import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  toFhirPatient,
  toFhirOrganization,
  toFhirLocation,
  toFhirServiceRequest,
  toFhirTask,
  type PatientInput,
  type FacilityInput,
  type ReferralInput,
} from './resources.js';

// Emits representative FHIR resources to a directory so the official HL7 FHIR
// validator can check them in CI (docs/PLAN.md Step 3). Fixtures exercise the
// interesting shapes: multi-identifier patient, facility with cross-system
// keys and coordinates, referral with coded danger signs + capabilities. Pure
// fixtures — no DB — so this runs anywhere Node runs.

const patient: PatientInput = {
  id: '11111111-1111-1111-1111-111111111111',
  given_name: 'Chanda',
  family_name: 'Mwansa',
  sex: 'F',
  birth_date: '1998-04-12',
  phone: '0977000000',
  identifiers: [
    { id_type: 'NRC', id_value: '123456/78/9' },
    { id_type: 'SMARTCARE_ID', id_value: 'SC-0001' },
    { id_type: 'PHONE', id_value: '0966123456' },
  ],
};

const facility: FacilityInput = {
  id: '22222222-2222-2222-2222-222222222222',
  zhfr_code: '20020001',
  name: 'Ndola Teaching Hospital',
  facility_type: 'L3_HOSPITAL',
  district: 'Ndola',
  province: 'Copperbelt',
  longitude: 28.6367,
  latitude: -12.9587,
  dhis2_uid: 'abc123DEF45',
  smartcare_guid: '7b46450b78a04a1db64c0fc9bb014773',
  elmis_id: 'ELMIS-42',
};

const referral: ReferralInput = {
  id: '33333333-3333-3333-3333-333333333333',
  reference: 'REF-2026-000123',
  patient_id: patient.id,
  from_facility_id: '44444444-4444-4444-4444-444444444444',
  to_facility_id: facility.id,
  reason: 'Postpartum haemorrhage — heavy bleeding after delivery',
  priority: 'EMERGENCY',
  current_status: 'IN_TRANSIT',
  danger_signs: ['vaginal_bleeding', 'severe_pallor'],
  required_capabilities: ['blood_transfusion', 'caesarean_section'],
};

export function sampleResources(): Array<{ name: string; resource: Record<string, unknown> }> {
  return [
    { name: 'Patient', resource: toFhirPatient(patient) },
    { name: 'Organization', resource: toFhirOrganization(facility) },
    { name: 'Location', resource: toFhirLocation(facility) },
    { name: 'ServiceRequest', resource: toFhirServiceRequest(referral) },
    { name: 'Task', resource: toFhirTask(referral) },
  ];
}

export async function emit(dir: string): Promise<string[]> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  for (const { name, resource } of sampleResources()) {
    const file = path.join(dir, `${name}.json`);
    await writeFile(file, JSON.stringify(resource, null, 2));
    written.push(file);
  }
  return written;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const dir = process.argv[2] ?? path.resolve('fhir-samples');
  emit(dir)
    .then((files) => console.log(`Wrote ${files.length} FHIR samples to ${dir}`))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
}
