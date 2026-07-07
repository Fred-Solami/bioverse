import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { config } from '../config.js';

// Rotating refresh tokens (DESIGN.md §15). The raw token is a high-entropy
// random string returned to the client once; the DB stores only its SHA-256
// hash. Rotation chains via replaced_by. Presenting a token that has already
// been rotated away (revoked but reused) is treated as theft: the whole family
// is revoked. See migrations/0008_refresh_tokens.sql.

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function expiryFromNow(): Date {
  const d = new Date();
  d.setDate(d.getDate() + config.refreshTokenTtlDays);
  return d;
}

export interface IssuedRefresh {
  raw: string;
  id: string;
}

export async function issueRefreshToken(
  userId: string,
  client: PoolClient | typeof pool = pool,
): Promise<IssuedRefresh> {
  const raw = randomBytes(32).toString('base64url');
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3) RETURNING id`,
    [userId, hashToken(raw), expiryFromNow()],
  );
  return { raw, id: rows[0]!.id }; // INSERT ... RETURNING always yields one row
}

interface RefreshRow {
  id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface RotationResult {
  userId: string;
  refresh: IssuedRefresh;
}

// Validate + rotate in one transaction. Returns null when the token is unknown,
// expired, or a reuse-of-revoked (family already burned). On reuse detection we
// revoke every live token for the user before returning null.
export async function rotateRefreshToken(
  raw: string,
): Promise<RotationResult | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<RefreshRow>(
      `SELECT id, user_id, expires_at, revoked_at
         FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [hashToken(raw)],
    );
    const token = rows[0];

    if (!token) {
      await client.query('ROLLBACK');
      return null;
    }

    if (token.revoked_at) {
      // Reuse of an already-rotated token — burn the whole family.
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = now()
           WHERE user_id = $1 AND revoked_at IS NULL`,
        [token.user_id],
      );
      await client.query('COMMIT');
      return null;
    }

    if (token.expires_at.getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      return null;
    }

    const next = await issueRefreshToken(token.user_id, client);
    await client.query(
      `UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1`,
      [token.id, next.id],
    );
    await client.query('COMMIT');
    return { userId: token.user_id, refresh: next };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Logout: revoke a specific presented token (and thereby its family on next
// reuse). Idempotent — revoking an unknown/already-revoked token is a no-op.
export async function revokeRefreshToken(raw: string): Promise<void> {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(raw)],
  );
}
