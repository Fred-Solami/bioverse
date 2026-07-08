import type { FastifyInstance } from 'fastify';
import {
  MATERNAL_DANGER_SIGNS,
  FACILITY_CAPABILITIES,
  CODE_SYSTEMS,
} from './valueSets.js';

// GET /api/v1/terminology — the coded value sets that drive the facility PWA's
// danger-sign checklist and capability pickers. Serving them (rather than
// bundling a copy in the client) keeps the UI's vocabulary identical to what
// the server validates against, so the two can never drift.
export async function terminologyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.authenticate] }, async () => ({
    systems: CODE_SYSTEMS,
    danger_signs: MATERNAL_DANGER_SIGNS,
    capabilities: FACILITY_CAPABILITIES,
  }));
}
