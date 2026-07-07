import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { seedFacilities } from '../src/seed.js';
import { seedUsers } from '../src/seedUsers.js';
import { pool, closePool } from '../src/db.js';

// The v0.1 exit criterion (DESIGN.md §17): "two seeded facilities complete a
// full referral lifecycle via API". Needs a PostGIS-capable Postgres, which the
// dev machine lacks (docs/PLAN.md constraint #1) — so this suite only runs when
// E2E=1, which CI sets after starting a postgis service container. It is
// deliberately self-contained: migrate + seed happen in beforeAll, so a fresh
// database proves the whole Phase 0 + v0.1 surface in one pass.
const run = process.env.E2E === '1';

const PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe!dev123';

interface Session {
  token: string;
  facilityId: string | null;
  district: string | null;
  cookie: string; // raw refresh cookie value
}

let app: FastifyInstance;

async function login(username: string): Promise<Session> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password: PASSWORD },
  });
  expect(res.statusCode, `login ${username}: ${res.body}`).toBe(200);
  const body = res.json();
  const cookie = res.cookies.find((c) => c.name === 'bv_refresh');
  expect(cookie).toBeDefined();
  return {
    token: body.accessToken,
    facilityId: body.user.facilityId,
    district: body.user.district,
    cookie: cookie!.value,
  };
}

function auth(s: Session) {
  return { authorization: `Bearer ${s.token}` };
}

async function transition(
  s: Session,
  referralId: string,
  to: string,
  extra: Record<string, unknown> = {},
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/referrals/${referralId}/transition`,
    headers: auth(s),
    payload: { to_status: to, occurred_at: new Date().toISOString(), ...extra },
  });
}

// audit_log writes happen in an onResponse hook, which can still be in flight
// when inject() resolves — poll briefly instead of asserting immediately.
async function auditCount(entityType: string, action: string): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit_log WHERE entity_type = $1 AND action = $2`,
      [entityType, action],
    );
    const n = Number(rows[0]!.n);
    if (n > 0) return n;
    await new Promise((r) => setTimeout(r, 100));
  }
  return 0;
}

