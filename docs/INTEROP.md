# Interoperability adapters

Build order = access order. Adapters live in `server/src/interop/`, one folder
per system, isolated behind interfaces so the rest of the codebase never sees a
raw external contract.

| # | Adapter | Surface | Access status | Current implementation |
|---|---|---|---|---|
| 1 | `zhfr` | ZHFR RESTful API (live) | **Exists today** — auth/access terms to be verified | **MFL fallback built** (`server/src/interop/zhfr/`): `npm run seed:mfl` seeds/refreshes real facilities from MOH-Zambia MFL GitHub CSV (contract confirmed 2026-07-07), carrying DHIS2 UID / SmartCare GUID / eLMIS ID cross-system keys, `source='MFL_GITHUB'`, `source_synced_at` freshness stamp. ZHFR API upgrade path pending access terms. |
| 2 | `dhis2` | DHIS2 Web API `dataValueSets` (ADX) | Documented, standard | Not built (v0.4). Monthly aggregate referral indicators only — no patient data, lowest governance barrier. Test against a DHIS2 dev/play instance. |
| 3 | `smartcare` | SmartCare HIE bus (FHIR/HL7/JSON/XML) | Governance-gated via MoH ICT / Digital Health TWG | Not built. FHIR client (`Patient`, `ServiceRequest`, `Encounter`) to be ready and stubbed until access is granted. |
| 4 | `elmis` | Via the same HIE | Governance-gated | Not built. Stock snapshot reader; `facility_stock_snapshot.source = 'STUB'` until live. |

## Contract discipline (the VSDC rule)

**No adapter is built against an assumed surface.** Every integration begins by
confirming the live contract — API vs export vs file — before any code is
written against it. This rule comes from hard experience with ZRA Smart
Invoice/VSDC integration work.

## Freshness contract

Every piece of externally-sourced data carries an explicit freshness tag
(`REALTIME | DAILY | MONTHLY | STALE`) that is **surfaced to users**, never
hidden. A clinician choosing a destination facility sees not just "oxytocin:
ADEQUATE" but how old that answer is.

## FHIR conformance spec (Step 3)

Compatibility = conformance to the standards Zambia's IAF already chose, not a
new contract. BioVerse's internal schema is unchanged; a thin edge layer
(`server/src/interop/fhir/`) emits FHIR R4 resources per the OpenHIE profiles.

| Function | OpenHIE profile / standard | BioVerse resource | Prove against |
|---|---|---|---|
| Patient identity | PIX / PDQm / PMIR | `Patient` | HL7 validator; `hapi.fhir.org` |
| Facility registry | mCSD | `Organization` + `Location` | HL7 validator |
| Referral / coordination | ServiceRequest + Task workflow | `ServiceRequest` + `Task` | HL7 validator |
| Terminology | SVCM | coded `CodeableConcept` | value-set validation |
| Aggregate reporting | ADX (IHE) | DHIS2 `dataValueSets` (v0.4) | `play.dhis2.org` |

**Enforced in CI:** the `fhir-conformance` job emits sample resources from the
mappers and validates them against FHIR R4 with HL7's official `validator_cli`.
A mapper drifting out of conformance fails the build.

**Namespace:** system URIs use a provisional URN base (`urn:bioverse:…`, one
constant in `terminology/valueSets.ts`) because a system URI must be one we
control and no domain is registered yet. Swap for the canonical https base when
a domain exists. DHIS2/SmartCare/eLMIS identifier systems are provisional until
the IAF/TWG specifies the authoritative ones.

**Terminology decision log:** `maternal_danger_signs` and `facility_capabilities`
are BioVerse-local code systems (`terminology/valueSets.ts`). Mapping each
concept to SNOMED CT / ICD-11 is a deliberate clinical-review task carried
structurally by an optional `snomed` field — a wrong clinical code is worse than
an unmapped local one. The capability vocabulary is shared by facility
`capabilities` and referral `required_capabilities` so the v0.2 match endpoint
has no vocabulary mismatch.

## Identity mapping

BioVerse's client registry follows the OpenHIE Client Registry pattern and is
designed to map onto the national EMPI/INRIS when live (identifier types
`SMARTCARE_ID`, `NRC`, `INRIS_ID` are first-class in `patient_identifiers`).
See DESIGN.md §11 for the matching cascade.
