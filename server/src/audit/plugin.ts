import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { pool } from '../db.js';

// Central audit (DESIGN.md §15: "Central audit middleware on all patient-data
// routes — enforced, not per-handler discipline"; Data Protection Act No. 3 of
// 2021). A route opts in via its `config.audit`; the onResponse hook then writes
// exactly one audit_log row per successful request, reading the entity id/detail
// the handler recorded. Handlers cannot forget to log — they can only enrich.

export type AuditAction = 'READ' | 'CREATE' | 'UPDATE' | 'EXPORT' | 'LOGIN';

export interface AuditConfig {
  action: AuditAction;
  entityType: string;
}

// What a handler contributes to the audit row it cannot see.
export interface AuditContext {
  entityId?: string | null;
  detail?: Record<string, unknown>;
  // Overrides route defaults when a handler needs to (e.g. failed LOGIN).
  action?: AuditAction;
  actorUserId?: string | null;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    audit?: AuditConfig;
  }
  interface FastifyRequest {
    auditContext?: AuditContext;
  }
}

interface AuditRow {
  actorUserId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  ipAddress: string | null;
  detail: Record<string, unknown>;
}

export async function recordAudit(row: AuditRow): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log
       (actor_user_id, action, entity_type, entity_id, ip_address, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      row.actorUserId,
      row.action,
      row.entityType,
      row.entityId,
      row.ipAddress,
      JSON.stringify(row.detail),
    ],
  );
}

export const auditPlugin = fp(async (app) => {
  app.addHook(
    'onResponse',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const cfg = req.routeOptions.config.audit;
      if (!cfg) return;
      // Only audit successful, authorized access. A 401/403/4xx means no data
      // was disclosed; logging it as an access would be misleading.
      if (reply.statusCode >= 400 && !req.auditContext?.action) return;

      const ctx = req.auditContext ?? {};
      try {
        await recordAudit({
          actorUserId: ctx.actorUserId ?? req.authUser?.sub ?? null,
          action: ctx.action ?? cfg.action,
          entityType: cfg.entityType,
          entityId: ctx.entityId ?? null,
          ipAddress: req.ip,
          detail: ctx.detail ?? {},
        });
      } catch (err) {
        // Audit failure must be loud but must not corrupt the client response,
        // which has already been sent by onResponse.
        req.log.error({ err }, 'audit_log write failed');
      }
    },
  );
});
