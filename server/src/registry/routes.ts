import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';

interface FacilityQuery {
  district?: string;
  capability?: string;
}

// Facility registry (MFL data). Public reference data, but now behind auth like
// the rest of the v0.1 surface — an unauthenticated caller has no business
// enumerating the network. Not patient data, so no audit hook.
export async function registryRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: FacilityQuery }>(
    '/',
    { preHandler: [app.authenticate] },
    async (request) => {
      const { district, capability } = request.query;
      const conditions: string[] = ['is_active = true'];
      const params: string[] = [];

      if (district) {
        params.push(district);
        conditions.push(`district = $${params.length}`);
      }
      if (capability) {
        params.push(capability);
        conditions.push(`(capabilities ->> $${params.length})::boolean IS TRUE`);
      }

      const { rows } = await pool.query(
        `SELECT id, zhfr_code, name, facility_type, ownership, district, province,
                ST_X(location::geometry) AS longitude,
                ST_Y(location::geometry) AS latitude,
                capabilities
           FROM facilities
          WHERE ${conditions.join(' AND ')}
          ORDER BY district, name`,
        params,
      );
      return { count: rows.length, facilities: rows };
    },
  );
}
