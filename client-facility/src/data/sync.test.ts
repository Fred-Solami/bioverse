import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queueCreate } from './referrals';
import { syncNow, pendingCount } from './sync';
import { listOutbox, getReferral, getMeta } from '../db/store';
import type { SessionUser } from '../types';
import type { LocalReferral } from './referrals';

const { pushEvents, pullEvents } = vi.hoisted(() => ({
  pushEvents: vi.fn(),
  pullEvents: vi.fn(),
}));
vi.mock('../api/client', () => ({ pushEvents, pullEvents }));

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
  reason: 'PPH',
  priority: 'EMERGENCY' as const,
  danger_signs: [],
  required_capabilities: [],
};

beforeEach(() => {
  pushEvents.mockReset();
  pullEvents.mockReset();
  pullEvents.mockResolvedValue({ cursor: '0', count: 0, events: [] });
});

describe('syncNow', () => {
  it('drains accepted events and flips the projection to synced', async () => {
    const local = await queueCreate(input, user);
    expect(await pendingCount()).toBeGreaterThan(0);

    pushEvents.mockImplementation(async (_id: string, events: Array<{ event_id: string }>) => ({
      accepted: events.length,
      rejected: 0,
      results: events.map((e) => ({
        event_id: e.event_id,
        status: 'accepted',
        referral_id: local.id,
        reference: 'REF-2026-000042',
      })),
    }));
    pullEvents.mockResolvedValue({ cursor: '7', count: 0, events: [] });

    const outcome = await syncNow();
    expect(outcome.pushedAccepted).toBeGreaterThan(0);

    const synced = await getReferral<LocalReferral>(local.id);
    expect(synced!.sync).toBe('synced');
    expect(synced!.reference).toBe('REF-2026-000042'); // server-assigned
    expect(await listOutbox()).toHaveLength(0); // queue drained
    expect(await getMeta('sync_cursor')).toBe('7'); // cursor advanced
  });

  it('flags rejected events instead of retrying them forever', async () => {
    const local = await queueCreate(input, user);
    pushEvents.mockImplementation(async (_id: string, events: Array<{ event_id: string }>) => ({
      accepted: 0,
      rejected: events.length,
      results: events.map((e) => ({
        event_id: e.event_id,
        status: 'rejected',
        referral_id: local.id,
        reason: 'unknown danger_signs',
      })),
    }));

    const outcome = await syncNow();
    expect(outcome.pushedRejected).toBeGreaterThan(0);
    const flagged = await getReferral<LocalReferral>(local.id);
    expect(flagged!.sync).toBe('rejected');
    expect(await listOutbox()).toHaveLength(0); // not retried forever
  });

  it('merges pulled status updates and creates rows for unseen referrals', async () => {
    const local = await queueCreate(input, user);
    pushEvents.mockImplementation(async (_id: string, events: Array<{ event_id: string }>) => ({
      accepted: events.length,
      rejected: 0,
      results: events.map((e) => ({
        event_id: e.event_id,
        status: 'accepted',
        referral_id: local.id,
        reference: 'REF-1',
      })),
    }));
    pullEvents.mockResolvedValue({
      cursor: '12',
      count: 2,
      events: [
        {
          seq: '11',
          referral_id: local.id,
          reference: 'REF-1',
          current_status: 'MATCHED', // someone matched it server-side
          priority: 'EMERGENCY',
          patient_id: 'p1',
          to_status: 'MATCHED',
          occurred_at: new Date().toISOString(),
        },
        {
          seq: '12',
          referral_id: 'remote-1',
          reference: 'REF-2',
          current_status: 'INITIATED', // inbound referral we have never seen
          priority: 'URGENT',
          patient_id: 'p9',
          to_status: 'INITIATED',
          occurred_at: new Date().toISOString(),
        },
      ],
    });

    await syncNow();
    const mine = await getReferral<LocalReferral>(local.id);
    expect(mine!.current_status).toBe('MATCHED');
    const inbound = await getReferral<LocalReferral>('remote-1');
    expect(inbound).toBeDefined();
    expect(inbound!.sync).toBe('synced');
  });
});
