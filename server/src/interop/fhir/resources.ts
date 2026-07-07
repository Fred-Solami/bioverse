// BioVerse → FHIR R4 mappers (docs/PLAN.md Step 3; OpenHIE profiles per
// docs/INTEROP.md). Pure functions producing plain FHIR JSON — no DB, no
// network — so conformance is unit-testable and CI-validatable. The internal
// schema is unchanged; this is purely the edge translation the national HIE
// (SmartCare) and DHIS2 understand. When TWG access is granted, integration is
// wiring these onto the bus, not re-modelling.

import {
  CODE_SYSTEMS,
  FHIR_NAMESPACE,
  dangerSign,
  capability,
  type Concept,
} from '../../terminology/valueSets.js';

// All URIs derive from the single provisional URN base (see valueSets.ts).
const IDENTIFIER_SYSTEMS: Record<string, string> = {
  NRC: `${FHIR_NAMESPACE}:identifier:nrc`,
  SMARTCARE_ID: `${FHIR_NAMESPACE}:identifier:smartcare`,
  INRIS_ID: `${FHIR_NAMESPACE}:identifier:inris`,
  BIOVERSE_MPI: `${FHIR_NAMESPACE}:identifier:mpi`,
};
const FACILITY_ID_SYSTEM = `${FHIR_NAMESPACE}:identifier:zhfr`;
const REFERRAL_ID_SYSTEM = `${FHIR_NAMESPACE}:identifier:referral`;
const FACILITY_TYPE_SYSTEM = `${FHIR_NAMESPACE}:codesystem:facility-type`;

// Cross-system join keys. These namespaces are PROVISIONAL: the authoritative
// identifier systems for DHIS2/SmartCare/eLMIS should come from the national
// IAF via the Digital Health TWG, not be minted by us. Kept under our own URN
// namespace until then so nothing falsely claims to be an official system.
const DHIS2_UID_SYSTEM = `${FHIR_NAMESPACE}:external:dhis2-uid`;
const SMARTCARE_GUID_SYSTEM = `${FHIR_NAMESPACE}:external:smartcare-guid`;
const ELMIS_ID_SYSTEM = `${FHIR_NAMESPACE}:external:elmis-id`;

// --- Patient (OpenHIE PIX/PDQm/PMIR) ---------------------------------------

export interface PatientInput {
  id: string;
  given_name: string;
  family_name: string;
  sex: string | null;
  birth_date: string | null;
  phone: string | null;
  identifiers?: Array<{ id_type: string; id_value: string }>;
}

function mapGender(sex: string | null): string {
  switch (sex) {
    case 'M': return 'male';
    case 'F': return 'female';
    case 'OTHER': return 'other';
    default: return 'unknown';
  }
}

export function toFhirPatient(p: PatientInput): Record<string, unknown> {
  const identifier = (p.identifiers ?? [])
    .filter((i) => i.id_type !== 'PHONE' && IDENTIFIER_SYSTEMS[i.id_type])
    .map((i) => ({ system: IDENTIFIER_SYSTEMS[i.id_type], value: i.id_value }));

  // Phone is a telecom point in FHIR, not an identifier.
  const phones = (p.identifiers ?? [])
    .filter((i) => i.id_type === 'PHONE')
    .map((i) => i.id_value);
  if (p.phone) phones.push(p.phone);
  const telecom = [...new Set(phones)].map((value) => ({ system: 'phone', value }));

  const resource: Record<string, unknown> = {
    resourceType: 'Patient',
    id: p.id,
    name: [{ family: p.family_name, given: [p.given_name] }],
    gender: mapGender(p.sex),
  };
  if (identifier.length) resource.identifier = identifier;
  if (telecom.length) resource.telecom = telecom;
  if (p.birth_date) resource.birthDate = p.birth_date;
  return resource;
}

// --- Organization + Location (OpenHIE mCSD) --------------------------------

export interface FacilityInput {
  id: string;
  zhfr_code: string;
  name: string;
  facility_type: string;
  district: string;
  province: string;
  longitude?: number | null;
  latitude?: number | null;
  dhis2_uid?: string | null;
  smartcare_guid?: string | null;
  elmis_id?: string | null;
}

export function toFhirOrganization(f: FacilityInput): Record<string, unknown> {
  const identifier: Array<Record<string, string>> = [
    { system: FACILITY_ID_SYSTEM, value: f.zhfr_code },
  ];
  // Carry the cross-system join keys the MFL provided (migration 0009) so the
  // same Organization is resolvable in DHIS2, SmartCare and eLMIS.
  if (f.dhis2_uid) identifier.push({ system: DHIS2_UID_SYSTEM, value: f.dhis2_uid });
  if (f.smartcare_guid) identifier.push({ system: SMARTCARE_GUID_SYSTEM, value: f.smartcare_guid });
  if (f.elmis_id) identifier.push({ system: ELMIS_ID_SYSTEM, value: f.elmis_id });

  return {
    resourceType: 'Organization',
    id: f.id,
    identifier,
    name: f.name,
    type: [{ coding: [{ system: FACILITY_TYPE_SYSTEM, code: f.facility_type }] }],
  };
}

