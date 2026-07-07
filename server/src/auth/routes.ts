import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { config } from '../config.js';
import { verifyPassword, verifyDummy } from './passwords.js';
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} from './tokens.js';
import type { AuthUser } from './plugin.js';
import { isRole } from './roles.js';

const REFRESH_COOKIE = 'bv_refresh';

interface LoginBody {
  username?: string;
  password?: string;
}

interface UserRow {
  id: string;
  password_hash: string;
  role: string;
  facility_id: string | null;
  district: string | null;
  is_active: boolean;
}

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict' as const,
    path: '/api/v1/auth',
    maxAge: config.refreshTokenTtlDays * 24 * 60 * 60,
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /login — verify credentials, issue access token + refresh cookie.
  app.post<{ Body: LoginBody }>(
    '/login',
    {
      config: {
        audit: { action: 'LOGIN', entityType: 'user' },
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
    },
    async (req, reply) => {
      const { username, password } = req.body ?? {};
      if (!username || !password) {
        return reply.code(400).send({ error: 'username and password required' });
      }

      const { rows } = await pool.query<UserRow>(
        `SELECT id, password_hash, role, facility_id, district, is_active
           FROM users WHERE username = $1`,
        [username],
      );
      const user = rows[0];

      const ok =
        user && user.is_active
          ? await verifyPassword(user.password_hash, password)
          : // Spend equivalent hash time so username presence is not observable
            // via response timing.
            await verifyDummy(password);

      if (!user || !user.is_active || !ok || !isRole(user.role)) {
        req.auditContext = { action: 'LOGIN', actorUserId: user?.id ?? null, detail: { outcome: 'FAILED' } };
        return reply.code(401).send({ error: 'invalid credentials' });
      }

      const authUser: AuthUser = {
        sub: user.id,
        role: user.role,
        facilityId: user.facility_id,
        district: user.district,
      };
      const accessToken = await reply.jwtSign(authUser);
      const refresh = await issueRefreshToken(user.id);

      req.auditContext = { actorUserId: user.id, entityId: user.id, detail: { outcome: 'SUCCESS' } };
      return reply
        .setCookie(REFRESH_COOKIE, refresh.raw, refreshCookieOptions())
        .send({ accessToken, user: authUser });
    },
  );

  // POST /refresh — rotate the refresh cookie, mint a fresh access token.
  app.post(
    '/refresh',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (!raw) return reply.code(401).send({ error: 'no refresh token' });

    const rotated = await rotateRefreshToken(raw);
    if (!rotated) {
      return reply
        .clearCookie(REFRESH_COOKIE, refreshCookieOptions())
        .code(401)
        .send({ error: 'invalid refresh token' });
    }

    const { rows } = await pool.query<UserRow>(
      `SELECT id, password_hash, role, facility_id, district, is_active
         FROM users WHERE id = $1`,
      [rotated.userId],
    );
    const user = rows[0];
    if (!user || !user.is_active || !isRole(user.role)) {
      return reply.code(401).send({ error: 'invalid refresh token' });
    }

    const authUser: AuthUser = {
      sub: user.id,
      role: user.role,
      facilityId: user.facility_id,
      district: user.district,
    };
    const accessToken = await reply.jwtSign(authUser);
    return reply
      .setCookie(REFRESH_COOKIE, rotated.refresh.raw, refreshCookieOptions())
      .send({ accessToken, user: authUser });
  });

  // POST /logout — revoke the presented refresh token and clear the cookie.
  app.post('/logout', async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (raw) await revokeRefreshToken(raw);
    return reply
      .clearCookie(REFRESH_COOKIE, refreshCookieOptions())
      .send({ ok: true });
  });
}
