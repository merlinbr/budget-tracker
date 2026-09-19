# Luna — Milestone 5 Monthly Budgets Handoff

## Current Assignment

**Milestone 5 — Monthly Budgets is implemented and verified.** Read `docs/LUNA_M5_HANDOFF.md`, then the complete `docs/superpowers/plans/2026-09-14-monthly-budgets.md`. All three M5 tasks and their verification gates are complete; the verified evidence is recorded in `README.md`, `state.md`, and the M5 sections below. Stop before M6 settings/export/operations and request user review — M5 remains implemented-subject-to-review, and this handoff still does not authorize M6 work, pushes, or deployment.

All M5 work is committed in a single milestone commit (`feat: implement Milestone 5 monthly budgets`), authorized by the user's explicit instruction during the implementation session. Your working tree should be clean at that boundary; any further edits continue to require separate authorization for commits.

The material below preserves historical M4/M3/M2 completion evidence, not the current assignment. Earlier instructions to stop before M5 and keep dashboard `budgets` empty describe the historical M4 boundary; M5 supersedes them and fills that section with real budgets.

## M5 Completion Evidence

- Backend: added `backend/app/budgets.py` (`GET /api/budgets`, `PUT/DELETE /api/budgets/{category_id}`, `POST /api/budgets/copy-previous`; `BEGIN IMMEDIATE` writes that validate responses before commit and roll back on any exception, including SQLite aggregate overflow → 409), migration `0005_budgets` (household-scoped `budgets` table, unique `(household_id, category_id, year, month)`, year/month/limit checks), `Budget`/`BudgetWrite`/`BudgetCopyRequest`/`BudgetResponse` models and schemas, and dashboard integration via `budget_rows` inside the existing single `BEGIN` snapshot.
- Frontend: `budgets.service.ts`, `budget-usage.ts`, guarded `/budgets` page with set/edit/remove and copy-previous confirmation, `Budget` interface in `core/api/models.ts`, dashboard `budgets` section rendering real rows, and `/budgets` navigation entry in the app shell.
- E2E: `frontend/e2e/budgets.spec.ts` runs the full lifecycle and copy-previous confirmation against the real backend at `1280×900` and `390×844` with isolated `e2e-budgets-1280`/`e2e-budgets-390` households; `backend/scripts/seed_e2e.py` seeds them via a generated `BUDGET_E2E_BUDGETS_PASSWORD` (never committed).
- Focused backend `cd backend && python -m pytest tests/test_budgets.py tests/test_dashboard.py tests/test_authorization.py -p no:warnings` — **131 passed** (`tests/test_budgets.py` covers zero/empty/exact limits, spent scoping/sign/calendar injection, ownership isolation, archived-category rules, concurrent unique-key upserts, migrated raw-constraint enforcement, atomic copy semantics, and overflow rollback paths).
- Focused frontend `npm test -- --watch=false --include=...budgets.page.spec.ts --include=...dashboard.page.spec.ts` — **22 passed (2 files)**; focused browser `npx playwright test e2e/budgets.spec.ts` — **2 passed**.
- Final integrated runs: backend `pytest -p no:warnings` — **211 passed**; frontend `npm test -- --watch=false` — **12 test files / 52 tests**; `npm run build` — passed; `npx playwright test` — **12 passed** at both widths.
- Disposable migration cycle on temporary SQLite URLs: M4 rows survived `0004 → 0005` unchanged; a temporararily real-hashed seeded identity authenticated, dashboard returned expenses `8472`/balance `91528`/empty `budgets`, `PUT` limit `60000` returned `remaining 51528`; downgrade removed `budgets` with M4 data intact; re-upgrade emptied budgets and kept totals; a separate empty database reached head `0005_budgets`.
- Focused M5 security review found no confirmed vulnerability in household predicates (`require_household` everywhere), CSRF coverage (global `csrf_guard` dependency), validate-before-commit atomic writes, or financial logging; `backend/app/budgets.py` has no logger/print calls.
- Limitation: browser scenarios assert rendered values, loading/error states and screenshots at both widths, but pixel-level human visual inspection was not performed in this environment (same standing limitation as M3/M4).

## Historical M4 Completion Evidence