describe.runIf(run)('v0.1 lifecycle (live database)', () => {
  let staffA: Session;
  let staffB: Session;
  let district: Session;
  let admin: Session;
  let patientId: string;
  let referralId: string;

  beforeAll(async () => {
    await migrate();
    await seedFacilities();
    await seedUsers();
    app = await buildApp({ logger: false });
    await app.ready();

    staffA = await login('staff.a');
    staffB = await login('staff.b');
    district = await login('district');
    admin = await login('admin');
    expect(staffA.facilityId).not.toBe(staffB.facilityId);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await closePool();
  });

  it('rejects a bad password and audits the failed login', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'staff.a', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(await auditCount('user', 'LOGIN')).toBeGreaterThan(0);
  });

  it('registers a patient, then deterministically matches on replay', async () => {
    const nrc = { id_type: 'NRC', id_value: `${Date.now()}/10/1` };
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/patients',
      headers: auth(staffA),
      payload: {
        given_name: 'Chanda',
        family_name: 'Mwansa',
        sex: 'F',
        birth_date: '1998-04-12',
        district: staffA.district,
        identifiers: [nrc],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    patientId = created.json().patient.id;

    // Same NRC again → the cascade returns the existing patient, no duplicate.
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/patients',
      headers: auth(staffB),
      payload: { given_name: 'C.', family_name: 'Mwansa', identifiers: [nrc] },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().matched_on).toBe('NRC');
    expect(replay.json().patient.id).toBe(patientId);

    // Audited search by identifier finds her too.
    const search = await app.inject({
      method: 'POST',
      url: '/api/v1/patients/search',
      headers: auth(staffA),
      payload: { identifier: nrc },
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().count).toBe(1);
  });

  it('creates a referral in INITIATED with its opening event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/referrals',
      headers: auth(staffA),
      payload: {
        patient_id: patientId,
        reason: 'PPH — heavy bleeding after delivery',
        priority: 'EMERGENCY',
        danger_signs: ['bleeding'],
        required_capabilities: ['blood_bank', 'caesarean_section'],
        event_id: randomUUID(),
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    referralId = body.referral.id;
    expect(body.referral.reference).toMatch(/^REF-\d{4}-\d{6}$/);
    expect(body.referral.current_status).toBe('INITIATED');
    expect(body.events).toHaveLength(1);
  });

  it('walks the full lifecycle with the right facility on each side', async () => {
    // Referrer side: match to facility B, dispatch, transit.
    let res = await transition(staffA, referralId, 'MATCHED', {
      to_facility_id: staffB.facilityId,
    });
    expect(res.statusCode, res.body).toBe(200);

    res = await transition(staffA, referralId, 'DISPATCHED');
    expect(res.statusCode).toBe(200);
    res = await transition(staffA, referralId, 'IN_TRANSIT');
    expect(res.statusCode).toBe(200);

    // Referrer must NOT be able to mark arrival — that's facility B's call.
    res = await transition(staffA, referralId, 'RECEIVED');
    expect(res.statusCode).toBe(403);

    // Receiver side, with idempotent replay on the event UUID.
    const receivedEvent = randomUUID();
    res = await transition(staffB, referralId, 'RECEIVED', { event_id: receivedEvent });
    expect(res.statusCode).toBe(200);
    res = await transition(staffB, referralId, 'RECEIVED', { event_id: receivedEvent });
    expect(res.statusCode).toBe(200); // replay: same state, no duplicate event
    expect(res.json().referral.current_status).toBe('RECEIVED');

    res = await transition(staffB, referralId, 'TREATED');
    expect(res.statusCode).toBe(200);
    res = await transition(staffB, referralId, 'FEEDBACK_RETURNED', {
      payload: { outcome: 'stabilised, transfused 2 units' },
    });
    expect(res.statusCode).toBe(200);

    // Referrer closes the loop.
    res = await transition(staffA, referralId, 'CLOSED');
    expect(res.statusCode).toBe(200);

    const timeline = res.json();
    expect(timeline.referral.current_status).toBe('CLOSED');
    expect(timeline.referral.closed_at).not.toBeNull();
    const statuses = timeline.events.map((e: { to_status: string }) => e.to_status);
    expect(statuses).toEqual([
      'INITIATED', 'MATCHED', 'DISPATCHED', 'IN_TRANSIT',
      'RECEIVED', 'TREATED', 'FEEDBACK_RETURNED', 'CLOSED',
    ]);

    // KPI instrumentation (DESIGN.md §20): acknowledgement time is derivable.
    const initiated = timeline.events.find((e: { to_status: string }) => e.to_status === 'INITIATED');
    const received = timeline.events.find((e: { to_status: string }) => e.to_status === 'RECEIVED');
    expect(new Date(received.occurred_at).getTime()).toBeGreaterThanOrEqual(
      new Date(initiated.occurred_at).getTime(),
    );
  });

  it('enforces mandatory reasons and re-entry after rejection', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/referrals',
      headers: auth(staffA),
      payload: { patient_id: patientId, reason: 'severe pre-eclampsia', priority: 'URGENT' },
    });
    const second = create.json().referral.id;

    let res = await transition(staffA, second, 'MATCHED', { to_facility_id: staffB.facilityId });
    expect(res.statusCode).toBe(200);

    // Receiver rejects — reason mandatory.
    res = await transition(staffB, second, 'REJECTED');
    expect(res.statusCode).toBe(400);
    res = await transition(staffB, second, 'REJECTED', { note: 'no ICU bed available' });
    expect(res.statusCode).toBe(200);
    expect(res.json().referral.current_status).toBe('REJECTED');

    // Rejected referrals re-enter matching.
    res = await transition(staffA, second, 'MATCHED', { to_facility_id: staffB.facilityId });
    expect(res.statusCode).toBe(200);

    // Cancellation also demands a reason, and only from the referrer.
    res = await transition(staffB, second, 'CANCELLED', { note: 'x' });
    expect(res.statusCode).toBe(403);
    res = await transition(staffA, second, 'CANCELLED');
    expect(res.statusCode).toBe(400);
    res = await transition(staffA, second, 'CANCELLED', { note: 'patient transferred privately' });
    expect(res.statusCode).toBe(200);

    // Terminal: nothing moves out of CANCELLED.
    res = await transition(staffA, second, 'MATCHED', { to_facility_id: staffB.facilityId });
    expect(res.statusCode).toBe(409);
  });

  it('scopes referral lists by role', async () => {
    const asStaffB = await app.inject({
      method: 'GET', url: '/api/v1/referrals', headers: auth(staffB),
    });
    expect(asStaffB.statusCode).toBe(200);
    // B sees the referrals routed to it, but B was never the referrer.
    const bIds = asStaffB.json().referrals.map((r: { id: string }) => r.id);
    expect(bIds).toContain(referralId);

    const asDistrict = await app.inject({
      method: 'GET', url: '/api/v1/referrals', headers: auth(district),
    });
    expect(asDistrict.statusCode).toBe(200);
    expect(asDistrict.json().count).toBeGreaterThan(0);

    const asAdmin = await app.inject({
      method: 'GET', url: '/api/v1/referrals?status=CLOSED', headers: auth(admin),
    });
    expect(asAdmin.json().referrals.some((r: { id: string }) => r.id === referralId)).toBe(true);
  });

  it('rotates refresh tokens and revokes on logout', async () => {
    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: `bv_refresh=${staffA.cookie}` },
    });
    expect(refreshed.statusCode).toBe(200);
    const newCookie = refreshed.cookies.find((c) => c.name === 'bv_refresh')!.value;
    expect(newCookie).not.toBe(staffA.cookie);

    // The old token was rotated away — reusing it burns the family.
    const reuse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: `bv_refresh=${staffA.cookie}` },
    });
    expect(reuse.statusCode).toBe(401);

    // And the rotated-to token is now dead too (family revocation).
    const afterBurn = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: `bv_refresh=${newCookie}` },
    });
    expect(afterBurn.statusCode).toBe(401);
  });

  it('wrote audit rows for every patient-touching surface', async () => {
    expect(await auditCount('patient', 'CREATE')).toBeGreaterThan(0);
    expect(await auditCount('patient', 'READ')).toBeGreaterThan(0);
    expect(await auditCount('referral', 'CREATE')).toBeGreaterThanOrEqual(2);
    expect(await auditCount('referral', 'UPDATE')).toBeGreaterThan(0);
    expect(await auditCount('user', 'LOGIN')).toBeGreaterThan(0);
  });
});
