import { pool } from '../db.js';
import { checkTransition, isStatus } from '../referrals/stateMachine.js';
import { isCapability, isDangerSign, validateCodes } from '../terminology/valueSets.js';
import { CAN_CREATE_REFERRAL, hasOversight } from '../auth/roles.js';
import type { AuthUser } from '../auth/plugin.js';

// Push apply logic (DESIGN.md §13). Replays events the client queued offline.
// The RULES are the shared source of truth — checkTransition (state machine) and
// the terminology validators — so a synced event is validated identically to
// one posted online; only the thin INSERT/UPDATE SQL lives here. Every event is
// idempotent on its client UUID, so replaying a batch after a flaky connection
// never double-applies.

const PRIORITIES = ['EMERGENCY', 'URGENT', 'ROUTINE'];

export interface PushEvent {
  event_id?: string;
  kind?: 'CREATE' | 'TRANSITION';
  referral_id?: string; // client-generated for CREATE, existing for TRANSITION
  occurred_at?: string;
  // CREATE
  referral?: {
    patient_id?: string;
    from_facility_id?: string;
    to_facility_id?: string;
    pathway?: string;
    reason?: string;
    clinical_summary?: string;
    danger_signs?: unknown[];
    required_capabilities?: unknown[];
    priority?: string;
  };
  // TRANSITION
  to_status?: string;
  note?: string;
  payload?: Record<string, unknown>;
  to_facility_id?: string;
}

export interface PushResult {
  event_id: string | null;
  status: 'accepted' | 'rejected';
  referral_id?: string;
  reference?: string; // assigned server-side on CREATE
  reason?: string;
}

function reject(event_id: string | null, reason: string): PushResult {
  return { event_id, status: 'rejected', reason };
}

export async function applyPushedEvent(ev: PushEvent, actor: AuthUser): Promise<PushResult> {
  if (!ev.event_id) return reject(null, 'event_id is required');

  // Idempotent replay: this client event was already recorded → accept as-is.
  const seen = await pool.query<{ referral_id: string }>(
    `SELECT referral_id FROM referral_events WHERE id = $1`,
    [ev.event_id],
  );
  if (seen.rows[0]) {
    return { event_id: ev.event_id, status: 'accepted', referral_id: seen.rows[0].referral_id, reason: 'replay' };
  }

  if (ev.kind === 'CREATE') return applyCreate(ev, actor);
  if (ev.kind === 'TRANSITION') return applyTransition(ev, actor);
  return reject(ev.event_id, 'kind must be CREATE or TRANSITION');
}

async function applyCreate(ev: PushEvent, actor: AuthUser): Promise<PushResult> {
  const r = ev.referral ?? {};
  if (!ev.referral_id) return reject(ev.event_id!, 'referral_id (client-generated) is required for CREATE');
  if (!CAN_CREATE_REFERRAL.includes(actor.role)) return reject(ev.event_id!, 'role may not create referrals');

  const fromFacilityId = r.from_facility_id ?? actor.facilityId;
  if (!r.patient_id || !r.reason || !r.priority || !fromFacilityId) {
    return reject(ev.event_id!, 'patient_id, reason, priority and a from facility are required');
  }
  if (!PRIORITIES.includes(r.priority)) return reject(ev.event_id!, 'invalid priority');
  if (!hasOversight(actor.role) && fromFacilityId !== actor.facilityId) {
    return reject(ev.event_id!, 'cannot refer on behalf of another facility');
  }
  if (validateCodes(r.danger_signs, isDangerSign).unknown.length) {
    return reject(ev.event_id!, 'unknown danger_signs');
  }
  if (validateCodes(r.required_capabilities, isCapability).unknown.length) {
    return reject(ev.event_id!, 'unknown required_capabilities');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const year = new Date().getFullYear();
    const { rows: seqRows } = await client.query<{ n: string }>(
      `SELECT nextval('referral_reference_seq') AS n`,
    );
    const reference = `REF-${year}-${seqRows[0]!.n.padStart(6, '0')}`;

    // Referral id is the client-generated UUID, so offline transitions queued
    // against it before sync resolve to the same row.
    await client.query(
      `INSERT INTO referrals
         (id, reference, patient_id, from_facility_id, to_facility_id, referring_user_id,
          pathway, reason, clinical_summary, danger_signs, required_capabilities,
          priority, current_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'INITIATED')`,
      [
        ev.referral_id,
        reference,
        r.patient_id,
        fromFacilityId,
        r.to_facility_id ?? null,
        actor.sub,
        r.pathway ?? 'MATERNAL',
        r.reason,
        r.clinical_summary ?? null,
        JSON.stringify(r.danger_signs ?? []),
        JSON.stringify(r.required_capabilities ?? []),
        r.priority,
      ],
    );
    await client.query(
      `INSERT INTO referral_events
         (id, referral_id, from_status, to_status, actor_user_id, actor_facility_id, note, payload, occurred_at)
       VALUES ($1, $2, NULL, 'INITIATED', $3, $4, $5, '{}', $6)`,
      [ev.event_id, ev.referral_id, actor.sub, fromFacilityId, r.reason, ev.occurred_at ?? new Date().toISOString()],
    );
    await client.query('COMMIT');
    return { event_id: ev.event_id!, status: 'accepted', referral_id: ev.referral_id, reference };
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as { code?: string }).code === '23505') {
      return reject(ev.event_id!, 'referral already exists');
    }
    throw err;
  } finally {
    client.release();
  }
}

async function applyTransition(ev: PushEvent, actor: AuthUser): Promise<PushResult> {
  if (!ev.referral_id || !isStatus(ev.to_status)) {
    return reject(ev.event_id!, 'referral_id and a valid to_status are required');
  }
  const to = ev.to_status;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      id: string;
      from_facility_id: string;
      to_facility_id: string | null;
      current_status: string;
    }>(
      `SELECT id, from_facility_id, to_facility_id, current_status
         FROM referrals WHERE id = $1 FOR UPDATE`,
      [ev.referral_id],
    );
    const referral = rows[0];
    if (!referral) {
      await client.query('ROLLBACK');
      return reject(ev.event_id!, 'referral not found');
    }

    const nextToFacility =
      to === 'MATCHED' ? ev.to_facility_id ?? referral.to_facility_id : referral.to_facility_id;

    const check = checkTransition(
      referral.current_status as Parameters<typeof checkTransition>[0],
      to,
      { role: actor.role, facilityId: actor.facilityId },
      { fromFacilityId: referral.from_facility_id, toFacilityId: nextToFacility },
      ev.note,
    );
    if (!check.ok) {
      await client.query('ROLLBACK');
      return reject(ev.event_id!, check.error);
    }

    await client.query(
      `INSERT INTO referral_events
         (id, referral_id, from_status, to_status, actor_user_id, actor_facility_id, note, payload, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        ev.event_id,
        referral.id,
        referral.current_status,
        to,
        actor.sub,
        actor.facilityId,
        ev.note ?? null,
        JSON.stringify(ev.payload ?? {}),
        ev.occurred_at ?? new Date().toISOString(),
      ],
    );
    const closedAt = to === 'CLOSED' ? 'now()' : 'closed_at';
    await client.query(
      `UPDATE referrals SET current_status = $1, to_facility_id = $2, closed_at = ${closedAt} WHERE id = $3`,
      [to, nextToFacility, referral.id],
    );
    await client.query('COMMIT');
    return { event_id: ev.event_id!, status: 'accepted', referral_id: referral.id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
