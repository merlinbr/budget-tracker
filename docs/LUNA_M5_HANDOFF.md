# Luna — Milestone 5 Monthly Budgets Handoff

## Assignment and Authorization

This is the implementation handoff for **Milestone 5 — Monthly Budgets only**, following the focused plan below. The user requested the M5 plan and this handoff; the plan and handoff were refreshed on **2026-09-18** against the current application. No M5 application implementation or M5 acceptance verification has been performed.

When the user initiates implementation, deliver all three tasks end to end. Do not restart authentication, accounts/categories, transactions or the M4 dashboard. Earlier handoffs' M4-only scope and empty-budget instructions are historical; M5 now owns budget persistence, editing and dashboard progress.

The focused plan remains subject to user review before implementation. This document does not independently authorize implementation, commits, pushes or deployment. Do not claim that M5, the full MVP or production readiness is complete.

## Read First

1. `BUDGET_TRACKER_MVP_SPEC.md` — product source of truth; focus on §§7.7, 9, 11–14, 18, 21, 22.6, 23–25, 35–39, 42–44.
2. `docs/superpowers/plans/2026-09-14-monthly-budgets.md` — **read in full before editing**. Contains all three tasks, exact file map, Python/TypeScript contracts, implementation examples, boundary tests and acceptance gates.
3. `docs/superpowers/plans/2026-09-07-budget-tracker-mvp.md` — established budget decisions and Task 5.1. The focused M5 plan resolves default copy as an atomic conflict, not a partial copy or silent skip.
4. `README.md`, `state.md`, and the M4 completion evidence in `docs/LUNA_HANDOFF.md` — existing commands, recorded results and remaining limitations.
5. Source/test integration points named in the focused plan. Re-read current files before editing; follow existing conventions rather than building parallel implementations.

The product specification governs requirements; the focused plan fixes this milestone's implementation contracts. This handoff is an execution guide, not a replacement plan. Preserve prior plans and `docs/LUNA_M3_HANDOFF.md` / `docs/LUNA_M4_HANDOFF.md`.

## Starting State

- M4 is recorded as implemented at commit `4681f93`. The dashboard already shows selected-month totals, spending and recent transactions, with all-time active-account balance.
- Current migration head is `0004_transactions`. M5 adds **`0005_budgets`**; do not modify historical migrations or rebuild existing tables.
- Dashboard currently has an intentionally empty budgets response contract. Replace backend `list[dict[str, object]]` constrained to empty and frontend `never[]` with the plan's real budget types.
- Dashboard opens an explicit SQLite `BEGIN` so all reporting queries share one WAL snapshot. Budget reporting must use that same session/transaction.
- Existing stack: Angular 22, RxJS, FastAPI, Pydantic, SQLAlchemy, SQLite and Alembic. No new dependencies are needed.
- Fresh M4 baseline from the app assessment immediately before the planning refresh: **117 backend tests passed (111 deprecation warnings)**, **36 frontend tests across 11 files passed**, production build passed, and **10 browser scenarios passed**. These are M4 results, not M5 evidence.
- M3 browser list loading/failure visual rendering remains unverified. Fresh M4 dashboard ready-state screenshots were inspected at desktop and phone widths without obvious clipping; this does not establish visual review of its other states. Preserve these precise qualifications.
- Plan refresh checked referenced source contracts and all eight Python examples parsed successfully. A disposable SQLite probe using the current database configuration confirmed SELECT → `BEGIN IMMEDIATE` → rollback. Budget behavior, concurrency and security still require implementation and their own runtime proof.

## Deliver All Three Tasks

