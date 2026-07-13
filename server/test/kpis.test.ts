import { describe, expect, it } from 'vitest';
import { computeKpis, type ReferralMilestones } from '../src/metrics/kpis.js';

const T0 = new Date('2026-07-13T08:00:00Z');
function plus(mins: number): Date {
  return new Date(T0.getTime() + mins * 60000);
}

function ref(over: Partial<ReferralMilestones>): ReferralMilestones {
  return {
    current_status: over.current_status ?? 'INITIATED',
    initiated_at: over.initiated_at ?? T0,
    matched_at: over.matched_at ?? null,
    received_at: over.received_at ?? null,
    treated_at: over.treated_at ?? null,
    feedback_at: over.feedback_at ?? null,
  };
}

describe('computeKpis', () => {
  it('reports feedback closure as returned-over-treated', () => {
    const k = computeKpis([
      ref({ current_status: 'FEEDBACK_RETURNED', treated_at: plus(120), feedback_at: plus(200) }),
      ref({ current_status: 'TREATED', treated_at: plus(90) }), // treated, no feedback
      ref({ current_status: 'CLOSED', treated_at: plus(60), feedback_at: plus(100) }),
    ]);
    expect(k.feedback_closure_rate).toBeCloseTo(2 / 3); // 2 of 3 treated got feedback
  });

  it('is null when nothing has been treated yet', () => {
    const k = computeKpis([ref({ current_status: 'INITIATED' }), ref({ current_status: 'MATCHED', matched_at: plus(5) })]);
    expect(k.feedback_closure_rate).toBeNull();
  });

  it('computes acknowledgement time median and p90 from INITIATED to RECEIVED', () => {
    const k = computeKpis([
      ref({ received_at: plus(30) }),
      ref({ received_at: plus(60) }),
      ref({ received_at: plus(90) }),
      ref({ received_at: plus(600) }),
    ]);
    expect(k.acknowledgement_time.count).toBe(4);
    expect(k.acknowledgement_time.median_minutes).toBe(90);
    expect(k.acknowledgement_time.p90_minutes).toBe(600);
  });

  it('tallies statuses and rejection rate', () => {
    const k = computeKpis([
      ref({ current_status: 'REJECTED' }),
      ref({ current_status: 'REJECTED' }),
      ref({ current_status: 'CLOSED' }),
      ref({ current_status: 'INITIATED' }),
    ]);
    expect(k.by_status).toEqual({ REJECTED: 2, CLOSED: 1, INITIATED: 1 });
    expect(k.rejection_rate).toBeCloseTo(0.5);
  });

  it('handles an empty dataset without dividing by zero', () => {
    const k = computeKpis([]);
    expect(k.total).toBe(0);
    expect(k.feedback_closure_rate).toBeNull();
    expect(k.acknowledgement_time.median_minutes).toBeNull();
  });
});
