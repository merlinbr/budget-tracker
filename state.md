# Project State

## Current milestone

**Milestone 4 — Selected-Month Dashboard (implemented; user review required before M5)**

Milestones 1–3 remain completed and verified. Milestone 4 replaces the identity-only landing page with a household-scoped selected-month dashboard backed by `GET /api/dashboard`, with exact-cent server totals, native month navigation, sorted spending and ten recent transactions. Focused backend/frontend/browser gates and the final integrated suites, build, and full browser run passed. Browser list loading/failure visual rendering (M3) remains unverified; M4 screenshots were captured and layout assertions passed without pixel-level visual review.

## Completed

- Alembic revision `0002_identity` adds users, households, household members, and opaque sessions.
- Argon2id password hashing with bounded validation and hidden-input bootstrap administration.
- Atomic `init-household`, `create-user`, `reset-password`, and `cleanup-sessions` CLI commands.
- Hashed, rotating, expiring session cookies with logout and password-change/reset revocation.
- Signed double-submit CSRF tokens bound to anonymous or authenticated session state.
- Exact Origin checks, bounded five-failure login limiting, generic credential errors, and active membership checks.
- Angular login, auth restoration, guards, 401 recovery, accessible validation, and protected `/dashboard` identity landing page.
- HTTPS Compose example with exact origin, secure cookies, one backend worker, no published backend host port, and Caddy proxying.
- Alembic revision `0003_accounts_categories` adds household-scoped accounts and categories without changing the identity tables.
- `init-household` optionally creates the exact 17 default categories atomically for a new household; existing households are unchanged.
- Angular `/accounts` and `/categories` provide guarded CRUD/archive workflows, exact money display/input, keyboard validation, archive confirmation, and read-only archived rows.
- Alembic revision `0004_transactions` adds household-scoped transaction storage and indexes; account balances aggregate transaction cents.
- Angular `/transactions` provides guarded add/edit/filter/delete workflow with accessible validation and confirmation.
- `GET /api/dashboard` returns the household-scoped selected-month summary, sorted category spending, ten recent transactions and an empty `budgets` array; current balance is all-time across non-archived accounts.
- Angular `/dashboard` renders the selected-month dashboard with local-month default, native month input, Previous/Next controls, four summary cards, spending and recent lists, and coherent loading/error/ready states.

## Verification

- M2 baseline `cd backend && python -m pytest`: **55 passed**.
- M2 baseline `cd frontend && npm test -- --watch=false`: **8 files, 19 tests passed**.
- M2 baseline `cd frontend && npm run build -- --configuration development`: **passed**.
- M2 baseline `cd frontend && npx playwright test`: **6 passed** at `1280×900` and `390×844`.
- M3 focused `cd frontend && npx playwright test e2e/transactions.spec.ts`: **2 passed** at `1280×900` and `390×844`, using generated credentials, a real backend, `Pacific/Kiritimati`, and frontend clock `2026-09-06T12:30:00Z`; covered explicit September filter readiness, the exact rendered positive Salary amount `3.500,00 €` and exact `2026-09-07` date before later filters/deletion, exact transaction lifecycle/dates, exact Netflix expense `-17,99 €` on `2026-08-30` after clearing month/account filters, keyboard amount entry/validation (`0` stayed visible, focused, and invalid; then the amount was replaced and the expense save completed), filter/clear, archived historical reference correction, delete cancellation+confirmation, real reload persistence, plain-text HTML description, accessible validation, balance/API cents, separate expired-session save redirect, navigation to `/transactions` before shell logout, browser-back denial from that protected page, and protected deep-link denial.
- M3 disposable migration/API check: explicit TemporaryDirectory SQLite URL; seeded M2 account preserved exact `initial_balance=-8472, balance=-8472` before `0003 → 0004 → 0003 → 0004`, `initialBalance=-8472, balance=-8472` after `0003 → 0004` with `transactions_table_present=True`, API transaction `-1000` temporarily changed balance to `-9472`, downgrade removed `transactions` and preserved M2 household/account/category rows with `transactions_table_present=False` and `initial_balance=-8472, balance=-8472`, and final re-upgrade preserved `initial_balance=-8472, balance=-8472` while printing `transactions_table_present=True`.
- M3 final integrated checks: `cd backend && python -m pytest` — **89 passed, 83 warnings**; `cd frontend && npm test -- --watch=false` — **10 test files / 30 tests passed**; `npm run build` — **passed**; `npx playwright test` — **8 passed** at `1280×900` and `390×844`.
- M2 baseline disposable CLI PTY runs accepted all **17** exact default category pairs and declined with **0** category rows.
- M4 focused backend `cd backend && python -m pytest tests/test_dashboard.py tests/test_accounts.py tests/test_money.py tests/test_authorization.py -q`: **45 passed**. `tests/test_dashboard.py` covers the exact September/October/November oracle, empty/initial-only/income-only households, multi-account/shared-category joins, archive retention with renamed current names, latest-ten ordering, equal-spending category-ID tie-break, leap/calendar bounds, 422 validation, two-household isolation and member visibility, safe-integer and monthly overflow, scoped SQLite overflow, absence of financial logging, and a concurrent-write regression proving the four dashboard queries share one read snapshot.
- M4 focused frontend `cd frontend && npm test -- --watch=false --include=src/app/features/dashboard/dashboard.page.spec.ts`: **6 passed**; `npm run build`: **passed**.
- M4 focused browser `cd frontend && npx playwright test e2e/dashboard.spec.ts e2e/auth.spec.ts`: **4 passed** at `1280×900` and `390×844`, using isolated `e2e-dashboard-1280`/`e2e-dashboard-390` households, generated credentials, `Pacific/Kiritimati`, and frontend clock `2026-08-31T12:30:00Z`; covered the local-September default (UTC still August), exact rendered oracle per month, December/January rollover, keyboard month navigation, archive balance-versus-history, a nondefault-selection reload resetting to the local month, delayed real-GET loading, offline failure with Retry asserting a ready summary, expired-session redirect, and literal HTML-looking description.
- M4 final integrated checks: `cd backend && python -m pytest` — **117 passed**; `cd frontend && npm test -- --watch=false` — **11 test files / 36 tests passed**; `npm run build` — **passed**; `npx playwright test` — **10 passed** at `1280×900` and `390×844`.
- M4 dashboard ready, loading, empty and error screenshots were captured at both widths; the automated no-document-overflow and card-content assertions passed. Pixel-level visual inspection was not performed in this environment, so the M4 visual layout gate is asserted by automation, not human-reviewed.
- M4 financial consistency: `GET /api/dashboard` opens one explicit SQLite read transaction (`BEGIN`) so its four queries share a single WAL snapshot; the concurrent-write regression fails without the transaction and passes with it.

