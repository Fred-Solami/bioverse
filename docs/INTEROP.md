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

## Identity mapping

BioVerse's client registry follows the OpenHIE Client Registry pattern and is
designed to map onto the national EMPI/INRIS when live (identifier types
`SMARTCARE_ID`, `NRC`, `INRIS_ID` are first-class in `patient_identifiers`).
See DESIGN.md §11 for the matching cascade.
