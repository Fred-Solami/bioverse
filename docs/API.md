# API

## Implemented now (Phase 0 bootstrap)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | none | Liveness + DB check |
| GET | `/api/v1/facilities?district=&capability=` | none (public MFL data; JWT lands v0.1) | Read-only facility registry |

## v0.1 target surface (DESIGN.md §14)

```
POST   /api/v1/auth/login | /refresh | /logout
POST   /api/v1/referrals
GET    /api/v1/referrals/:id                      (full timeline)
GET    /api/v1/referrals?status=&facility=&priority=
POST   /api/v1/referrals/:id/transition           {to_status, note, payload, event_id, occurred_at}
GET    /api/v1/referrals/:id/match                (ranked candidates: capable+stocked)
GET    /api/v1/facilities?district=&capability=
POST   /api/v1/patients                           (runs matching cascade; may return existing)
GET    /api/v1/patients/search?identifier=&name=  (audited)
GET    /api/v1/identity/review-queue              (in-charge/district)
POST   /api/v1/identity/review-queue/:id/decide   {LINKED|REJECTED}
GET    /api/v1/dashboard/facility/:id
GET    /api/v1/dashboard/district/:district
POST   /api/v1/sync/push        GET /api/v1/sync/pull?since=
POST   /internal/interop/dhis2/export             (scheduled)
POST   /internal/interop/zhfr/refresh             (scheduled)
```

Binding rules once auth ships: all endpoints JWT-authenticated, RBAC-scoped;
patient-touching routes write `audit_log` via central middleware — enforced by
the framework, not per-handler discipline.
