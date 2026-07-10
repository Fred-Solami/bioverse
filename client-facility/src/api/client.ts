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

// Best-effort: exchange the refresh cookie for a fresh access token on app
// start. Returns null when offline or the session has expired.
export async function refresh(): Promise<AuthResponse | null> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch {
    // Offline logout still clears local state; the server token expires on its own.
  }
}

// Authenticated request: attaches the in-memory access token.
async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body) headers['content-type'] = 'application/json';
  return fetch(`${BASE}${path}`, { ...init, credentials: 'include', headers });
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
