import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { pool } from './db.js';
import { authPlugin } from './auth/plugin.js';
import { auditPlugin } from './audit/plugin.js';
import { authRoutes } from './auth/routes.js';
import { registryRoutes } from './registry/routes.js';
import { identityRoutes, reviewQueueRoutes } from './identity/routes.js';
import { referralRoutes } from './referrals/routes.js';
import { transportRoutes } from './transport/routes.js';
import { alertRoutes } from './alerts/routes.js';
import { syncRoutes } from './sync/routes.js';
import { terminologyRoutes } from './terminology/routes.js';

export interface BuildOptions {
  logger?: boolean;
}

// Application factory (DESIGN.md §16 tree: server/src). Returning a built-but-
// unlistened instance lets tests drive the full plugin/route graph via
// app.inject() without binding a port. index.ts is the only place that listens.
export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  // Never let PII reach the logs (DESIGN.md §15). Bodies are not logged by
  // default; redact the auth header and cookies for good measure.
  const logger =
    opts.logger === false
      ? false
      : { redact: ['req.headers.authorization', 'req.headers.cookie'] };
  const app = Fastify({ logger });

  // Rate limiting is opt-in per route (global: false). Auth + patient-search
  // routes set `config.rateLimit` themselves (§15: "Rate limiting on auth +
  // search endpoints"); everything else is unthrottled at this layer.
  await app.register(rateLimit, { global: false });

  await app.register(auditPlugin);
  await app.register(authPlugin);

  app.get('/health', async () => {
    await pool.query('SELECT 1');
    return { status: 'ok', service: 'bioverse-server', db: 'up' };
  });

  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(registryRoutes, { prefix: '/api/v1/facilities' });
  await app.register(identityRoutes, { prefix: '/api/v1/patients' });
  await app.register(reviewQueueRoutes, { prefix: '/api/v1/identity' });
  await app.register(referralRoutes, { prefix: '/api/v1/referrals' });
  await app.register(transportRoutes, { prefix: '/api/v1/referrals' });
  await app.register(alertRoutes, { prefix: '/api/v1/alerts' });
  await app.register(syncRoutes, { prefix: '/api/v1/sync' });
  await app.register(terminologyRoutes, { prefix: '/api/v1/terminology' });

  return app;
}
