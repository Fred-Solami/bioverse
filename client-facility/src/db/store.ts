import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SessionUser } from '../types';

// The device's local database (DESIGN.md §13). Every offline write lands here
// first; the UI reads from here so it never waits on the network. Slice 2 uses
// `session`; `outbox`/`referrals`/`patients`/`meta` are created now so later
// slices need no schema migration.
interface BioverseDB extends DBSchema {
  session: { key: string; value: { user: SessionUser } };
  outbox: { key: string; value: { event_id: string; [k: string]: unknown } };
  referrals: { key: string; value: { id: string; [k: string]: unknown } };
  patients: { key: string; value: { id: string; [k: string]: unknown } };
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

export async function getSession(): Promise<{ user: SessionUser } | undefined> {
  return (await db()).get('session', SESSION_KEY);
}

export async function setSession(value: { user: SessionUser }): Promise<void> {
  await (await db()).put('session', value, SESSION_KEY);
}

export async function clearSession(): Promise<void> {
  await (await db()).delete('session', SESSION_KEY);
}
