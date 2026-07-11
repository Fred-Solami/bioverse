// Transport dispatch ranking (m-mama pattern: nearest available vehicle). Pure
// logic so the policy is unit-testable; PostGIS computes the distances in SQL.
// The heuristic that showed real-world impact is simple — get the closest
// available vehicle to the patient fast — so that is what we rank by, surfacing
// vehicle type and contact for the coordinator to confirm.

export type VehicleType = 'AMBULANCE' | 'COMMUNITY_DRIVER' | 'MOTORBIKE' | 'BOAT';

export interface TransportOption {
  id: string;
  name: string;
  vehicle_type: VehicleType;
  contact_phone: string | null;
  district: string | null;
  distance_m: number | null; // null when either point lacks coordinates
}

export interface RankedTransport extends TransportOption {
  rank: number;
  recommended: boolean;
}

export function rankTransport(
  options: TransportOption[],
  limit = 10,
): RankedTransport[] {
  const ordered = [...options].sort((a, b) => {
    const da = a.distance_m ?? Number.POSITIVE_INFINITY;
    const db = b.distance_m ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name);
  });
  return ordered.slice(0, limit).map((o, i) => ({
    ...o,
    rank: i + 1,
    recommended: i === 0, // the nearest available vehicle is pre-selected
  }));
}
