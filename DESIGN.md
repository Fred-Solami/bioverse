# BioVerse — Health System Coordination Platform
## Final Implementation Plan & System Design (Build-Ready)
**Status:** v2.0 — FINAL for build start
**Supersedes:** DESIGN.md v1.0/v1.1
**Context:** Republic of Zambia, national health system
**Author/Owner:** Fred Solami
---
# PART I — STRATEGY
## 1. What BioVerse is
BioVerse is a **health system coordination platform** for Zambia: the application layer that closes the loops between systems that already exist but do not coordinate — SmartCare Pro (patients), eLMIS (supply), DHIS2 (reporting), the ZHFR/MFL (facilities), and the ~96,000-strong community health workforce that sits outside all of them.
Its core domain object is the **referral**: today a paper triplicate form with no acknowledgement, no tracking, no transport coordination, and no feedback loop — a documented direct contributor to maternal and neonatal mortality. When Zambia fixed referral coordination manually (Saving Mothers Giving Life, 2012–2016), institutional maternal mortality in intervention districts fell **37.6%**. BioVerse digitises that coordination.
**One-line positioning:** *Zambia built the rails — SmartCare, eLMIS, DHIS2, and now the national Interoperability Architectural Framework. Nobody is running the train. BioVerse is the coordination application the national infrastructure exists to carry.*
## 2. Positioning relative to the national IAF
Zambia's MoH has published an **Interoperability Architectural Framework (IAF)** under the Digital Health Strategy 2022–2026: an HIE built on Apache Kafka + OpenHIM, four core registries (Master Facility List, Enterprise Master Patient Index, Health Provider Directory, Product Registry), shared terminology/auth services, and an analytics layer (ONDAP). SmartCare already operates an HIE bus exchanging FHIR/HL7/JSON/XML with DISA, eLMIS, DHIS2, and CBS.
**The IAF is infrastructure, not an application.** It defines how systems exchange messages and agree on identity. It does not create a referral, dispatch transport, alert a district officer, or close a feedback loop — it exists so point-of-service applications can. BioVerse is such an application: **IAF-native by design**, so that in any future MoH conversation the claim is "we built to your published framework."
Precedent from the owner's own domain: ZRA's Smart Invoice/VSDC standard did not eliminate integrators — it created the market for them. A published government framework creates the seat BioVerse fills.
**Absorption risk, stated honestly:** MoH or a donor project could eventually build referral coordination into SmartCare. Mitigations: (a) timing — national procurement cycles are measured in years; a solo builder can pilot in months; (b) posture — FHIR-native + open-source means the worst case is becoming the reference implementation the national system absorbs, which for a public good is a win condition; (c) the seams targeted (referrals, community tier) have remained open through 20 years of national digitisation.
## 3. What BioVerse is NOT (evidence-forced exclusions)
- **Not an EHR.** SmartCare Pro: ~2,000+ facilities, 12M+ records, government-owned. Clinical truth lives there; BioVerse links to it.
- **Not a supply/logistics system.** eLMIS FE: ~2,600–3,000 facilities, national since 2019. BioVerse *reads* it so supply informs routing; it never re-tracks stock.
- **Not a predictive digital twin.** Rejected on evidence: the Epic Sepsis Model — 405k training encounters, hundreds of hospitals — caught only 33% of sepsis cases in external validation while alerting on 18% of all patients (real AUC 0.63 vs claimed 0.76–0.83); clinical models degrade under distribution shift precisely where environments differ from training; and routine African facility data has 40%+ missing-data rates — a per-person continuously-learning predictor can neither validate, generalise, nor be fed. Meanwhile a simple missing-data *alert* in Rwanda cut ART-eligible-but-not-started patients from 29.6% to 6.2%. **Rules and state machines beat models in this context, and that is written into the architecture.** The only "twin" BioVerse keeps is the *care-journey view*: a live, linked record of a real patient's referrals and encounters across facilities.
## 4. Design principles (binding)
1. **Whole-system coordination, one seam at a time.** The goal is coordinating the entire fragmented system; the method is closing one loop end-to-end before opening the next, with each closed seam making the others smarter. No parallel half-built modules — that is how BioVerse v0 died.
2. **Interoperate, never duplicate.** Every entity keys to official identifiers (ZHFR/MFL codes, SmartCare IDs, future INRIS/EMPI). FHIR-native data model. IAF-conformant exchange patterns.
3. **Every seam feeds the coordination decision.** Supply data appears where a clinician chooses where to send a patient — not on a disconnected dashboard.
4. **Coordinate, don't predict.** Explainable rules only. Any future risk flag must be an externally validated clinical checklist (e.g. maternal danger signs), never a learned per-person model.
5. **Offline-first, SMS-degradable.** Non-negotiable from day one.
6. **Human-in-the-loop.** BioVerse recommends; clinicians, dispatchers, and district officers decide. No auto-executed clinical or logistical actions. No silent patient-record merges.
7. **Data Protection Act No. 3 of 2021 compliance by construction.** Audit log on every patient-data access; facility/district-scoped RBAC; minimal PII; in-country hosting posture.
8. **Sustainability by design.** Boring stack, low run cost, open-source public good, district/MoH engagement from Phase 1.
## 5. Decisions — LOCKED for v1 (revisable with cause)
| # | Decision | Call | Rationale |
|---|---|---|---|
| D1 | Stack | **Node.js 20 + TypeScript + Fastify, PostgreSQL 15 + PostGIS, Redis** | Owner's daily runtime; best FHIR ecosystem in JS; PostGIS is decisive for routing; OSS posture required for public good. Go remains the documented fallback; data model is stack-agnostic. |
| D2 | First clinical pathway | **Maternal/emergency referral** (health post → district hospital) | Highest documented mortality payoff; SMGL gives a measurable baseline; exercises every subsystem. ART loss-to-follow-up is pathway #2 on the same engine. |
| D3 | Pilot target | **One Copperbelt district** (leverage existing NPOS/Quantum Foods training relationships; confirm specific district during Phase 1) | Relationships are the scarce resource; the champion matters more than the district. |
| D4 | Open-source | **Public from day one**, MIT or Apache-2.0 | Public-good posture is a strategic asset (Digital Square/DPG route), aligns with MoH-Zambia's own public GitHub practice, and disciplines quality. |
---
# PART II — SYSTEM DESIGN
## 6. System context
```
                        ┌────────────────────────────┐
                        │   MoH / District dashboards │
                        └──────────────▲─────────────┘
                                       │ KPIs, aggregates
  ┌────────────────┐         ┌─────────┴──────────┐         ┌─────────────────┐
  │  SmartCare Pro  │  FHIR   │                    │  ADX    │      DHIS2       │
  │  (national EHR) │◄───────►│      BioVerse       │────────►│  (HMIS reports)  │
  └────────────────┘ via HIE  │  Coordination Core  │         └─────────────────┘
  ┌────────────────┐  read    │                    │  REST   ┌─────────────────┐
  │      eLMIS      │────────►│  referral engine ·  │◄────────│  ZHFR / MFL      │
  │  (supply/stock) │ feeds   │  client registry ·  │  seed   │  (facility API)  │
  └────────────────┘ routing  │  matching · alerts  │         └─────────────────┘
                              └───▲────────────▲────┘
                    offline sync  │            │  app / SMS
                   ┌──────────────┴──┐   ┌─────┴──────────────┐
                   │ Facility client  │   │  CHW companion      │
                   │ (PWA, offline)   │   │  (M2; 96k CBV tier) │
                   └─────────────────┘   └────────────────────┘
```
## 7. Module roadmap (seams, in closing order)
| Module | Seam | Content | When |
|---|---|---|---|
| **M1** | Facility↔facility | Referral lifecycle: create → match → dispatch → receive → treat → feedback → close; escalation alerts; dashboards | **v0.1–v1.0 (build now)** |
| **M1.5** | Patient↔supply | Capability + stock-aware routing. Capability data from own registry day one; stock from eLMIS when access granted (stubbed until then) | **Woven into M1** |
| **M2** | Community↔facility | CHW companion: referral initiation, task lists, danger-sign checklists, LTFU tracing; SMS degradation | Pilot phase |
| **M3** | Longitudinal | Care-journey view across referrals/encounters (the honest "twin") | After M2 data flows |
| **M4** | Private sector | Pharmacy/private-facility supply layer eLMIS omits (21.4% of facilities are private) | Post-pilot |
| **M5** | Risk flags | Validated clinical checklists only (maternal danger-sign scoring at triage) | Deferred; gated on data quality |
## 8. Component architecture (monolith-first, module boundaries enforced)
Single deployable Node service, internally modular (each module = folder with its own routes/services/repos; no cross-module DB access). Split into services only if scale demands — solo maintainability wins.
```
server/src/
├── auth/          JWT (15-min access + rotating refresh), argon2id, RBAC middleware
├── registry/      facilities (ZHFR-seeded), users, capabilities
├── identity/      client registry: patients, identifiers, matching cascade, review queue
├── referrals/     state machine, events, escalation timers
├── matching/      capability+stock+distance ranking (PostGIS)
├── alerts/        escalation rules, notification dispatch (in-app now; SMS/USSD later)
├── sync/          offline delta sync (push/pull, idempotent)
├── interop/       adapters: zhfr | dhis2 | smartcare | elmis (isolated, freshness-contracted)
├── audit/         append-only access log (middleware-injected)
└── dashboards/    read models (facility, district, MoH)
```
**Clients:** `client-facility/` — React PWA, offline-first (IndexedDB + service worker, sync queue). CHW client (M2) reuses the same sync protocol.
## 9. Data model (authoritative DDL, migrations 0001–0007)
FHIR mappings noted per table. UUIDs throughout; TIMESTAMPTZ; append-only where marked.
```sql
-- 0001_facilities.sql  (FHIR: Organization + Location)
CREATE TABLE facilities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zhfr_code         TEXT UNIQUE NOT NULL,          -- official facility ID (ZHFR/MFL)
  name              TEXT NOT NULL,
  facility_type     TEXT NOT NULL,                 -- HEALTH_POST|HEALTH_CENTRE|L1_HOSPITAL|L2_HOSPITAL|L3_HOSPITAL|PHARMACY
  ownership         TEXT NOT NULL,                 -- MOH|FAITH_BASED|PRIVATE|ZDF|ZNS|POLICE|CORRECTIONAL
  district          TEXT NOT NULL,
  province          TEXT NOT NULL,
  location          GEOGRAPHY(POINT,4326),
  capabilities      JSONB NOT NULL DEFAULT '{}',   -- {"emonc":true,"csection":true,"blood_bank":false,...}
  parent_facility_id UUID REFERENCES facilities(id),
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_facilities_location ON facilities USING GIST(location);
CREATE INDEX idx_facilities_district ON facilities(district);
-- 0002_users.sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,                     -- argon2id
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL,                     -- CHW|FACILITY_STAFF|FACILITY_INCHARGE|DISTRICT_OFFICER|MOH_ADMIN
  facility_id   UUID REFERENCES facilities(id),
  district      TEXT,
  phone         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 0003_identity.sql  (FHIR: Patient; OpenHIE Client Registry pattern)
CREATE TABLE patients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  given_name    TEXT NOT NULL,
  family_name   TEXT NOT NULL,
  sex           TEXT,                              -- M|F|OTHER|UNKNOWN
  birth_date    DATE,
  birth_year_approx BOOLEAN NOT NULL DEFAULT false,
  phone         TEXT,
  district      TEXT,
  home_location GEOGRAPHY(POINT,4326),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE patient_identifiers (                 -- provenance-tracked, reversible links
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  UUID NOT NULL REFERENCES patients(id),
  id_type     TEXT NOT NULL,                       -- NRC|SMARTCARE_ID|INRIS_ID|PHONE|BIOVERSE_MPI
  id_value    TEXT NOT NULL,
  asserted_by UUID REFERENCES users(id),
  asserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(id_type, id_value, is_active)
);
CREATE TABLE match_review_queue (                  -- borderline matches: humans decide
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_a   UUID NOT NULL REFERENCES patients(id),
  candidate_b   UUID NOT NULL REFERENCES patients(id),
  score         NUMERIC NOT NULL,
  features      JSONB NOT NULL,                    -- per-field similarity breakdown
  status        TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING|LINKED|REJECTED
  decided_by    UUID REFERENCES users(id),
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 0004_referrals.sql  (FHIR: ServiceRequest + Encounter)
CREATE TABLE referrals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference             TEXT UNIQUE NOT NULL,      -- REF-2026-000123 (sequence-backed)
  patient_id            UUID NOT NULL REFERENCES patients(id),
  from_facility_id      UUID NOT NULL REFERENCES facilities(id),
  to_facility_id        UUID REFERENCES facilities(id),
  referring_user_id     UUID NOT NULL REFERENCES users(id),
  pathway               TEXT NOT NULL DEFAULT 'MATERNAL', -- MATERNAL|GENERAL (ART_LTFU later)
  reason                TEXT NOT NULL,
  clinical_summary      TEXT,
  danger_signs          JSONB NOT NULL DEFAULT '[]',
  required_capabilities JSONB NOT NULL DEFAULT '[]',
  priority              TEXT NOT NULL,             -- EMERGENCY|URGENT|ROUTINE
  current_status        TEXT NOT NULL DEFAULT 'INITIATED',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at             TIMESTAMPTZ
);
CREATE INDEX idx_referrals_status ON referrals(current_status);
CREATE INDEX idx_referrals_to_facility ON referrals(to_facility_id, current_status);
CREATE TABLE referral_events (                     -- APPEND-ONLY. The lifecycle IS this log.
  id                UUID PRIMARY KEY,              -- client-generated for offline idempotency
  referral_id       UUID NOT NULL REFERENCES referrals(id),
  from_status       TEXT,
  to_status         TEXT NOT NULL,
  actor_user_id     UUID REFERENCES users(id),
  actor_facility_id UUID REFERENCES facilities(id),
  note              TEXT,
  payload           JSONB NOT NULL DEFAULT '{}',   -- transport, feedback, rejection reason
  occurred_at       TIMESTAMPTZ NOT NULL,          -- client time
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 0005_stock.sql  (read model; eLMIS overlay — BioVerse never writes stock)
CREATE TABLE facility_stock_snapshot (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  item_code   TEXT NOT NULL,                       -- ZEML/eLMIS commodity code
  item_name   TEXT NOT NULL,
  status      TEXT NOT NULL,                       -- CRITICAL|ADEQUATE|SURPLUS|UNKNOWN
  source      TEXT NOT NULL,                       -- ELMIS|MANUAL|PHARMACY|STUB
  as_of       DATE,
  freshness   TEXT NOT NULL,                       -- REALTIME|DAILY|MONTHLY|STALE
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 0006_audit.sql  (APPEND-ONLY. Data Protection Act requirement.)
CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id),
  action        TEXT NOT NULL,                     -- READ|CREATE|UPDATE|EXPORT|LOGIN
  entity_type   TEXT NOT NULL,
  entity_id     UUID,
  ip_address    INET,
  detail        JSONB NOT NULL DEFAULT '{}',
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 0007_sync.sql
CREATE TABLE sync_cursors (
  client_id   TEXT NOT NULL,
  user_id     UUID NOT NULL REFERENCES users(id),
  last_pulled TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (client_id, user_id)
);
```
## 10. Referral state machine (server-enforced)
```
INITIATED → MATCHED → DISPATCHED → IN_TRANSIT → RECEIVED → TREATED → FEEDBACK_RETURNED → CLOSED
    │           │
    ├→ CANCELLED (referrer; reason mandatory)
    └───────────└→ REJECTED (receiver; reason mandatory) → re-enters matching; district alerted
```
Rules: transitions validated against an allow-list; role-gated (only receiving facility marks RECEIVED/TREATED/FEEDBACK_RETURNED; only referrer CANCELS); idempotent on event UUID for offline replay; every transition appends `referral_events`.
**Escalation timers (Redis, worker-checked):**
- EMERGENCY unMATCHED > 15 min → district officer alert
- DISPATCHED with no RECEIVED beyond expected transit + 60 min → both facilities + district
- TREATED with no FEEDBACK_RETURNED > 48 h → receiving in-charge
- Any REJECTED → immediate district visibility
**Matching algorithm (M1.5, human-confirmed):**
1. Filter: `is_active` facilities possessing ALL `required_capabilities`.
2. Rank: PostGIS `ST_Distance` from referring facility.
3. Annotate: stock status for pathway-relevant items (freshness-tagged; STUB source until eLMIS live).
4. Downrank: facilities with CRITICAL stock on required items (never hide — annotate).
5. Present top 5; referring clinician confirms. Emergency default = top candidate pre-selected.
## 11. Identity & the matching cascade (how BioVerse matches their systems' patients)
Aligned to the OpenHIE Client Registry pattern and Zambia's IAF EMPI direction; designed to *map onto* the national EMPI/INRIS when live, not compete with it.
1. **Deterministic:** exact match on active identifiers, priority SMARTCARE_ID → NRC → INRIS_ID → PHONE. Hit = same patient.
2. **Probabilistic fallback:** score on phonetic-normalised names (Bemba/Nyanja/Lozi variants), sex, birth date (year ± 2 when `birth_year_approx`), district. Score ≥ T_high → auto-link (logged, reversible). T_low ≤ score < T_high → `match_review_queue` for human decision. Below T_low → new patient.
3. **Never destructive:** all links are provenance-tracked assertions in `patient_identifiers`; merges reversible; every identity decision audited. A wrong merge is worse than a duplicate.
4. Thresholds start conservative (favour review queue over auto-link) and tighten with pilot data.
## 12. Interoperability adapters (build order = access order)
| # | Adapter | Surface | Status | Action |
|---|---|---|---|---|
| 1 | `zhfr` | ZHFR RESTful API (live; already integrates SmartCare/DHIS2/eLMIS/DATIM) | **Exists today** | Build first: seed + refresh facilities. Verify auth/access terms; fall back to MOH-Zambia MFL GitHub data if API access is gated. |
| 2 | `dhis2` | DHIS2 Web API `dataValueSets` (ADX) | Documented, standard | Build second: monthly aggregate referral indicators. No patient data → lowest governance barrier. Test against a DHIS2 dev/play instance. |
| 3 | `smartcare` | SmartCare HIE bus (FHIR/HL7/JSON/XML; already carries DISA/eLMIS/DHIS2/CBS traffic) | Governance-gated | FHIR client ready (`Patient`, `ServiceRequest`, `Encounter`); stub until access granted via MoH ICT / Digital Health TWG. |
| 4 | `elmis` | Via the same HIE (JSI already piping eLMIS↔SmartCare) | Governance-gated | Stock snapshot reader; `STUB` source until live. |
**Contract discipline (VSDC rule):** no adapter is built against an assumed surface. Each integration begins by confirming the live contract — API vs export vs file — and every adapter carries an explicit freshness tag surfaced to users.
## 13. Offline & sync
- Facility PWA: IndexedDB event queue; service worker; client-generated event UUIDs + client timestamps.
- `POST /sync/push`: batched events, idempotent on UUID, per-event accept/reject with reasons.
- `GET /sync/pull?since=`: role-scoped deltas (own facility's referrals in/out + own district if officer).
- Conflicts: event log is append-only so nothing is lost; mutable-field conflicts resolve last-write-wins and are logged for review.
- SMS degradation (M2): structured-SMS encode/decode of minimum referral payload via gateway adapter (CHT-proven pattern).
## 14. API contract (v0.1 surface)
```
POST   /api/v1/auth/login | /refresh | /logout
POST   /api/v1/referrals
GET    /api/v1/referrals/:id                      (full timeline)
GET    /api/v1/referrals?status=&facility=&priority=
POST   /api/v1/referrals/:id/transition           {to_status, note, payload, event_id, occurred_at}
GET    /api/v1/referrals/:id/match                (ranked candidates: capable+stocked)
GET    /api/v1/facilities?district=&capability=
POST   /api/v1/patients                           (runs matching cascade; may return existing)
POST   /api/v1/patients/search                    (audited; body {identifier,name})
GET    /api/v1/identity/review-queue              (in-charge/district)
POST   /api/v1/identity/review-queue/:id/decide   {LINKED|REJECTED}
GET    /api/v1/dashboard/facility/:id
GET    /api/v1/dashboard/district/:district
POST   /api/v1/sync/push        GET /api/v1/sync/pull?since=
POST   /internal/interop/dhis2/export             (scheduled)
POST   /internal/interop/zhfr/refresh             (scheduled)
```
All endpoints JWT-authenticated; RBAC-scoped; patient-touching routes write `audit_log` via central middleware (enforced, not per-handler discipline). *Patient search is POST, not GET: identifiers and names are PII and §15 forbids PII in URLs/logs.*
## 15. Security & compliance checklist (v0.1 gate)
- [ ] Argon2id; 15-min JWT access; rotating refresh; logout revocation
- [ ] RBAC matrix implemented and tested per role (CHW → MOH_ADMIN)
- [ ] Central audit middleware on all patient-data routes
- [ ] No PII in logs, URLs, or error messages
- [ ] Rate limiting (Redis) on auth + search endpoints
- [ ] TLS-only; HSTS; secure cookie flags on refresh token
- [ ] Secrets via env; `.env` gitignored; **git history scanned (gitleaks) before repo goes public**
- [ ] `docs/COMPLIANCE.md`: Data Protection Act notes; registration with the Data Protection Commissioner is a pilot prerequisite (before any live patient data), not a v0.1 blocker
---
# PART III — IMPLEMENTATION PLAN
## 16. Phase 0 — Repo surgery & foundation (Weeks 1–2)
1. Tag current state `v0-archive`. Collapse to single `main`.
2. Delete: `python-ai/`, `bioverse_mobile/`, `terraform/`, `.kiro/`, investor scripts, extra docker-composes, `README_DOCKER.md`.
3. Scan git history for secrets (gitleaks); rotate anything found.
4. New tree:
```
bioverse/
├── README.md            # honest: problem → evidence → what exists → roadmap
├── DESIGN.md            # this document
├── docs/ RESEARCH.md · INTEROP.md · API.md · COMPLIANCE.md
├── server/ migrations/ · src/ · test/
├── client-facility/
└── docker-compose.yml   # postgres+postgis, redis, server
```
5. Fix GitHub About: *"Health system coordination platform for Zambia — referral tracking and capability-aware routing across facilities and community health workers. FHIR-native, IAF-aligned, offline-first."*
6. Migrations 0001–0007 running clean; seed script pulling facilities from MFL data (ZHFR API if accessible, MOH-Zambia GitHub MFL data otherwise).
7. Conventional commits from here forward.
**Exit criteria:** fresh clone → `docker compose up` → migrations apply → seeded facility registry queryable.
## 17. Phase 1 — Vertical slice v0.1 → v1.0 (Months 1–6, solo-paced)
**v0.1 — "A referral exists" (≈ weeks 3–6)**
Auth + RBAC + audit middleware; patients (deterministic matching only); referral create + full state machine + event log; facility list API.
*Demo: two seeded facilities complete a full lifecycle via API.*
**v0.2 — "Routing is smart" (≈ weeks 7–10)**
PostGIS match endpoint (capability filter + distance rank); stock annotation from STUB source; Redis escalation timers + in-app alerts; probabilistic matching + review queue.
*Demo: emergency referral auto-suggests the capable — not merely nearest — hospital; an ignored emergency escalates.*
**v0.3 — "It works in the field" (≈ weeks 11–16)**
Facility PWA: login, create referral (maternal danger-sign checklist), inbound queue, transitions, feedback form — fully offline-capable with sync.
*Demo: airplane-mode referral creation, sync on reconnect.*
**v0.4 — "The district can see" (≈ weeks 17–20)**
District dashboard: open referrals, delay flags, feedback-gap, capability-match rate; DHIS2 export against a dev instance; ZHFR refresh job.
*Demo: district officer view + monthly ADX export.*
**v1.0 — "Pilot-ready" (≈ weeks 21–24)**
Hardening: RBAC test matrix, load test at district scale (~50 facilities, ~200 referrals/day), backup/restore runbook, seeded demo script, one-page pilot brief (problem → evidence → demo → SMGL-baselined KPIs).
**Parallel track (non-code, starts Week 1):** identify the district champion. List every Copperbelt health-adjacent contact from NPOS training work; ask about NetOne health-sector relationships; target one district health office conversation by v0.3. *The pilot lives or dies here, not in the code.*
## 18. Phase 2 — District pilot (Months 6–18)
One Copperbelt district, maternal pathway, health posts → district hospital. Live eLMIS/SmartCare integration where access is granted via the Digital Health TWG (chaired by MoH ICT Directorate — the actual door to knock on). Add CHW companion (M2). Measure against SMGL baselines. Iterate on real workflow friction — the make-or-break factor in every deployment study reviewed.
## 19. Phase 3 — National conversation (18+ months)
With pilot data: SMART Zambia Institute / MoH ICT (pitch: built to their published IAF); the donor ecosystem funding CBV programs; Digital Square / UNDP DigitalX listing as a digital public good. Non-exclusive routes.
## 20. KPIs (instrumented from v0.1)
| KPI | Definition | Baseline source |
|---|---|---|
| Referral acknowledgement time | INITIATED → RECEIVED | Paper-system pilot baseline |
| Feedback closure rate | % TREATED → FEEDBACK_RETURNED | ~0% today (the loop doesn't exist) |
| Capability-match rate | % routed to a facility able to treat | SMGL / pilot baseline |
| Emergency escalation response | Alert → resolution time | New metric |
| LTFU recovery | Unacknowledged referrals traced to closure | Pilot |
| Sync freshness | % facilities syncing in window | Uptime = top data-quality lever (Rwanda evidence) |
| Duplicate-patient rate | Review-queue outcomes | Pilot |
## 21. Definition of done — v1.0
A district health officer can watch, on one screen: a maternal emergency initiated at a seeded health post, routed to the *capable* hospital (not the nearest incapable one), escalated when ignored, acknowledged, treated, feedback returned to the referring nurse, and closed — every step audited, the whole flow working offline, aggregates exportable to DHIS2, and zero live patient data required for the demo.
---
*BioVerse v2.0 does less than BioVerse v0 promised — and that is precisely why it will matter. The rails are built. This is the train. Measure of success: referrals closed, not features shipped.*
