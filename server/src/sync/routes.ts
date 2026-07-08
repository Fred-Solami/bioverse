import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import type { AuthUser } from '../auth/plugin.js';
import { applyPushedEvent, type PushEvent } from './service.js';

const MAX_PUSH = 200;

// Offline sync (DESIGN.md §13). The append-only referral_events log IS the sync
// unit: every change is an event with a client UUID and timestamps. Pull hands
// the client role-scoped event deltas since a server-time watermark; push
// (added next) replays the client's queued events. The watermark is recorded_at
// (server time), not occurred_at (client time), so deltas are monotonic and
// nothing is skipped when devices have skewed clocks.

interface PullQuery {
  client_id?: string;
  since?: string;
  limit?: string;
}

const MAX_PULL = 500;

// Role-scoped visibility, mirroring the referral list: facility staff see their
// facility's referrals (in or out), district officers their district, MOH all.
// Returns a WHERE fragment plus its params (offset by the caller's param count).
function scopeClause(user: AuthUser, startIndex: number): { sql: string; params: unknown[] } {
  if (user.role === 'MOH_ADMIN') return { sql: 'TRUE', params: [] };
  if (user.role === 'DISTRICT_OFFICER') {
    return {
      sql: `(ff.district = $${startIndex} OR tf.district = $${startIndex})`,
      params: [user.district],
    };
  }
  return {
    sql: `(r.from_facility_id = $${startIndex} OR r.to_facility_id = $${startIndex})`,
    params: [user.facilityId],
  };
}

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  // POST /sync/push — replay a batch of events queued offline. Each event is
  // applied independently and idempotently (on its client UUID); one rejection
  // never blocks the rest. Returns a per-event accept/reject result the client
  // uses to clear its queue or surface a conflict (DESIGN.md §13).
  app.post<{ Body: { client_id?: string; events?: PushEvent[] } }>(
    '/push',
    {
      preHandler: [app.authenticate],
      config: { audit: { action: 'UPDATE', entityType: 'sync' } },
    },
    async (req, reply) => {
      const user = req.authUser!;
      const { client_id, events } = req.body ?? {};
      if (!client_id) return reply.code(400).send({ error: 'client_id is required' });
      if (!Array.isArray(events)) return reply.code(400).send({ error: 'events must be an array' });
      if (events.length > MAX_PUSH) {
        return reply.code(413).send({ error: `at most ${MAX_PUSH} events per push` });
      }

      const results = [];
      for (const ev of events) {
        results.push(await applyPushedEvent(ev, user));
      }
      const accepted = results.filter((r) => r.status === 'accepted').length;

      req.auditContext = {
        detail: { client_id, accepted, rejected: results.length - accepted },
      };
      return reply.send({ accepted, rejected: results.length - accepted, results });
    },
  );

  // GET /sync/pull?client_id=&since=&limit= — role-scoped event deltas.
  app.get<{ Querystring: PullQuery }>(
    '/pull',
    {
      preHandler: [app.authenticate],
      config: { audit: { action: 'READ', entityType: 'sync' } },
    },
    async (req, reply) => {
      const user = req.authUser!;
      const clientId = req.query.client_id;
      if (!clientId) return reply.code(400).send({ error: 'client_id is required' });

      // Scope-less roles still need an anchor; a facility/district user without
      // one sees nothing rather than everything.
      if (user.role === 'DISTRICT_OFFICER' && !user.district) {
        return reply.send({ cursor: req.query.since ?? null, count: 0, events: [] });
      }
      if (
        (user.role === 'CHW' || user.role === 'FACILITY_STAFF' || user.role === 'FACILITY_INCHARGE') &&
        !user.facilityId
      ) {
        return reply.send({ cursor: req.query.since ?? null, count: 0, events: [] });
      }

      // The cursor is an opaque monotonic token (the last delivered seq), not a
      // wall-clock time — immune to microsecond truncation and device clock
      // skew. Explicit query wins; else resume from the stored cursor; else 0.
      let since = req.query.since ?? null;
      if (since === null) {
        const { rows } = await pool.query<{ last_seq: string }>(
          `SELECT last_seq FROM sync_cursors WHERE client_id = $1 AND user_id = $2`,
          [clientId, user.sub],
        );
        since = rows[0] ? rows[0].last_seq : '0';
      }

      const limit = Math.min(Number(req.query.limit) || MAX_PULL, MAX_PULL);
      const scope = scopeClause(user, 2);
      const params: unknown[] = [since, ...scope.params];

      const { rows: events } = await pool.query<{ seq: string }>(
        `SELECT e.seq, e.id AS event_id, e.referral_id, e.from_status, e.to_status,
                e.actor_user_id, e.actor_facility_id, e.note, e.payload,
                e.occurred_at, e.recorded_at,
                r.reference, r.current_status, r.patient_id, r.priority,
                r.from_facility_id, r.to_facility_id
           FROM referral_events e
           JOIN referrals r  ON r.id = e.referral_id
           JOIN facilities ff ON ff.id = r.from_facility_id
           LEFT JOIN facilities tf ON tf.id = r.to_facility_id
          WHERE e.seq > $1::bigint AND ${scope.sql}
          ORDER BY e.seq ASC
          LIMIT ${limit}`,
        params,
      );

      // New cursor = the last delivered seq, or hold at `since` when nothing was
      // new. Never advance past what we actually returned.
      const lastEvent = events[events.length - 1];
      const cursor = lastEvent ? lastEvent.seq : since;

      await pool.query(
        `INSERT INTO sync_cursors (client_id, user_id, last_pulled, last_seq)
         VALUES ($1, $2, now(), $3::bigint)
         ON CONFLICT (client_id, user_id)
           DO UPDATE SET last_pulled = now(), last_seq = EXCLUDED.last_seq`,
        [clientId, user.sub, cursor],
      );

      req.auditContext = { detail: { client_id: clientId, delivered: events.length } };
      return reply.send({ cursor, count: events.length, events });
    },
  );
}
