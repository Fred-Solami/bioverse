import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import type { AuthUser } from '../auth/plugin.js';
import { rankTransport, type TransportOption } from './dispatch.js';

// Transport coordination endpoints, mounted under /api/v1/referrals. The
// referral's DISPATCHED/IN_TRANSIT phase already exists in the state machine and
// the escalation worker already alerts on transit delays; these endpoints fill
// in the dispatch: find the nearest available vehicle and assign it.

interface RefRow {
  from_facility_id: string;
  from_district: string | null;
}

// Visibility mirrors the match endpoint: the referring facility, its district
// officer, or MOH may coordinate transport for a referral.
function canCoordinate(user: AuthUser, ref: RefRow): boolean {
  if (user.role === 'MOH_ADMIN') return true;
  if (user.role === 'DISTRICT_OFFICER') return user.district != null && user.district === ref.from_district;
  return user.facilityId != null && user.facilityId === ref.from_facility_id;
}

async function loadRef(referralId: string): Promise<RefRow | null> {
  const { rows } = await pool.query<RefRow>(
    `SELECT r.from_facility_id, ff.district AS from_district
       FROM referrals r JOIN facilities ff ON ff.id = r.from_facility_id
      WHERE r.id = $1`,
    [referralId],
  );
  return rows[0] ?? null;
}

export async function transportRoutes(app: FastifyInstance): Promise<void> {
  // GET /referrals/:id/transport/options — nearest available vehicles.
  app.get<{ Params: { id: string } }>(
    '/:id/transport/options',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.authUser!;
      const ref = await loadRef(req.params.id);
      if (!ref) return reply.code(404).send({ error: 'not found' });
      if (!canCoordinate(user, ref)) return reply.code(404).send({ error: 'not found' });

      const { rows } = await pool.query<TransportOption>(
        `WITH ref AS (
           SELECT ff.location AS from_location
             FROM referrals r JOIN facilities ff ON ff.id = r.from_facility_id
            WHERE r.id = $1
         )
         SELECT t.id, t.name, t.vehicle_type, t.contact_phone, t.district,
           CASE WHEN t.location IS NOT NULL AND ref.from_location IS NOT NULL
                THEN ST_Distance(t.location, ref.from_location) END AS distance_m
         FROM transport_resources t, ref
         WHERE t.is_available = true
         ORDER BY distance_m NULLS LAST
         LIMIT 25`,
        [req.params.id],
      );

      const options = rankTransport(rows);
      return reply.send({ referral_id: req.params.id, count: options.length, options });
    },
  );

  // POST /referrals/:id/transport — assign a vehicle to the referral.
  app.post<{
    Params: { id: string };
    Body: { resource_id?: string; driver_name?: string; contact_phone?: string; eta_minutes?: number; notes?: string };
  }>(
    '/:id/transport',
    {
      preHandler: [app.authenticate],
      config: { audit: { action: 'UPDATE', entityType: 'referral' } },
    },
    async (req, reply) => {
      const user = req.authUser!;
      const b = req.body ?? {};
      if (!b.resource_id) return reply.code(400).send({ error: 'resource_id is required' });

      const ref = await loadRef(req.params.id);
      if (!ref) return reply.code(404).send({ error: 'not found' });
      if (!canCoordinate(user, ref)) return reply.code(404).send({ error: 'not found' });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Reject a second assignment for slice 1 (re-dispatch comes later).
        const existing = await client.query(
          `SELECT 1 FROM referral_transport WHERE referral_id = $1`,
          [req.params.id],
        );
        if (existing.rows[0]) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'transport already assigned' });
        }

        // Claim the vehicle only if still available (guards against a race).
        const claimed = await client.query(
          `UPDATE transport_resources SET is_available = false
            WHERE id = $1 AND is_available = true
            RETURNING id`,
          [b.resource_id],
        );
        if (!claimed.rows[0]) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'vehicle no longer available' });
        }

        const { rows } = await client.query(
          `INSERT INTO referral_transport
             (referral_id, resource_id, status, driver_name, contact_phone, eta_minutes, notes, requested_by)
           VALUES ($1, $2, 'DISPATCHED', $3, $4, $5, $6, $7)
           RETURNING id, referral_id, resource_id, status, eta_minutes`,
          [
            req.params.id,
            b.resource_id,
            b.driver_name ?? null,
            b.contact_phone ?? null,
            b.eta_minutes ?? null,
            b.notes ?? null,
            user.sub,
          ],
        );
        await client.query('COMMIT');

        req.auditContext = { entityId: req.params.id, detail: { transport: b.resource_id } };
        return reply.code(201).send(rows[0]);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // GET /referrals/:id/transport — the current assignment, if any.
  app.get<{ Params: { id: string } }>(
    '/:id/transport',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const user = req.authUser!;
      const ref = await loadRef(req.params.id);
      if (!ref) return reply.code(404).send({ error: 'not found' });
      if (!canCoordinate(user, ref)) return reply.code(404).send({ error: 'not found' });

      const { rows } = await pool.query(
        `SELECT rt.id, rt.status, rt.driver_name, rt.contact_phone, rt.eta_minutes, rt.notes,
                rt.created_at, t.name AS vehicle_name, t.vehicle_type, t.contact_phone AS vehicle_phone
           FROM referral_transport rt
           JOIN transport_resources t ON t.id = rt.resource_id
          WHERE rt.referral_id = $1`,
        [req.params.id],
      );
      return reply.send({ referral_id: req.params.id, transport: rows[0] ?? null });
    },
  );
}
