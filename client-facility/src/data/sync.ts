import { pushEvents, pullEvents, type PullEvent } from '../api/client';
import {
  listOutbox,
  removeOutbox,
  getReferral,
  putReferral,
  getMeta,
  setMeta,
} from '../db/store';
import type { LocalReferral } from './referrals';

// The sync engine (DESIGN.md §13, docs/PWA-PLAN.md Slice 4).
//
// Push: drain the outbox through /sync/push. Accepted events (including
// idempotent replays) leave the queue and flip the local projection to
// 'synced', picking up the server-assigned reference. Rejected events also
// leave the queue -- retrying an event the server has ruled invalid can never
// succeed -- but the projection is flagged 'rejected' with the reason so the
// clinician sees the conflict instead of silently losing work.
//
// Pull: fetch role-scoped event deltas since the stored cursor and merge the
// latest status per referral into the local projection. Referrals we have
// never seen (e.g. inbound from another facility) get a minimal row; later
// slices enrich them. The cursor is the server's opaque monotonic seq.

const CLIENT_ID_KEY = 'client_id';
const CURSOR_KEY = 'sync_cursor';

export async function getClientId(): Promise<string> {
  let id = await getMeta<string>(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    await setMeta(CLIENT_ID_KEY, id);
  }
  return id;
}

export interface SyncOutcome {
  pushedAccepted: number;
  pushedRejected: number;
  pulled: number;
  cursor: string;
}

async function applyPullEvent(ev: PullEvent): Promise<void> {
  const existing = await getReferral<LocalReferral>(ev.referral_id);
  if (existing) {
    await putReferral<LocalReferral>({
      ...existing,
      reference: ev.reference,
      current_status: ev.current_status,
      sync: existing.sync === 'rejected' ? 'rejected' : 'synced',
    });
    return;
  }
  // A referral this device has never seen (inbound, or created on another
  // device). Minimal projection; patient details arrive with later slices.
  await putReferral<LocalReferral>({
    id: ev.referral_id,
    reference: ev.reference,
    patient_id: ev.patient_id,
    patient_name: ev.reference,
    priority: ev.priority as LocalReferral['priority'],
    reason: '',
    danger_signs: [],
    current_status: ev.current_status,
    from_facility_id: null,
    created_at: ev.occurred_at,
    sync: 'synced',
  });
}

// Deduped like refresh(): concurrent callers (online event + manual button)
// share one in-flight sync instead of double-pushing the same outbox.
let syncInFlight: Promise<SyncOutcome> | null = null;

export function syncNow(): Promise<SyncOutcome> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = doSync();
  void syncInFlight.finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function doSync(): Promise<SyncOutcome> {
  const clientId = await getClientId();
  let pushedAccepted = 0;
  let pushedRejected = 0;

  const outbox = await listOutbox<{ event_id: string; referral_id?: string }>();
  if (outbox.length > 0) {
    const { results } = await pushEvents(clientId, outbox);
    for (const r of results) {
      await removeOutbox(r.event_id);
      const refId = r.referral_id ?? outbox.find((e) => e.event_id === r.event_id)?.referral_id;
      const local = refId ? await getReferral<LocalReferral>(refId) : undefined;
      if (r.status === 'accepted') {
        pushedAccepted++;
        if (local) {
          await putReferral<LocalReferral>({
            ...local,
            reference: r.reference ?? local.reference,
            sync: 'synced',
          });
        }
      } else {
        pushedRejected++;
        if (local) {
          await putReferral<LocalReferral>({ ...local, sync: 'rejected' });
        }
      }
    }
  }

  const since = (await getMeta<string>(CURSOR_KEY)) ?? '0';
  const pull = await pullEvents(clientId, since);
  for (const ev of pull.events) {
    await applyPullEvent(ev);
  }
  await setMeta(CURSOR_KEY, pull.cursor);

  return { pushedAccepted, pushedRejected, pulled: pull.count, cursor: pull.cursor };
}

export async function pendingCount(): Promise<number> {
  return (await listOutbox()).length;
}
