import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { CAN_CREATE_REFERRAL, hasOversight } from '../auth/roles.js';
import type { AuthUser } from '../auth/plugin.js';
import { checkTransition, isStatus, type Status } from './stateMachine.js';

interface CreateBody {
  patient_id?: string;
  from_facility_id?: string;
  to_facility_id?: string;
  pathway?: string;
  reason?: string;
  clinical_summary?: string;
  danger_signs?: unknown[];
  required_capabilities?: unknown[];
  priority?: string;
  event_id?: string; // client-generated UUID of the INITIATED event (idempotency)
  occurred_at?: string;
}

interface TransitionBody {
  to_status?: string;
  note?: string;
  payload?: Record<string, unknown>;
  to_facility_id?: string; // used when to_status = MATCHED
  event_id?: string; // client-generated UUID (idempotent replay)
  occurred_at?: string;
}

const PRIORITIES = ['EMERGENCY', 'URGENT', 'ROUTINE'];

interface ReferralRow {
  id: string;
  reference: string;
  patient_id: string;
  from_facility_id: string;
  to_facility_id: string | null;
  current_status: Status;
}

async function loadTimeline(referralId: string) {
  const [{ rows: refRows }, { rows: events }] = await Promise.all([
    pool.query(
      `SELECT r.*, ff.name AS from_facility_name, tf.name AS to_facility_name
         FROM referrals r
         JOIN facilities ff ON ff.id = r.from_facility_id
         LEFT JOIN facilities tf ON tf.id = r.to_facility_id
        WHERE r.id = $1`,
      [referralId],
    ),
    pool.query(
      `SELECT id, from_status, to_status, actor_user_id, actor_facility_id,
              note, payload, occurred_at, recorded_at
         FROM referral_events WHERE referral_id = $1
        ORDER BY occurred_at ASC, recorded_at ASC`,
      [referralId],
    ),
  ]);
  if (!refRows[0]) return null;
  return { referral: refRows[0], events };
}

// Can this user see this referral? Facility staff: only their facility's in/out
// referrals. District officer: anything touching a facility in their district.
// MOH_ADMIN: everything.
function canView(user: AuthUser, r: ReferralRow, fromDistrict: string | null, toDistrict: string | null): boolean {
  if (user.role === 'MOH_ADMIN') return true;
  if (user.role === 'DISTRICT_OFFICER') {
    return user.district != null && (user.district === fromDistrict || user.district === toDistrict);
  }
  return (
    user.facilityId != null &&
    (user.facilityId === r.from_facility_id || user.facilityId === r.to_facility_id)
  );
}

