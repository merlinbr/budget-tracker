# Application review — 2026-09-29

## Assessment and scope

**Status: implemented household-budget MVP; release candidate with deployment gates pending.** The architecture fits a small private household deployment. Four code findings remain open (C1/C2/C3/C5). C4/C6 were reproduced and corrected in the approved authentication-lifecycle package, with integrated verification recorded on 2026-09-30 below. The original review had three reproduced findings and three source-derived risks.

This document records review and subsequent scoped verification, not authorization to deploy. The original review changed no application source, real household database, server configuration or network policy; the later approved C4/C6 frontend changes are recorded below. The earlier eleven readiness findings in `DEPLOYMENT.md` §13 have separate repository-level closure; that does not close the new findings below.

The product is a private, self-hosted household budget tracker: individual logins, shared household accounts/categories/transactions, monthly budgets, a selected-month dashboard, basic settings and CSV export. Access must require LAN/authorized Tailscale reachability **and** application authentication. Product scope: [MVP specification](../BUDGET_TRACKER_MVP_SPEC.md), §§1–3.

### Current progress

| Area | State |
|---|---|
| Identity | Local authentication, server-side sessions, CSRF, household membership and administrative bootstrap implemented |
| Accounts/categories | Create/edit/archive, household scoping and calculated balances implemented |
| Transactions | Income/expense entry, edit/delete, dates, description search and filters implemented |
| Dashboard | Selected-month income/expenses/net, current balance, category spending and recent transactions implemented |
| Budgets | Monthly limits, spent/remaining/progress and copy-previous implemented |
| Settings/export | Profile/password, read-only membership and filtered spreadsheet-safe CSV implemented |
| Backup/recovery | Scripts implemented and disposable backup/restore exercised; actual-host operation remains open |
| Deployment | Compose and Unraid instructions plus local disposable container evidence recorded; actual-host release acceptance incomplete |

## Priority definitions

- **P0 — release gate:** must pass before the relevant network exposure or routine real-data use. Requires actual-host evidence and separate authorization for operational changes.
- **P1 — fix next:** user draft preservation or authentication/navigation lifecycle correctness.
- **P2 — correctness/accessibility:** controlled input/error handling, concurrent edits and keyboard/screen-reader behavior; complete before routine use.
- **P3 — maintenance:** behavior-preserving cleanup or automation after correctness fixes.

Priorities express task order/urgency, not vulnerability severity. No authentication bypass or cross-household disclosure was confirmed in the reviewed paths; this was not penetration testing.

## Code findings

### C1 — Bound resource identifiers before SQLite binding

**Priority:** P2. **Evidence:** reproduced for an account path; sibling cases identified from source. **Status:** open.

