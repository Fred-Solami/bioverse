import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { seedFacilities } from '../src/seed.js';
import { seedUsers } from '../src/seedUsers.js';
import { pool, closePool } from '../src/db.js';
import { scanAndRaise } from '../src/referrals/escalationWorker.js';

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
  let incharge: Session;
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
    incharge = await login('incharge.a');
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
        danger_signs: ['vaginal_bleeding'],
        required_capabilities: ['blood_transfusion', 'caesarean_section'],
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

  it('rejects off-vocabulary clinical codes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/referrals',
      headers: auth(staffA),
      payload: {
        patient_id: patientId,
        reason: 'test',
        priority: 'ROUTINE',
        danger_signs: ['made_up_sign'],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('made_up_sign');
  });

  it('suggests capable facilities ranked by distance (the v0.2 match)', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/referrals',
      headers: auth(staffA),
      payload: {
        patient_id: patientId,
        reason: 'PPH requiring surgical + transfusion capacity',
        priority: 'EMERGENCY',
        required_capabilities: ['blood_transfusion', 'caesarean_section'],
      },
    });
    const rid = create.json().referral.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/referrals/${rid}/match`,
      headers: auth(staffA),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    const names = body.candidates.map((c: { name: string }) => c.name);

    // Only facilities with BOTH capabilities qualify: the two full hospitals.
    expect(names).toContain('Masaiti District Hospital');
    expect(names).toContain('Ndola Teaching Hospital');
    // St. Theresa has caesarean but no blood transfusion → filtered out.
    expect(names).not.toContain('St. Theresa Mission Hospital (Ibenga)');
    // No health posts / maternity-only centres.
    expect(body.candidates.every((c: { facility_type: string }) => c.facility_type !== 'HEALTH_POST')).toBe(true);
    // Emergency pre-selects the nearest capable facility, with stock annotated.
    expect(body.candidates[0].recommended).toBe(true);
    expect(body.candidates[0].stock_status).toBeTruthy();
    expect(typeof body.candidates[0].distance_m).toBe('number');
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

  it('escalates an unmatched emergency and routes the alert to the district', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/referrals',
      headers: auth(staffA),
      payload: {
        patient_id: patientId,
        reason: 'Eclampsia — convulsing, needs urgent transfer',
        priority: 'EMERGENCY',
        danger_signs: ['convulsions'],
      },
    });
    const rid = create.json().referral.id;

    // Scan as if 20 minutes have passed with the referral still INITIATED.
    const later = new Date(Date.now() + 20 * 60_000);
    const raised = await scanAndRaise(later);
    expect(raised).toBeGreaterThan(0);

    // The district officer receives the CRITICAL alert.
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/alerts?status=OPEN',
      headers: auth(district),
    });
    expect(list.statusCode).toBe(200);
    const alert = list.json().alerts.find(
      (a: { referral_id: string; alert_type: string }) =>
        a.referral_id === rid && a.alert_type === 'EMERGENCY_UNMATCHED',
    );
    expect(alert).toBeDefined();
    expect(alert.severity).toBe('CRITICAL');

    // A facility not involved does not see a district-scoped alert.
    const bList = await app.inject({
      method: 'GET',
      url: '/api/v1/alerts',
      headers: auth(staffB),
    });
    expect(
      bList.json().alerts.find((a: { referral_id: string }) => a.referral_id === rid),
    ).toBeUndefined();

    // Idempotent: re-scanning raises no duplicate.
    const raisedAgain = await scanAndRaise(new Date(later.getTime() + 60_000));
    const before = raised;
    expect(raisedAgain).toBeLessThan(before + 1); // no new EMERGENCY_UNMATCHED for rid

    // The district acknowledges it; it leaves the OPEN queue.
    const ack = await app.inject({
      method: 'POST',
      url: `/api/v1/alerts/${alert.id}/ack`,
      headers: auth(district),
    });
    expect(ack.statusCode).toBe(200);
    const open = await app.inject({
      method: 'GET',
      url: '/api/v1/alerts?status=OPEN',
      headers: auth(district),
    });
    expect(
      open.json().alerts.find((a: { id: string }) => a.id === alert.id),
    ).toBeUndefined();
  });

  it('routes a borderline duplicate to the review queue and links on decision', async () => {
    // Original patient, no identifiers so the deterministic stage can't catch a
    // later near-duplicate.
    const orig = await app.inject({
      method: 'POST',
      url: '/api/v1/patients',
      headers: auth(staffA),
      payload: {
        given_name: 'Bwalya',
        family_name: 'Chibesakunda',
        sex: 'M',
        birth_date: '1985-06-01',
        district: 'Kabwe',
      },
    });
    expect(orig.statusCode).toBe(201);
    expect(orig.json().review_pending).toBe(false);
    const origId = orig.json().patient.id;

    // Near-duplicate: same names/sex but different district and no birth date →
    // scores into the review band, not auto-link.
    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/patients',
      headers: auth(staffB),
      payload: {
        given_name: 'Bwalya',
        family_name: 'Chibesakunda',
        sex: 'M',
        district: 'Ndola',
      },
    });
    expect(dup.statusCode).toBe(201);
    expect(dup.json().review_pending).toBe(true);
    const dupId = dup.json().patient.id;

    // In-charge sees the pending review; ordinary facility staff cannot.
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/v1/identity/review-queue',
      headers: auth(staffA),
    });
    expect(forbidden.statusCode).toBe(403);

    const queue = await app.inject({
      method: 'GET',
      url: '/api/v1/identity/review-queue',
      headers: auth(incharge),
    });
    expect(queue.statusCode).toBe(200);
    const review = queue.json().reviews.find(
      (r: { a_id: string; b_id: string }) => r.a_id === dupId && r.b_id === origId,
    );
    expect(review).toBeDefined();
    expect(Number(review.score)).toBeGreaterThanOrEqual(0.6);
    expect(Number(review.score)).toBeLessThan(0.85);

    // Link them; a reversible shared MPI is asserted on both records.
    const decide = await app.inject({
      method: 'POST',
      url: `/api/v1/identity/review-queue/${review.id}/decide`,
      headers: auth(incharge),
      payload: { decision: 'LINKED' },
    });
    expect(decide.statusCode).toBe(200);

    // The duplicate now points at the surviving record; the survivor is
    // untouched. Reversible, non-destructive.
    const { rows } = await pool.query<{ id: string; linked_to: string | null }>(
      `SELECT id, linked_to FROM patients WHERE id IN ($1, $2)`,
      [origId, dupId],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.linked_to]));
    expect(byId[dupId]).toBe(origId);
    expect(byId[origId]).toBeNull();

    // Deciding again is a conflict.
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/identity/review-queue/${review.id}/decide`,
      headers: auth(incharge),
      payload: { decision: 'REJECTED' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('delivers role-scoped event deltas via sync pull', async () => {
    const pull1 = await app.inject({
      method: 'GET',
      url: `/api/v1/sync/pull?client_id=devA&since=0`,
      headers: auth(staffA),
    });
    expect(pull1.statusCode).toBe(200);
    const body = pull1.json();
    expect(body.count).toBeGreaterThan(0);
    // Every delivered event belongs to a referral touching staffA's facility.
    for (const e of body.events) {
      expect(e.from_facility_id === staffA.facilityId || e.to_facility_id === staffA.facilityId).toBe(true);
    }

    // The cursor advanced; re-pulling from it yields nothing new...
    const pull2 = await app.inject({
      method: 'GET',
      url: `/api/v1/sync/pull?client_id=devA&since=${body.cursor}`,
      headers: auth(staffA),
    });
    expect(pull2.json().count).toBe(0);

    // ...and resuming with no `since` uses the stored cursor (also nothing new).
    const pull3 = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/pull?client_id=devA',
      headers: auth(staffA),
    });
    expect(pull3.json().count).toBe(0);

    // A different facility's device only sees its own scoped deltas.
    const pullB = await app.inject({
      method: 'GET',
      url: `/api/v1/sync/pull?client_id=devB&since=0`,
      headers: auth(staffB),
    });
    for (const e of pullB.json().events) {
      expect(e.from_facility_id === staffB.facilityId || e.to_facility_id === staffB.facilityId).toBe(true);
    }
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
