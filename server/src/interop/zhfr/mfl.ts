// MFL → BioVerse facility mapping (interop adapter #1, docs/INTEROP.md).
// Source contract confirmed 2026-07-07 against MOH-Zambia/MFL on GitHub:
// province,district,name,HMIS_code,DHIS2_UID,smartcare_GUID,eLMIS_ID,iHRIS_ID,
// location,ownership,facility_type,longitude,latitude,
// catchment_population_head_count,catchment_population_cso,operation_status
//
// Pure parsing/mapping — no DB, no network — so the contract is unit-testable.
// seedFromMfl.ts owns fetching and upserting.

export const MFL_CSV_URL =
  'https://raw.githubusercontent.com/MOH-Zambia/MFL/master/geography/data/facility_list.csv';

export interface MflFacility {
  zhfr_code: string;
  name: string;
  facility_type: string;
  ownership: string;
  district: string;
  province: string;
  longitude: number | null;
  latitude: number | null;
  dhis2_uid: string | null;
  smartcare_guid: string | null;
  elmis_id: string | null;
  is_active: boolean;
}

export interface MflParseResult {
  facilities: MflFacility[];
  skipped: number; // rows without an HMIS code or name — unusable
  typeFallbacks: number; // rows whose facility_type needed the heuristic
  ownershipFallbacks: number;
}

// Minimal RFC-4180 CSV parser: quoted fields, embedded commas/quotes/newlines.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

// MFL's labels → our facility_type. Explicit map first, heuristic fallback for
// labels we haven't catalogued (counted, so drift is visible in seed output).
// Label census run against the live dataset 2026-07-07 (2,828 rows):
// Health Post 1060 · Rural Health Centre 1108 · Urban Health Centre 362 ·
// Hospital - Level 1 115 · Hospital - Level 2 22 · Hospital - Level 3 14 ·
// Hospital Affiliated Health Centre 12 · Zonal Health Centre 13 ·
// Border Health Post 3 · (empty) 119.
const TYPE_MAP: Record<string, string> = {
  'health post': 'HEALTH_POST',
  'border health post': 'HEALTH_POST',
  'rural health centre': 'HEALTH_CENTRE',
  'urban health centre': 'HEALTH_CENTRE',
  'zonal health centre': 'HEALTH_CENTRE',
  'hospital affiliated health centre': 'HEALTH_CENTRE',
  'health centre': 'HEALTH_CENTRE',
  'hospital - level 1': 'L1_HOSPITAL',
  'district hospital': 'L1_HOSPITAL',
  'hospital - level 2': 'L2_HOSPITAL',
  'general hospital': 'L2_HOSPITAL',
  'provincial hospital': 'L2_HOSPITAL',
  'hospital - level 3': 'L3_HOSPITAL',
  'central hospital': 'L3_HOSPITAL',
  'specialised hospital': 'L3_HOSPITAL',
  'specialized hospital': 'L3_HOSPITAL',
  pharmacy: 'PHARMACY',
};

function mapType(raw: string): { type: string; fallback: boolean } {
  const key = raw.trim().toLowerCase();
  const mapped = TYPE_MAP[key];
  if (mapped) return { type: mapped, fallback: false };
  if (key.includes('hospital')) return { type: 'L1_HOSPITAL', fallback: true };
  if (key.includes('post')) return { type: 'HEALTH_POST', fallback: true };
  if (key.includes('pharmac')) return { type: 'PHARMACY', fallback: true };
  return { type: 'HEALTH_CENTRE', fallback: true };
}

// Live label census 2026-07-07: GRZ 2476 · Private 148 · NGO 126 ·
// Military 54 · Police 24. "NGO" covers CHAZ mission facilities among others;
// without a faith-based flag in the source we map it to PRIVATE (non-state)
// rather than guessing FAITH_BASED — revisit when ZHFR API access provides
// finer ownership data.
const OWNERSHIP_MAP: Record<string, string> = {
  grz: 'MOH', // Government of the Republic of Zambia
  moh: 'MOH',
  government: 'MOH',
  chaz: 'FAITH_BASED', // Churches Health Association of Zambia
  'faith based': 'FAITH_BASED',
  'faith-based': 'FAITH_BASED',
  mission: 'FAITH_BASED',
  ngo: 'PRIVATE',
  private: 'PRIVATE',
  military: 'ZDF',
  zdf: 'ZDF',
  'defence force': 'ZDF',
  zns: 'ZNS',
  police: 'POLICE',
  'zambia police': 'POLICE',
  correctional: 'CORRECTIONAL',
  prisons: 'CORRECTIONAL',
};

function mapOwnership(raw: string): { ownership: string; fallback: boolean } {
  const key = raw.trim().toLowerCase();
  const mapped = OWNERSHIP_MAP[key];
  if (mapped) return { ownership: mapped, fallback: false };
  if (key.includes('church') || key.includes('mission') || key.includes('faith')) {
    return { ownership: 'FAITH_BASED', fallback: true };
  }
  if (key.includes('private')) return { ownership: 'PRIVATE', fallback: true };
  return { ownership: 'MOH', fallback: true };
}

function num(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function text(raw: string | undefined): string | null {
  const t = raw?.trim();
  return t ? t : null;
}

export function parseMfl(csv: string): MflParseResult {
  const rows = parseCsv(csv);
  const header = rows[0]?.map((h) => h.trim());
  if (!header) throw new Error('MFL CSV is empty');
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`MFL CSV missing expected column "${name}" — contract changed?`);
    return i;
  };

  // Fail loudly if the published contract drifts (the VSDC rule).
  const iProvince = col('province');
  const iDistrict = col('district');
  const iName = col('name');
  const iHmis = col('HMIS_code');
  const iDhis2 = col('DHIS2_UID');
  const iSmartcare = col('smartcare_GUID');
  const iElmis = col('eLMIS_ID');
  const iOwnership = col('ownership');
  const iType = col('facility_type');
  const iLon = col('longitude');
  const iLat = col('latitude');
  const iStatus = col('operation_status');

  const result: MflParseResult = {
    facilities: [],
    skipped: 0,
    typeFallbacks: 0,
    ownershipFallbacks: 0,
  };

  for (const row of rows.slice(1)) {
    const zhfrCode = text(row[iHmis]);
    const name = text(row[iName]);
    const district = text(row[iDistrict]);
    const province = text(row[iProvince]);
    if (!zhfrCode || !name || !district || !province) {
      result.skipped++;
      continue;
    }

    const { type, fallback: typeFb } = mapType(row[iType] ?? '');
    const { ownership, fallback: ownFb } = mapOwnership(row[iOwnership] ?? '');
    if (typeFb) result.typeFallbacks++;
    if (ownFb) result.ownershipFallbacks++;

    result.facilities.push({
      zhfr_code: zhfrCode,
      name,
      facility_type: type,
      ownership,
      district,
      province,
      longitude: num(row[iLon]),
      latitude: num(row[iLat]),
      dhis2_uid: text(row[iDhis2]),
      smartcare_guid: text(row[iSmartcare]),
      elmis_id: text(row[iElmis]),
      is_active: (row[iStatus] ?? '').trim().toLowerCase() === 'operational',
    });
  }
  return result;
}
