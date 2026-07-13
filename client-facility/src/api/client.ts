import type { SessionUser } from '../types';

// Thin API client. The refresh token rides in an HttpOnly cookie
// (credentials:'include'); the short-lived access token stays in memory only,
// never in IndexedDB, so a stolen device database yields no live credential.
const BASE = '/api/v1';

let accessToken: string | null = null;
export function setToken(token: string | null): void {
  accessToken = token;
}
export function getToken(): string | null {
  return accessToken;
}

interface AuthResponse {
  accessToken: string;
  user: SessionUser;
}

async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `request failed (${res.status})`;
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

// Best-effort: exchange the refresh cookie for a fresh access token. Refresh
// tokens ROTATE with reuse-detection on the server, so two concurrent refreshes
// would present the same cookie and the second looks like token theft, burning
// the whole session. We therefore dedupe: concurrent callers share one in-flight
// refresh. Returns null when offline or the session has expired.
let refreshInFlight: Promise<AuthResponse | null> | null = null;
export function refresh(): Promise<AuthResponse | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
      return res.ok ? ((await res.json()) as AuthResponse) : null;
    } catch {
      return null;
    }
  })();
  void refreshInFlight.finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch {
    // Offline logout still clears local state; the server token expires on its own.
  }
}

// Authenticated request: attaches the in-memory access token. On a 401 (the
// token hasn't loaded yet after a page refresh, or has expired) it silently
// exchanges the refresh cookie for a new token and retries once.
async function authFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { ...init, credentials: 'include', headers });
  if (res.status === 401 && retry) {
    const refreshed = await refresh();
    if (refreshed) {
      setToken(refreshed.accessToken);
      return authFetch(path, init, false);
    }
  }
  return res;
}

export interface Concept {
  code: string;
  display: string;
}
export interface Terminology {
  systems: Record<string, string>;
  danger_signs: Concept[];
  capabilities: Concept[];
}

export async function getTerminology(): Promise<Terminology> {
  const res = await authFetch('/terminology');
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export interface PatientHit {
  id: string;
  given_name: string;
  family_name: string;
  sex?: string | null;
  birth_date?: string | null;
  district?: string | null;
}

export async function searchPatients(query: {
  name?: string;
  identifier?: { id_type: string; id_value: string };
}): Promise<PatientHit[]> {
  const res = await authFetch('/patients/search', {
    method: 'POST',
    body: JSON.stringify(query),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).patients ?? [];
}

// --- Referrals (server view: dispatch, inbound queue, detail) -------------
export interface ServerReferral {
  id: string;
  reference: string;
  priority: string;
  current_status: string;
  from_facility_id: string;
  to_facility_id: string | null;
  from_facility_name: string;
  to_facility_name: string | null;
}

export async function listReferrals(status?: string): Promise<ServerReferral[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await authFetch(`/referrals${q}`);
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).referrals ?? [];
}

export interface ReferralEvent {
  to_status: string;
  from_status: string | null;
  note: string | null;
  occurred_at: string;
}
export interface ReferralDetail {
  referral: ServerReferral & { patient_id: string; reason: string; danger_signs: string[] };
  events: ReferralEvent[];
}

export async function getReferralDetail(id: string): Promise<ReferralDetail> {
  const res = await authFetch(`/referrals/${id}`);
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export interface TransportOption {
  id: string;
  name: string;
  vehicle_type: string;
  contact_phone: string | null;
  district: string | null;
  distance_m: number | null;
  rank: number;
  recommended: boolean;
}

export async function getTransportOptions(referralId: string): Promise<TransportOption[]> {
  const res = await authFetch(`/referrals/${referralId}/transport/options`);
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()).options ?? [];
}

export async function assignTransport(
  referralId: string,
  body: { resource_id: string; driver_name?: string; eta_minutes?: number },
): Promise<void> {
  const res = await authFetch(`/referrals/${referralId}/transport`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

// --- Sync (outbox push + delta pull) --------------------------------------
export interface PushResult {
  event_id: string;
  status: 'accepted' | 'rejected';
  referral_id?: string;
  reference?: string;
  reason?: string;
}

export async function pushEvents(
  clientId: string,
  events: unknown[],
): Promise<{ accepted: number; rejected: number; results: PushResult[] }> {
  const res = await authFetch('/sync/push', {
    method: 'POST',
    body: JSON.stringify({ client_id: clientId, events }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export interface PullEvent {
  seq: string;
  referral_id: string;
  reference: string;
  current_status: string;
  priority: string;
  patient_id: string;
  to_status: string;
  occurred_at: string;
}

export async function pullEvents(
  clientId: string,
  since: string,
): Promise<{ cursor: string; count: number; events: PullEvent[] }> {
  const res = await authFetch(
    `/sync/pull?client_id=${encodeURIComponent(clientId)}&since=${encodeURIComponent(since)}`,
  );
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}
