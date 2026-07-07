import { describe, expect, it } from 'vitest';
import { rankCandidates, type Candidate } from '../src/referrals/matching.js';

function cand(over: Partial<Candidate>): Candidate {
  return {
    facility_id: over.facility_id ?? 'f',
    name: over.name ?? 'Facility',
    facility_type: over.facility_type ?? 'L2_HOSPITAL',
    district: over.district ?? 'Ndola',
    distance_m: 'distance_m' in over ? over.distance_m! : 1000,
    stock_status: over.stock_status ?? 'ADEQUATE',
    capabilities: over.capabilities ?? {},
  };
}

describe('rankCandidates', () => {
  it('ranks by distance among adequately-stocked facilities', () => {
    const ranked = rankCandidates(
      [
        cand({ facility_id: 'far', name: 'Far', distance_m: 9000 }),
        cand({ facility_id: 'near', name: 'Near', distance_m: 1000 }),
        cand({ facility_id: 'mid', name: 'Mid', distance_m: 4000 }),
      ],
      { priority: 'URGENT' },
    );
    expect(ranked.map((c) => c.facility_id)).toEqual(['near', 'mid', 'far']);
    expect(ranked.map((c) => c.rank)).toEqual([1, 2, 3]);
  });

  it('downranks CRITICAL-stock facilities below adequate ones but keeps them', () => {
    const ranked = rankCandidates(
      [
        cand({ facility_id: 'near_critical', distance_m: 500, stock_status: 'CRITICAL' }),
        cand({ facility_id: 'far_ok', distance_m: 8000, stock_status: 'ADEQUATE' }),
      ],
      { priority: 'EMERGENCY' },
    );
    // The nearer facility has critical stock, so the adequately-stocked one wins
    // — but the critical one is still present (annotated, not hidden).
    expect(ranked.map((c) => c.facility_id)).toEqual(['far_ok', 'near_critical']);
    expect(ranked).toHaveLength(2);
  });

  it('pre-selects the top candidate only for emergencies', () => {
    const emergency = rankCandidates([cand({ distance_m: 100 })], { priority: 'EMERGENCY' });
    expect(emergency[0]!.recommended).toBe(true);
    const routine = rankCandidates([cand({ distance_m: 100 })], { priority: 'ROUTINE' });
    expect(routine[0]!.recommended).toBe(false);
  });

  it('sorts facilities without coordinates last', () => {
    const ranked = rankCandidates(
      [
        cand({ facility_id: 'no_geo', distance_m: null }),
        cand({ facility_id: 'geo', distance_m: 5000 }),
      ],
      { priority: 'URGENT' },
    );
    expect(ranked.map((c) => c.facility_id)).toEqual(['geo', 'no_geo']);
  });

  it('caps the result at the top 5', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      cand({ facility_id: `f${i}`, distance_m: i * 100 }),
    );
    expect(rankCandidates(many, { priority: 'URGENT' })).toHaveLength(5);
  });
});
