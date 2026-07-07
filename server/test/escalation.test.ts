import { describe, expect, it } from 'vitest';
import {
  evaluateEscalations,
  DEFAULT_THRESHOLDS,
  type ReferralSnapshot,
} from '../src/referrals/escalation.js';

const T0 = new Date('2026-07-07T08:00:00Z');
function minsAfter(m: number): Date {
  return new Date(T0.getTime() + m * 60000);
}

function snap(over: Partial<ReferralSnapshot>): ReferralSnapshot {
  return {
    priority: over.priority ?? 'EMERGENCY',
    current_status: over.current_status ?? 'INITIATED',
    initiated_at: over.initiated_at ?? T0,
    dispatched_at: over.dispatched_at ?? null,
    treated_at: over.treated_at ?? null,
    status_since: over.status_since ?? T0,
  };
}

describe('evaluateEscalations', () => {
  it('raises EMERGENCY_UNMATCHED for an emergency still unmatched past 15 min', () => {
    const before = evaluateEscalations(snap({}), minsAfter(14));
    expect(before).toHaveLength(0);
    const after = evaluateEscalations(snap({}), minsAfter(16));
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      alert_type: 'EMERGENCY_UNMATCHED',
      severity: 'CRITICAL',
      notifyDistrict: true,
    });
  });

  it('does not raise EMERGENCY_UNMATCHED for a non-emergency', () => {
    const r = evaluateEscalations(snap({ priority: 'ROUTINE' }), minsAfter(60));
    expect(r).toHaveLength(0);
  });

  it('raises TRANSIT_OVERDUE past the grace window and notifies both sides', () => {
    const s = snap({ current_status: 'IN_TRANSIT', dispatched_at: T0 });
    expect(evaluateEscalations(s, minsAfter(59))).toHaveLength(0);
    const r = evaluateEscalations(s, minsAfter(61));
    expect(r[0]).toMatchObject({
      alert_type: 'TRANSIT_OVERDUE',
      notifyReferrer: true,
      notifyReceiver: true,
      notifyDistrict: true,
    });
  });

  it('raises FEEDBACK_OVERDUE after 48h to the receiver only', () => {
    const s = snap({ current_status: 'TREATED', treated_at: T0 });
    expect(evaluateEscalations(s, minsAfter(47 * 60))).toHaveLength(0);
    const r = evaluateEscalations(s, minsAfter(49 * 60));
    expect(r[0]).toMatchObject({
      alert_type: 'FEEDBACK_OVERDUE',
      notifyReceiver: true,
      notifyReferrer: false,
      notifyDistrict: false,
    });
  });

  it('raises REJECTED immediately with district visibility', () => {
    const r = evaluateEscalations(snap({ current_status: 'REJECTED' }), minsAfter(0));
    expect(r[0]).toMatchObject({
      alert_type: 'REJECTED',
      notifyDistrict: true,
      notifyReferrer: true,
    });
  });

  it('never escalates terminal referrals', () => {
    for (const status of ['CLOSED', 'CANCELLED']) {
      expect(evaluateEscalations(snap({ current_status: status }), minsAfter(9999))).toHaveLength(0);
    }
  });

  it('uses the default thresholds when none supplied', () => {
    expect(DEFAULT_THRESHOLDS.emergencyUnmatchedMin).toBe(15);
    const r = evaluateEscalations(snap({}), minsAfter(20));
    expect(r).toHaveLength(1);
  });
});
