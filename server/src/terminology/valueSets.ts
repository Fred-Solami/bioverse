// Coded value sets — the terminology layer (docs/PLAN.md Step 3, docs/INTEROP.md
// SVCM alignment). Danger signs and facility capabilities were free-text JSONB;
// interoperability requires codes, because two FHIR-speaking systems still fail
// to coordinate if one sends "bleeding" and the other expects a concept code.
//
// These are BioVerse-local code systems with real system URIs. Mapping each
// concept to SNOMED CT / ICD-11 is a deliberate downstream task requiring
// clinical/terminology review (a wrong SNOMED code is worse than none), and is
// carried structurally by the optional `snomed` field for a future SVCM
// ConceptMap. The local codes are stable and safe to depend on now.

// FHIR canonical/namespace base. A URN (not an https:// domain) because a
// system URI must be one we legitimately control, and BioVerse owns no domain
// yet — a URN implies no DNS ownership and can't collide with someone else's
// bioverse.zm. When a domain is registered, swap this single constant for the
// canonical https base and every derived URI updates with it.
export const FHIR_NAMESPACE = 'urn:bioverse';

export const CODE_SYSTEMS = {
  dangerSign: `${FHIR_NAMESPACE}:codesystem:maternal-danger-signs`,
  capability: `${FHIR_NAMESPACE}:codesystem:facility-capabilities`,
} as const;

export interface Concept {
  code: string;
  display: string;
  snomed?: string; // populated only after clinical validation — intentionally sparse
}

// Maternal danger signs — aligned to the WHO/MCPC danger-sign checklist that
// the v0.3 facility PWA will render. The MATERNAL pathway is the pilot focus.
export const MATERNAL_DANGER_SIGNS: readonly Concept[] = [
  { code: 'vaginal_bleeding', display: 'Vaginal bleeding' },
  { code: 'severe_headache', display: 'Severe headache' },
  { code: 'visual_disturbance', display: 'Visual disturbance / blurred vision' },
  { code: 'convulsions', display: 'Convulsions / fits' },
  { code: 'loss_of_consciousness', display: 'Loss of consciousness' },
  { code: 'high_fever', display: 'High fever' },
  { code: 'severe_abdominal_pain', display: 'Severe abdominal pain' },
  { code: 'facial_swelling', display: 'Swelling of face / hands' },
  { code: 'difficulty_breathing', display: 'Difficulty breathing' },
  { code: 'reduced_fetal_movement', display: 'Reduced fetal movement' },
  { code: 'absent_fetal_movement', display: 'Absent fetal movement' },
  { code: 'prolonged_labour', display: 'Prolonged / obstructed labour' },
  { code: 'premature_rupture_of_membranes', display: 'Premature rupture of membranes' },
  { code: 'foul_smelling_discharge', display: 'Foul-smelling vaginal discharge' },
  { code: 'severe_pallor', display: 'Severe pallor / suspected severe anaemia' },
];

// Facility capabilities — the EmONC signal functions plus referral-relevant
// services. This is the SAME vocabulary a referral's `required_capabilities`
// draws from and that facility `capabilities` are keyed by, so the v0.2 match
// endpoint can filter "facilities possessing ALL required capabilities"
// (DESIGN.md §10) without a vocabulary mismatch.
export const FACILITY_CAPABILITIES: readonly Concept[] = [
  { code: 'parenteral_antibiotics', display: 'Parenteral antibiotics' },
  { code: 'parenteral_uterotonics', display: 'Parenteral uterotonics' },
  { code: 'parenteral_anticonvulsants', display: 'Parenteral anticonvulsants (MgSO4)' },
  { code: 'manual_removal_of_placenta', display: 'Manual removal of placenta' },
  { code: 'removal_retained_products', display: 'Removal of retained products' },
  { code: 'assisted_vaginal_delivery', display: 'Assisted vaginal delivery' },
  { code: 'neonatal_resuscitation', display: 'Newborn resuscitation' },
  { code: 'caesarean_section', display: 'Caesarean section' },
  { code: 'blood_transfusion', display: 'Blood transfusion' },
  { code: 'emergency_obstetric_care', display: 'Comprehensive emergency obstetric care' },
  { code: 'neonatal_intensive_care', display: 'Neonatal intensive care' },
  { code: 'inpatient_maternity', display: 'Inpatient maternity' },
];

function index(concepts: readonly Concept[]): ReadonlyMap<string, Concept> {
  return new Map(concepts.map((c) => [c.code, c]));
}

const DANGER_INDEX = index(MATERNAL_DANGER_SIGNS);
const CAPABILITY_INDEX = index(FACILITY_CAPABILITIES);

export function isDangerSign(code: unknown): code is string {
  return typeof code === 'string' && DANGER_INDEX.has(code);
}

export function isCapability(code: unknown): code is string {
  return typeof code === 'string' && CAPABILITY_INDEX.has(code);
}

export function dangerSign(code: string): Concept | undefined {
  return DANGER_INDEX.get(code);
}

export function capability(code: string): Concept | undefined {
  return CAPABILITY_INDEX.get(code);
}

// Partition an incoming code list into recognized vs unknown, so a handler can
// reject with a precise 400 naming exactly which codes are off-vocabulary.
export function validateCodes(
  codes: unknown,
  isValid: (c: unknown) => c is string,
): { valid: string[]; unknown: string[] } {
  const valid: string[] = [];
  const unknown: string[] = [];
  if (Array.isArray(codes)) {
    for (const c of codes) {
      if (isValid(c)) valid.push(c);
      else unknown.push(String(c));
    }
  }
  return { valid, unknown };
}
