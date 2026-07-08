export type Role =
  | 'CHW'
  | 'FACILITY_STAFF'
  | 'FACILITY_INCHARGE'
  | 'DISTRICT_OFFICER'
  | 'MOH_ADMIN';

// Mirrors the server's AuthUser (server/src/auth/plugin.ts) plus the username
// we capture at login for display. The access token is never persisted.
export interface SessionUser {
  sub: string;
  role: Role;
  facilityId: string | null;
  district: string | null;
  username?: string;
}