- Backend: added `backend/app/dashboard.py` (one authenticated, household-scoped `GET /api/dashboard`), dashboard response schemas in `schemas.py`, router registration in `main.py`, and generalized the shared `checked_cents` overflow message to `The calculated amount exceeds the supported range.` (account-specific SQL-overflow wording unchanged). No migration or schema-table change.
- Frontend: added `dashboard.service.ts` and `dashboard.page.spec.ts`; replaced the identity-only `dashboard.page.ts` with a local-month default, native labelled month input, Previous/Next controls, four summary cards, sorted spending and recent lists, and one loading/error/ready state; moved user/household identity into the shell header; removed the two obsolete `Welcome, E2E User` assertions from `e2e/auth.spec.ts`.
- Integration: extended `backend/scripts/seed_e2e.py` with isolated `e2e-dashboard-1280`/`e2e-dashboard-390` identities and `frontend/playwright.config.ts` with a generated `BUDGET_E2E_DASHBOARD_PASSWORD`; added `frontend/e2e/dashboard.spec.ts`.
- Focused backend `cd backend && python -m pytest tests/test_dashboard.py tests/test_accounts.py tests/test_money.py tests/test_authorization.py -q`: **45 passed**.
- Focused frontend `cd frontend && npm test -- --watch=false --include=src/app/features/dashboard/dashboard.page.spec.ts`: **6 passed**; `npm run build`: **passed**.
- Focused browser `cd frontend && npx playwright test e2e/dashboard.spec.ts e2e/auth.spec.ts`: **4 passed** at `1280×900` and `390×844` with isolated households, `Pacific/Kiritimati`, and frontend clock `2026-08-31T12:30:00Z`. Verified the local-September default (UTC still August), the exact rendered oracle (September `4.397,29 €` balance / `3.500,00 €` income / `84,72 €` expenses / `3.415,28 €` net; October `-17,99 €` net and exact `2026-10-01`; November empty lists; archived-account balance `0,00 €` with preserved history), December/January rollover, keyboard month navigation, a nondefault-selection reload resetting to the local month, delayed real-GET loading, offline failure with Retry asserting a ready summary, expired-session redirect, and literal HTML-looking description with no script execution.
- Final integrated checks: `cd backend && python -m pytest` — **117 passed**; `cd frontend && npm test -- --watch=false` — **11 test files / 36 tests passed**; `npm run build` — **passed**; `npx playwright test` — **10 passed** at `1280×900` and `390×844`.
- Review corrections: `GET /api/dashboard` now opens one explicit SQLite read transaction (`BEGIN`) so its four queries share a single WAL snapshot; a concurrent-write regression fails without it and passes with it. Added an income-only month case and a genuine equal-spending category-ID tie-break; fixed a calendar-dependent frontend test and strengthened the e2e reload/Retry checks.
- Focused M4 security review found no confirmed vulnerability in household predicates, joined name lookups, integer-cent precision, calendar bounds, request cancellation, 401 cleanup, or financial logging; `backend/app/dashboard.py` has no logger/print calls.
- Limitation: M4 ready, loading, empty and error screenshots were captured at both widths and the automated no-document-overflow and card-content assertions passed, but pixel-level visual inspection was not performed in this environment. The M3 browser list loading/failure visual limitation also remains unchanged. Deployment, network, backup/restore, and production-readiness gates remain unverified.

## Historical M3 Focused Completion Evidence

- Real-backend Playwright command: `cd frontend && npx playwright test e2e/transactions.spec.ts` — **2 passed** at `1280×900` and `390×844`, with generated credentials, `Pacific/Kiritimati`, and frontend clock `2026-09-06T12:30:00Z`. The workflow explicitly submitted September `2026-09`, asserted a ready state before saving and before the September-hidden Netflix assertion, entered Salary/Groceries on exact `2026-09-07` dates and Netflix at `2026-08-30`, asserted the rendered Salary row's exact positive locale amount `3.500,00 €` before later filters/deletion, verified Netflix as exact expense `-17,99 €` after clearing month/account filters, verified keyboard amount entry/validation (`0` stayed visible, focused, and invalid; then the amount was replaced and the expense save completed), corrected archived Groceries to `2026-08-31`, cancelled then confirmed deletion, performed a real `page.reload()` persistence check, verified `4.410,00 €`/raw `441000`, separately exercised expired-session save redirect, navigated to `/transactions` before shell logout, and verified browser-back/direct deep-link denial without financial content.
- Disposable migration/API command: with an explicitly temporary `TemporaryDirectory` SQLite URL, the checker printed `before_cycle_0003 initial_balance=-8472 balance=-8472`, `upgrade_to_head=0004_transactions transactions_table_present=True`, `after_0004_upgrade initialBalance=-8472 balance=-8472 transactions_table_present=True`, `post_upgrade_transaction=created_and_read amount=-1000`, `after_transaction initialBalance=-8472 balance=-9472`, `after_0003_downgrade m2_records_preserved=True transactions_table_present=False initial_balance=-8472 balance=-8472`, and `after_0004_reupgrade m2_records_preserved=True transactions_table_present=True initial_balance=-8472 balance=-8472`. M2 household/account/category rows remained preserved through downgrade and final re-upgrade.
- Focused M3 security review found no confirmed issue across household predicates, creator immutability, archive/reference checks, sign/cents/date validation, literal search parameterization, explicit response fields, text rendering, CSRF/401 flow, or private-data logging. `backend/app/transactions.py` has no logger/print calls; `backend/app/errors.py:98-100` logs only HTTP method and URL path for unhandled errors, not request bodies, amounts, or descriptions. This was a focused source review, not external penetration testing.
- Real-browser failure preservation is verified without mocks: context-offline save showed the connection alert with the form and amount retained and no success; invalid `XSRF-TOKEN` produced the actual 403 alert with the same preservation; `/api/auth/csrf` refreshed the token before canceling, and unique failed-save descriptions were absent from filtered history. Browser loading/failure visual rendering remains unverified. No unsafe request replay was used. Final integrated backend/frontend suites, build, and full Playwright run passed; deployment, network, backup/restore, and production-readiness gates remain unverified.

