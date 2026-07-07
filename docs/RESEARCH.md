# Research & evidence base

This file indexes the evidence that shaped BioVerse's design decisions. The
full argument lives in [DESIGN.md](../DESIGN.md) Part I; this is the working
list to keep citations and follow-up research in one place.

## Core evidence (from DESIGN.md)

| Claim | Evidence | Design consequence |
|---|---|---|
| Referral coordination reduces maternal mortality | Saving Mothers Giving Life (Zambia/Uganda, 2012–2016): institutional maternal mortality −37.6% in intervention districts | Referral is the core domain object (D2); SMGL is the KPI baseline |
| Predictive clinical models fail under distribution shift | Epic Sepsis Model external validation: 33% sensitivity, alerts on 18% of patients, AUC 0.63 vs claimed 0.76–0.83 | "Coordinate, don't predict" (principle 4); M5 gated on validated checklists only |
| Simple rules work where models can't | Rwanda missing-data alert: ART-eligible-not-started 29.6% → 6.2% | Rules + state machines architecture; escalation timers |
| Routine facility data quality is poor | 40%+ missing-data rates in routine African facility data | No per-person learned models; sync freshness as a first-class KPI |
| National systems exist but don't coordinate | SmartCare Pro ~2,000+ facilities / 12M+ records; eLMIS ~2,600–3,000 facilities; ZHFR live; IAF published | Interoperate-never-duplicate (principle 2); adapter build order §12 |
| Private sector is a real gap | 21.4% of facilities are private, outside eLMIS | M4 module, post-pilot |

## Open research tasks

- [ ] Confirm ZHFR API access terms (auth, rate limits, licence) — blocks the
  `zhfr` adapter; fallback is MOH-Zambia MFL GitHub data.
- [ ] Obtain the IAF specification document (exchange patterns, EMPI interface)
  for conformance checking.
- [ ] Locate SMGL district-level baseline tables for pilot KPI comparison.
- [ ] Digital Health TWG meeting cadence and membership route (chaired by MoH
  ICT Directorate).
- [ ] Validated maternal danger-sign checklist selection (for the v0.3 PWA
  form and, later, M5).
- [ ] CHT structured-SMS payload design references for M2.
