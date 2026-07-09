# v0.3 build plan — the facility PWA

The sync **backend** is done and CI-green (`/sync/pull` + `/sync/push`, event
replay idempotent on client UUIDs, monotonic cursor). What remains in v0.3 is
the **offline-first React PWA** in `client-facility/` that consumes it. This
plan sequences that work into small, shippable, testable slices.

Demo we are building toward (DESIGN.md §17): *airplane-mode referral creation,
sync on reconnect.*

## Architecture decisions (committing now, to avoid churn)

- **Stack:** React + Vite + TypeScript. Service worker via `vite-plugin-pwa`
  (Workbox) to precache the app shell so the app *loads* offline.
- **Local store:** IndexedDB via the `idb` library. Object stores:
  `session`, `outbox` (queued events), `referrals` (local projection),
  `patients` (cache), `meta` (sync cursor).
- **Offline-first data flow:** every write becomes an event appended to the
  `outbox` **and** optimistically applied to the local `referrals` projection.
  The UI reads only from the local projection, so it never waits on the network.
  A **sync engine** flushes the outbox via `/sync/push` and pulls deltas via
  `/sync/pull` when connectivity returns.
- **IDs:** `crypto.randomUUID()` for referral ids and event ids, generated on
  the device (matches the server's client-UUID idempotency contract).
- **Auth:** `/auth/login` → access token in memory + refresh cookie (HttpOnly).
  Offline work needs no token (events queue locally); sync refreshes the token
  on reconnect. Session presence (not token validity) gates the UI offline.
- **State:** Zustand (tiny) for app state; React Router for navigation.
- **Testing:** Vitest for store/sync-engine units (fake-indexeddb + mocked
  fetch); Playwright for offline e2e (`context.setOffline`, reload, reconnect).

## Backend prerequisite (small)

- **`GET /api/v1/terminology`** — return the danger-sign and capability value
  sets so the referral checklist is driven by the same vocabulary the server
  validates against (no bundled copy that can drift). ~1 endpoint + test.

## Scope boundary for v0.3 (explicit)

- Offline referral creation assumes the **patient already exists locally**
  (pulled while online, or picked from cache). Offline *new-patient* creation
  runs the server-side matching cascade, so it's deferred — the device can
  quick-create a patient only while online. Noted as a known v0.3 limitation;
  the airplane-mode demo (known patient) is unaffected.

## Slices (each: deliverable → test → exit)

### Slice 0 — Terminology endpoint (backend)
`GET /api/v1/terminology` returns value sets. Inject test.
**Exit:** client can fetch the danger-sign checklist source.

### Slice 1 — Scaffold + offline app shell
Vite + React + TS in `client-facility/`; `vite-plugin-pwa`; basic routes
(login, dashboard shell); service worker precaches the shell.
**Test:** Playwright — load app, go offline, reload, app still renders.
**Exit:** the app opens with no network. CI builds + typechecks the client.

### Slice 2 — Local store + auth
`idb` schema + a typed store module (unit-tested with fake-indexeddb). Login
against `/auth/login`; persist session; auth guard; logout.
**Test:** store units; Playwright login happy-path.
**Exit:** log in online, land on dashboard, session survives reload.

### Slice 3 — Create referral offline (headline)
Referral form with the maternal danger-sign checklist (from Slice 0). On
submit: generate UUIDs, append CREATE event to `outbox`, optimistically insert
into local `referrals`; the new referral shows in "my outbound" immediately.
**Test:** Playwright — offline, create referral, it appears; reload, still there
(persisted in IndexedDB).
**Exit:** a referral can be created with the network off.

#### Slice 3 — detailed implementation

Build order (each testable; commit per group):

1. **Terminology cache** — `api.getTerminology()` → cache in IndexedDB `meta`
   under `terminology`; a `useTerminology` hook reads cache-first, refreshes when
   online. Drives the danger-sign checklist + capability chips. *Unit: cache
   round-trip.*
2. **Patient picker** — a referral needs a server-known `patient_id` (the CREATE
   push does an FK insert), so patients are **searched online** (`POST
   /patients/search`) and the chosen one is cached in the `patients` store;
   offline, pick from cache. Scope per plan: no offline new-patient creation.
   *Unit: patient cache list/put.*
3. **Local referral data layer** — `db/referrals.ts`: `queueCreate(input)` writes
   a CREATE event to `outbox` **and** an optimistic projection to `referrals`
   (status INITIATED, `sync:'pending'`, reference `PENDING`); `listReferrals()`.
   A pure `buildCreateEvent(input, user)` maps form → PushEvent (validated,
   UUIDs). *Unit: buildCreateEvent shape; queueCreate writes both stores.*
4. **Referral form page** (`/referrals/new`) — patient picker, reason, priority
   segmented control, danger-sign checklist, optional capability chips + clinical
   summary. Submit → `queueCreate` → navigate to list. Works fully offline.
5. **Outbound list** — dashboard reads `listReferrals()`; each row shows priority,
   patient, status, and a **"Pending sync"** badge while `sync:'pending'`.
   *(Actual push/pull is Slice 4; here the badge just reflects local state.)*

Data shapes:
- `outbox` event = the server `PushEvent` CREATE (client `event_id`,
  `referral_id`, `referral{…}`).
- `referrals` projection = `{ id, reference, patient_id, patient_name, priority,
  reason, danger_signs, current_status, from_facility_id, created_at, sync }`.

Verify: live (preview + local API) — search/pick a patient, create a referral
offline (DevTools offline or stop API), see it listed with the pending badge,
reload → still there. Playwright offline spec authored for Slice 6 CI.

### Slice 4 — Sync engine (the demo)
Flush `outbox` via `/sync/push`; apply per-event results (clear accepted,
flag rejected/conflicts). Pull deltas via `/sync/pull`; merge into local
projection; advance cursor. Online/offline detection; auto-sync on reconnect +
manual "Sync now".
**Test:** Playwright — create offline → go online → assert pushed (server has
it) and status reflects server; re-sync is idempotent.
**Exit:** the airplane-mode → reconnect demo passes end to end.

### Slice 5 — Inbound queue, transitions, feedback
Inbound list (referrals routed to my facility, from pulled deltas). Transition
actions (RECEIVED → TREATED → FEEDBACK_RETURNED) queue events. Feedback form.
Optional: match view (`/referrals/:id/match`) when online.
**Test:** Playwright — receive an inbound referral, transition it offline, sync.
**Exit:** a full two-facility loop runs through the PWA.

### Slice 6 — Hardening + CI e2e
Token refresh on reconnect; conflict-surfacing UI; service-worker update flow;
error/empty states. Add a CI job: boot server (PostGIS service) + serve built
PWA + run Playwright headless.
**Exit:** Playwright offline suite green in CI; v0.3 demo script documented.

## Risks / watch-items

- **Service-worker update flow** — the classic PWA footgun (stale shell). Test
  the update path explicitly (Slice 6).
- **Playwright in CI** is heavier than our current jobs (needs browser + a live
  server + PostGIS). Introduce it once (Slice 6); keep unit/store tests fast and
  separate so the quick loop stays quick.
- **Auth token expiry across long offline periods** — refresh on reconnect;
  never block local work on it.
- **Projection/serve rebuild** — the local `referrals` projection is rebuilt
  from pulled events + optimistic outbox; keep that reducer pure and unit-tested
  (it's the client mirror of the server's event log).
