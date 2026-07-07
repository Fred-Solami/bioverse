import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { CAN_TOUCH_PATIENTS } from '../auth/roles.js';
import {
  deterministicMatch,
  isUsableIdentifier,
  type Identifier,
} from './matching.js';
import { bestMatch, band, type Candidate } from './probabilistic.js';
import { CAN_REVIEW_IDENTITY } from '../auth/roles.js';

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

      // Cascade stage 1: deterministic — exact active-identifier hit.
      const match = await deterministicMatch(identifiers);
      if (match) {
        const patient = await loadPatient(match.patientId);
        req.auditContext = {
          entityId: match.patientId,
          detail: { matched: true, matched_on: match.matchedOn },
        };
        return reply.code(200).send({ matched: true, matched_on: match.matchedOn, patient });
      }

      // Cascade stage 2: probabilistic (DESIGN.md §11). Score the incoming
      // demographics against existing patients; the band decides the action.
      const incoming = {
        given_name: b.given_name,
        family_name: b.family_name,
        sex: b.sex ?? null,
        birth_date: b.birth_date ?? null,
        birth_year_approx: b.birth_year_approx ?? false,
        district: b.district ?? null,
      };
      // Blocking: only score plausibly-related records. A shared district or
      // family-name initial bounds the candidate set (a normalised-name blocking
      // key is the production refinement).
      const { rows: candRows } = await pool.query<Candidate>(
        `SELECT id, given_name, family_name, sex,
                to_char(birth_date, 'YYYY-MM-DD') AS birth_date, district
           FROM patients
          WHERE ($1::text IS NULL OR district = $1)
             OR left(lower(family_name), 1) = left(lower($2), 1)
          LIMIT 500`,
        [incoming.district, incoming.family_name],
      );
      const best = bestMatch(incoming, candRows);
      const decision = best ? band(best.score) : 'NEW';

      // Auto-link: high-confidence same patient. Return the existing record and
      // attach any new identifiers to it (provenance-tracked, non-destructive).
      if (best && decision === 'AUTO_LINK') {
        for (const id of identifiers) {
          await pool.query(
            `INSERT INTO patient_identifiers (patient_id, id_type, id_value, asserted_by)
             VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
            [best.candidate.id, id.id_type, id.id_value.trim(), user.sub],
          );
        }
        const patient = await loadPatient(best.candidate.id);
        req.auditContext = {
          entityId: best.candidate.id,
          detail: { matched: true, matched_on: 'PROBABILISTIC', score: best.score },
        };
        return reply
          .code(200)
          .send({ matched: true, matched_on: 'PROBABILISTIC', score: best.score, patient });
      }

      // No/low match, or a borderline that needs human review → register a new
      // patient. For the borderline band, also enqueue a review pairing it with
      // the best candidate (a wrong auto-merge is worse than a duplicate).
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

        let reviewPending = false;
        if (best && decision === 'REVIEW') {
          await client.query(
            `INSERT INTO match_review_queue (candidate_a, candidate_b, score, features)
             VALUES ($1, $2, $3, $4)`,
            [patientId, best.candidate.id, best.score, JSON.stringify(best.features)],
          );
          reviewPending = true;
        }
        await client.query('COMMIT');

        req.auditContext = {
          entityId: patientId,
          detail: { matched: false, review_pending: reviewPending, score: best?.score },
        };
        const patient = await loadPatient(patientId);
        return reply.code(201).send({ matched: false, review_pending: reviewPending, patient });
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

// Identity match-review queue — mounted at /api/v1/identity (DESIGN.md §14),
// deliberately separate from the /api/v1/patients surface.
export async function reviewQueueRoutes(app: FastifyInstance): Promise<void> {
  // GET /identity/review-queue — borderline probabilistic matches awaiting a
  // human decision (DESIGN.md §14; in-charge/district).
  app.get(
    '/review-queue',
    {
      preHandler: [app.authenticate, app.requireRole(...CAN_REVIEW_IDENTITY)],
      config: { audit: { action: 'READ', entityType: 'match_review' } },
    },
    async (_req, reply) => {
      const { rows } = await pool.query(
        `SELECT q.id, q.score, q.features, q.status, q.created_at,
                a.id AS a_id, a.given_name AS a_given, a.family_name AS a_family,
                a.birth_date AS a_birth, a.district AS a_district,
                b.id AS b_id, b.given_name AS b_given, b.family_name AS b_family,
                b.birth_date AS b_birth, b.district AS b_district
           FROM match_review_queue q
           JOIN patients a ON a.id = q.candidate_a
           JOIN patients b ON b.id = q.candidate_b
          WHERE q.status = 'PENDING'
          ORDER BY q.score DESC, q.created_at ASC
          LIMIT 200`,
      );
      return reply.send({ count: rows.length, reviews: rows });
    },
  );

  // POST /identity/review-queue/:id/decide {decision: LINKED|REJECTED}. LINKED
  // asserts the two records are the same person via a shared, deactivatable MPI
  // identifier on both — reversible, never a destructive merge (DESIGN.md §11.3).
  app.post<{ Params: { id: string }; Body: { decision?: string } }>(
    '/review-queue/:id/decide',
    {
      preHandler: [app.authenticate, app.requireRole(...CAN_REVIEW_IDENTITY)],
      config: { audit: { action: 'UPDATE', entityType: 'match_review' } },
    },
    async (req, reply) => {
      const user = req.authUser!;
      const decision = req.body?.decision;
      if (decision !== 'LINKED' && decision !== 'REJECTED') {
        return reply.code(400).send({ error: 'decision must be LINKED or REJECTED' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query<{
          candidate_a: string;
          candidate_b: string;
          status: string;
        }>(
          `SELECT candidate_a, candidate_b, status
             FROM match_review_queue WHERE id = $1 FOR UPDATE`,
          [req.params.id],
        );
        const review = rows[0];
        if (!review) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'not found' });
        }
        if (review.status !== 'PENDING') {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: `already ${review.status}` });
        }

        await client.query(
          `UPDATE match_review_queue
              SET status = $1, decided_by = $2, decided_at = now()
            WHERE id = $3`,
          [decision, user.sub, req.params.id],
        );

        if (decision === 'LINKED') {
          // Record the link as a shared MPI (= the surviving candidate_b id)
          // asserted on both records — a provenance-tracked, reversible link
          // (is_active) rather than a destructive merge (DESIGN.md §11.3). Both
          // records survive; the assertion declares them one person.
          const mpi = review.candidate_b;
          for (const patientId of [review.candidate_a, review.candidate_b]) {
            await client.query(
              `INSERT INTO patient_identifiers (patient_id, id_type, id_value, asserted_by)
               VALUES ($1, 'BIOVERSE_MPI', $2, $3) ON CONFLICT DO NOTHING`,
              [patientId, mpi, user.sub],
            );
          }
        }
        await client.query('COMMIT');

        req.auditContext = {
          entityId: req.params.id,
          detail: { decision, candidate_a: review.candidate_a, candidate_b: review.candidate_b },
        };
        return reply.send({ id: req.params.id, status: decision });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );
}
