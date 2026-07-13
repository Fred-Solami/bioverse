import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { computeKpis, type ReferralMilestones } from './kpis.js';

// GET /api/v1/metrics - the coordination KPIs (DESIGN.md §20), role-scoped like
// the referral list: MOH sees the whole system, a district officer their
// district, facility staff their own facility's referrals (in and out).
export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = req.authUser!;
    const conds: string[] = [];
    const params: unknown[] = [];

    if (user.role === 'MOH_ADMIN') {
      // whole system
    } else if (user.role === 'DISTRICT_OFFICER') {
      if (!user.district) return reply.send({ scope: 'district', kpis: computeKpis([]) });
      params.push(user.district);
      conds.push(`(ff.district = $${params.length} OR tf.district = $${params.length})`);
    } else {
      if (!user.facilityId) return reply.send({ scope: 'facility', kpis: computeKpis([]) });
      params.push(user.facilityId);
      conds.push(`(r.from_facility_id = $${params.length} OR r.to_facility_id = $${params.length})`);
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const milestone = (status: string) =>
      `(SELECT max(occurred_at) FROM referral_events e WHERE e.referral_id = r.id AND e.to_status = '${status}')`;

    const { rows } = await pool.query<ReferralMilestones>(
      `SELECT r.current_status,
              r.created_at AS initiated_at,
              ${milestone('MATCHED')} AS matched_at,
              ${milestone('RECEIVED')} AS received_at,
              ${milestone('TREATED')} AS treated_at,
              ${milestone('FEEDBACK_RETURNED')} AS feedback_at
         FROM referrals r
         JOIN facilities ff ON ff.id = r.from_facility_id
         LEFT JOIN facilities tf ON tf.id = r.to_facility_id
         ${where}`,
      params,
    );

    const scope =
      user.role === 'MOH_ADMIN' ? 'system' : user.role === 'DISTRICT_OFFICER' ? 'district' : 'facility';
    return reply.send({ scope, kpis: computeKpis(rows) });
  });
}
