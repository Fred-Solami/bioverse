import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { queueCreate, queueTransition, buildTransitionEvent } from './referrals';
import { listOutbox, getReferral } from '../db/store';
import type { SessionUser } from '../types';
import type { LocalReferral } from './referrals';

const user: SessionUser = {
  sub: 'u1',
  role: 'FACILITY_INCHARGE',
  facilityId: 'fac-1',
  district: 'Ndola',
  username: 'incharge.a',
};

describe('buildTransitionEvent', () => {
  it('produces a server-shaped TRANSITION event and trims empty notes', () => {
    const ev = buildTransitionEvent('ref-1', 'RECEIVED', { note: '   ' });
    expect(ev).toMatchObject({ kind: 'TRANSITION', referral_id: 'ref-1', to_status: 'RECEIVED' });
    expect(ev.event_id).toMatch(/[0-9a-f-]{36}/);
    expect(ev.note).toBeUndefined();
  });
});

describe('queueTransition', () => {
  it('queues the event and optimistically advances the local status', async () => {
    const local = await queueCreate(
      {
        patient_id: 'p1',
        patient_name: 'Chanda Mwansa',
        reason: 'PPH',
        priority: 'EMERGENCY',
        danger_signs: [],
        required_capabilities: [],
      },
      user,
    );

    await queueTransition(local.id, 'RECEIVED', { note: 'arrived stable' });

    const updated = await getReferral<LocalReferral>(local.id);
    expect(updated!.current_status).toBe('RECEIVED');
    expect(updated!.sync).toBe('pending');

    const queued = (await listOutbox()).filter((e) => (e as { kind?: string }).kind === 'TRANSITION');
    expect(queued).toHaveLength(1);
  });
});
