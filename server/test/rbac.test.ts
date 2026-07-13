import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AuthUser } from '../src/auth/plugin.js';

// These exercise the auth/RBAC gates only — every assertion is on a path that
// the preHandler chain (authenticate → requireRole) or in-handler validation
// rejects *before* any database access, so they run without a live Postgres.
// The full happy-path lifecycle is the v0.1 demo, run against a seeded DB.

let app: FastifyInstance;

function token(user: Partial<AuthUser>): string {
  const payload: AuthUser = {
    sub: user.sub ?? '00000000-0000-0000-0000-000000000001',
    role: user.role ?? 'FACILITY_STAFF',
    facilityId: user.facilityId ?? 'fac-1',
    district: user.district ?? 'Ndola',
  };
  return app.jwt.sign(payload);
}

function auth(user: Partial<AuthUser>) {
  return { authorization: `Bearer ${token(user)}` };
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('authentication gate', () => {
  it('rejects unauthenticated access to facilities', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/facilities' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects unauthenticated access to referrals', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/referrals' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a token with an unknown role', async () => {
    const bad = app.jwt.sign({ sub: 'x', role: 'ROOT', facilityId: null, district: null } as never);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/referrals',
      headers: { authorization: `Bearer ${bad}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('referral creation RBAC', () => {
  it('forbids DISTRICT_OFFICER from creating a referral', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/referrals',
      headers: auth({ role: 'DISTRICT_OFFICER' }),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('forbids MOH_ADMIN from creating a referral', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/referrals',
      headers: auth({ role: 'MOH_ADMIN' }),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets FACILITY_STAFF past the role gate (400 on missing fields, not 403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/referrals',
      headers: auth({ role: 'FACILITY_STAFF' }),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('identity review queue RBAC', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/identity/review-queue' });
    expect(res.statusCode).toBe(401);
  });

  it('forbids ordinary facility staff (403, proving the route is mounted)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/identity/review-queue',
      headers: auth({ role: 'FACILITY_STAFF' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a decide with an invalid decision value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/identity/review-queue/00000000-0000-0000-0000-0000000000cc/decide',
      headers: auth({ role: 'FACILITY_INCHARGE' }),
      payload: { decision: 'MAYBE' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('metrics endpoint', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/metrics' });
    expect(res.statusCode).toBe(401);
  });
});

describe('terminology endpoint', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/terminology' });
    expect(res.statusCode).toBe(401);
  });

  it('returns the coded value sets to an authenticated user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/terminology',
      headers: auth({ role: 'FACILITY_STAFF' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.danger_signs)).toBe(true);
    expect(body.danger_signs.some((c: { code: string }) => c.code === 'vaginal_bleeding')).toBe(true);
    expect(body.capabilities.some((c: { code: string }) => c.code === 'caesarean_section')).toBe(true);
  });
});

describe('sync pull', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/sync/pull?client_id=dev1' });
    expect(res.statusCode).toBe(401);
  });

  it('requires a client_id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/pull',
      headers: auth({ role: 'FACILITY_STAFF' }),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('transition validation', () => {
  it('rejects an invalid to_status before touching the DB', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/referrals/00000000-0000-0000-0000-0000000000aa/transition',
      headers: auth({ role: 'FACILITY_STAFF' }),
      payload: { to_status: 'BANANA' },
    });
    expect(res.statusCode).toBe(400);
  });
});
