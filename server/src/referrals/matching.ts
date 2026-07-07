// Capability-aware routing — the ranking half of the match algorithm
// (DESIGN.md §10, steps 4–5). PostGIS does the capability filter and distance
// computation (SQL, in the route); this pure function applies the downrank and
// selection so the policy is unit-testable without a database.
//
// 1–3 (filter to facilities with ALL required capabilities, rank by distance,
// annotate stock) happen in SQL. Here:
//   4. Downrank — not hide — facilities with CRITICAL stock on required items.
//   5. Present the top N; for an EMERGENCY the nearest capable candidate is
//      pre-selected (`recommended`).

export type StockStatus = 'CRITICAL' | 'ADEQUATE' | 'SURPLUS' | 'UNKNOWN';

export interface Candidate {
  facility_id: string;
  name: string;
  facility_type: string;
  district: string;
  distance_m: number | null; // null when either facility lacks coordinates
  stock_status: StockStatus;
  capabilities: Record<string, boolean>;
}

export interface RankedCandidate extends Candidate {
  rank: number;
  recommended: boolean;
}

export interface RankOptions {
  priority: string; // EMERGENCY | URGENT | ROUTINE
  limit?: number;
}

// A facility with CRITICAL stock on a required item is downranked below every
// adequately-stocked option, but never removed — the clinician still sees it
// (it may be the only capable facility) with the stock flag visible.
function sortKey(c: Candidate): [number, number, string] {
  const criticalPenalty = c.stock_status === 'CRITICAL' ? 1 : 0;
  // Unknown distance sorts last among its stock tier.
  const distance = c.distance_m ?? Number.POSITIVE_INFINITY;
  return [criticalPenalty, distance, c.name];
}

export function rankCandidates(
  candidates: Candidate[],
  { priority, limit = 5 }: RankOptions,
): RankedCandidate[] {
  const ordered = [...candidates].sort((a, b) => {
    const [ka0, ka1, ka2] = sortKey(a);
    const [kb0, kb1, kb2] = sortKey(b);
    if (ka0 !== kb0) return ka0 - kb0;
    if (ka1 !== kb1) return ka1 - kb1;
    return ka2.localeCompare(kb2);
  });

  return ordered.slice(0, limit).map((c, i) => ({
    ...c,
    rank: i + 1,
    // Emergencies default to the top candidate pre-selected; for non-emergencies
    // the clinician always chooses explicitly.
    recommended: i === 0 && priority === 'EMERGENCY',
  }));
}