| Task | Required result |
|---|---|
| 1 — Persistence, API and reporting | Budgets model/migration, household-scoped list/upsert/delete/copy, exact-cent usage, atomic overwrite behavior, populated dashboard budgets and money/security/snapshot regressions |
| 2 — Angular editor and overview | Protected `/budgets` route, every active expense category, month selection, explicit save/remove/copy confirmation, shared usage presentation, coherent request states and preserved pending-write protection |
| 3 — Integrated acceptance | Isolated real-backend browser households, desktop/phone workflows, migration-cycle proof, focused security review, final suites/build and evidence-backed documentation |

Default execution order is Task 1 → Task 2 → Task 3 inline. Backend/frontend may instead run concurrently against the plan's fixed JSON contract with disjoint file ownership and no validation while edits are in flight; Task 3 follows integration. The plan's execution-checkpoint table defines each gate.

Do not stop after persistence, API routes, passing unit tests or an unexercised page. The full focused-plan acceptance checklist defines completion.

## Non-Negotiable Contracts

### API and persistence

- Resource identity is authenticated household/category/year/month. Internal budget ID/timestamps are stored, not exposed as route identity.
- `GET /api/budgets?year=2026&month=9` returns configured budgets only, ordered by category name then ID, including archived-category history. No budget means no row, not a fabricated zero limit.
- `PUT /api/budgets/{categoryId}?year=2026&month=9` accepts `{ "limitAmount": 60000 }`; create and replace both return 200 with the updated budget and usage. Repeated/concurrent upserts leave one row.
- `DELETE /api/budgets/{categoryId}?year=2026&month=9` returns 204 for removal; missing/foreign budget gives the same generic 404. Never delete transactions or the category when removing a limit.
- `POST /api/budgets/copy-previous` accepts `{ "year": 2026, "month": 9, "overwrite": false }` and returns the full target-month budget array on success. The backend defaults omitted `overwrite` to false.
- Year is `1–9999`, month `1–12`; required explicit query periods, strict bodies and no browser-supplied household identity. Reject extra fields, coercible non-integer money, negative limits and values beyond safe cents.
- Unique household/category/year/month constraint; foreign keys and database checks for integer/range limits and valid period. The API must independently enforce same-household expense-category references.
- Derive scope from `require_household`; owner/member permissions remain identical. Reuse global CSRF protection, error envelopes, 401 recovery and generic foreign/missing 404 behavior.
- Explicit budget response fields: `categoryId`, `categoryName`, `isArchived`, `year`, `month`, `limitAmount`, `spent`, `remaining`, `progress`. No ownership/creator/ORM data leakage.

### Financial rules and transaction ownership

- Integer EUR cents bounded by `±9007199254740991`. Reuse `Cents`, `checked_cents`, `parseMoney`, `moneyInput`, `formatMoney` and `localToday`.
- Only expense categories may have budgets. Zero is valid; negative limits are invalid.
- `spent` is the magnitude of selected-month negative transaction sums for that household/category, including archived accounts/categories. No positive amounts, initial balances, carryover or all-time spending.
- Use inclusive first/last calendar-date bounds; leap years and December 9999 must work without timestamp conversion.
- `remaining = limitAmount - spent`. `progress = spent / limitAmount` only for positive limits; zero limit returns `null`. Ratio is dimensionless, finite and unclamped above 1; it is not a monetary value.
- One concrete `budget_rows(db, household_id, year, month, *, category_id=None)` query supplies list/upsert/copy responses and Dashboard. No transaction downloads, per-category reporting query loop or second financial calculation in Angular.
- The reporting helper never begins/commits/rolls back a transaction. Dashboard owns its existing read snapshot; do not introduce a nested transaction or new session.
- PUT/DELETE/copy acquire `BEGIN IMMEDIATE` before financial lookup/validation, following the plan's current pysqlite behavior, to keep archive/upsert/copy decisions atomic. Re-read transaction assumptions if the database/auth code changes before implementation.
- Calculate and validate PUT/copy response **before commit**; any failure rolls back the entire mutation. Do not return an error after silently persisting a limit.
- Translate genuine SQLite aggregate overflow and safe-integer overflow to 409 `CONFLICT`; never use REAL/`TOTAL()`, round money, return partial data or mask unrelated DB exceptions.
- DELETE does not require usage calculation: an overflowing budget remains removable.