export async function referralRoutes(app: FastifyInstance): Promise<void> {
  // POST /referrals — create in INITIATED, append the opening event. Idempotent
  // on the client event_id so an offline replay returns the same referral.
  app.post<{ Body: CreateBody }>(
    '/',
    {
      preHandler: [app.authenticate, app.requireRole(...CAN_CREATE_REFERRAL)],
      config: { audit: { action: 'CREATE', entityType: 'referral' } },
    },
    async (req, reply) => {
      const user = req.authUser!;
      const b = req.body ?? {};

      const fromFacilityId = b.from_facility_id ?? user.facilityId;
      if (!b.patient_id || !b.reason || !b.priority || !fromFacilityId) {
        return reply.code(400).send({ error: 'patient_id, reason, priority, and a from facility are required' });
      }
      if (!PRIORITIES.includes(b.priority)) {
        return reply.code(400).send({ error: `priority must be one of ${PRIORITIES.join(', ')}` });
      }
      // Non-oversight users may only refer from their own facility.
      if (!hasOversight(user.role) && fromFacilityId !== user.facilityId) {
        return reply.code(403).send({ error: 'cannot refer on behalf of another facility' });
      }

      // Idempotent replay: the opening event id already exists → return as-is.
      if (b.event_id) {
        const { rows } = await pool.query<{ referral_id: string }>(
          `SELECT referral_id FROM referral_events WHERE id = $1`,
          [b.event_id],
        );
        if (rows[0]) {
          const existing = await loadTimeline(rows[0].referral_id);
          req.auditContext = { entityId: rows[0].referral_id, detail: { replay: true } };
          return reply.code(200).send(existing);
        }
      }

      const occurredAt = b.occurred_at ?? new Date().toISOString();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const year = new Date().getFullYear();
        const { rows: seqRows } = await client.query<{ n: string }>(
          `SELECT nextval('referral_reference_seq') AS n`,
        );
        const reference = `REF-${year}-${seqRows[0]!.n.padStart(6, '0')}`;

        const { rows: created } = await client.query<ReferralRow>(
          `INSERT INTO referrals
             (reference, patient_id, from_facility_id, to_facility_id, referring_user_id,
              pathway, reason, clinical_summary, danger_signs, required_capabilities,
              priority, current_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'INITIATED')
           RETURNING id, reference, patient_id, from_facility_id, to_facility_id, current_status`,
          [
            reference,
            b.patient_id,
            fromFacilityId,
            b.to_facility_id ?? null,
            user.sub,
            b.pathway ?? 'MATERNAL',
            b.reason,
            b.clinical_summary ?? null,
            JSON.stringify(b.danger_signs ?? []),
            JSON.stringify(b.required_capabilities ?? []),
            b.priority,
          ],
        );
        const referral = created[0]!; // INSERT ... RETURNING always yields one row

        await client.query(
          `INSERT INTO referral_events
             (id, referral_id, from_status, to_status, actor_user_id, actor_facility_id, note, payload, occurred_at)
           VALUES (COALESCE($1, gen_random_uuid()), $2, NULL, 'INITIATED', $3, $4, $5, '{}', $6)`,
          [b.event_id ?? null, referral.id, user.sub, fromFacilityId, b.reason, occurredAt],
        );
        await client.query('COMMIT');

        req.auditContext = { entityId: referral.id, detail: { reference, patient_id: b.patient_id } };
        const timeline = await loadTimeline(referral.id);
        return reply.code(201).send(timeline);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // GET /referrals/:id — full timeline (referral + append-only event log).
  app.get<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [app.authenticate],
      config: { audit: { action: 'READ', entityType: 'referral' } },
    },
    async (req, reply) => {
      const user = req.authUser!;
      const timeline = await loadTimeline(req.params.id);
      if (!timeline) return reply.code(404).send({ error: 'not found' });

      const r = timeline.referral as ReferralRow & { from_district?: string; to_district?: string };
      const { rows: dist } = await pool.query<{ from_district: string | null; to_district: string | null }>(
        `SELECT ff.district AS from_district, tf.district AS to_district
           FROM referrals r
           JOIN facilities ff ON ff.id = r.from_facility_id
           LEFT JOIN facilities tf ON tf.id = r.to_facility_id
          WHERE r.id = $1`,
        [req.params.id],
      );
      if (!canView(user, r, dist[0]?.from_district ?? null, dist[0]?.to_district ?? null)) {
        return reply.code(404).send({ error: 'not found' });
      }

      req.auditContext = { entityId: r.id, detail: { patient_id: r.patient_id } };
      return reply.send(timeline);
    },
  );

  // GET /referrals?status=&facility=&priority= — role-scoped list.
  app.get<{ Querystring: { status?: string; facility?: string; priority?: string } }>(
    '/',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.authUser!;
      const { status, facility, priority } = req.query;
      const conds: string[] = [];
      const params: unknown[] = [];

      if (user.role === 'MOH_ADMIN') {
        // no scope restriction
      } else if (user.role === 'DISTRICT_OFFICER') {
        if (!user.district) return reply.send({ count: 0, referrals: [] });
        params.push(user.district);
        conds.push(`(ff.district = $${params.length} OR tf.district = $${params.length})`);
      } else {
        if (!user.facilityId) return reply.send({ count: 0, referrals: [] });
        params.push(user.facilityId);
        conds.push(`(r.from_facility_id = $${params.length} OR r.to_facility_id = $${params.length})`);
      }

      if (status) {
        params.push(status);
        conds.push(`r.current_status = $${params.length}`);
      }
      if (priority) {
        params.push(priority);
        conds.push(`r.priority = $${params.length}`);
      }
      if (facility) {
        params.push(facility);
        conds.push(`(r.from_facility_id = $${params.length} OR r.to_facility_id = $${params.length})`);
      }

      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT r.id, r.reference, r.patient_id, r.from_facility_id, r.to_facility_id,
                r.priority, r.pathway, r.current_status, r.created_at,
                ff.name AS from_facility_name, tf.name AS to_facility_name
           FROM referrals r
           JOIN facilities ff ON ff.id = r.from_facility_id
           LEFT JOIN facilities tf ON tf.id = r.to_facility_id
           ${where}
          ORDER BY r.created_at DESC
          LIMIT 200`,
        params,
      );
      return reply.send({ count: rows.length, referrals: rows });
    },
  );

  // POST /referrals/:id/transition — the one gate every state change passes.
  app.post<{ Params: { id: string }; Body: TransitionBody }>(
    '/:id/transition',
    {
      preHandler: [app.authenticate],
      config: { audit: { action: 'UPDATE', entityType: 'referral' } },
    },
    async (req, reply) => {
      const user = req.authUser!;
      const b = req.body ?? {};
      if (!isStatus(b.to_status)) {
        return reply.code(400).send({ error: 'valid to_status required' });
      }
      const to = b.to_status;

      // Idempotent replay: this event id already recorded → return current state.
      if (b.event_id) {
        const { rows } = await pool.query(
          `SELECT 1 FROM referral_events WHERE id = $1 AND referral_id = $2`,
          [b.event_id, req.params.id],
        );
        if (rows[0]) {
          const timeline = await loadTimeline(req.params.id);
          req.auditContext = { entityId: req.params.id, detail: { replay: true, to } };
          return reply.code(200).send(timeline);
        }
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query<ReferralRow>(
          `SELECT id, reference, patient_id, from_facility_id, to_facility_id, current_status
             FROM referrals WHERE id = $1 FOR UPDATE`,
          [req.params.id],
        );
        const referral = rows[0];
        if (!referral) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'not found' });
        }

        // MATCHED may assign the receiving facility; carry it into the check.
        const nextToFacility =
          to === 'MATCHED' ? b.to_facility_id ?? referral.to_facility_id : referral.to_facility_id;

        const check = checkTransition(
          referral.current_status,
          to,
          { role: user.role, facilityId: user.facilityId },
          { fromFacilityId: referral.from_facility_id, toFacilityId: nextToFacility },
          b.note,
        );
        if (!check.ok) {
          await client.query('ROLLBACK');
          return reply.code(check.code).send({ error: check.error });
        }

        await client.query(
          `INSERT INTO referral_events
             (id, referral_id, from_status, to_status, actor_user_id, actor_facility_id, note, payload, occurred_at)
           VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            b.event_id ?? null,
            referral.id,
            referral.current_status,
            to,
            user.sub,
            user.facilityId,
            b.note ?? null,
            JSON.stringify(b.payload ?? {}),
            b.occurred_at ?? new Date().toISOString(),
          ],
        );

        const closedAt = to === 'CLOSED' ? 'now()' : 'closed_at';
        await client.query(
          `UPDATE referrals
              SET current_status = $1,
                  to_facility_id = $2,
                  closed_at = ${closedAt}
            WHERE id = $3`,
          [to, nextToFacility, referral.id],
        );
        await client.query('COMMIT');

        req.auditContext = {
          entityId: referral.id,
          detail: { from: referral.current_status, to, patient_id: referral.patient_id },
        };
        const timeline = await loadTimeline(referral.id);
        return reply.send(timeline);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );
}
