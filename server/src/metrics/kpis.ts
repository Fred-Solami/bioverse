// KPI computation (DESIGN.md §20). Pure logic over per-referral milestone
// timestamps so the definitions are unit-testable and identical wherever they
// are surfaced. These are the numbers the whole system exists to move:
// feedback closure (~0% on paper today) and referral acknowledgement time.

export interface ReferralMilestones {
  current_status: string;
  initiated_at: Date;
  matched_at: Date | null;
  received_at: Date | null;
  treated_at: Date | null;
  feedback_at: Date | null;
}

export interface DurationStat {
  count: number;
  median_minutes: number | null;
  p90_minutes: number | null;
}

export interface Kpis {
  total: number;
  by_status: Record<string, number>;
  acknowledgement_time: DurationStat; // INITIATED -> RECEIVED
  time_to_match: DurationStat; // INITIATED -> MATCHED
  feedback_closure_rate: number | null; // FEEDBACK_RETURNED / TREATED
  rejection_rate: number | null; // REJECTED / all
}

function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60000;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]! * 10) / 10;
}

function durationStat(values: number[]): DurationStat {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    median_minutes: percentile(sorted, 50),
    p90_minutes: percentile(sorted, 90),
  };
}

export function computeKpis(referrals: ReferralMilestones[]): Kpis {
  const byStatus: Record<string, number> = {};
  const ackTimes: number[] = [];
  const matchTimes: number[] = [];
  let treatedCount = 0;
  let feedbackCount = 0;
  let rejectedCount = 0;

  for (const r of referrals) {
    byStatus[r.current_status] = (byStatus[r.current_status] ?? 0) + 1;
    if (r.received_at) ackTimes.push(minutesBetween(r.initiated_at, r.received_at));
    if (r.matched_at) matchTimes.push(minutesBetween(r.initiated_at, r.matched_at));
    // A referral counts as "treated" once it has been treated at any point.
    if (r.treated_at) treatedCount++;
    if (r.feedback_at) feedbackCount++;
    if (r.current_status === 'REJECTED') rejectedCount++;
  }

  return {
    total: referrals.length,
    by_status: byStatus,
    acknowledgement_time: durationStat(ackTimes),
    time_to_match: durationStat(matchTimes),
    feedback_closure_rate: treatedCount > 0 ? feedbackCount / treatedCount : null,
    rejection_rate: referrals.length > 0 ? rejectedCount / referrals.length : null,
  };
}
