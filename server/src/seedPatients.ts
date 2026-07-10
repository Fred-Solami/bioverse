import { pool, closePool } from './db.js';

// Synthetic patient seeding — Synthea-style (synthetic, zero privacy risk) but
// localized for Zambia, because Synthea's default US names/addresses would read
// as obviously wrong in a Copperbelt facility app. Gives the client realistic
// data to search and stress-tests the matching cascade at volume.
//
// NOT for production. Reproducible (seeded PRNG) so re-runs are stable; upserts
// on the NRC identifier so it is safe to run repeatedly.

const COUNT = Number(process.env.PATIENT_COUNT ?? 60);

// Deterministic PRNG (mulberry32) so the same dataset regenerates every run.
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GIVEN_F = [
  'Chanda', 'Mwaka', 'Bupe', 'Mutinta', 'Namwaka', 'Luyando', 'Mapalo', 'Temwani',
  'Chisomo', 'Thandiwe', 'Mercy', 'Grace', 'Precious', 'Kunda', 'Chilufya', 'Musonda',
  'Nsansa', 'Taonga', 'Chikondi', 'Wongani',
];
const GIVEN_M = [
  'Mulenga', 'Kabwe', 'Mwape', 'Bwalya', 'Chomba', 'Musonda', 'Chibesa', 'Mumba',
  'Sepo', 'Lubinda', 'Kondwani', 'Mabvuto', 'Emmanuel', 'Gift', 'Blessings', 'Chali',
  'Mwansa', 'Kapya', 'Yotam', 'Isaac',
];
const FAMILY = [
  'Mwansa', 'Phiri', 'Banda', 'Tembo', 'Zulu', 'Mulenga', 'Bwalya', 'Sakala', 'Ngoma',
  'Daka', 'Mbewe', 'Kabwe', 'Musonda', 'Chilufya', 'Kaunda', 'Lungu', 'Sinkamba',
  'Mwanza', 'Chibwe', 'Kalaba', 'Muyunda', 'Sitali', 'Nkhoma', 'Chanda',
];
// Districts our seeded facilities sit in (server/seed/facilities.sample.json).
const DISTRICTS = ['Masaiti', 'Ndola', 'Mpongwe', 'Lufwanyama', 'Kitwe'];

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

interface SyntheticPatient {
  given_name: string;
  family_name: string;
  sex: 'M' | 'F';
  birth_date: string;
  phone: string;
  district: string;
  nrc: string;
}

export function generatePatients(count = COUNT, seed = 42): SyntheticPatient[] {
  const rand = rng(seed);
  const out: SyntheticPatient[] = [];
  for (let i = 0; i < count; i++) {
    const sex: 'M' | 'F' = rand() < 0.62 ? 'F' : 'M'; // maternal-heavy pilot population
    const given = pick(rand, sex === 'F' ? GIVEN_F : GIVEN_M);
    // Weight ages toward reproductive range but keep a spread.
    const age = 15 + Math.floor(rand() * 45);
    const year = 2026 - age;
    const month = 1 + Math.floor(rand() * 12);
    const day = 1 + Math.floor(rand() * 28);
    out.push({
      given_name: given,
      family_name: pick(rand, FAMILY),
      sex,
      birth_date: `${year}-${pad(month, 2)}-${pad(day, 2)}`,
      phone: `09${pick(rand, ['5', '6', '7'])}${pad(Math.floor(rand() * 10000000), 7)}`,
      district: pick(rand, DISTRICTS),
      // NRC format NNNNNN/NN/N — deterministic and unique per index.
      nrc: `${pad(100000 + i * 7, 6)}/${pad(10 + (i % 89), 2)}/1`,
    });
  }
  return out;
}

export async function seedPatients(count = COUNT): Promise<number> {
  const patients = generatePatients(count);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of patients) {
      // Skip if this NRC already maps to a patient (idempotent re-runs).
      const existing = await client.query(
        `SELECT 1 FROM patient_identifiers WHERE id_type = 'NRC' AND id_value = $1 AND is_active = true`,
        [p.nrc],
      );
      if (existing.rows[0]) continue;

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO patients (given_name, family_name, sex, birth_date, phone, district)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [p.given_name, p.family_name, p.sex, p.birth_date, p.phone, p.district],
      );
      await client.query(
        `INSERT INTO patient_identifiers (patient_id, id_type, id_value) VALUES ($1, 'NRC', $2)`,
        [rows[0]!.id, p.nrc],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return patients.length;
}

const isDirectRun =
  process.argv[1] !== undefined && process.argv[1].endsWith('seedPatients.ts');

if (isDirectRun) {
  seedPatients()
    .then((n) => {
      console.log(`Seeded up to ${n} synthetic patients (localized Zambian demographics).`);
      return closePool();
    })
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
      return closePool();
    });
}
