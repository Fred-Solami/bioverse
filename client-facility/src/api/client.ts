import type { SessionUser } from '../types';

// Thin API client. The refresh token rides in an HttpOnly cookie
// (credentials:'include'); the short-lived access token stays in memory only —
// never in IndexedDB — so a stolen device database yields no live credential.
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
