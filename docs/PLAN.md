# Execution plan — from v0.1 to a standards-conformant v0.2

Operationalizes DESIGN.md Part III with what we know as of 2026-07-07:
v0.1 code is built (uncommitted), the interoperability target is confirmed
(Zambia IAF → OpenHIE profiles → FHIR R4), and every external contract we
need has a free sandbox or open data source to prove against.

## Where we are

- **Phase 0** — done and committed (`e6fadc2`): repo structure, migrations
  0001–0007, dev seed, bootstrap server.
- **v0.1 "A referral exists"** — built, typechecked, 27 unit/inject tests
  passing; **not yet committed** and **not yet run end-to-end** (dev machine
  has no Docker and local PG17 lacks PostGIS, so migrations can't apply here).
  Surface: auth (argon2id, 15-min JWT, rotating refresh + reuse-detection),
  RBAC matrix, central audit middleware, referral state machine + append-only
  events with offline-idempotent replay, deterministic patient matching,
  auth-gated facility registry, dev user seeding.
- **Known deviation from DESIGN.md §14:** patient search is `POST
  /patients/search` (body), not GET with query params — §15 forbids PII in
  URLs/logs. §14 should be updated to match.

## Constraints that shape the plan

1. **Dev machine:** no Docker; local PostgreSQL 17 lacks PostGIS. Anything
   needing a real database or containers runs in GitHub Actions (runners have
   Docker) or against hosted sandboxes.
2. **Governance:** SmartCare HIE / eLMIS / EMPI access is gated by the MoH
   Digital Health TWG. Until granted, we prove conformance against reference
   implementations of the same standards (OpenHIE pattern), so that when the
   door opens the adapter work is mapping, not invention.
3. **Compatibility = conformance:** FHIR R4 + OpenHIE profiles (PDQm/PMIR
   identity, mCSD facilities, ServiceRequest+Task referrals, SVCM
   terminology, ADX aggregates). We never define a new external contract.

## Step 1 — Commit v0.1, stand up CI with PostGIS, prove the lifecycle
*Closes v0.1. Everything else builds on this.*

- Commit the v0.1 work (conventional commits, split sensibly: auth, audit,
  referrals, identity, app restructure, tests, seed users).
- GitHub Actions workflow: `postgis/postgis:17` + `redis` service containers;
  `npm ci → migrate → seed → seed:users → typecheck → vitest`.
- Add the end-to-end lifecycle integration test (runs in CI where a real DB
  exists; skipped locally when `DATABASE_URL` can't provide PostGIS):
  login as staff.a → create patient → create referral → walk INITIATED →
  MATCHED → DISPATCHED → IN_TRANSIT → RECEIVED (as staff.b) → TREATED →
  FEEDBACK_RETURNED → CLOSED → assert timeline, audit rows, and KPI-relevant
  timestamps (INITIATED→RECEIVED measurable per DESIGN.md §20).
- Also exercise: REJECTED → re-match, CANCELLED without reason (400), wrong
  facility transition (403), replayed event UUID (idempotent 200).
- **Exit:** CI green on a fresh clone = v0.1 demo criteria met.

## Step 2 — Real facilities: `zhfr` adapter from MOH-Zambia MFL
*Replaces DEV seed with genuine Zambian facilities. No access negotiation needed.*

- `server/src/interop/zhfr/`: fetch + normalize the MFL CSV
  (github.com/MOH-Zambia/MFL, `geography/data/facility_list.csv`), map to our
  `facilities` schema (HMIS code, DHIS2 UID, coordinates, type, ownership),
  honoring the freshness-tag contract (`source`, tagged `MONTHLY`/`STALE`).
- Keep dev sample as fixture for tests; seed script gains `--source=mfl`.
- Verify ZHFR RESTful API access terms in parallel (upgrade path per
  docs/INTEROP.md #1).
- **Exit:** `npm run seed -- --source=mfl` loads real Copperbelt facilities;
  demo runs on real facility names/coordinates.

## Step 3 — FHIR conformance track
*Turns "compatible" into a CI assertion.*

- Edge mappers in `server/src/interop/fhir/` (internal schema unchanged):
  - referral → `ServiceRequest` + `Task` (state machine ↔ Task.status map)
  - patient + identifiers → `Patient` (identifier systems for
    SMARTCARE_ID/NRC/INRIS_ID/PHONE)
  - facility → `Organization` + `Location` (mCSD-shaped)
- CI job: `validator_cli.jar` (Java, no Docker) validates emitted resources
  against R4 on every push; optional smoke round-trip against
  `hapi.fhir.org/baseR4` (synthetic data only).
- **Terminology now, while the schema is young:** coded value sets for
  `danger_signs` and `required_capabilities` (maternal danger-sign list
  mapped to ICD-11/SNOMED where clean; national codes when SVCM available).
  Migration adds code columns/validation; free text demoted to display.
- Update docs/INTEROP.md into the conformance spec: profile-per-function
  table, sandbox targets, terminology decision log. Fix DESIGN.md §14
  (patient search POST).
- **Exit:** CI fails if any emitted FHIR resource is non-conformant.

## Step 4 — v0.2 "Routing is smart" (DESIGN.md §17)

- `GET /referrals/:id/match`: PostGIS capability filter + `ST_Distance` rank,
  top 5, stock annotation from `STUB` source, CRITICAL-stock downrank
  (annotate, never hide). Developed against CI DB with real MFL coordinates.
- Redis escalation timers + worker (EMERGENCY unmatched >15 min, transit
  overdue, feedback >48 h, any REJECTED → district alert).
- Probabilistic matching (phonetic-normalized names, Bemba/Nyanja/Lozi
  variants) + `match_review_queue` endpoints; conservative thresholds.
- **Exit (§17 demo):** emergency referral auto-suggests the capable — not
  merely nearest — hospital; an ignored emergency escalates.

## Step 5 — Horizon (per DESIGN.md, unchanged)

- **v0.3** facility PWA (offline-first, sync push/pull) — the first frontend.
- **v0.4** district dashboard + ADX export proven against play.dhis2.org +
  ZHFR refresh job.
- **v1.0** hardening: RBAC test matrix, district-scale load test, backup
  runbook, pilot brief. Instant OpenHIE stack in CI as SmartCare rehearsal.

## Parallel non-code track (started, per DESIGN.md §17)

District champion identification; Digital Health TWG (MoH ICT Directorate)
is the door for SmartCare/eLMIS/EMPI access — target one district health
office conversation by v0.3. Data Protection Commissioner registration is a
pilot prerequisite, not a v0.1 blocker.

## Sandbox / open-source verification matrix

| External contract | Prove against | Cost / access |
|---|---|---|
| FHIR R4 conformance | `validator_cli.jar` in CI | Free, Java only |
| FHIR exchange | `hapi.fhir.org/baseR4` (hosted) or `hapiproject/hapi` in CI | Free |
| Facility data | MOH-Zambia/MFL GitHub CSV | Free, exists today |
| DHIS2 ADX (v0.4) | play.dhis2.org demo API | Free, hosted |
| HIE mediator pattern (v1.0) | Instant OpenHIE / OpenHIM in CI | Free, Docker-in-CI |
| SmartCare / eLMIS / EMPI | TWG-gated; stub + freshness tags until granted | Governance |

## Risks

- **PostGIS-only dev loop:** all DB verification lives in CI until a
  PostGIS-capable database is available locally or hosted (Neon/Supabase free
  tiers support PostGIS if a faster loop is wanted).
- **Terminology drift:** if Step 3 coding is skipped, v0.3 ships free-text
  clinical data and retrofitting becomes a breaking change.
- **MFL data quality:** coordinates/capabilities may be incomplete —
  capability data will need curation; keep `capabilities` locally maintained
  until ZHFR provides it.
- **Governance timeline:** TWG access may take months; nothing on the
  critical path to v1.0 depends on it (by design).
