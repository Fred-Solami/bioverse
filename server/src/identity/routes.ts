import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { CAN_TOUCH_PATIENTS } from '../auth/roles.js';
import {
  deterministicMatch,
  isUsableIdentifier,
  type Identifier,
} from './matching.js';

interface CreatePatientBody {
  given_name?: string;
  family_name?: string;
  sex?: string;
  birth_date?: string;
  birth_year_approx?: boolean;
  phone?: string;
  district?: string;
  identifiers?: Identifier[];
}

interface SearchBody {
  identifier?: Identifier;
  name?: string;
}

async function loadPatient(id: string) {
  const [{ rows: pRows }, { rows: ids }] = await Promise.all([
    pool.query(
      `SELECT id, given_name, family_name, sex, birth_date, birth_year_approx,
              phone, district, created_at
         FROM patients WHERE id = $1`,
      [id],
    ),
    pool.query(
      `SELECT id_type, id_value, is_active FROM patient_identifiers
        WHERE patient_id = $1 AND is_active = true`,
      [id],
    ),
  ]);
  if (!pRows[0]) return null;
  return { ...pRows[0], identifiers: ids };
}

export async function identityRoutes(app: FastifyInstance): Promise<void> {
  // POST /patients — runs the matching cascade; may return an existing patient
  // (DESIGN.md §14). Deterministic-only in v0.1: an exact identifier hit links;
  // otherwise a new patient is registered with its supplied identifiers.
  app.post<{ Body: CreatePatientBody }>(
    '/',
    {
      preHandler: [app.authenticate, app.requireRole(...CAN_TOUCH_PATIENTS)],
      config: { audit: { action: 'CREATE', entityType: 'patient' } },
    },
    async (req, reply) => {
      const user = req.authUser!;
      const b = req.body ?? {};
      if (!b.given_name || !b.family_name) {
        return reply.code(400).send({ error: 'given_name and family_name are required' });
      }
      const identifiers = (b.identifiers ?? []).filter(isUsableIdentifier);

      // Cascade stage 1: deterministic.
      const match = await deterministicMatch(identifiers);
      if (match) {
        const patient = await loadPatient(match.patientId);
        req.auditContext = {
          entityId: match.patientId,
          detail: { matched: true, matched_on: match.matchedOn },
        };
        return reply.code(200).send({ matched: true, matched_on: match.matchedOn, patient });
      }

      // No deterministic hit → register a new patient + its identifiers.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO patients
             (given_name, family_name, sex, birth_date, birth_year_approx, phone, district)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            b.given_name,
            b.family_name,
            b.sex ?? null,
            b.birth_date ?? null,
            b.birth_year_approx ?? false,
            b.phone ?? null,
            b.district ?? null,
          ],
        );
        const patientId = rows[0]!.id; // INSERT ... RETURNING always yields one row

        for (const id of identifiers) {
          await client.query(
            `INSERT INTO patient_identifiers (patient_id, id_type, id_value, asserted_by)
             VALUES ($1, $2, $3, $4)`,
            [patientId, id.id_type, id.id_value.trim(), user.sub],
          );
        }
        await client.query('COMMIT');

        req.auditContext = { entityId: patientId, detail: { matched: false } };
        const patient = await loadPatient(patientId);
        return reply.code(201).send({ matched: false, patient });
      } catch (err) {
        await client.query('ROLLBACK');
        // Unique-violation on an identifier = concurrent create of the same
        // patient; surface as a conflict rather than a 500.
        if ((err as { code?: string }).code === '23505') {
          return reply.code(409).send({ error: 'identifier already registered' });
        }
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // POST /patients/search — audited lookup by exact identifier or name.
  // Deliberately POST, not the GET of DESIGN.md §14: patient identifiers and
  // names are PII, and §15 forbids PII in URLs/logs. Kept off the query string.
  app.post<{ Body: SearchBody }>(
    '/search',
    {
      preHandler: [app.authenticate, app.requireRole(...CAN_TOUCH_PATIENTS)],
      config: {
        audit: { action: 'READ', entityType: 'patient' },
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
    },
    async (req, reply) => {
      const { identifier, name } = req.body ?? {};

      if (identifier && isUsableIdentifier(identifier)) {
        const match = await deterministicMatch([identifier]);
        const patient = match ? await loadPatient(match.patientId) : null;
        req.auditContext = {
          detail: { by: 'identifier', id_type: identifier.id_type, hit: Boolean(patient) },
          entityId: match?.patientId ?? null,
        };
        return reply.send({ count: patient ? 1 : 0, patients: patient ? [patient] : [] });
      }

      if (name && name.trim().length >= 2) {
        const { rows } = await pool.query(
          `SELECT id, given_name, family_name, sex, birth_date, district
             FROM patients
            WHERE given_name ILIKE $1 OR family_name ILIKE $1
            ORDER BY family_name, given_name
            LIMIT 50`,
          [`%${name.trim()}%`],
        );
        req.auditContext = { detail: { by: 'name', hits: rows.length } };
        return reply.send({ count: rows.length, patients: rows });
      }

      return reply.code(400).send({ error: 'provide a valid identifier or a name (min 2 chars)' });
    },
  );
}
