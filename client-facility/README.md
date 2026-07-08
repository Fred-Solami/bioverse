# client-facility

Facility PWA — lands in **v0.3** ("It works in the field", DESIGN.md §17).

React, offline-first: IndexedDB event queue + service worker, client-generated
event UUIDs, sync via `POST /api/v1/sync/push` / `GET /api/v1/sync/pull`.

Scope at v0.3: login, create referral (maternal danger-sign checklist),
inbound referral queue, status transitions, feedback form — all fully
offline-capable. The CHW companion client (M2) reuses the same sync protocol.

## Build order (docs/PWA-PLAN.md)

- **Slice 1 (done):** Vite + React + TS scaffold; `vite-plugin-pwa` service
  worker precaches the shell so the app loads offline. `useOnline` connectivity
  badge. Playwright offline test authored (`e2e/offline.spec.ts`; runs in CI at
  Slice 6).
- **Next:** local store + auth (Slice 2) → offline referral creation (Slice 3)
  → sync engine (Slice 4) → inbound queue/transitions/feedback (Slice 5).

## Scripts

`npm run dev` (proxies `/api` → server on :3000) · `npm run build` (emits the
service worker) · `npm run typecheck` · `npm run e2e` (Playwright).
