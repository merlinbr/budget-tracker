# Luna — Milestone 4 Dashboard Handoff

## Assignment

Implement **Milestone 4 — Selected-Month Dashboard only**, end to end, following the focused plan below. The user reports M3 implemented and requested this M4 plan and handoff. Do not restart authentication, accounts/categories or transactions, and do not implement M5 budgets.

This is an implementation assignment, not evidence that M4 is complete. Earlier handoffs' instructions to wait before planning M4 are historical; this document is the current M4 handoff. Do not commit, push or deploy without separate authorization.

## Read First

1. `BUDGET_TRACKER_MVP_SPEC.md` — product source of truth; focus on §§7.7, 9–12, 14, 21, 22.2, 23, 25, 33, 35–39, 42–44.
2. `docs/superpowers/plans/2026-09-13-dashboard.md` — **read in full before editing**. Contains all three tasks, exact file map, Python/TypeScript response contracts, implementation examples, regression boundaries and acceptance gates.
3. `docs/superpowers/plans/2026-09-07-budget-tracker-mvp.md` — established reporting decisions and Task 4.1. The focused M4 plan supersedes its exclusive-next-month recipe with M3's inclusive first/last DATE bounds, supporting December 9999.
4. `README.md`, `state.md`, and the historical evidence in `docs/LUNA_HANDOFF.md` — actual commands, existing milestone results and remaining limitations.
5. The source/test integration points named in the focused plan. Re-read current files before editing; follow existing conventions instead of creating a second implementation.

The specification governs product requirements. The focused M4 plan defines this milestone's implementation contracts. Preserve earlier plans and `docs/LUNA_M3_HANDOFF.md`; do not treat historical M2/M3 assignments as current scope.

## Starting State

- Existing stack: Angular 22, RxJS, FastAPI, Pydantic, SQLAlchemy and SQLite. No new dependencies are needed.
- Revision `0004_transactions` supplies required persistence/indexes. **No M4 migration or schema-table change.**
- `/dashboard` already exists under the authenticated shell but currently contains identity-only content. Replace that page in place; retain route guards and sign-out.
- `state.md` records M3's final integrated results: 89 backend tests, 30 frontend tests, production build and 8 browser scenarios passed. These are historical recorded results, not fresh M4 verification.
- M3 transaction loading/failure **visual rendering remains unverified**. Preserve that distinction; M4 dashboard visual checks do not retroactively verify M3 screens.
- M4 planning checked paths, Python example syntax and financial arithmetic. Application execution remains required.

## Deliver All Three Tasks

| Task | Required result |
|---|---|
| 1 — Dashboard API | One authenticated, household-scoped `GET /api/dashboard`; exact summary, category spending and latest-ten monthly history; validation, isolation, archive, calendar and overflow regressions |
| 2 — Angular dashboard | Local-current-month default, native month selection and previous/next controls, four summary cards, spending/history lists, coherent request states, accessible desktop/phone layout and preserved authenticated identity |
| 3 — Integrated acceptance | Isolated real-backend browser households, exact financial oracles, visual loading/error/empty/ready checks, session-expiry recovery, integrated suites, focused security review and evidence-backed documentation |

Do not stop after API routes, passing unit tests or an unexercised screen. The focused plan's acceptance checklist defines completion.

## Non-Negotiable Contracts

### API and financial behavior

