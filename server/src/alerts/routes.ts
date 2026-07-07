import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';

// In-app alert delivery (DESIGN.md §10). Alerts are raised by the escalation
// worker; here users read the ones addressed to them and acknowledge them.
// Scoping mirrors referral visibility: district officers see their district's
// alerts, facility staff see alerts naming their facility, MOH sees all.
export async function alertRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { status?: string } }>(
    '/',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.authUser!;
      const conds: string[] = [];
      const params: unknown[] = [];

      if (user.role === 'MOH_ADMIN') {
        // no restriction
      } else if (user.role === 'DISTRICT_OFFICER') {
        if (!user.district) return reply.send({ count: 0, alerts: [] });
        params.push(user.district);
        conds.push(`a.district = $${params.length}`);
      } else {
        if (!user.facilityId) return reply.send({ count: 0, alerts: [] });
        params.push(user.facilityId);
        conds.push(`$${params.length} = ANY(a.facility_ids)`);
      }

      if (req.query.status) {
        params.push(req.query.status);
        conds.push(`a.status = $${params.length}`);
      }

      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT a.id, a.referral_id, a.alert_type, a.severity, a.district,
                a.status, a.created_at, r.reference, r.priority, r.current_status
           FROM referral_alerts a
           JOIN referrals r ON r.id = a.referral_id
           ${where}
          ORDER BY (a.severity = 'CRITICAL') DESC, a.created_at DESC
          LIMIT 200`,
        params,
      );
      return reply.send({ count: rows.length, alerts: rows });
    },
  );

  // POST /alerts/:id/ack — acknowledge, scoped so a user can only ack an alert
  // actually addressed to them.
  app.post<{ Params: { id: string } }>(
    '/:id/ack',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.authUser!;
      const scope: string[] = [];
      const params: unknown[] = [req.params.id, user.sub];

      if (user.role === 'MOH_ADMIN') {
        // may ack anything
      } else if (user.role === 'DISTRICT_OFFICER') {
        if (!user.district) return reply.code(404).send({ error: 'not found' });
        params.push(user.district);
        scope.push(`district = $${params.length}`);
      } else {
        if (!user.facilityId) return reply.code(404).send({ error: 'not found' });
        params.push(user.facilityId);
        scope.push(`$${params.length} = ANY(facility_ids)`);
      }

      const scopeSql = scope.length ? `AND (${scope.join(' OR ')})` : '';
      const { rows } = await pool.query(
        `UPDATE referral_alerts
            SET status = 'ACKNOWLEDGED', acknowledged_by = $2, acknowledged_at = now()
          WHERE id = $1 AND status = 'OPEN' ${scopeSql}
          RETURNING id, status`,
        params,
      );
      if (!rows[0]) return reply.code(404).send({ error: 'not found or already acknowledged' });
      return reply.send(rows[0]);
    },
  );
}
