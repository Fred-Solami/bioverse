import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { getSession, setSession, clearSession } from './store';
import type { SessionUser } from '../types';

const user: SessionUser = {
  sub: 'u1',
  role: 'FACILITY_STAFF',
  facilityId: 'f1',
  district: 'Ndola',
  username: 'staff.a',
};

describe('session store', () => {
  it('round-trips and clears the session', async () => {
    expect(await getSession()).toBeUndefined();

    await setSession({ user });
    const loaded = await getSession();
    expect(loaded?.user.username).toBe('staff.a');
    expect(loaded?.user.facilityId).toBe('f1');

    await clearSession();
    expect(await getSession()).toBeUndefined();
  });
});
