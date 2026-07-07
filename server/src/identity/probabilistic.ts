// Probabilistic matching — stage 2 of the cascade (DESIGN.md §11). Pure,
// deterministic scoring so thresholds and language handling are unit-testable.
// Runs only when the deterministic stage misses. Conservative by design:
// thresholds favour the review queue over silent auto-linking, because a wrong
// merge is worse than a duplicate.

export interface DemographicRecord {
  given_name: string;
  family_name: string;
  sex: string | null;
  birth_date: string | null; // YYYY-MM-DD
  birth_year_approx?: boolean;
  district: string | null;
}

export interface MatchFeatures {
  family: number;
  given: number;
  sex: number;
  birth: number;
  district: number;
}

export interface MatchScore {
  score: number; // 0..1
  features: MatchFeatures;
}

// Conservative starting thresholds; tighten with pilot data (DESIGN.md §11.4).
export const T_HIGH = 0.85; // >= auto-link
export const T_LOW = 0.6; //  [T_LOW, T_HIGH) -> human review; < T_LOW -> new patient

const WEIGHTS = { family: 0.35, given: 0.25, birth: 0.2, sex: 0.1, district: 0.1 };

// Phonetic normalisation tuned for Bemba/Nyanja/Lozi spelling variation: strip
// diacritics, fold common equivalences (ph→f, doubled consonants, s/z, y/i),
// drop non-letters. Not a full Soundex — a conservative skeleton that catches
// transliteration differences without collapsing distinct names.
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritics
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/ph/g, 'f')
    .replace(/z/g, 's')
    .replace(/y/g, 'i')
    .replace(/(.)\1+/g, '$1'); // collapse doubled letters
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

// 1.0 for phonetically-equal names, otherwise an edit-distance ratio on the
// normalised forms.
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

function birthScore(inc: DemographicRecord, cand: DemographicRecord): number {
  if (!inc.birth_date || !cand.birth_date) return 0.3; // missing data: weakly neutral
  if (inc.birth_date === cand.birth_date) return 1;
  const ya = Number(inc.birth_date.slice(0, 4));
  const yb = Number(cand.birth_date.slice(0, 4));
  const tolerance = inc.birth_year_approx ? 2 : 1;
  return Math.abs(ya - yb) <= tolerance ? 0.6 : 0;
}

function sexScore(inc: DemographicRecord, cand: DemographicRecord): number {
  if (!inc.sex || !cand.sex || inc.sex === 'UNKNOWN' || cand.sex === 'UNKNOWN') return 0.5;
  return inc.sex === cand.sex ? 1 : 0;
}

function districtScore(inc: DemographicRecord, cand: DemographicRecord): number {
  if (!inc.district || !cand.district) return 0.5;
  return inc.district === cand.district ? 1 : 0;
}

export function scoreMatch(inc: DemographicRecord, cand: DemographicRecord): MatchScore {
  const features: MatchFeatures = {
    family: nameSimilarity(inc.family_name, cand.family_name),
    given: nameSimilarity(inc.given_name, cand.given_name),
    sex: sexScore(inc, cand),
    birth: birthScore(inc, cand),
    district: districtScore(inc, cand),
  };
  const score =
    features.family * WEIGHTS.family +
    features.given * WEIGHTS.given +
    features.sex * WEIGHTS.sex +
    features.birth * WEIGHTS.birth +
    features.district * WEIGHTS.district;
  return { score, features };
}

export type MatchBand = 'AUTO_LINK' | 'REVIEW' | 'NEW';

export function band(score: number): MatchBand {
  if (score >= T_HIGH) return 'AUTO_LINK';
  if (score >= T_LOW) return 'REVIEW';
  return 'NEW';
}

export interface Candidate extends DemographicRecord {
  id: string;
}

// Best-scoring existing patient for an incoming record.
export function bestMatch(
  inc: DemographicRecord,
  candidates: Candidate[],
): { candidate: Candidate; score: number; features: MatchFeatures } | null {
  let best: { candidate: Candidate; score: number; features: MatchFeatures } | null = null;
  for (const c of candidates) {
    const { score, features } = scoreMatch(inc, c);
    if (!best || score > best.score) best = { candidate: c, score, features };
  }
  return best;
}
