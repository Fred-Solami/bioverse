import { pool, closePool } from './db.js';

// Synthetic transport resources near the seeded facilities so the dispatch
// endpoint has vehicles to rank. Hospitals get an ambulance; other facilities
// get a community driver or motorbike (the m-mama model leans on trained
// community drivers, not just ambulances). Idempotent by name. NOT production.

interface FacilityRow {
  id: string;
  name: string;
  facility_type: string;
  district: string;
  lon: number | null;
  lat: number | null;
}

const HOSPITAL_TYPES = ['L1_HOSPITAL', 'L2_HOSPITAL', 'L3_HOSPITAL'];

export async function seedTransport(): Promise<number> {
  const { rows: facilities } = await pool.query<FacilityRow>(
    `SELECT id, name, facility_type, district,
            ST_X(location::geometry) AS lon, ST_Y(location::geometry) AS lat
       FROM facilities
      WHERE is_active = true AND location IS NOT NULL
      ORDER BY district, name
      LIMIT 30`,
  );

  let created = 0;
  for (const [i, f] of facilities.entries()) {
    const isHospital = HOSPITAL_TYPES.includes(f.facility_type);
    const type = isHospital ? 'AMBULANCE' : i % 2 === 0 ? 'COMMUNITY_DRIVER' : 'MOTORBIKE';
    const name = isHospital
      ? `${f.name} Ambulance`
      : `${f.district} ${type === 'MOTORBIKE' ? 'Rider' : 'Driver'} ${i + 1}`;

    // Small deterministic jitter so vehicles aren't all exactly on the facility.
    const lon = f.lon != null ? f.lon + ((i % 5) - 2) * 0.01 : null;
    const lat = f.lat != null ? f.lat + ((i % 3) - 1) * 0.01 : null;
    const phone = `097${String(1000000 + i * 5347).slice(0, 7)}`;

    const res = await pool.query(
      `INSERT INTO transport_resources
         (name, vehicle_type, base_facility_id, location, contact_phone, district, source)
       SELECT $1, $2, $3,
              CASE WHEN $4::float8 IS NULL THEN NULL
                   ELSE ST_SetSRID(ST_MakePoint($4::float8, $5::float8), 4326)::geography END,
              $6, $7, 'DEV'
       WHERE NOT EXISTS (SELECT 1 FROM transport_resources WHERE name = $1)`,
      [name, type, f.id, lon, lat, phone, f.district],
    );
    created += res.rowCount ?? 0;
  }
  return created;
}

const isDirectRun =
  process.argv[1] !== undefined && process.argv[1].endsWith('seedTransport.ts');

if (isDirectRun) {
  seedTransport()
    .then((n) => {
      console.log(`Seeded ${n} synthetic transport resources.`);
      return closePool();
    })
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
      return closePool();
    });
}