- **Locations:** [`schemas.py:90–97`](../backend/app/schemas.py#L90), transaction references; [`transactions.py:164–176`](../backend/app/transactions.py#L164), transaction paths; account/category paths and transaction filter IDs also lack a consistent upper bound.
- **Trigger/result:** authenticated `GET /api/accounts/9223372036854775808` returned HTTP `500` with `INTERNAL_ERROR`. Positive-only validation accepts an integer outside SQLite's signed 64-bit binding range.
- **Impact:** malformed identifiers become internal server errors instead of client validation errors. JavaScript-safe identifier handling also needs one consistent supported range.
- **Minimum correction:** apply the existing bounded-ID approach from budgets/export to all affected path, filter and write-body references. Preserve strict integer validation and household scope; do not special-case just the reproduced URL.
- **Acceptance:** oversized path/filter/body IDs return the shared `422` validation envelope without database binding errors; valid IDs still work and ordinary missing/foreign records retain existing not-found behavior.

### C2 — Empty-state Add resets a submitted draft during a pending save

**Priority:** P1. **Evidence:** reproduced for accounts; matching category pattern inspected. **Status:** open.

- **Locations:** [`accounts.page.ts:31–38,125–126`](../frontend/src/app/features/accounts/accounts.page.ts#L31); [`categories.page.ts:16–22,62`](../frontend/src/app/features/categories/categories.page.ts#L16).
- **Trigger/result:** with the first account POST delayed but still routed to the real backend, the empty-state “Add an account” button remained enabled. Clicking it changed the submitted name from `Pending draft` to an empty string.
- **Impact:** a failed write no longer leaves the user's submitted values intact; a successful outstanding write can close a newly entered draft. Header Add buttons already disable during pending writes, but the empty-state buttons and `startAdd()` entry points do not.
- **Minimum correction:** disable both empty-state Add buttons during submission/archive operations and enforce the same guard inside `startAdd()`.
- **Acceptance:** a delayed first-account/first-category save cannot reset the form through either Add action; failed saves retain the submitted values and successful saves do not create duplicate writes.

### C3 — Confirmation focus runs before Angular renders the confirmation

**Priority:** P2. **Evidence:** reproduced for account archive; matching category/transaction code inspected. **Status:** open.

- **Locations:** [`accounts.page.ts:154`](../frontend/src/app/features/accounts/accounts.page.ts#L154), [`categories.page.ts:69`](../frontend/src/app/features/categories/categories.page.ts#L69), [`transactions.page.ts:266–270`](../frontend/src/app/features/transactions/transactions.page.ts#L266).
- **Trigger/result:** opening the account archive confirmation displayed the confirmation but left `document.activeElement` on the Archive button; the confirmation was not focused.
- **Cause:** `queueMicrotask` runs before the conditional view is rendered in the current Angular scheduling model; the optional `viewChild` focus call can silently do nothing.
- **Impact:** keyboard/screen-reader users are not moved to the newly opened confirmation, which appears after the list.
- **Minimum correction:** reuse the budgets page's existing `afterNextRender` focus pattern for these confirmations; retain sensible focus restoration after cancel/success.
- **Acceptance:** account/category archive and transaction delete move focus to the rendered confirmation; cancel restores focus to the originating action; successful removal leaves focus on a valid control.

### C4 — Settings can leave global pending state stuck after destruction

**Priority:** P1. **Evidence:** originally source-derived; reproduced before correction. **Status:** closed at repository level, 2026-09-30; see [authentication-lifecycle verification](#authentication-lifecycle-verification--2026-09-30).

- **Locations:** [`settings.page.ts:171–179,216–225`](../frontend/src/app/features/settings/settings.page.ts#L171), [`pending-form.service.ts`](../frontend/src/app/core/pending-form.service.ts), [`auth.guard.ts:29–30`](../frontend/src/app/core/auth/auth.guard.ts#L29), [`app-shell.ts:113–116`](../frontend/src/app/layout/app-shell.ts#L113).
- **Scenario:** a profile/password mutation is outstanding when another request produces a `401` and redirects to login. The route guard permits login navigation, destroying Settings. When the mutation settles, its finalizer skips clearing the root-provided pending flag because the component is destroyed.
- **Expected impact:** after signing in again, protected-page navigation and sign-out can remain blocked until reload.
- **Minimum correction:** release global pending ownership independently of component-local signal updates. Ensure an older operation cannot clear a newer operation's pending state. Do not blanket-cancel writes or pretend cancellation rolls back a server-side mutation.
- **Acceptance:** reproduce the delayed-mutation/auth-expiry ordering, then prove re-login allows navigation and sign-out; also prove a late old operation cannot unblock a newer outstanding write.

### C5 — Concurrent delete during transaction edit can produce HTTP 500

**Priority:** P2. **Evidence:** [INFERENCE] from source; not runtime-reproduced. **Status:** open, targeted reproduction required.

- **Location:** [`transactions.py:180–207`](../backend/app/transactions.py#L180).
- **Scenario:** another household member deletes the transaction after the edit loads/validates it but before its UPDATE. The UPDATE result is ignored, the operation commits, then `db.refresh(transaction)` attempts to reload a missing row.
- **Expected impact:** an ordinary concurrent missing-record condition becomes a generic internal error rather than a controlled missing-resource/conflict response.
- **Minimum correction:** inspect affected-row count and return the established not-found/conflict response when no row matched, before reporting successful commit/refresh.
- **Acceptance:** deterministically interleave deletion between lookup and UPDATE; the edit returns the agreed controlled response, does not recreate the row, and preserves existing edit/household-isolation behavior.

### C6 — Abandoned reads can clear a newer authenticated session

**Priority:** P1. **Evidence:** originally source-derived; reproduced before correction. **Status:** closed at repository level, 2026-09-30; see [authentication-lifecycle verification](#authentication-lifecycle-verification--2026-09-30).

- **Locations:** [`accounts.page.ts:114–133`](../frontend/src/app/features/accounts/accounts.page.ts#L114), [`categories.page.ts:64–66`](../frontend/src/app/features/categories/categories.page.ts#L64), [`transactions.page.ts:177–225`](../frontend/src/app/features/transactions/transactions.page.ts#L177), [`auth.interceptor.ts:15–30`](../frontend/src/app/core/auth/auth.interceptor.ts#L15).
- **Scenario:** some page-owned list/detail/lookup subscriptions survive navigation. A request from an old session completes with a delayed `401` after logout and a newer login. The global interceptor clears current auth before component request-sequence checks run.
- **Expected impact:** an abandoned request redirects an already re-authenticated user back to login. Sequence counters prevent stale component assignments, not interceptor side effects.
- **Minimum correction:** cancel page-owned GETs on destruction, following existing `takeUntilDestroyed` usage. Preserve sequencing or cancellation of superseded reads where appropriate. Do not suppress legitimate current-session `401` responses.
- **Acceptance:** leaving each affected page cancels its outstanding reads; an abandoned old-session read cannot invalidate a newer login, while a live current-session `401` still redirects correctly.

## Refactoring and maintainability findings

These are not six more feature gaps. Keep changes local and behavior-preserving; do not introduce a generic CRUD framework, global state library or new backend service/repository hierarchy.

| ID | Priority | Finding and smallest useful action |
|---|---|---|
| R1 | P3 | **Inconsistent frontend lifecycle conventions.** Account/category/transaction read cleanup, confirmation focus and Settings pending cleanup differ. Close C3/C4/C6 first by reusing existing patterns; avoid a separate speculative abstraction project. |
| R2 | P3 | **Dense account/category methods.** `startAdd`, `loadList`, `startEdit`, save/archive handlers and inline templates compress unrelated state transitions into long lines. Expand the touched methods/blocks so guards, state ownership and callback order are reviewable; extract only genuinely repeated behavior. |
| R3 | P3 / ongoing invariant | **Household-consistent references rely partly on application checks.** The financial model has individual foreign keys rather than database-enforced composite household/reference invariants. Future imports/write paths must reuse the current scope/reference validation. Preserve that invariant now; consider schema enforcement only when an actual new write path warrants it, not as a prerequisite rewrite. See [`models.py`](../backend/app/models.py). |
| R4 | P3 | **Status/evidence duplication.** README, `state.md` and multiple handoffs mix current evidence with historical milestone totals. Use `state.md` for current status and this document for this review's open findings; keep handoffs historical and have other documents link to the canonical status rather than copy it. Earlier §13 closures remain distinct from C1–C6. |
| R5 | P3 | **Quality automation gap.** No checked-in CI workflow or lint configuration was found in the review. Automate the existing backend/frontend/build/browser commands with disposable data before expanding tooling. Keep lint/format adoption a separately scoped decision, not a mass-restyling prerequisite. |

### Architecture worth preserving

- Angular feature pages and feature-local HTTP services; strict TypeScript/template checking; native forms and shared exact-cent helpers.
- Feature-sized FastAPI routers and direct SQLAlchemy queries, without unnecessary pass-through layers.
- Central CSRF enforcement, server-derived household membership, hashed/expiring sessions and password-change session revocation.
- Integer-cent validation, archive/history rules, explicit dashboard read snapshots and atomic budget writes.
- SQLite WAL, migrations, safe CSV handling and stdlib backup/offline recovery.
- Behavior-focused tests for isolation, money/date boundaries, concurrency, migrations and real-backend desktop/mobile workflows.

### Intentional tradeoffs, not immediate tasks

- SQLite and one backend worker fit household-scale usage. Add database/worker infrastructure only when measured concurrency or deployment needs exceed this model.
- The in-memory login limiter uses shared socket-peer buckets behind Caddy because arbitrary forwarded headers are not trusted. Any future per-client limiting must first establish trusted proxy handling.
- CSV export buffers in memory; use bounded spooling only if measured export size threatens memory.
- History is unpaginated; description search uses SQLite's ASCII-only case folding. Add pagination/non-ASCII normalization only when an actual household workflow needs them.
- Eager frontend routes are acceptable at this scope; no routing rewrite is justified by this review.
- Bank sync/import, recurring transactions, linked transfers, split transactions, multi-currency, receipts, advanced analytics, public registration and native mobile apps remain explicitly outside the MVP.

## Operational release findings

All are **P0 gates**, not application features to implement blindly. Follow [DEPLOYMENT.md](DEPLOYMENT.md) §11 and [BACKUP_RESTORE.md](BACKUP_RESTORE.md). Local disposable evidence does not prove the actual Unraid host or client devices. The host-specific Unraid guides remain unpublished and are outside this commit's scope.

| ID | Open gate | Required proof |
|---|---|---|
| O1 | Unraid deployment inputs | Private persistent data/separate backup paths, UID/GID ownership, filesystem access, actual bind addresses, available HTTPS port, DNS hostname and client certificate-trust approach reviewed |
| O2 | LAN-only disposable rehearsal | Private container network, migration/health/startup and reboot behavior, persisted Unraid definitions, recreation persistence, browser login, trusted TLS, actual IPv4/IPv6 binds and no externally reachable backend port |
| O3 | Tailscale network isolation | Replace the documented wildcard allow-all grant, not supplement it. Review all additive policies/routes, retain rollback, and prove the media-only recipient cannot connect to Budget while Emby/Jellyseerr still work before Budget tailnet exposure |
| O4 | Actual-host backup/recovery | Live WAL access on the host filesystem, restricted permissions, non-overlapping daily scheduler, 30-day retention, visible failures/notification delivery, isolated offline recovery and restored-session denial; exercise platform guards skipped on the development host |
| O5 | Actual-device release acceptance | Authorized remote and LAN devices use trusted HTTPS and still need login; public IPv4/IPv6 access denied; no forwarding/Funnel; backend port denied; correct cookies/CSP/headers and recorded HSTS decision; dated evidence and user release review |

The Unraid documentation records local two-container/backup/recovery proof and explicitly leaves Castle-specific paths, templates, scheduling, DNS/client trust and network checks open. No server/network change is authorized by this review.

## Short prioritized next-task list

Checkboxes track completed fixes/gates, not whether the finding was documented. Only the authentication-lifecycle code task is complete; unrelated fixes and operational gates remain unchecked.

- [x] **P1 — Authentication lifecycle (C4, C6):** original races reproduced, operation-owned pending release and page-owned GET cancellation corrected; re-login/navigation/sign-out, newer-operation overlap and live `401` acceptance passed (2026-09-30).
- [ ] **P1 — Draft preservation (C2):** guard both account/category Add entry points and empty-state controls; prove failed delayed saves retain input.
- [ ] **P2 — Backend errors (C1, C5):** bound all affected identifiers and handle interleaved transaction deletion; prove validation/missing-resource responses instead of `500`.
- [ ] **P2 — Accessible confirmation focus (C3):** use the existing render-aware focus pattern for all three confirmation workflows and verify keyboard focus restoration.
- [ ] **P0 — Prepare host and rehearse LAN deployment (O1, O2):** resolve actual Unraid inputs, obtain change authorization, and run the disposable LAN-only rehearsal without real financial data.
- [ ] **P0 — Prove backup/recovery on the host (O4):** verify manual backup, scheduler/failure visibility and isolated restore before routine real-data use.
- [ ] **P0 — Prove network isolation and accept release (O3, O5):** review/replace wildcard policy before tailnet exposure; verify allowed/denied devices and public paths; complete §11 evidence and obtain release review.
- [ ] **P3 — Maintenance (R1–R5):** keep lifecycle patterns consistent, expand touched dense methods, preserve household invariants, consolidate current status and automate existing checks. No architecture rewrite.

Host preparation can proceed independently of code fixes. P0 describes a hard exposure/data-use gate, not permission to change the host or an instruction to skip prerequisite steps. Before closing code tasks, keep focused regression checks for consumer-visible failure cases, exercise the real changed workflows, and run the existing integrated checks once on the stable tree. Update this document and `state.md` with actual outcomes.

## Verification record and limits

### Authentication-lifecycle verification — 2026-09-30

**C4/C6 closure is code-level, not release acceptance.** Source tree `b71cc84` was stable for all fresh integrated checks. Independent Task 1–5 correctness/spec reviews approved their scoped packages; Task 5 retained the environmental cleanup minor below. Final whole-branch review is still a controller handoff, not claimed here. Implementation commits: `1d4f8cc`, `c53ecc2`, `534729b`; acceptance tests: `81ffd48`, `b71cc84` (approved plan: `318d83b`).

- **C4 original RED:** `core/auth/auth-lifecycle.spec.ts`, “releases a profile write when a separate 401 destroys Settings”: Settings PATCH outstanding → separate household GET 401 → actual guards/router destroy Settings at login → PATCH remains uncancelled → 422 settlement. `expect(pending.pending()).toBe(false)` received **true** (1 failed test). This is the reported stuck lock, not the separate missing-API RED. The same named regression now passes. `core/pending-form.service.spec.ts` proves independent/idempotent release, destroyed-old-owner versus new-owner isolation and callback unregistering. Lifecycle tests “a late abandoned write cannot release a newer page operation” and “allows re-login/navigation before old profile settlement (%s)” (200/422), plus both `layout/app-shell.spec.ts` sign-out tests, prove actual consumer behavior before/after settlement and while a newer lock exists. Feature page specs cover all 11 mutation entry points with success/error settlement after destruction, no write cancellation, dead UI effects or new GETs.
- **C6 original RED:** `features/accounts/accounts.page.spec.ts`, “cancels an abandoned account GET before it can clear a newer login”: capture GET → destroy page → logout → newer login → still-live old GET 401 through the actual interceptor. `expect(auth.authState()).toEqual(identity)` received **null** (1 failed / 8 passed). Now identity survives and the request is cancelled. Account/category specs “cancels … list and detail GETs on destruction” and transaction spec “cancels lookup, detail and filtered-list GETs on destruction” pass. Transaction pre-fix diagnostics were list **true**, accounts/categories/detail **false**. Newer-detail ordering tests and existing superseded-filter cancellation remain passing. `core/auth/auth.interceptor.spec.ts` retains live protected-401 login redirection and login/non-API exceptions; production interceptor/restoration behavior is unchanged.
- **Changed-browser acceptance:** `frontend/e2e/auth-lifecycle.spec.ts` passed all five scenarios at **1280×900 and 390×844** (10 tests within the full run). A real successful profile PATCH has only response delivery held; separate real expired-cookie household 401 destroys Settings. Pending UI/navigation denial and one PATCH are checked; re-login, protected Accounts/Categories GETs and sign-out work before and after old delivery, without reload; original profile is restored through UI. Abandoned Accounts/Categories lists and Transactions account lookup are followed by logout/new login and attempted late real-401 delivery; protected reads/auth-me 200 and sign-out remain usable. A still-mounted protected read 401 redirects and recovers. Browser handler completion is not proof Angular received an abandoned response; direct cancellation/all detail paths and newer-write overlap are unit-layer evidence. Client cancellation does not roll back writes. Viewport proof is workflow automation, not a new pixel-level/accessibility audit.

Fresh commands (all exit 0; full stdout/stderr retained in private `.superpowers/sdd/2026-09-30-authentication-lifecycle/task-6-*.log`):

| Command | Actual result |
|---|---|
| `cd backend && C:/Python314/python.exe -m pytest -q --junitxml=<scratch>/task-6-backend.xml` | **303 passed / 5 skipped**, 308 tests, 0 failures/errors (JUnit totals; existing quiet config omits totals) |
| `cd frontend && npm test -- --watch=false` | **117 passed / 16 files**, four existing jsdom document-navigation warnings |
| `cd frontend && npm run build` | Production build passed, initial bundle 462.74 kB |
| `cd frontend && npx playwright test` | **26 passed**, 1 worker, 1.2m; no retries occurred |

Backend skips: four symlink-privilege guards and one POSIX owner/mode guard; actual-host checks stay open. Output retains two dependency deprecations and 256 Alembic warnings (258 warnings total), not pristine output. Matching installed global Python was used; original venv lacks argon2. Baseline npm install evidence has two moderate audit findings and four optional/blocked install-script notices; dependencies were not upgraded and install/audit was not rerun for this closure.

For Playwright, **`BUDGET_E2E_DATABASE_URL` was explicitly unset**, `PYTHON=C:/Python314/python.exe`, and `BUDGET_E2E_DATA_DIRECTORY` was explicitly this plan's private `task-6-disposable` directory. Unchanged configuration created/migrated/seeded `budget-tracker-e2e-jiTM5p` there with its ownership marker; no real household data was used. Post-run inspection found **budget.db / budget.db-shm / budget.db-wal still present, marker removed**. Removal did not complete; precise cause is unproven. Task 5's analogous leftovers remain deferred, not cleaned up or rewritten here. One earlier Task 5 pre-delivery Transactions login service-unavailable failure had unknown cause; it did not recur in final 30+10 trace-off focused tests or this fresh full run. Passing runs do not explain its cause.

Final source inspection found no `setPending` in production/tests; each write captures its own release, destruction unregisters ownership, dead callbacks are guarded, reads have required destruction ownership, and transaction filter supersession remains. No mutation destruction cancellation/replay, production interceptor change, dependency/backend/deployment/database-file change or C1/C2/C3/C5 fix is mixed in. Whitespace/path/link checks passed. Private scratch retains Task 1–5 reports/reviews and original RED logs (`task-1-red-c4.txt`, `task-2-red-c6.log`) plus Task 6 logs/XML/report; these are local evidence, not a published artifact bundle. C1/C2/C3/C5 and O1–O5 remain open. Release classification remains **release candidate with deployment gates pending**.

### Exercised during the application review

A freshly migrated disposable database and the actual Angular/FastAPI development runtime were used. The real household database was untouched.

- Created an account with `100000` initial cents, an expense category and a transaction of `-8472` cents dated `2026-09-07`.
- Dashboard returned balance `91528`, income `0`, expenses `8472` and net `-8472`; rendered values matched.
- Set budget `60000`; response/render showed spent `8472`, remaining `51528`, progress `0.1412` / `14.12%`.
- CSV endpoint returned `200`, `private, no-store`, and the expected `2026-09-07,Groceries,Checking,Food,expense,-84.72,EUR` row. A browser-saved download was **not independently verified** in this review.
- Captured desktop and 390px mobile dashboard screenshots; mobile document width was `390`, with no horizontal overflow in that surface. This is not complete visual/accessibility coverage of every page.
- Signed out; the financial dashboard API returned `401`.
- Ran `scripts/backup.py` against the live disposable database and `scripts/restore.py` into a separate recovery database. Both exited `0`; recovered revision was `0005_budgets`, sessions `0`, transaction `-8472`, budget `60000`, integrity `ok`. Actual-host permissions/durability and restored-cookie denial were not exercised in this review.
- Reproduced C1's account-path `500`, C2's pending-account draft reset and C3's account-confirmation focus failure. At that review date, sibling cases and C4/C5/C6 required targeted verification. The subsequent C4/C6 evidence is recorded above; C5 remains open.

Disposable review data was removed and review services/browser were stopped. Screenshots were temporary; no retained screenshot bundle or new regression tests were produced. Documentation of this review does not rerun or upgrade its evidence.

### Previously recorded repository verification

[`state.md:18–25`](../state.md#L18) records backend **303 passed / 5 skipped**, frontend **77 tests / 13 files**, production build passed and full Playwright **16 passed**. Those historical totals were not rerun during the original application review; fresh authentication-lifecycle totals are recorded above. Skipped platform guards, actual-host networking/TLS/scheduler/recovery and full release acceptance remain open.

This was a source/local-runtime review, not an external security assessment, production deployment or complete proof of every MVP acceptance criterion.