- `GET /api/dashboard?year=2026&month=9` requires both parameters. Year `1–9999`; month `1–12`. Invalid/missing values use the existing 422 error envelope; do not choose a server-local default.
- Derive household from `require_household`. Scope every aggregate and joined account/category name lookup; never accept browser-supplied ownership. Owner/member financial visibility is identical. Anonymous requests return 401 without financial fields.
- Response keys: `period`, `summary`, `budgets`, `spendingByCategory`, `recentTransactions`. Use the focused plan's exact item fields, aliases and types; do not expose ORM relationships, creator details or arbitrary model columns.
- Integer EUR cents throughout, bounded by `±9007199254740991`. Reuse `Cents`, `checked_cents` and the existing account balance query/response helpers. No floating aggregation, browser-calculated financial totals or duplicate money parser.
- **Current balance is all-time across non-archived accounts**, including initial balances and future-dated entries exactly like Accounts. Validate individual balances and their combined sum. Changing only the displayed month must not change balance.
- **Monthly activity includes archived accounts/categories.** Income is positive transaction sum; expenses are absolute negative sum; net is income minus expenses. Initial balances are not monthly activity.
- Use inclusive first/last calendar-date bounds with `monthrange`, as implemented by M3. No timezone conversion of transaction dates; December 9999 must work.
- Spending groups negative transactions by category ID/name, returns positive totals and sorts total descending then category ID ascending. Omit categories without spending.
- Recent transactions are at most ten **within the selected month**, ordered by transaction date, created-at and ID descending. Include date, description, category name, account name and signed amount. Archived references retain readable names.
- Empty activity gives zero monthly totals and empty lists, not necessarily zero balance. Income-only months can have recent rows without spending rows.
- Return `budgets: []` only. No budget widget, route, table, progress calculation or unavailable link in M4; M5 supplies these.
- Safe-integer or SQLite aggregate overflow returns 409 `CONFLICT` for the entire response. Do not round, emit partial cards, use SQLite `TOTAL()`/REAL, or catch unrelated DB exceptions as overflow. Filter unrelated households/archived balance accounts before aggregation.
- Fixed-query-count reporting: no all-history transaction download and no per-account/category transaction query loop.

### Frontend behavior

- Keep the existing `DashboardPage`, `/dashboard` route and protected shell. Move user/household identity into a compact shell header line rather than preserving the obsolete landing card.
- Remove the two auth E2E assertions tied to the old welcome heading. Preserve real login/restoration/logout/guard checks and verify restored user/household identity without pinning welcome copy.
- Default to the **browser's local current month** using existing `localToday`. Native labelled month input plus Previous month / Next month; supported range `0001-01` to `9999-12`, disabled endpoint navigation and associated invalid-input error.
- Keep month state page-local; use integer month arithmetic, not Date constructors that reinterpret years 0–99. No URL persistence or shared period store in M4.
- Use the existing RxJS `switchMap` / inner `catchError` / `startWith` / `takeUntilDestroyed` pattern and one loading/error/ready state. New requests hide old totals; stale responses cannot replace the selected period. Errors are not empty/zero results. Keep selection and provide explicit Retry.
- Existing interceptor owns 401 recovery. No automatic write replay, polling or automatic network retry.
- Render server totals with existing `formatMoney`; preserve exact cents and readable signs. Render names/descriptions as plain text and `YYYY-MM-DD` dates literally.
- Sorted spending list, not charts. Semantic controls, labels, visible focus, keyboard operation, readable non-color cues, wrapping and no document overflow at phone width.

## Files and Ownership

- **Backend:** Create `backend/app/dashboard.py` and `backend/tests/test_dashboard.py`; update `schemas.py`, `main.py`, and only the shared amount-overflow message in `money.py`. Preserve accounts/transactions behavior and models/migrations.
- **Frontend:** Update `frontend/src/app/features/dashboard/dashboard.page.ts`; add adjacent `dashboard.service.ts` and `dashboard.page.spec.ts`; update shared API models, shell identity and auth E2E expectations. Existing route configuration stays intact.
- **Integration:** Add `frontend/e2e/dashboard.spec.ts`; extend `backend/scripts/seed_e2e.py` and `frontend/playwright.config.ts` only for isolated dashboard identities. After runtime proof, update README, state and the active handoff.

Execute inline, or run backend/frontend owners concurrently against the fixed plan contract. One owner each for shared schemas, frontend types/shell and browser harness. Concurrent workers skip builds/tests/linters; validate centrally after edits settle. Inspect existing-symbol references with LSP where available before modifying their behavior. Record justified path adaptations; do not create parallel helpers or routes.

## Test Data Safety and Isolation

- Only existing migrated pytest temporary DBs and Playwright-owned temporary DBs. Never reset/downgrade `data/budget.db`, overwrite `.env`, alter deployment or commit fixed passwords.
- Existing E2E files share one household and leave activity behind. **Unique record names do not isolate dashboard totals.** Follow the plan's separate `e2e-dashboard-1280` and `e2e-dashboard-390` users/households.
- Generate `BUDGET_E2E_DASHBOARD_PASSWORD` once, preserve it through inherited environment values when Playwright evaluates config in workers, and pass it to the seed process as `E2E_DASHBOARD_PASSWORD`.
- The seed script uses the configured database; it does not itself enforce temporary-path ownership. Execute through the owned Playwright configuration with no real-database override.
- On browser retries, delete only that disposable dashboard household's transactions and archive its active accounts through real APIs with valid CSRF, then create uniquely named fixtures. Preserve other test households and original auth/expired-session seeds.

