import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SessionUser } from '../types';

export interface CachedPatient {
  id: string;
  given_name: string;
  family_name: string;
  sex?: string | null;
  birth_date?: string | null;
  district?: string | null;
}

// The device's local database (DESIGN.md §13). Every offline write lands here
// first; the UI reads from here so it never waits on the network. Object stores
// are created up front so later slices need no schema migration.
interface BioverseDB extends DBSchema {
  session: { key: string; value: { user: SessionUser } };
  outbox: { key: string; value: { event_id: string } };
  referrals: { key: string; value: { id: string } };
  patients: { key: string; value: CachedPatient };
  meta: { key: string; value: unknown };
}

const SESSION_KEY = 'current';
let dbp: Promise<IDBPDatabase<BioverseDB>> | null = null;

function db(): Promise<IDBPDatabase<BioverseDB>> {
  if (!dbp) {
    dbp = openDB<BioverseDB>('bioverse', 1, {
      upgrade(d) {
        d.createObjectStore('session');
        d.createObjectStore('outbox', { keyPath: 'event_id' });
        d.createObjectStore('referrals', { keyPath: 'id' });
        d.createObjectStore('patients', { keyPath: 'id' });
        d.createObjectStore('meta');
      },
    });
  }
  return dbp;
}

// --- session --------------------------------------------------------------
export async function getSession(): Promise<{ user: SessionUser } | undefined> {
  return (await db()).get('session', SESSION_KEY);
}
export async function setSession(value: { user: SessionUser }): Promise<void> {
  await (await db()).put('session', value, SESSION_KEY);
}
export async function clearSession(): Promise<void> {
  await (await db()).delete('session', SESSION_KEY);
}

// --- meta (cached lookups: terminology, sync cursor) ----------------------
export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db()).get('meta', key) as Promise<T | undefined>;
}
export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', value, key);
}

// --- patients (server-known patients cached for offline selection) --------
export async function putPatient(p: CachedPatient): Promise<void> {
  await (await db()).put('patients', p);
}
export async function listPatients(): Promise<CachedPatient[]> {
  return (await db()).getAll('patients');
}

// --- outbox (events queued offline, drained by the sync engine) -----------
// Generic over the caller's event shape; the store only needs the event_id key.
export async function addOutbox<T extends { event_id: string }>(event: T): Promise<void> {
  await (await db()).put('outbox', event as never);
}
export async function listOutbox<T extends { event_id: string } = { event_id: string }>(): Promise<T[]> {
  return (await db()).getAll('outbox') as unknown as Promise<T[]>;
}

// --- referrals (local projection the UI reads from) -----------------------
export async function putReferral<T extends { id: string }>(r: T): Promise<void> {
  await (await db()).put('referrals', r as never);
}
export async function getAllReferrals<T extends { id: string } = { id: string }>(): Promise<T[]> {
  return (await db()).getAll('referrals') as unknown as Promise<T[]>;
}