## Historical M3 User-Review Boundary

The previous handoff requested user review before M4. The user has since requested and received the M4 plan, handoff and implementation; see the M4 Completion Evidence above. The recorded M3 browser loading/failure visual limitation remains unchanged. M5 budgets and production readiness remain incomplete.

## Historical M2 Record
## Read First

1. `BUDGET_TRACKER_MVP_SPEC.md` — source of truth; focus on §§5, 7.7, 9–11, 16–17, 21–25, 33, 35, 37–43 and M2 in §44.
2. `docs/superpowers/plans/2026-09-08-accounts-categories.md` — complete five-task M2 plan, fixed API/helper contracts, exact file map, implementation examples, verification matrix and completion gates. Read in full before editing.
3. `docs/superpowers/plans/2026-09-07-budget-tracker-mvp.md` — existing gap decisions and Task 2.1; the focused plan expands that task.
4. `README.md`, `state.md` and the existing M1 source/tests — actual runtime commands, auth/CSRF/session behavior, fixtures, form conventions and migration parent `0002_identity`.
5. `docs/superpowers/plans/2026-09-07-transactions.md` §1 required M2 contracts — compatibility context only, not authorization to implement M3.

The current user correction supersedes historical claims that M2 was already complete. Reuse existing code/conventions and follow the MVP on mandatory product requirements. Record any justified path adaptations instead of creating duplicate helpers.

## Preserve Milestone 3

- **Do not overwrite or edit** `docs/superpowers/plans/2026-09-07-transactions.md` during M2 implementation.
- The previous active M3 handoff is preserved unchanged as `docs/LUNA_M3_HANDOFF.md`. Leave it intact too.
- Both M3 documents describe future work after completed M2. Their old starting-state assumption is historical, not the current assignment.
- After verified M2, request user review before activating the preserved M3 work. Do not silently execute it.

## Deliver All Five Tasks

| Task | Required result |
|---|---|
| 1 — Household-scoped APIs | Account/category models, `0003_accounts_categories`, strict schemas, list/detail/create/update/archive APIs, exact initial balances and real two-household authorization tests |
| 2 — Optional bootstrap defaults | Exact §41 seed set accepted/declined through existing `init-household`, atomic with household/owner creation, no retroactive seeding |
| 3 — Exact money utilities | Safe signed initial-balance parsing, unsigned parsing compatible with M3, precise edit/display through both safe-integer endpoints |
| 4 — Angular management | Guarded account/category pages; shared navigation/logout; create/edit/archive, warnings, confirmation, accessible phone/desktop forms and reliable failure states |
| 5 — Integrated acceptance | Real-backend browser lifecycle, M1-data migration preservation, actual CLI prompt exercise, focused security review and evidence-backed status updates |

Do not stop after models, routes, unit tests or an unexercised screen. The complete plan's acceptance checklist defines completion.

## Non-Negotiable Contracts

