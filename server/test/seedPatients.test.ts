import { describe, expect, it } from 'vitest';
import { generatePatients } from '../src/seedPatients.js';

describe('generatePatients', () => {
  it('is deterministic for a given seed', () => {
    const a = generatePatients(20, 42);
    const b = generatePatients(20, 42);
    expect(a).toEqual(b);
  });

  it('produces well-formed, plausibly Zambian synthetic records', () => {
    const patients = generatePatients(60);
    expect(patients).toHaveLength(60);
    for (const p of patients) {
      expect(p.given_name.length).toBeGreaterThan(1);
      expect(p.family_name.length).toBeGreaterThan(1);
      expect(['M', 'F']).toContain(p.sex);
      expect(p.birth_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.nrc).toMatch(/^\d{6}\/\d{2}\/\d$/); // NRC format
      expect(p.phone).toMatch(/^09\d{8}$/);
      expect(['Masaiti', 'Ndola', 'Mpongwe', 'Lufwanyama', 'Kitwe']).toContain(p.district);
    }
  });

  it('assigns unique NRCs across the set', () => {
    const nrcs = generatePatients(100).map((p) => p.nrc);
    expect(new Set(nrcs).size).toBe(nrcs.length);
  });
});
