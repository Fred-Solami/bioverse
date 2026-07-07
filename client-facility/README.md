# client-facility

Facility PWA — lands in **v0.3** ("It works in the field", DESIGN.md §17).

React, offline-first: IndexedDB event queue + service worker, client-generated
event UUIDs, sync via `POST /api/v1/sync/push` / `GET /api/v1/sync/pull`.

Scope at v0.3: login, create referral (maternal danger-sign checklist),
inbound referral queue, status transitions, feedback form — all fully
offline-capable. The CHW companion client (M2) reuses the same sync protocol.

Nothing to build here yet; this placeholder pins the repo structure.