## Verification

Focused iteration, from the indicated directories:

```text
# backend
python -m pytest tests/test_dashboard.py tests/test_accounts.py tests/test_money.py tests/test_authorization.py -q

# frontend
npm test -- --watch=false --include=src/app/features/dashboard/dashboard.page.spec.ts
npx playwright test e2e/dashboard.spec.ts e2e/auth.spec.ts
```

Final integrated checks after edits settle:

```text
# backend
python -m pytest

# frontend
npm test -- --watch=false
npm run build
npx playwright test
```

No separate migration cycle is needed: M4 introduces no migration. Record actual outcomes/counts, not expected results copied from M3.

### Required financial oracle

In an isolated household: Checking initial `100000` cents; September 7 Salary `+350000`; September 7 Groceries `-8472`; October 1 Netflix `-1799`.

| Period/state | Balance | Income | Expenses | Net |
|---|---:|---:|---:|---:|
| September 2026 | 439729 | 350000 | 8472 | 341528 |
| October 2026 | 439729 | 0 | 1799 | -1799 |
| November 2026 | 439729 | 0 | 0 | 0 |
| September after Checking archive | 0 | 350000 | 8472 | 341528 |

Assert exact formatted browser values, including the formatter's nonbreaking space before EUR; scope assertions to the correct card. September history excludes Netflix, October includes exact date `2026-10-01`, and archive preserves monthly history/names.

Also prove:

- Two-household isolation, anonymous denial and same-household member visibility; foreign overflow does not poison another household's report.
- Empty household, initial-only balance, multiple accounts/categories without join multiplication, income-only month, archived resources, stable latest-ten/tie ordering, leap day/year rollover and year endpoints.
- Safe-cent endpoints, combined balance overflow, monthly overflow despite offsetting net, actual SQLite overflow and controlled 409 without partial data.
- Real browser at `1280×900` and `390×844`, with `Pacific/Kiritimati` and clock `2026-08-31T12:30:00Z`: selected default is September, not UTC August. Exercise keyboard navigation, rollover, reload default and fresh data after returning from another page.
- Inspect actual ready/empty/loading/error screenshots, wrapping and focus; DOM assertions alone are not visual verification. Wait for matching responses and ready state before absence assertions.
- For deterministic loading visuals, temporarily delay only a dashboard GET, capture loading, then continue to the real backend and remove interception. No synthetic financial response or write replay; report this accurately as delayed real-GET rendering.
- Offline month request shows a connection error without old/zero/empty financial data; restore network, Retry and confirm the same selected period. Expired valid session on a month request redirects to login and removes financial DOM.
- Literal HTML-looking names/descriptions remain text, with no script/dialog execution.
- Focused source/security review of household predicates, name joins, precision, calendar bounds, request races, auth cleanup and financial logging. Fix concrete in-scope findings and retain behavioral regressions.

## Completion and Stop Boundary

After runtime proof, remove throwaway artifacts and update README, `state.md` and `docs/LUNA_HANDOFF.md` with the actual M4 behavior, results and limitations. Preserve earlier milestone evidence and the historical M3 visual limitation; do not silently relabel it as verified.

Completion report must include:

1. Delivered API/UI behavior and actual changed paths or justified plan adaptations.
2. Actual focused/integrated command results, counts and warnings.
3. Financial, authorization/overflow and desktop/phone browser evidence; distinguish visual inspection from automated assertions.
4. Security findings/fixes and exact unverified gates, if any.
5. **User-review boundary before Milestone 5 — Monthly Budgets.**

Do not claim completion from a backend-only/UI-only subset or passing tests without the required browser evidence. If a gate is blocked, finish reachable work and name the exact missing prerequisite and unverified behavior.

Out of scope: budgets/progress, settings/CSV, deployment/backups/restore/network release gates, transfers/imports/recurrence, charts, global state, new dependencies and unrelated hardening. **Stop after verified M4; do not claim full MVP or production readiness.**
