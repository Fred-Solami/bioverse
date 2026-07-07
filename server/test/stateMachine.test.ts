import { describe, expect, it } from 'vitest';
import {
  checkTransition,
  isTerminal,
  isStatus,
  type ReferralSides,
  type TransitionActor,
} from '../src/referrals/stateMachine.js';

const sides: ReferralSides = { fromFacilityId: 'A', toFacilityId: 'B' };
const referrer: TransitionActor = { role: 'FACILITY_STAFF', facilityId: 'A' };
const receiver: TransitionActor = { role: 'FACILITY_STAFF', facilityId: 'B' };
const district: TransitionActor = { role: 'DISTRICT_OFFICER', facilityId: null };

describe('referral state machine', () => {
  it('accepts a legal referrer-side transition', () => {
    expect(checkTransition('INITIATED', 'MATCHED', referrer, sides, undefined).ok).toBe(true);
  });

  it('rejects a transition not on the allow-list with 409', () => {
    const r = checkTransition('INITIATED', 'RECEIVED', receiver, sides, undefined);
    expect(r).toMatchObject({ ok: false, code: 409 });
  });

  it('requires a reason for CANCELLED and REJECTED', () => {
    expect(checkTransition('INITIATED', 'CANCELLED', referrer, sides, undefined)).toMatchObject({
      ok: false,
      code: 400,
    });
    expect(checkTransition('MATCHED', 'REJECTED', receiver, sides, '  ')).toMatchObject({
      ok: false,
      code: 400,
    });
    expect(checkTransition('MATCHED', 'REJECTED', receiver, sides, 'no beds').ok).toBe(true);
  });

  it('requires a to_facility_id for MATCHED', () => {
    const r = checkTransition('INITIATED', 'MATCHED', referrer, { fromFacilityId: 'A', toFacilityId: null }, undefined);
    expect(r).toMatchObject({ ok: false, code: 400 });
  });

  it('gates receiver-only transitions to the receiving facility', () => {
    // Referrer facility cannot mark RECEIVED.
    expect(checkTransition('IN_TRANSIT', 'RECEIVED', referrer, sides, undefined)).toMatchObject({
      ok: false,
      code: 403,
    });
    expect(checkTransition('IN_TRANSIT', 'RECEIVED', receiver, sides, undefined).ok).toBe(true);
  });

  it('gates referrer-only transitions to the referring facility', () => {
    // Receiver cannot CANCEL.
    expect(checkTransition('INITIATED', 'CANCELLED', receiver, sides, 'x')).toMatchObject({
      ok: false,
      code: 403,
    });
    expect(checkTransition('INITIATED', 'CANCELLED', referrer, sides, 'x').ok).toBe(true);
  });

  it('lets oversight roles act on either side', () => {
    expect(checkTransition('MATCHED', 'REJECTED', district, sides, 'reason').ok).toBe(true);
    expect(checkTransition('IN_TRANSIT', 'RECEIVED', district, sides, undefined).ok).toBe(true);
  });

  it('allows a rejected referral to re-enter matching', () => {
    expect(checkTransition('REJECTED', 'MATCHED', referrer, sides, undefined).ok).toBe(true);
  });

  it('knows terminal states', () => {
    expect(isTerminal('CLOSED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('INITIATED')).toBe(false);
  });

  it('validates status strings', () => {
    expect(isStatus('MATCHED')).toBe(true);
    expect(isStatus('BANANA')).toBe(false);
  });
});
