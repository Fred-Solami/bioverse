import { describe, expect, it } from 'vitest';
import { rankTransport, type TransportOption } from '../src/transport/dispatch.js';

function opt(over: Partial<TransportOption>): TransportOption {
  return {
    id: over.id ?? 'r',
    name: over.name ?? 'Vehicle',
    vehicle_type: over.vehicle_type ?? 'COMMUNITY_DRIVER',
    contact_phone: over.contact_phone ?? '0970000000',
    district: over.district ?? 'Ndola',
    distance_m: 'distance_m' in over ? over.distance_m! : 1000,
  };
}

describe('rankTransport', () => {
  it('ranks the nearest available vehicle first and recommends it', () => {
    const ranked = rankTransport([
      opt({ id: 'far', name: 'Far', distance_m: 9000 }),
      opt({ id: 'near', name: 'Near', distance_m: 800 }),
      opt({ id: 'mid', name: 'Mid', distance_m: 4000 }),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['near', 'mid', 'far']);
    expect(ranked[0]!.recommended).toBe(true);
    expect(ranked[1]!.recommended).toBe(false);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('sorts vehicles without coordinates last', () => {
    const ranked = rankTransport([
      opt({ id: 'no_geo', distance_m: null }),
      opt({ id: 'geo', distance_m: 5000 }),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['geo', 'no_geo']);
  });

  it('caps the result at the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => opt({ id: `v${i}`, distance_m: i * 100 }));
    expect(rankTransport(many)).toHaveLength(10);
  });
});