- Existing stack/dependencies only. Direct feature routers/services; no generic CRUD framework, state library, repository layer or new money package.
- Every resource query/lookup/write is scoped by `require_household`. Server derives ownership; owner/member financial permissions are identical. Unknown/foreign ID is the same generic 404.
- Account types: `checking`, `savings`, `cash`, `credit_card`, `other`. Category types: `income`, `expense`; category PUT accepts name only, so type remains immutable.
- Trim names, 1–100 Unicode code points. Case-sensitive exact trimmed uniqueness: account per household; category per household/type. Archived names remain reserved. Duplicate create/rename is 409 with a name field error.
- Initial balance is strict signed integer cents in `[-9007199254740991, 9007199254740991]`; zero allowed. Reject booleans, floats, numeric strings, null and overflow. Currency is EUR.
- `Account` JSON: `id`, `name`, `type`, `initialBalance`, `balance`, `isArchived`. `Category`: `id`, `name`, `type`, `isArchived`. No exposed/writable household ownership or arbitrary ORM serialization.
- Lists return arrays, active by default; `includeArchived=true` includes retained archives. Detail can read archives. Owned archived resources are read-only through PUT (409).
- Use idempotent `POST /api/accounts/{id}/archive` and category equivalent, returning 204. **No DELETE/unarchive endpoints**, hard deletion or archive body field.
- Create returns 201; GET/PUT 200; validation 422; uniqueness/read-only conflict 409. Preserve existing error envelope, global Origin/CSRF checks and Angular 401 handling.
- Account balance is initially initial balance, returned through one response helper. Do not store a second balance column or build transaction aggregation before M3.
- Decimal input is parsed from digit components, never `parseFloat * 100`. Keep M3-compatible unsigned `parseMoney`/absolute `moneyInput`; signed account entry uses separate small wrappers.
- Initial-balance edits show a clear warning and require acknowledgement when the value changes. Preserve form values after failed writes; successful save followed by failed refresh is not a failed save or a reason to replay POST.
- Archive requires an accessible confirmation; cancellation sends nothing, failure keeps the row. Failed list loading is not an empty list. Render all resource names as plain text.
- Optional seeds belong only to new bootstrap, in the existing single transaction. No migration/startup seeding, default accounts, existing-household mutation or extra seed command.

## Verification and Data Safety

Use existing migrated disposable test fixtures and the Playwright-owned temporary database/generated credentials. Never downgrade/reset real `data/budget.db`, overwrite `.env`, alter production deployment or commit fixed E2E credentials.

After edits settle:

```text
# backend
python -m pytest

# frontend
npm test -- --watch=false
npm run build
npx playwright test
```

Also prove:

- Two independent authenticated households cannot list/read/edit/archive each other's records, including archived-list branches and forged ownership payloads. Same-household member writes succeed. Rejected requests leave data unchanged.
- Safe-cent boundaries, signed/zero balances, exact decimal round trips/display, enum/name/uniqueness boundaries, immutable category type, archive idempotency and retained rows.
- Disposable M1-data upgrade to `0003_accounts_categories` preserves identity/membership/session behavior; a separate disposable downgrade/re-upgrade preserves M1 identities. Downgrade intentionally removes M2 tables/data; never claim otherwise.
- Real `init-household` prompt with defaults accepted and declined; rollback on actual seed uniqueness failure; no defaults automatically added to existing households.
- Real browser at 1280×900 and 390×844: login → create account/category → rename/type or warned balance edit → cancel/confirm archive → show archived → refresh → logout → financial deep-link denial. Include keyboard amount entry/validation, labelled errors, failed-save preservation and readable exact amounts.
- Focused authorization/security review, concrete findings fixed and reproductions rerun. Passing suites alone is not the review.

If runtime tooling is unavailable, finish reachable work and report the exact unverified gate. Do not claim complete implementation without evidence.

## Historical M2 Execution Record

Execute inline unless a backend owner (Tasks 1–2) and frontend owner (Tasks 3–4) genuinely run concurrently against the plan's fixed contracts. Shared models/schemas/migrations/routes have one owner each. Concurrent workers skip builds/tests/linters; validate centrally after edits settle.

Focused runtime proof is complete. `README.md`, `state.md`, and this active handoff now record the actual behavior, exact command counts, migration/API/browser evidence, security result including the verified logger/source review, and remaining unverified later-release work. The temporary migration script/database and browser-run artifacts were removed. Do not commit, push or deploy without separate authorization.

Historical M2 scope excluded transactions/aggregates, M4 analytics, M5 budgets, M6 export/settings/operations/release, transfers/imports/recurrence, icons/colors, unarchive, pagination, public registration and production-readiness claims. Current M3 scope stops before M4 dashboard, budgets, export/settings, deployment, backups, restore, and production-readiness work.

**Historical boundary:** Milestone 2 was previously verified. The current boundary is focused M3 evidence plus the final integrated commands and user review before M4; M4 and production readiness remain incomplete.
