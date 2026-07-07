import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool, closePool } from './db.js';

// Facility seeding. Default source is the bundled dev sample (clearly-marked
// DEV zhfr_codes). The zhfr adapter (interop #1) replaces this with live
// ZHFR API / MOH-Zambia MFL data once access terms are confirmed — see
// docs/INTEROP.md. Pass a JSON file path as argv[2] to seed from another file.

interface SeedFacility {
  zhfr_code: string;
  name: string;
  facility_type: string;
  ownership: string;
  district: string;
  province: string;
  longitude: number | null;
  latitude: number | null;
  capabilities: Record<string, boolean>;
}

const defaultSeedFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'seed',
  'facilities.sample.json',
);

export async function seedFacilities(file = defaultSeedFile): Promise<number> {
  const facilities: SeedFacility[] = JSON.parse(await readFile(file, 'utf8'));

  for (const f of facilities) {
    await pool.query(
      `INSERT INTO facilities
         (zhfr_code, name, facility_type, ownership, district, province, location, capabilities)
       VALUES
         ($1, $2, $3, $4, $5, $6,
          CASE WHEN $7::float8 IS NULL THEN NULL
               ELSE ST_SetSRID(ST_MakePoint($7::float8, $8::float8), 4326)::geography
          END,
          $9)
       ON CONFLICT (zhfr_code) DO UPDATE SET
         name = EXCLUDED.name,
         facility_type = EXCLUDED.facility_type,
         ownership = EXCLUDED.ownership,
         district = EXCLUDED.district,
         province = EXCLUDED.province,
         location = EXCLUDED.location,
         capabilities = EXCLUDED.capabilities,
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
        JSON.stringify(f.capabilities),
      ],
    );
  }
  return facilities.length;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  seedFacilities(process.argv[2] ?? defaultSeedFile)
    .then((count) => {
      console.log(`Seeded ${count} facilities.`);
      return closePool();
    })
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
      return closePool();
    });
}