The development Compose environment uses Caddy's internal CA; clients must trust
that CA or use an explicit development-only certificate bypass.

## Security review

- M1 security review found no remaining concrete authentication issue. Fixed findings remain covered by the M1 regression suite.
- Focused M3 review found no confirmed vulnerability in transaction household predicates, creator immutability, sign/cents/date validation, literal search parameterization, explicit response fields, text rendering, or CSRF/401 flow. A subsequent adversarial re-review found and fixed four defects, each with a regression test: transaction PUT omitted unchanged columns, so a concurrent edit could persist an unvalidated amount/category pair (fixed with a full-column `UPDATE`); hard-deleted transaction IDs were reused, so a stale write could hit a replacement row (fixed with `sqlite_autoincrement`); SQLite `SUM` overflow in one account failed unrelated accounts and account creation (fixed by scoping the aggregate to the requested accounts); and unhandled database errors logged bound parameters including financial notes (fixed with `hide_parameters=True`). `backend/app/errors.py:98-100` logs only HTTP method and URL path for unhandled errors, not request bodies, amounts, or descriptions. This was a focused source review, not external penetration testing.
- Real-browser failed-save preservation is verified without mocks: offline save showed the connection alert with the form and amount retained and no success; invalid `XSRF-TOKEN` produced the actual 403 alert with the same preservation; `/api/auth/csrf` refreshed the token before canceling, and unique failed-save descriptions were absent from filtered history.
- M3 browser loading/failure visual rendering remains unverified; no API mocks/intercepts or unsafe request replay was used.
- Focused M4 review found no confirmed vulnerability in the dashboard household predicates, joined account/category name lookups, integer-cent precision, calendar bounds, request cancellation, 401 cleanup, or financial logging. `backend/app/dashboard.py` has no logger/print calls; the shared logger records only HTTP method and URL path. This was a focused source review, not external penetration testing.
- Deferred defense-in-depth: explicit private/no-store headers for financial GETs, CSP/HSTS, full UUID E2E suffixes, and shared/multi-worker limiter operation. These have no demonstrated M2/M3 exploit in the current deployment.

Residual boundary: the limiter is intentionally in-memory and single-worker. Behind
Caddy, clients initially share the socket-IP bucket because arbitrary forwarded
headers are not trusted. Production LAN/Tailscale reachability, firewall rules,
backups, restore, and multi-worker/shared-limiter operation remain unverified later
release work.

## Milestone checklist

- [x] M0 / Task 0.1 — Runnable repository and infrastructure
- [x] M1 / Task 1.1 — Identity persistence and bootstrap administration
- [x] M1 / Task 1.2 — Browser sessions, CSRF, authorization, and login UI
- [x] M2 / Task 2.1 — Household-scoped accounts and categories
- [x] M3 / Task 3.1 — Exact-cent transactions and filtered history (focused browser/migration/security gates and final integrated checks passed; browser loading/failure visual rendering remains unverified; user review before M4)
- [x] M4 / Task 4.1 — Selected-month dashboard (focused backend/frontend/browser gates and final integrated checks passed; screenshots captured with layout assertions, pixel-level visual review not performed; user review before M5)
- [ ] M5 / Task 5.1 — Monthly budgets
- [ ] M6 / Task 6.1 — Settings and CSV export
- [ ] M6 / Task 6.2 — Deployment, backups, restore, and network boundary
- [ ] M6 / Task 6.3 — Complete MVP acceptance evidence

Final integrated checks pass. Request user review of verified M4 before starting Milestone 5 — monthly budgets. Do not claim M5, the full MVP, or production readiness.
