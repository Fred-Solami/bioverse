import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { buildCreateEvent, queueCreate, listLocalReferrals } from './referrals';
import { listOutbox } from '../db/store';
import type { SessionUser } from '../types';

const user: SessionUser = {
  sub: 'u1',
  role: 'FACILITY_STAFF',
  facilityId: 'fac-1',
  district: 'Ndola',
  username: 'staff.a',
};

const input = {
  patient_id: 'p1',
  patient_name: 'Chanda Mwansa',
  reason: '  PPH, bleeding  ',
  priority: 'EMERGENCY' as const,
  danger_signs: ['vaginal_bleeding'],
  required_capabilities: ['blood_transfusion'],
  clinical_summary: '',
};

describe('buildCreateEvent', () => {
  it('produces a server-shaped CREATE event with client UUIDs', () => {
    const ev = buildCreateEvent(input, user);
    expect(ev.kind).toBe('CREATE');
    expect(ev.event_id).toMatch(/[0-9a-f-]{36}/);
    expect(ev.referral_id).toMatch(/[0-9a-f-]{36}/);
    expect(ev.event_id).not.toBe(ev.referral_id);
    expect(ev.referral).toMatchObject({
      patient_id: 'p1',
      from_facility_id: 'fac-1',
      reason: 'PPH, bleeding', // trimmed
      priority: 'EMERGENCY',
      pathway: 'MATERNAL',
      danger_signs: ['vaginal_bleeding'],
    });
    expect(ev.referral.clinical_summary).toBeUndefined(); // empty → omitted
  });
});

describe('queueCreate', () => {
  it('writes both the outbox event and the optimistic projection', async () => {
    const local = await queueCreate(input, user);
    expect(local.sync).toBe('pending');
    expect(local.reference).toBe('PENDING');
    expect(local.current_status).toBe('INITIATED');

    const outbox = await listOutbox<{ event_id: string; referral_id: string; kind: string }>();
    const queued = outbox.find((e) => e.referral_id === local.id);
    expect(queued).toBeDefined();
    expect(queued!.kind).toBe('CREATE');

    const listed = await listLocalReferrals();
    expect(listed.some((r) => r.id === local.id && r.patient_name === 'Chanda Mwansa')).toBe(true);
  });
});
