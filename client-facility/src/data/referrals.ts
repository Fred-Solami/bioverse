import { addOutbox, putReferral, getAllReferrals } from '../db/store';
import type { SessionUser } from '../types';

export type Priority = 'EMERGENCY' | 'URGENT' | 'ROUTINE';

export interface CreateReferralInput {
  patient_id: string;
  patient_name: string;
  reason: string;
  priority: Priority;
  danger_signs: string[];
  required_capabilities: string[];
  clinical_summary?: string;
}

// The CREATE event queued in the outbox — shape matches the server's PushEvent
// (server/src/sync/service.ts), so the sync engine (Slice 4) replays it as-is.
export interface CreateEvent {
  event_id: string;
  kind: 'CREATE';
  referral_id: string;
  occurred_at: string;
  referral: {
    patient_id: string;
    from_facility_id: string | null;
    reason: string;
    priority: Priority;
    pathway: string;
    danger_signs: string[];
    required_capabilities: string[];
    clinical_summary?: string;
  };
}

// Local projection the UI renders. `sync` tracks whether the outbox event has
// been accepted by the server yet.
export interface LocalReferral {
  id: string;
  reference: string;
  patient_id: string;
  patient_name: string;
  priority: Priority;
  reason: string;
  danger_signs: string[];
  current_status: string;
  from_facility_id: string | null;
  created_at: string;
  sync: 'pending' | 'synced' | 'rejected';
}

// Pure: form input + actor → a CREATE event with client-generated UUIDs. The
// device owns the ids so offline transitions can reference the referral before
// it ever reaches the server.
export function buildCreateEvent(input: CreateReferralInput, user: SessionUser): CreateEvent {
  return {
    event_id: crypto.randomUUID(),
    kind: 'CREATE',
    referral_id: crypto.randomUUID(),
    occurred_at: new Date().toISOString(),
    referral: {
      patient_id: input.patient_id,
      from_facility_id: user.facilityId,
      reason: input.reason.trim(),
      priority: input.priority,
      pathway: 'MATERNAL',
      danger_signs: input.danger_signs,
      required_capabilities: input.required_capabilities,
      clinical_summary: input.clinical_summary?.trim() || undefined,
    },
  };
}

// Offline-first write: queue the event AND optimistically project the referral,
// both in IndexedDB, so the UI reflects it immediately with no network.
export async function queueCreate(
  input: CreateReferralInput,
  user: SessionUser,
): Promise<LocalReferral> {
  const event = buildCreateEvent(input, user);
  await addOutbox(event);

  const local: LocalReferral = {
    id: event.referral_id,
    reference: 'PENDING',
    patient_id: input.patient_id,
    patient_name: input.patient_name,
    priority: input.priority,
    reason: event.referral.reason,
    danger_signs: input.danger_signs,
    current_status: 'INITIATED',
    from_facility_id: user.facilityId,
    created_at: event.occurred_at,
    sync: 'pending',
  };
  await putReferral(local);
  return local;
}

export async function listLocalReferrals(): Promise<LocalReferral[]> {
  const rows = await getAllReferrals<LocalReferral>();
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
