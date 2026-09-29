# Application review — 2026-09-29

## Assessment and scope

**Status: implemented household-budget MVP; release candidate with deployment gates pending.** The architecture fits a small private household deployment. Six code findings remain open from this review; three were reproduced and three are source-derived risks requiring targeted reproduction before a fix is claimed.

This document records the review, not an implementation plan or authorization to deploy. No application source, real household database, server configuration or network policy was changed. The earlier eleven readiness findings in `DEPLOYMENT.md` §13 have separate repository-level closure; that does not close the new findings below.

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

**Priority:** P1. **Evidence:** [INFERENCE] from source; not runtime-reproduced. **Status:** open, targeted reproduction required.

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

**Priority:** P1. **Evidence:** [INFERENCE] from source; not runtime-reproduced. **Status:** open, targeted reproduction required.

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

Checkboxes track completed fixes/gates, not whether the finding was documented. They intentionally remain unchecked.

- [ ] **P1 — Authentication lifecycle (C4, C6):** reproduce the delayed-request orderings, fix pending ownership and page-owned read cancellation, then prove re-login/navigation/sign-out and legitimate `401` behavior.
- [ ] **P1 — Draft preservation (C2):** guard both account/category Add entry points and empty-state controls; prove failed delayed saves retain input.
- [ ] **P2 — Backend errors (C1, C5):** bound all affected identifiers and handle interleaved transaction deletion; prove validation/missing-resource responses instead of `500`.
- [ ] **P2 — Accessible confirmation focus (C3):** use the existing render-aware focus pattern for all three confirmation workflows and verify keyboard focus restoration.
- [ ] **P0 — Prepare host and rehearse LAN deployment (O1, O2):** resolve actual Unraid inputs, obtain change authorization, and run the disposable LAN-only rehearsal without real financial data.
- [ ] **P0 — Prove backup/recovery on the host (O4):** verify manual backup, scheduler/failure visibility and isolated restore before routine real-data use.
- [ ] **P0 — Prove network isolation and accept release (O3, O5):** review/replace wildcard policy before tailnet exposure; verify allowed/denied devices and public paths; complete §11 evidence and obtain release review.
- [ ] **P3 — Maintenance (R1–R5):** keep lifecycle patterns consistent, expand touched dense methods, preserve household invariants, consolidate current status and automate existing checks. No architecture rewrite.

Host preparation can proceed independently of code fixes. P0 describes a hard exposure/data-use gate, not permission to change the host or an instruction to skip prerequisite steps. Before closing code tasks, keep focused regression checks for consumer-visible failure cases, exercise the real changed workflows, and run the existing integrated checks once on the stable tree. Update this document and `state.md` with actual outcomes.

## Verification record and limits

### Exercised during the application review

A freshly migrated disposable database and the actual Angular/FastAPI development runtime were used. The real household database was untouched.

- Created an account with `100000` initial cents, an expense category and a transaction of `-8472` cents dated `2026-09-07`.
- Dashboard returned balance `91528`, income `0`, expenses `8472` and net `-8472`; rendered values matched.
- Set budget `60000`; response/render showed spent `8472`, remaining `51528`, progress `0.1412` / `14.12%`.
- CSV endpoint returned `200`, `private, no-store`, and the expected `2026-09-07,Groceries,Checking,Food,expense,-84.72,EUR` row. A browser-saved download was **not independently verified** in this review.
- Captured desktop and 390px mobile dashboard screenshots; mobile document width was `390`, with no horizontal overflow in that surface. This is not complete visual/accessibility coverage of every page.
- Signed out; the financial dashboard API returned `401`.
- Ran `scripts/backup.py` against the live disposable database and `scripts/restore.py` into a separate recovery database. Both exited `0`; recovered revision was `0005_budgets`, sessions `0`, transaction `-8472`, budget `60000`, integrity `ok`. Actual-host permissions/durability and restored-cookie denial were not exercised in this review.
- Reproduced C1's account-path `500`, C2's pending-account draft reset and C3's account-confirmation focus failure. Sibling cases and C4/C5/C6 require targeted verification as documented above.

Disposable review data was removed and review services/browser were stopped. Screenshots were temporary; no retained screenshot bundle or new regression tests were produced. Documentation of this review does not rerun or upgrade its evidence.

### Previously recorded repository verification

[`state.md:18–25`](../state.md#L18) records backend **303 passed / 5 skipped**, frontend **77 tests / 13 files**, production build passed and full Playwright **16 passed**. Those suites were not rerun during the application review or this documentation update. Skipped platform guards, actual-host networking/TLS/scheduler/recovery and full release acceptance remain open.

This was a source/local-runtime review, not an external security assessment, production deployment or complete proof of every MVP acceptance criterion.
