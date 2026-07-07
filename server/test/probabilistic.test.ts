import { describe, expect, it } from 'vitest';
import {
  normalizeName,
  nameSimilarity,
  scoreMatch,
  band,
  bestMatch,
  T_HIGH,
  T_LOW,
  type DemographicRecord,
  type Candidate,
} from '../src/identity/probabilistic.js';

describe('normalizeName', () => {
  it('folds diacritics, doubled letters and common variants', () => {
    expect(normalizeName('Phiri')).toBe(normalizeName('Firi')); // ph→f
    expect(normalizeName('Mwanza')).toBe(normalizeName('Mwansa')); // z→s
    expect(normalizeName("Bwal­ya")).toBe('bwalia'); // y→i, non-letters dropped
    expect(normalizeName('Zulu')).toBe(normalizeName('Zzulu')); // doubled collapse
  });
});

describe('nameSimilarity', () => {
  it('scores phonetically-equal names as identical', () => {
    expect(nameSimilarity('Phiri', 'Firi')).toBe(1);
  });
  it('gives partial credit for near names and low for distinct ones', () => {
    expect(nameSimilarity('Mwanza', 'Mwanze')).toBeGreaterThan(0.6);
    expect(nameSimilarity('Banda', 'Tembo')).toBeLessThan(0.4);
  });
});

const base: DemographicRecord = {
  given_name: 'Chanda',
  family_name: 'Mwanza',
  sex: 'F',
  birth_date: '1998-04-12',
  district: 'Ndola',
};

describe('scoreMatch + band', () => {
  it('scores an identical record in the auto-link band', () => {
    const { score } = scoreMatch(base, { ...base });
    expect(score).toBeGreaterThanOrEqual(T_HIGH);
    expect(band(score)).toBe('AUTO_LINK');
  });

  it('puts a spelling variant with matching demographics in review or above', () => {
    const variant: DemographicRecord = { ...base, family_name: 'Mwansa', given_name: 'Chanda' };
    const { score } = scoreMatch(base, variant);
    expect(score).toBeGreaterThanOrEqual(T_LOW);
  });

  it('scores a different person below the review threshold', () => {
    const other: DemographicRecord = {
      given_name: 'Mutale',
      family_name: 'Tembo',
      sex: 'M',
      birth_date: '1972-01-01',
      district: 'Kitwe',
    };
    expect(band(scoreMatch(base, other).score)).toBe('NEW');
  });

  it('honours the birth-year tolerance only when approximate', () => {
    const off2 = { ...base, birth_date: '2000-04-12' }; // 2 years off
    const exact = scoreMatch(base, off2).score;
    const approx = scoreMatch({ ...base, birth_year_approx: true }, off2).score;
    expect(approx).toBeGreaterThan(exact);
  });
});

describe('bestMatch', () => {
  it('returns the highest-scoring candidate', () => {
    const candidates: Candidate[] = [
      { id: 'p1', given_name: 'Mutale', family_name: 'Tembo', sex: 'M', birth_date: '1970-01-01', district: 'Kitwe' },
      { id: 'p2', given_name: 'Chanda', family_name: 'Mwansa', sex: 'F', birth_date: '1998-04-12', district: 'Ndola' },
    ];
    const best = bestMatch(base, candidates);
    expect(best!.candidate.id).toBe('p2');
    expect(best!.score).toBeGreaterThanOrEqual(T_LOW);
  });

  it('returns null when there are no candidates', () => {
    expect(bestMatch(base, [])).toBeNull();
  });
});
