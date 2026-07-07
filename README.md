# BioVerse

**Health system coordination platform for Zambia** — referral tracking and capability-aware routing across facilities and community health workers. FHIR-native, IAF-aligned, offline-first.

## The problem

Zambia's health systems exist but do not coordinate. SmartCare Pro holds patient records (~2,000+ facilities), eLMIS tracks supply (~2,600–3,000 facilities), DHIS2 aggregates reporting, the ZHFR/MFL registers facilities — and the ~96,000-strong community health workforce sits outside all of them.

The seam where this fragmentation kills people is the **referral**: today a paper triplicate form with no acknowledgement, no tracking, no transport coordination, and no feedback loop — a documented direct contributor to maternal and neonatal mortality.

## The evidence

- When Zambia fixed referral coordination *manually* (Saving Mothers Giving Life, 2012–2016), institutional maternal mortality in intervention districts fell **37.6%**. BioVerse digitises that coordination.
- Simple rules beat models in this context: a missing-data *alert* in Rwanda cut ART-eligible-but-not-started patients from 29.6% to 6.2%, while the Epic Sepsis Model (405k training encounters) caught only 33% of cases in external validation. BioVerse uses explainable rules and state machines, never learned per-person predictors.

See [DESIGN.md](DESIGN.md) for the full evidence base and system design.

## What BioVerse is NOT

- **Not an EHR** — clinical truth lives in SmartCare Pro; BioVerse links to it.
- **Not a supply system** — BioVerse *reads* eLMIS so stock informs routing; it never re-tracks stock.
- **Not a predictive digital twin** — coordinate, don't predict. The only "twin" is the care-journey view: a live, linked record of real referrals and encounters.

## What exists today (Phase 0)

- Repo structure, authoritative data model (migrations 0001–0007: facilities, users, identity/matching, referrals + append-only event log, stock read-model, audit log, sync cursors)
- Docker Compose dev environment (PostgreSQL 15 + PostGIS, Redis, server)
- Facility seed script (dev sample data; ZHFR/MFL adapter is integration #1 — see [docs/INTEROP.md](docs/INTEROP.md))
- Minimal bootstrap server: health check + read-only facility registry query

## Quick start

```bash
docker compose up --build
# migrations apply, sample facilities seed, server starts
curl http://localhost:3000/health
curl "http://localhost:3000/api/v1/facilities?district=Masaiti"
```

Without Docker: run PostgreSQL 15+ with PostGIS and Redis, copy `server/.env.example` to `server/.env`, then:

```bash
cd server
npm install
npm run migrate && npm run seed && npm run dev
```

## Roadmap

| Version | Milestone |
|---|---|
| v0.1 | "A referral exists" — auth, RBAC, audit, patients (deterministic matching), full referral state machine |
| v0.2 | "Routing is smart" — PostGIS capability+distance matching, stock annotation, escalation timers, probabilistic matching |
| v0.3 | "It works in the field" — offline-first facility PWA |
| v0.4 | "The district can see" — district dashboard, DHIS2 export, ZHFR refresh |
| v1.0 | Pilot-ready — hardening, load test, runbooks, pilot brief |

Full roadmap and phase gates: [DESIGN.md](DESIGN.md), Part III.

## Principles (binding)

1. Whole-system coordination, one seam at a time.
2. Interoperate, never duplicate — every entity keys to official identifiers.
3. Every seam feeds the coordination decision.
4. Coordinate, don't predict — explainable rules only.
5. Offline-first, SMS-degradable.
6. Human-in-the-loop — BioVerse recommends; clinicians decide.
7. Data Protection Act No. 3 of 2021 compliance by construction.
8. Sustainability by design — boring stack, low run cost, open source.

## License

MIT (see [LICENSE](LICENSE)). Open source from day one is a locked decision (D4): public-good posture, Digital Square/DPG route, and it disciplines quality.

---

*Measure of success: referrals closed, not features shipped.*