export function toFhirLocation(f: FacilityInput): Record<string, unknown> {
  const resource: Record<string, unknown> = {
    resourceType: 'Location',
    id: f.id,
    name: f.name,
    managingOrganization: { reference: `Organization/${f.id}` },
  };
  if (f.longitude != null && f.latitude != null) {
    // FHIR position is [longitude, latitude, altitude?].
    resource.position = { longitude: f.longitude, latitude: f.latitude };
  }
  return resource;
}

// --- ServiceRequest + Task (referral / care coordination) ------------------

export interface ReferralInput {
  id: string;
  reference: string;
  patient_id: string;
  from_facility_id: string;
  to_facility_id: string | null;
  reason: string;
  priority: string; // EMERGENCY | URGENT | ROUTINE
  current_status: string;
  danger_signs?: string[];
  required_capabilities?: string[];
}

// FHIR request priority vocabulary: routine | urgent | asap | stat.
function mapPriority(priority: string): string {
  switch (priority) {
    case 'EMERGENCY': return 'stat';
    case 'URGENT': return 'urgent';
    default: return 'routine';
  }
}

// ServiceRequest.status is coarse (draft|active|completed|revoked|...). The
// fine-grained BioVerse lifecycle lives on Task (below); here we only need to
// say whether the request is still live, done, or withdrawn.
function mapServiceRequestStatus(status: string): string {
  switch (status) {
    case 'CLOSED': return 'completed';
    case 'CANCELLED': return 'revoked';
    default: return 'active';
  }
}

// Task.status is the standard fulfilment vocabulary; Task.businessStatus keeps
// the exact BioVerse status so no fidelity is lost across the boundary.
function mapTaskStatus(status: string): string {
  switch (status) {
    case 'INITIATED': return 'requested';
    case 'MATCHED': return 'received';
    case 'DISPATCHED': return 'accepted';
    case 'IN_TRANSIT':
    case 'RECEIVED':
    case 'TREATED':
    case 'FEEDBACK_RETURNED': return 'in-progress';
    case 'CLOSED': return 'completed';
    case 'CANCELLED': return 'cancelled';
    case 'REJECTED': return 'rejected';
    default: return 'requested';
  }
}

function coding(concept: Concept | undefined, system: string, code: string) {
  return concept
    ? { coding: [{ system, code, display: concept.display }] }
    : { coding: [{ system, code }] };
}

export function toFhirServiceRequest(r: ReferralInput): Record<string, unknown> {
  const reasonCode: Array<Record<string, unknown>> = [{ text: r.reason }];
  for (const code of r.danger_signs ?? []) {
    reasonCode.push(coding(dangerSign(code), CODE_SYSTEMS.dangerSign, code));
  }

  const resource: Record<string, unknown> = {
    resourceType: 'ServiceRequest',
    id: r.id,
    identifier: [{ system: REFERRAL_ID_SYSTEM, value: r.reference }],
    status: mapServiceRequestStatus(r.current_status),
    intent: 'order',
    priority: mapPriority(r.priority),
    // What is being requested. Required by invariant prr-1 before orderDetail
    // (the capability list below) may be populated.
    code: { text: 'Inter-facility patient referral' },
    subject: { reference: `Patient/${r.patient_id}` },
    requester: { reference: `Organization/${r.from_facility_id}` },
    reasonCode,
  };
  if (r.to_facility_id) {
    resource.performer = [{ reference: `Organization/${r.to_facility_id}` }];
  }
  const caps = (r.required_capabilities ?? []).map((code) =>
    coding(capability(code), CODE_SYSTEMS.capability, code),
  );
  if (caps.length) resource.orderDetail = caps;
  return resource;
}

export function toFhirTask(r: ReferralInput): Record<string, unknown> {
  const resource: Record<string, unknown> = {
    resourceType: 'Task',
    id: r.id,
    identifier: [{ system: REFERRAL_ID_SYSTEM, value: r.reference }],
    status: mapTaskStatus(r.current_status),
    // Preserve the exact BioVerse status FHIR's coarse enum can't express.
    businessStatus: { text: r.current_status },
    intent: 'order',
    priority: mapPriority(r.priority),
    focus: { reference: `ServiceRequest/${r.id}` },
    for: { reference: `Patient/${r.patient_id}` },
    requester: { reference: `Organization/${r.from_facility_id}` },
  };
  if (r.to_facility_id) {
    resource.owner = { reference: `Organization/${r.to_facility_id}` };
  }
  return resource;
}