### Archive and copy behavior

- Existing archived-category budgets remain readable, editable and removable for historical correction. Creating a missing budget for an archived category returns 409.
- Copy source is previous-month configured budgets for currently active expense categories in the authenticated household. Never copy/change archived-category budgets.
- **Default copy is all-or-nothing:** any overlap with eligible target categories returns 409 and writes nothing, including otherwise-missing categories. No silent skips or partial merge.
- Only copy-collision 409 carries `error.fields.overwrite`. The frontend must not turn other 409s, such as overflow, into overwrite prompts.
- Confirmed `overwrite: true` atomically replaces matching eligible limits and inserts missing ones. Preserve target-only and archived target budgets. Copy limits only, never source spending/remaining/IDs/timestamps.
- Re-read source/target in the confirmed transaction; do not trust a stale browser preview. Cancel makes no request.
- January copies December of the previous year. At `0001-01`, UI disables Copy and API returns 422. Empty source is a successful no-op returning the current target list.

### Frontend and accessibility

- `/budgets` uses existing auth/pending guards and shell navigation. No global period store, batch-save endpoint, chart library or new state framework.
- Show all active expense categories, even without a budget; union in configured archived history. Merge/track by category ID, never category name. Income categories are absent.
- Browser-local current month on entry. Native labelled month input and Previous/Next controls, bounded by `0001-01` / `9999-12`; no Date-constructor year-0–99 reinterpretation.
- One inline editor at a time. Existing limit uses exact `moneyInput` prefill; missing limit is blank. Save/Cancel closes the editor; month changes, other editors and copy are disabled while it is open.
- Text input with decimal keyboard and exact `parseMoney`; zero saves a budget, blank is invalid, and explicit Remove is the only deletion action. Associate errors with the labelled field; preserve values after failed saves.
- During writes, synchronously set `PendingFormService`; block duplicate actions, local month changes/cancel, navigation and sign-out. Clear pending on success/error. Preserve interceptor-owned session-expiry recovery; never automatically replay writes.
- Removal and overwrite use focused inline confirmations and cancellation/focus restoration. Keep the captured selected month/category stable throughout an operation.
- Successful mutation announces success then reloads. If refresh fails, preserve the success message and explain that only refresh failed; Retry does GETs, never repeats the write.
- Read requests use the existing latest-request-wins pattern. Categories and budgets must both load successfully before editing; loading/error never presents old-month cards or false No budget states.
- Use one `BudgetUsageComponent` in Budgets and Dashboard. Native `Intl.NumberFormat` formats the server-provided ratio; no Angular locale registration or client money calculation is needed.
- Dashboard displays **every configured selected-month budget**, including zero limits, no-spending categories and archived history, through its existing GET. Do not add a separate budget fetch or weaken the existing snapshot/summary contracts.
- Missing: No budget. Zero/no spending: explicit zero state. Zero/with spending: exact overage and Over budget, no percentage. Positive over-limit: percentage above 100%, exact overage and Over budget. At-limit: At budget.
- Status must not rely on color. Preserve semantic controls, readable amounts, keyboard operation, associated errors, visible focus, responsive wrapping and plain-text rendering of names.

## Files and Ownership

- **Backend owner:** Create `backend/app/budgets.py`, `backend/tests/test_budgets.py` and `backend/migrations/versions/0005_budgets.py`; modify existing models, schemas, router registration, dashboard and its tests. Preserve unrelated financial/auth behavior.
- **Frontend owner:** Create `frontend/src/app/features/budgets/budgets.service.ts`, `budgets.page.ts`, `budgets.page.spec.ts` and `budget-usage.ts`; update shared API types, routes, shell and dashboard page/tests.
- **Integration owner:** Create `frontend/e2e/budgets.spec.ts`; extend seed/config only for isolated budget identities. After runtime proof, update README, state and the active handoff.

