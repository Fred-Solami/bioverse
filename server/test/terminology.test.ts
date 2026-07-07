import { describe, expect, it } from 'vitest';
import {
  isDangerSign,
  isCapability,
  validateCodes,
  MATERNAL_DANGER_SIGNS,
  FACILITY_CAPABILITIES,
} from '../src/terminology/valueSets.js';

describe('value sets', () => {
  it('recognizes known codes and rejects unknown ones', () => {
    expect(isDangerSign('vaginal_bleeding')).toBe(true);
    expect(isDangerSign('bleeding')).toBe(false); // the old free-text value
    expect(isCapability('caesarean_section')).toBe(true);
    expect(isCapability('blood_bank')).toBe(false); // superseded by blood_transfusion
  });

  it('has unique, non-empty codes and displays', () => {
    for (const set of [MATERNAL_DANGER_SIGNS, FACILITY_CAPABILITIES]) {
      const codes = new Set<string>();
      for (const c of set) {
        expect(c.code).toMatch(/^[a-z0-9_]+$/);
        expect(c.display.length).toBeGreaterThan(0);
        expect(codes.has(c.code)).toBe(false);
        codes.add(c.code);
      }
    }
  });

  it('partitions codes into valid and unknown', () => {
    const r = validateCodes(['vaginal_bleeding', 'nonsense', 'convulsions'], isDangerSign);
    expect(r.valid).toEqual(['vaginal_bleeding', 'convulsions']);
    expect(r.unknown).toEqual(['nonsense']);
  });

  it('treats non-array input as no codes', () => {
    expect(validateCodes(undefined, isDangerSign)).toEqual({ valid: [], unknown: [] });
  });
});
