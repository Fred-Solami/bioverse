import { describe, expect, it } from 'vitest';
import {
  toFhirPatient,
  toFhirOrganization,
  toFhirLocation,
  toFhirServiceRequest,
  toFhirTask,
} from '../src/interop/fhir/resources.js';

// Structural conformance checks that run everywhere (the official HL7 validator
// runs the authoritative R4 check in CI — see .github/workflows/ci.yml).

describe('toFhirPatient', () => {
  const patient = {
    id: 'p1',
    given_name: 'Chanda',
    family_name: 'Mwansa',
    sex: 'F' as const,
    birth_date: '1998-04-12',
    phone: null,
    identifiers: [
      { id_type: 'NRC', id_value: '123456/78/9' },
      { id_type: 'PHONE', id_value: '0977000000' },
    ],
  };

  it('maps names, gender and birthDate', () => {
    const r = toFhirPatient(patient);
    expect(r.resourceType).toBe('Patient');
    expect(r.gender).toBe('female');
    expect(r.birthDate).toBe('1998-04-12');
    expect(r.name).toEqual([{ family: 'Mwansa', given: ['Chanda'] }]);
  });

  it('routes NRC to identifier and PHONE to telecom', () => {
    const r = toFhirPatient(patient) as {
      identifier: Array<{ system: string; value: string }>;
      telecom: Array<{ system: string; value: string }>;
    };
    expect(r.identifier).toHaveLength(1);
    expect(r.identifier[0]!.system).toContain(':nrc');
    expect(r.telecom).toEqual([{ system: 'phone', value: '0977000000' }]);
  });

  it('defaults unknown sex to the FHIR "unknown" code', () => {
    expect(toFhirPatient({ ...patient, sex: null }).gender).toBe('unknown');
  });
});

describe('toFhirOrganization / toFhirLocation (mCSD)', () => {
  const facility = {
    id: 'f1',
    zhfr_code: '20020001',
    name: 'Ndola Teaching Hospital',
    facility_type: 'L3_HOSPITAL',
    district: 'Ndola',
    province: 'Copperbelt',
    longitude: 28.6,
    latitude: -12.9,
    dhis2_uid: 'abc123',
    smartcare_guid: 'guid-1',
    elmis_id: null,
  };

  it('carries cross-system identifiers for the same Organization', () => {
    const r = toFhirOrganization(facility) as {
      identifier: Array<{ system: string; value: string }>;
    };
    const systems = r.identifier.map((i) => i.system);
    expect(systems.some((s) => s.includes('zhfr'))).toBe(true);
    expect(systems.some((s) => s.includes('dhis2'))).toBe(true);
    expect(systems.some((s) => s.includes('smartcare'))).toBe(true);
    // elmis_id was null — no phantom identifier.
    expect(systems.some((s) => s.includes('elmis'))).toBe(false);
  });

  it('emits Location.position as [lon, lat] linked to its Organization', () => {
    const r = toFhirLocation(facility) as {
      position: { longitude: number; latitude: number };
      managingOrganization: { reference: string };
    };
    expect(r.position).toEqual({ longitude: 28.6, latitude: -12.9 });
    expect(r.managingOrganization.reference).toBe('Organization/f1');
  });

  it('omits position when coordinates are missing', () => {
    const r = toFhirLocation({ ...facility, longitude: null, latitude: null });
    expect(r.position).toBeUndefined();
  });
});

describe('toFhirServiceRequest / toFhirTask', () => {
  const referral = {
    id: 'r1',
    reference: 'REF-2026-000123',
    patient_id: 'p1',
    from_facility_id: 'f-from',
    to_facility_id: 'f-to',
    reason: 'PPH',
    priority: 'EMERGENCY',
    current_status: 'IN_TRANSIT',
    danger_signs: ['vaginal_bleeding'],
    required_capabilities: ['blood_transfusion'],
  };

  it('maps EMERGENCY priority to FHIR stat and carries coded reasons', () => {
    const r = toFhirServiceRequest(referral) as {
      priority: string;
      status: string;
      reasonCode: Array<{ text?: string; coding?: Array<{ system: string; code: string; display?: string }> }>;
      orderDetail: Array<{ coding: Array<{ display?: string }> }>;
    };
    expect(r.priority).toBe('stat');
    expect(r.status).toBe('active');
    // FHIR invariant prr-1: orderDetail requires code to be present.
    expect((r as { code?: { text?: string } }).code?.text).toBeTruthy();
    expect(r.reasonCode[0]).toEqual({ text: 'PPH' });
    expect(r.reasonCode[1]!.coding![0]).toMatchObject({
      code: 'vaginal_bleeding',
      display: 'Vaginal bleeding',
    });
    expect(r.orderDetail[0]!.coding[0]!.display).toBe('Blood transfusion');
  });

  it('maps lifecycle to ServiceRequest.status and preserves it in Task', () => {
    expect((toFhirServiceRequest({ ...referral, current_status: 'CLOSED' })).status).toBe('completed');
    expect((toFhirServiceRequest({ ...referral, current_status: 'CANCELLED' })).status).toBe('revoked');

    const task = toFhirTask({ ...referral, current_status: 'REJECTED' }) as {
      status: string;
      businessStatus: { text: string };
      focus: { reference: string };
      owner: { reference: string };
    };
    expect(task.status).toBe('rejected');
    expect(task.businessStatus.text).toBe('REJECTED'); // exact status preserved
    expect(task.focus.reference).toBe('ServiceRequest/r1');
    expect(task.owner.reference).toBe('Organization/f-to');
  });
});
