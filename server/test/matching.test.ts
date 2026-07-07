import { describe, expect, it, vi } from 'vitest';
import {
  deterministicMatch,
  isUsableIdentifier,
  type Identifier,
} from '../src/identity/matching.js';

describe('identifier validation', () => {
  it('accepts known id types with a value', () => {
    expect(isUsableIdentifier({ id_type: 'NRC', id_value: '123456/78/9' })).toBe(true);
  });
  it('rejects unknown types and empty values', () => {
    expect(isUsableIdentifier({ id_type: 'BIOVERSE_MPI', id_value: 'x' })).toBe(false);
    expect(isUsableIdentifier({ id_type: 'NRC', id_value: '   ' })).toBe(false);
  });
});

describe('deterministic matching cascade', () => {
  it('queries identifiers in precedence order and returns the first hit', async () => {
    const queried: string[] = [];
    // Fake executor: only SMARTCARE_ID resolves to a patient.
    const executor = {
      query: vi.fn(async (_sql: string, params: unknown[]) => {
        const idType = params[0] as string;
        queried.push(idType);
        if (idType === 'SMARTCARE_ID') return { rows: [{ patient_id: 'p-smart' }] };
        return { rows: [] };
      }),
    };

    const ids: Identifier[] = [
      { id_type: 'PHONE', id_value: '0977000000' },
      { id_type: 'SMARTCARE_ID', id_value: 'SC-1' },
      { id_type: 'NRC', id_value: '111111/11/1' },
    ];

    const match = await deterministicMatch(ids, executor as never);
    expect(match).toEqual({ patientId: 'p-smart', matchedOn: 'SMARTCARE_ID' });
    // SMARTCARE_ID is highest precedence, so it is tried first and short-circuits.
    expect(queried[0]).toBe('SMARTCARE_ID');
  });

  it('falls through precedence to a lower-priority hit', async () => {
    const queried: string[] = [];
    const executor = {
      query: vi.fn(async (_sql: string, params: unknown[]) => {
        const idType = params[0] as string;
        queried.push(idType);
        if (idType === 'PHONE') return { rows: [{ patient_id: 'p-phone' }] };
        return { rows: [] };
      }),
    };
    const ids: Identifier[] = [
      { id_type: 'PHONE', id_value: '0977000000' },
      { id_type: 'NRC', id_value: '111111/11/1' },
    ];
    const match = await deterministicMatch(ids, executor as never);
    expect(match).toEqual({ patientId: 'p-phone', matchedOn: 'PHONE' });
    // NRC (higher precedence) is tried before PHONE.
    expect(queried).toEqual(['NRC', 'PHONE']);
  });

  it('returns null when nothing matches', async () => {
    const executor = { query: vi.fn(async () => ({ rows: [] })) };
    const match = await deterministicMatch(
      [{ id_type: 'NRC', id_value: '111111/11/1' }],
      executor as never,
    );
    expect(match).toBeNull();
  });

  it('ignores unusable identifiers before querying', async () => {
    const executor = { query: vi.fn(async () => ({ rows: [] })) };
    await deterministicMatch([{ id_type: 'BIOVERSE_MPI', id_value: 'x' }], executor as never);
    expect(executor.query).not.toHaveBeenCalled();
  });
});
