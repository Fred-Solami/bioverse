import { pool, closePool } from './db.js';
import { hashPassword } from './auth/passwords.js';

// Dev user seeding so the v0.1 demo ("two seeded facilities complete a full
// referral lifecycle via the API", DESIGN.md §17) can actually log in. Creates
// facility staff at the first two seeded facilities plus a district officer and
// an MOH admin. NOT for production — the password is a shared dev default.
//
// Prereq: run `npm run seed` (facilities) first. Password via SEED_PASSWORD,
// else a loud dev default.
const DEV_PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe!dev123';

interface FacilityRow {
  id: string;
  district: string;
  name: string;
}

export async function seedUsers(): Promise<number> {
  const { rows: facilities } = await pool.query<FacilityRow>(
    `SELECT id, district, name FROM facilities WHERE is_active = true
      ORDER BY district, name LIMIT 2`,
  );
  if (facilities.length < 2) {
    throw new Error('Seed at least two facilities first (npm run seed).');
  }

  const hash = await hashPassword(DEV_PASSWORD);
  const [a, b] = facilities as [FacilityRow, FacilityRow];

  const users = [
    { username: 'staff.a', full_name: 'Dev Staff A', role: 'FACILITY_STAFF', facility_id: a.id, district: a.district },
    { username: 'staff.b', full_name: 'Dev Staff B', role: 'FACILITY_STAFF', facility_id: b.id, district: b.district },
    { username: 'incharge.a', full_name: 'Dev In-Charge A', role: 'FACILITY_INCHARGE', facility_id: a.id, district: a.district },
    { username: 'district', full_name: 'Dev District Officer', role: 'DISTRICT_OFFICER', facility_id: null, district: a.district },
    { username: 'admin', full_name: 'Dev MOH Admin', role: 'MOH_ADMIN', facility_id: null, district: null },
  ];

  for (const u of users) {
    await pool.query(
      `INSERT INTO users (username, password_hash, full_name, role, facility_id, district)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (username) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         full_name = EXCLUDED.full_name,
         role = EXCLUDED.role,
         facility_id = EXCLUDED.facility_id,
         district = EXCLUDED.district,
         is_active = true`,
      [u.username, hash, u.full_name, u.role, u.facility_id, u.district],
    );
  }
  return users.length;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  process.argv[1].endsWith('seedUsers.ts');

if (isDirectRun) {
  seedUsers()
    .then((count) => {
      console.log(`Seeded ${count} dev users (password: ${DEV_PASSWORD}).`);
      return closePool();
    })
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
      return closePool();
    });
}