Execute inline, or run backend/frontend owners concurrently against the focused plan's fixed JSON contract, followed by integration. One owner per shared file. Concurrent workers skip formatters, linters, builds and tests; validate centrally once edits settle. Inspect exported-symbol references with LSP where available before changing behavior. Record necessary plan adaptations, not speculative rewrites.

## Test Data Safety

- Use existing migrated temporary pytest databases and Playwright-owned temporary directories/generated credentials. Never reset/downgrade real `data/budget.db`, overwrite `.env`, change deployment or use a real-database environment override.
- Budget E2E identities are `e2e-budgets-1280` and `e2e-budgets-390`, each with its own household. Unique record names do not isolate totals; do not reuse M4 dashboard households.
- Generate `BUDGET_E2E_BUDGETS_PASSWORD` using the existing harness pattern, preserve it through worker environment inheritance, and pass it to the seed process as `E2E_BUDGETS_PASSWORD`.
- The seed script trusts its configured database. Invoke it only through the disposable harness; do not seed the normal development DB.
- On retries, clean only that scenario household's budgets for exercised months and its transactions, archive its active accounts/categories through authenticated CSRF-protected APIs, then use unique names. Preserve other households and existing auth/expired-session fixtures.
- Keep teardown ownership-marker checks. No global reset endpoint or fixed credentials.

## Verification

Focused checks from the indicated directories, after the corresponding edits settle:

```text
# backend
python -m pytest tests/test_budgets.py tests/test_dashboard.py tests/test_authorization.py -q

# frontend
npm test -- --watch=false --include=src/app/features/budgets/budgets.page.spec.ts --include=src/app/features/dashboard/dashboard.page.spec.ts
npm run build
npx playwright test e2e/budgets.spec.ts e2e/dashboard.spec.ts e2e/auth.spec.ts
```

Final integrated checks once the full tree is stable:

```text
# backend
python -m pytest

# frontend
npm test -- --watch=false
npm run build
npx playwright test
```

Record actual outcomes, counts and warnings. Do not copy M4 results as M5 evidence or claim syntax checks prove runtime behavior.

### Required financial and copy oracles

For Groceries spending `8472` cents in the selected month:

| Limit | Spent | Remaining | Progress | Required state |
|---:|---:|---:|---:|---|
| 60000 | 8472 | 51528 | 0.1412 | Remaining; 14.12% before locale formatting |
| 8000 | 8472 | -472 | 1.059 | Over budget by 472; 105.9% |
| 0 | 8472 | -8472 | null | Over budget by 8472; no ratio |
| No configured budget | Not a budget row | Not a budget row | Not a budget row | No budget; transactions still exist |

Also prove positive/no-spending, zero/no-spending and exact-at-limit states. Browser assertions must check exact formatted EUR values and textual status within the correct category card, allowing the existing locale's nonbreaking spaces.

Copy oracle: previous month A=60000/B=20000; target A=8000/C=30000. Default request returns 409 with A unchanged, B absent and C unchanged. Cancel does nothing. Confirmed overwrite produces A=60000/B=20000/C=30000 and target-month spending, preserving target-only/archived budgets. January rollover and source archive exclusion must be exercised.

### Required boundary evidence

