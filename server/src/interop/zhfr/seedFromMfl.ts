import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool, closePool } from '../../db.js';
import { MFL_CSV_URL, parseMfl, type MflParseResult } from './mfl.js';

// Seeds/refreshes the facility registry from the MOH-Zambia Master Facility
// List (interop adapter #1 fallback source, docs/INTEROP.md). Upserts on
// zhfr_code so re-running refreshes in place; rows gain source='MFL_GITHUB'
// and a source_synced_at freshness stamp. Pass a local CSV path as argv[2] to
// seed from a downloaded file instead of the network.

export async function seedFromMfl(fileOrUrl?: string): Promise<MflParseResult> {
  let csv: string;
  if (fileOrUrl && !/^https?:\/\//.test(fileOrUrl)) {
    csv = await readFile(fileOrUrl, 'utf8');
  } else {
    const url = fileOrUrl ?? MFL_CSV_URL;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`MFL fetch failed: ${res.status} ${res.statusText}`);
    csv = await res.text();
  }

  const parsed = parseMfl(csv);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const f of parsed.facilities) {
      await client.query(
        `INSERT INTO facilities
           (zhfr_code, name, facility_type, ownership, district, province, location,
            dhis2_uid, smartcare_guid, elmis_id, is_active, source, source_synced_at)
         VALUES
           ($1, $2, $3, $4, $5, $6,
            CASE WHEN $7::float8 IS NULL OR $8::float8 IS NULL THEN NULL
                 ELSE ST_SetSRID(ST_MakePoint($7::float8, $8::float8), 4326)::geography
            END,
            $9, $10, $11, $12, 'MFL_GITHUB', now())
         ON CONFLICT (zhfr_code) DO UPDATE SET
           name = EXCLUDED.name,
           facility_type = EXCLUDED.facility_type,
           ownership = EXCLUDED.ownership,
           district = EXCLUDED.district,
           province = EXCLUDED.province,
           location = EXCLUDED.location,
           dhis2_uid = EXCLUDED.dhis2_uid,
           smartcare_guid = EXCLUDED.smartcare_guid,
           elmis_id = EXCLUDED.elmis_id,
           is_active = EXCLUDED.is_active,
           source = 'MFL_GITHUB',
           source_synced_at = now(),
           updated_at = now()`,
        [
          f.zhfr_code,
          f.name,
          f.facility_type,
          f.ownership,
          f.district,
          f.province,
          f.longitude,
          f.latitude,
          f.dhis2_uid,
          f.smartcare_guid,
          f.elmis_id,
          f.is_active,
        ],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return parsed;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  seedFromMfl(process.argv[2])
    .then((r) => {
      console.log(
        `Seeded ${r.facilities.length} facilities from MFL ` +
          `(skipped ${r.skipped}; type fallbacks ${r.typeFallbacks}; ` +
          `ownership fallbacks ${r.ownershipFallbacks}).`,
      );
      return closePool();
    })
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
      return closePool();
    });
}
