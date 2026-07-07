// RBAC single source of truth (DESIGN.md §15: "RBAC matrix implemented and
// tested per role, CHW → MOH_ADMIN"). Roles are ordered from least to most
// privileged; the ordering is not itself an authorization rule — every gate is
// an explicit allow-list — but it documents the hierarchy.
export const ROLES = [
  'CHW',
  'FACILITY_STAFF',
  'FACILITY_INCHARGE',
  'DISTRICT_OFFICER',
  'MOH_ADMIN',
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

// Roles that may initiate a referral from their facility.
export const CAN_CREATE_REFERRAL: readonly Role[] = [
  'CHW',
  'FACILITY_STAFF',
  'FACILITY_INCHARGE',
];

// Roles that may create/search patients in the client registry.
export const CAN_TOUCH_PATIENTS: readonly Role[] = [
  'CHW',
  'FACILITY_STAFF',
  'FACILITY_INCHARGE',
  'DISTRICT_OFFICER',
  'MOH_ADMIN',
];

// Roles that may decide identity match-review-queue entries (DESIGN.md §14:
// in-charge / district).
export const CAN_REVIEW_IDENTITY: readonly Role[] = [
  'FACILITY_INCHARGE',
  'DISTRICT_OFFICER',
  'MOH_ADMIN',
];

// Roles with cross-facility oversight: exempt from the facility-side check on
// referral transitions (they still obey the state-machine allow-list).
export const OVERSIGHT_ROLES: readonly Role[] = ['DISTRICT_OFFICER', 'MOH_ADMIN'];

export function hasOversight(role: Role): boolean {
  return OVERSIGHT_ROLES.includes(role);
}
