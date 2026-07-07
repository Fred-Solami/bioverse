# Compliance — Data Protection Act No. 3 of 2021 (Zambia)

BioVerse handles personal health data, which the Act treats as sensitive
personal data. Compliance is **by construction**, not by policy document.

## Built into the architecture

- **Audit trail:** `audit_log` (migration 0006) is append-only; every
  patient-data access (READ included) is recorded with actor, action, entity,
  IP, and timestamp via central middleware (v0.1).
- **Access control:** facility/district-scoped RBAC; five roles from CHW to
  MOH_ADMIN; users see only their own facility's referrals (own district for
  officers).
- **Data minimisation:** the patient record holds only what coordination
  requires (name, sex, birth date, phone, district, home location). Clinical
  truth stays in SmartCare Pro.
- **Reversible identity:** no destructive merges; all identifier links are
  provenance-tracked assertions; wrong merges are recoverable.
- **No PII leakage:** no PII in logs, URLs, or error messages (v0.1 gate).
- **Hosting posture:** in-country hosting for any live patient data.

## Regulatory checklist

- [ ] **Registration with the Office of the Data Protection Commissioner** —
  a *pilot prerequisite* (required before any live patient data), not a v0.1
  blocker. Track lead time; start the conversation during Phase 1.
- [ ] Data protection impact assessment before pilot go-live.
- [ ] Data-sharing agreement with the pilot district health office / MoH
  covering purpose, retention, and access.
- [ ] Breach-notification procedure documented.
- [ ] Retention and deletion policy (referral records vs audit log).

## Security gate for v0.1 (from DESIGN.md §15)

- [ ] Argon2id password hashing; 15-min JWT access tokens; rotating refresh;
  logout revocation
- [ ] RBAC matrix implemented and tested per role
- [ ] Central audit middleware on all patient-data routes
- [ ] Rate limiting (Redis) on auth + search endpoints
- [ ] TLS-only; HSTS; secure cookie flags on refresh token
- [ ] Secrets via env; `.env` gitignored; git history scanned (gitleaks)
  before the repo goes public
