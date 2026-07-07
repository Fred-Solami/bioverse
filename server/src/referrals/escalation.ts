// Escalation rules (DESIGN.md §10). Pure logic: given a referral's status and
// milestone timestamps, decide which alerts SHOULD exist right now and who is
// notified. The worker (escalationWorker.ts) resolves the abstract targets
// (district/referrer/receiver) to concrete ids and persists idempotently.
//
// Mechanism note: DESIGN.md names "Redis timers"; we instead scan the append-
// only event log (the timestamps already live there — no duplicated timer
// state) on an interval. Correct and sufficient at district scale; Redis can
// back this later if volume demands. The *rules* below are mechanism-agnostic.

export type AlertType =
  | 'EMERGENCY_UNMATCHED'
  | 'TRANSIT_OVERDUE'
  | 'FEEDBACK_OVERDUE'
  | 'REJECTED';

export interface EscalationThresholds {
  emergencyUnmatchedMin: number; // EMERGENCY still INITIATED beyond this
  transitGraceMin: number; // DISPATCHED/IN_TRANSIT without RECEIVED beyond this
  feedbackOverdueHours: number; // TREATED without FEEDBACK_RETURNED beyond this
}

export const DEFAULT_THRESHOLDS: EscalationThresholds = {
  emergencyUnmatchedMin: 15,
  transitGraceMin: 60,
  feedbackOverdueHours: 48,
};

// A referral reduced to what the rules need — derived from referral_events.
export interface ReferralSnapshot {
  priority: string; // EMERGENCY | URGENT | ROUTINE
  current_status: string;
  initiated_at: Date;
  dispatched_at: Date | null; // when it entered DISPATCHED
  treated_at: Date | null; // when it entered TREATED
  status_since: Date; // when it entered current_status
}

export interface AlertSpec {
  alert_type: AlertType;
  severity: 'CRITICAL' | 'WARNING';
  notifyDistrict: boolean;
  notifyReferrer: boolean;
  notifyReceiver: boolean;
}

function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60000;
}

// Returns the alerts that should exist for this snapshot at time `now`.
// Terminal referrals (CLOSED/CANCELLED) never escalate.
export function evaluateEscalations(
  snap: ReferralSnapshot,
  now: Date,
  thresholds: EscalationThresholds = DEFAULT_THRESHOLDS,
): AlertSpec[] {
  const specs: AlertSpec[] = [];

  // An unacknowledged emergency that hasn't even been matched is the sharpest
  // failure — the district must know.
  if (
    snap.current_status === 'INITIATED' &&
    snap.priority === 'EMERGENCY' &&
    minutesBetween(snap.initiated_at, now) > thresholds.emergencyUnmatchedMin
  ) {
    specs.push({
      alert_type: 'EMERGENCY_UNMATCHED',
      severity: 'CRITICAL',
      notifyDistrict: true,
      notifyReferrer: false,
      notifyReceiver: false,
    });
  }

  // Dispatched but never arrived: a patient may be lost in transit.
  if (
    (snap.current_status === 'DISPATCHED' || snap.current_status === 'IN_TRANSIT') &&
    snap.dispatched_at !== null &&
    minutesBetween(snap.dispatched_at, now) > thresholds.transitGraceMin
  ) {
    specs.push({
      alert_type: 'TRANSIT_OVERDUE',
      severity: 'WARNING',
      notifyDistrict: true,
      notifyReferrer: true,
      notifyReceiver: true,
    });
  }

  // Treated but the loop never closed — the referring clinician never learns
  // the outcome. This is the gap BioVerse exists to close (DESIGN.md §20).
  if (
    snap.current_status === 'TREATED' &&
    snap.treated_at !== null &&
    minutesBetween(snap.treated_at, now) > thresholds.feedbackOverdueHours * 60
  ) {
    specs.push({
      alert_type: 'FEEDBACK_OVERDUE',
      severity: 'WARNING',
      notifyDistrict: false,
      notifyReferrer: false,
      notifyReceiver: true, // receiving in-charge
    });
  }

  // A rejection re-opens the search and the district gets immediate visibility.
  if (snap.current_status === 'REJECTED') {
    specs.push({
      alert_type: 'REJECTED',
      severity: 'WARNING',
      notifyDistrict: true,
      notifyReferrer: true,
      notifyReceiver: false,
    });
  }

  return specs;
}
