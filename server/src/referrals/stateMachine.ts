import { hasOversight, type Role } from '../auth/roles.js';

// Server-enforced referral lifecycle (DESIGN.md §10). Pure logic — no DB, no
// Fastify — so the allow-list and role gating are unit-testable in isolation.
//
// INITIATED → MATCHED → DISPATCHED → IN_TRANSIT → RECEIVED → TREATED
//   → FEEDBACK_RETURNED → CLOSED
//     ├→ CANCELLED (referrer; reason mandatory)
//     └→ REJECTED (receiver; reason mandatory) → re-enters matching

export const STATUSES = [
  'INITIATED',
  'MATCHED',
  'DISPATCHED',
  'IN_TRANSIT',
  'RECEIVED',
  'TREATED',
  'FEEDBACK_RETURNED',
  'CLOSED',
  'CANCELLED',
  'REJECTED',
] as const;

export type Status = (typeof STATUSES)[number];

// Allowed forward/terminal transitions. Absence = rejected by the allow-list.
const TRANSITIONS: Record<Status, readonly Status[]> = {
  INITIATED: ['MATCHED', 'CANCELLED'],
  MATCHED: ['DISPATCHED', 'CANCELLED', 'REJECTED'],
  DISPATCHED: ['IN_TRANSIT', 'REJECTED'],
  IN_TRANSIT: ['RECEIVED', 'REJECTED'],
  RECEIVED: ['TREATED'],
  TREATED: ['FEEDBACK_RETURNED'],
  FEEDBACK_RETURNED: ['CLOSED'],
  REJECTED: ['MATCHED'], // re-enters matching
  CANCELLED: [],
  CLOSED: [],
};

// Which side of the referral a transition belongs to. The receiving facility
// owns arrival/treatment/feedback and rejection; the referrer owns routing,
// transport, cancellation and closure.
const RECEIVER_STATUSES: readonly Status[] = [
  'RECEIVED',
  'TREATED',
  'FEEDBACK_RETURNED',
  'REJECTED',
];
const REFERRER_STATUSES: readonly Status[] = [
  'MATCHED',
  'DISPATCHED',
  'IN_TRANSIT',
  'CANCELLED',
  'CLOSED',
];

// Reason (a non-empty note) is mandatory on these transitions.
const REASON_REQUIRED: readonly Status[] = ['CANCELLED', 'REJECTED'];

export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export function isTerminal(status: Status): boolean {
  return TRANSITIONS[status].length === 0;
}

export interface TransitionActor {
  role: Role;
  facilityId: string | null;
}

export interface ReferralSides {
  fromFacilityId: string;
  toFacilityId: string | null;
}

export type TransitionCheck =
  | { ok: true }
  | { ok: false; code: 400 | 403 | 409; error: string };

// The single gate every transition passes through: allow-list, then role/side,
// then reason. Order matters — a caller learns "illegal transition" before
// "not your facility", never leaking who owns a step they couldn't reach anyway.
export function checkTransition(
  from: Status,
  to: Status,
  actor: TransitionActor,
  referral: ReferralSides,
  note: string | undefined,
): TransitionCheck {
  if (!TRANSITIONS[from].includes(to)) {
    return { ok: false, code: 409, error: `illegal transition ${from} → ${to}` };
  }

  if (REASON_REQUIRED.includes(to) && !note?.trim()) {
    return { ok: false, code: 400, error: `${to} requires a reason` };
  }

  // MATCHED must land on a concrete receiving facility.
  if (to === 'MATCHED' && !referral.toFacilityId) {
    return { ok: false, code: 400, error: 'MATCHED requires a to_facility_id' };
  }

  // Oversight roles (district/MOH) may act on either side; facility staff are
  // bound to their own facility's side of the referral.
  if (!hasOversight(actor.role)) {
    if (RECEIVER_STATUSES.includes(to)) {
      if (!actor.facilityId || actor.facilityId !== referral.toFacilityId) {
        return { ok: false, code: 403, error: 'only the receiving facility may perform this transition' };
      }
    } else if (REFERRER_STATUSES.includes(to)) {
      if (!actor.facilityId || actor.facilityId !== referral.fromFacilityId) {
        return { ok: false, code: 403, error: 'only the referring facility may perform this transition' };
      }
    }
  }

  return { ok: true };
}
