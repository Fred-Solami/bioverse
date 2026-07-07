import Fastify from 'fastify';
import { pool } from './db.js';
import { config } from './config.js';

// Phase 0 bootstrap server: health check + read-only facility registry.
// JWT auth, RBAC, and audit middleware land in v0.1 (DESIGN.md §14/§17);
// facilities are public MFL data, so this read-only surface predates auth.

const app = Fastify({ logger: true });

app.get('/health', async () => {
  await pool.query('SELECT 1');
  return { status: 'ok', service: 'bioverse-server', db: 'up' };
});

interface FacilityQuery {
  district?: string;
  capability?: string;
}

app.get<{ Querystring: FacilityQuery }>(
  '/api/v1/facilities',
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

app
  .listen({ port: config.port, host: config.host })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