- Anonymous denial, CSRF rejection, two-household isolation and owner/member parity across list/upsert/delete/copy and dashboard reporting.
- Income/foreign category rejection; strict body/period validation; integer/range and uniqueness constraints on the migrated database; same-key concurrent upsert without duplicates.
- Exact month boundaries, leap day, December 9999, multi-account spending without multiplication, retained archived history and current category names.
- Safe-cent and actual SQLite aggregate overflow; unrelated household/month/unbudgeted-category overflow cannot poison the budget list; failed PUT/copy rolls back and DELETE remains possible.
- Default-copy conflict writes nothing, confirmed overwrite is atomic, no-source/zero-limit copy works, minimum year rejects and target-only budgets survive.
- Extend the existing real concurrent-write dashboard test with a configured limit: first response's budget usage sees the original transaction amount along with the other sections; follow-up sees the committed amount. Do not replace real snapshot proof with source-string assertions.
- Real browser at `1280×900` and `390×844`, `Pacific/Kiritimati`, clock `2026-08-31T12:30:00Z`: local default is September, not UTC August.
- UI account/category/expense → set budget → Dashboard progress → edit/zero/remove → copy conflict/cancel/confirm → reload persistence → logout/guarded route. Include expired-session recovery during a budget request.
- Keyboard submission/confirmation, delayed real-write pending guards, delayed real-GET loading, offline failure and successful same-month Retry. Synchronize on actual responses and visible ready values, not sleeps or spinner disappearance alone.
- Inspect actual desktop/phone ready/zero/over-budget/empty/loading/error surfaces and confirmations. Screenshot capture or no-overflow assertions alone are not pixel-level visual inspection; state any unavailable visual check precisely.
- Focused security review of household predicates, reference validation, CSRF, archive/write races, atomic copy, error rollback and financial logging. Fix concrete in-scope findings and retain meaningful regressions.

### Disposable migration cycle

Use a throwaway script and `TemporaryDirectory`, setting its SQLite `DATABASE_URL` before app imports. Execute Alembic via its API, never against the normal development database.

1. Upgrade to `0004_transactions`; seed household/user/account/category plus initial balance `100000` and selected-month expense `-8472`. Use direct exact SQL to record balance `91528`, expenses `8472` and seeded IDs/counts.
2. Upgrade to `0005_budgets`; verify prior data unchanged, authenticate with the M5 application, check baseline totals, create limit `60000` through the API and verify remaining `51528`.
3. Close application sessions/connections, downgrade only to `0004_transactions`, and use direct SQL to verify budgets table removal with all M4 rows/exact totals preserved.
4. Re-upgrade to `0005_budgets`; verify empty budgets table and unchanged M4 data, then reopen the application and check Dashboard totals and empty budgets. Separately prove empty database to head.
5. Record actual revision/table/value output, then remove only the throwaway artifacts.

Do not run the M5 Dashboard against `0004_transactions`, before the first upgrade or after downgrade: it now requires the budgets table. Use direct exact SQL at either historical-schema stage; API checks belong at `0005_budgets`. Downgrade intentionally discards M5 budget rows, not M4 data; this is not a production rollback or backup procedure.

## Completion and Stop Boundary

After runtime proof, update `README.md`, `state.md` and `docs/LUNA_HANDOFF.md` with actual M5 behavior, migration head, commands/results and limitations. Preserve historical evidence and prior milestone handoffs/plans; do not silently relabel M3/M4 visual limitations as resolved.

Completion report must include:

1. Delivered API/UI behavior and actual changed paths or justified plan adaptations.
2. Focused/integrated command results, counts and warnings.
3. Exact financial/copy/authorization/overflow/snapshot evidence and migration-cycle output.
4. Desktop/phone workflow and visual evidence, explicitly distinguishing visual inspection from automated assertions.
5. Security findings/fixes and exact unverified gates, if any.
6. **User-review boundary before Milestone 6 — Settings, Export and Operations.**

Do not claim completion from a backend-only/UI-only subset. If a gate is blocked, finish reachable work and name the missing prerequisite and unverified behavior. Remove throwaway artifacts, not permanent regressions or unrelated user work.

Out of scope: settings/CSV, deployment/backups/restore/network release gates, transfers/imports/recurrence, rollover budgeting, templates, bulk-save/state/chart frameworks, new dependencies and unrelated hardening. **Stop after verified M5; do not claim full MVP or production readiness.**
