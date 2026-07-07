import type { PoolClient } from 'pg';
import { pool } from '../db.js';

// Deterministic stage of the matching cascade (DESIGN.md §11, stage 1).
// Probabilistic scoring + review queue are v0.2; v0.1 links only on an exact
// active-identifier hit. Identifier precedence: SMARTCARE_ID → NRC → INRIS_ID →
// PHONE (national-registry ids before the weaker phone signal).
export const ID_PRIORITY = ['SMARTCARE_ID', 'NRC', 'INRIS_ID', 'PHONE'] as const;

export interface Identifier {
  id_type: string;
  id_value: string;
}

export function isUsableIdentifier(id: Identifier): boolean {
  return (
    ID_PRIORITY.includes(id.id_type as (typeof ID_PRIORITY)[number]) &&
    typeof id.id_value === 'string' &&
    id.id_value.trim().length > 0
  );
}

export interface DeterministicMatch {
  patientId: string;
  matchedOn: string;
}

type Executor = PoolClient | typeof pool;

// Returns the first patient whose active identifiers exactly match one of the
// supplied identifiers, honouring precedence. Null = no deterministic hit
// (caller creates a new patient; a probabilistic pass will slot in here in v0.2).
export async function deterministicMatch(
  identifiers: Identifier[],
  executor: Executor = pool,
): Promise<DeterministicMatch | null> {
  const ordered = identifiers
    .filter(isUsableIdentifier)
    .sort(
      (a, b) =>
        ID_PRIORITY.indexOf(a.id_type as (typeof ID_PRIORITY)[number]) -
        ID_PRIORITY.indexOf(b.id_type as (typeof ID_PRIORITY)[number]),
    );

  for (const id of ordered) {
    const { rows } = await executor.query<{ patient_id: string }>(
      `SELECT patient_id FROM patient_identifiers
        WHERE id_type = $1 AND id_value = $2 AND is_active = true
        LIMIT 1`,
      [id.id_type, id.id_value.trim()],
    );
    if (rows[0]) return { patientId: rows[0].patient_id, matchedOn: id.id_type };
  }
  return null;
}
