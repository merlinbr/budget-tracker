# Household Budget Tracker

Private, self-hosted household budget tracker. Milestones 1–4 provide local authentication, household membership, account/category management, exact-cent balances, archive workflows, transaction entry/history, and a household-scoped selected-month dashboard. Browser list loading/failure visual rendering remains unverified; budgets and later features remain out of scope.

## Requirements

- Node.js 24.15 or newer in the Node 24 line
- Python 3.13 or 3.14
- Docker Engine with Compose v2

The frontend is pinned to Angular 22.1.x. The backend uses FastAPI, SQLAlchemy 2.x, Alembic, SQLite, and Argon2id.

## Local development

Create a backend environment and install the pinned dependencies:

```text
cd backend
python -m venv .venv
# Windows PowerShell: .\.venv\Scripts\Activate.ps1
# POSIX shell: source .venv/bin/activate
python -m pip install -r requirements.lock
alembic upgrade head
python -m app.cli init-household
uvicorn app.main:app --reload --port 8000
```

The bootstrap command reads the household name, username, display name, and password confirmation interactively. Passwords are never command-line arguments. `init-household` optionally creates the exact 17 default categories for a new household. Add later members with `python -m app.cli create-user`; use `reset-password` and `cleanup-sessions` for administration.

In a second terminal:

```text
cd frontend
npm ci
npm start
```

Open `http://127.0.0.1:4200/`. The Angular development proxy forwards `/api/*` to FastAPI at `http://127.0.0.1:8000`. Both `http://127.0.0.1:4200` and `http://localhost:4200` are valid development origins.

## Checks

Backend:

```text
cd backend
python -m pytest
```

Frontend:

```text
cd frontend
npm test -- --watch=false
npm run build
npx playwright test
```

The Playwright browser binary is a separate local install when needed:

```text
npx playwright install chromium
```

Verified locally against disposable databases and the real-backend browser harness:

- Backend M2 baseline: `cd backend && python -m pytest` — 55 passed. Final integrated run: `cd backend && python -m pytest` — **85 passed, 79 warnings**.
- Angular M2 baseline: `8` test files / `19` tests passed; development build passed. Final integrated runs: `cd frontend && npm test -- --watch=false` — **10 test files / 30 tests passed**; `npm run build` — **passed**.
- Playwright M2 baseline: `6` browser tests passed at `1280×900` and `390×844`, including account/category lifecycle, keyboard validation, archive/read-only behavior, logout, and protected deep-link denial.
- Playwright M3 focused: `cd frontend && npx playwright test e2e/transactions.spec.ts` — **2 passed** at `1280×900` and `390×844` against the real backend with generated credentials, `Pacific/Kiritimati`, and frontend clock `2026-09-06T12:30:00Z`; covered exact transaction amounts/dates, keyboard expense validation/entry, filters, archived historical correction, plain-text HTML description, reload persistence, balance/API cents, expired-session save redirect, actual logout/back/deep-link denial, and real offline/403 failed-save preservation.
- Alembic M2 baseline: fresh `0002_identity → 0003_accounts_categories` preserved identity/session rows and exact `-8472` cents; a separate `0003 → 0002 → 0003` cycle preserved identity/session rows and removed/recreated financial tables; an empty database reached head.
- Alembic M3 focused: on an explicitly temporary SQLite URL, the seeded M2 account remained `initial_balance=-8472, balance=-8472` before the cycle, `initialBalance=-8472, balance=-8472` after `0003 → 0004` with `transactions_table_present=True`, `initial_balance=-8472, balance=-9472` after the API-created/read `-1000` transaction, and `initial_balance=-8472, balance=-8472` after `0004 → 0003` with `transactions_table_present=False`; the final `0003 → 0004` re-upgrade preserved M2 household/account/category rows and printed `transactions_table_present=True` with `initial_balance=-8472, balance=-8472`.
- Bootstrap CLI: disposable real PTY runs accepted all `17` exact default category pairs and declined with `0` category rows.
- Focused M2 security review: no confirmed Critical/High/Medium/Low vulnerabilities.
- Focused M3 security review: no confirmed vulnerability in transaction household predicates, archive/reference checks, sign/cents/date validation, parameterized literal search, explicit responses, text rendering, preserved CSRF/401 flow, or private-data logging. `backend/app/transactions.py` has no logger/print calls; the generic logger at `backend/app/errors.py:98-100` records only HTTP method and URL path, not request bodies, amounts, or descriptions. This was a focused source review, not external penetration testing.
- Real browser failure preservation: with the context offline, a valid save showed the connection alert while the form and amount remained; replacing only `XSRF-TOKEN` produced the actual 403 alert with the form and amount preserved; the real `/api/auth/csrf` endpoint refreshed CSRF before canceling, and unique failed-save descriptions were absent from filtered history.
- Browser loading/failure visual rendering remains unverified. No API mocks/intercepts or unsafe request replay was used. Final integrated backend/frontend commands, build, and full Playwright run all passed; deployment, network, backup, and restore remain later gates.
- M4 focused backend: `cd backend && python -m pytest tests/test_dashboard.py tests/test_accounts.py tests/test_money.py tests/test_authorization.py -q` — **45 passed**; the new `tests/test_dashboard.py` covers the exact September/October/November oracle, empty/initial-only/income-only households, join multiplication, archive retention, latest-ten ordering, equal-spending category-ID tie-break, leap/calendar bounds, validation, two-household isolation and member visibility, safe-integer and monthly overflow, scoped SQLite overflow, absence of financial logging, and a concurrent-write regression proving all four dashboard queries share one read snapshot.
- M4 focused frontend: `cd frontend && npm test -- --watch=false --include=src/app/features/dashboard/dashboard.page.spec.ts` — **6 passed**; `npm run build` — **passed**.
- M4 focused browser: `cd frontend && npx playwright test e2e/dashboard.spec.ts e2e/auth.spec.ts` — **4 passed** at `1280×900` and `390×844`, using isolated `e2e-dashboard-1280`/`e2e-dashboard-390` households, generated credentials, `Pacific/Kiritimati`, and frontend clock `2026-08-31T12:30:00Z`; covered the local-September default, exact rendered oracle per month, December/January rollover, keyboard month navigation, archive balance-versus-history, a nondefault-selection reload resetting to the local month, delayed real-GET loading, offline failure with Retry asserting a ready summary, expired-session redirect, and literal HTML-looking description.
- M4 final integrated runs: `cd backend && python -m pytest` — **117 passed**; `cd frontend && npm test -- --watch=false` — **11 test files / 36 tests passed**; `npm run build` — **passed**; `npx playwright test` — **10 passed** at `1280×900` and `390×844`.
- M4 dashboard ready, loading, empty and error screenshots were captured at both widths and the automated no-document-overflow and card-content assertions passed; pixel-level visual inspection was not performed in this environment, so the visual layout gate is asserted, not human-reviewed.
- M4 financial consistency: `GET /api/dashboard` opens one explicit SQLite read transaction (`BEGIN`) so its four queries share a single WAL snapshot; a concurrent-write regression fails without it and passes with it.
- Focused M4 security review: no confirmed vulnerability in the dashboard household predicates, joined name lookups, integer-cent precision, calendar bounds, request cancellation, 401 cleanup, or financial logging. `backend/app/dashboard.py` has no logger/print calls.

## Administration

Run these commands from `backend` against the configured database:

```text
python -m app.cli init-household
python -m app.cli create-user
python -m app.cli reset-password
python -m app.cli cleanup-sessions
```

`init-household` is one-time and creates the owner membership. `create-user` assigns a member to the existing household. Password reset revokes every session for that user. Use a disposable database for verification; never reset or downgrade the real `data/budget.db`.

## Compose

Copy the example values, then validate and start the deployment:

```text
# PowerShell
Copy-Item .env.example .env

docker compose config
docker compose up --build
```

Compose runs the Alembic migrations before serving FastAPI. Caddy is the only published service; the backend has no host port and runs one worker with `--no-proxy-headers`. Database files persist in `./data`, and Caddy state persists in named volumes.

The development Compose binding uses Caddy's internal CA at `https://localhost:8443`. Its exact allowed origin is `https://localhost:8443`, and secure cookies are enabled:

```text
curl --insecure https://localhost:8443/api/health
curl --insecure https://localhost:8443/api/unknown
```

Install and trust the Caddy root certificate on a device before using a browser without a certificate warning. Production must replace the example secret with a high-entropy value and configure exact HTTPS origins and trusted hosts. The in-memory limiter is single-worker; behind Caddy, clients initially share the socket IP bucket because arbitrary forwarded headers are not trusted.

## Migrations

The identity schema is Alembic revision `0002_identity`; accounts/categories are `0003_accounts_categories`; transactions are `0004_transactions`:
```text
cd backend
alembic upgrade head
alembic current
```

Use a separate disposable database for downgrade/upgrade checks. Do not downgrade the real database.

## API

- `GET /api/health` is public and non-sensitive.
- `GET /api/auth/csrf` bootstraps the signed readable CSRF cookie.
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, and `POST /api/auth/change-password` implement cookie-backed authentication.
- `/dashboard` renders the selected-month dashboard: four server-calculated summary cards (all-time non-archived account balance, month income, expenses, net), a sorted spending-by-category list, and up to ten recent transactions. A native labelled month input plus Previous/Next month controls default to the browser's local current month; month state is page-local.
- `GET /api/dashboard?year=YYYY&month=M` is authenticated and household-scoped. Both parameters are required (year `1–9999`, month `1–12`); missing or invalid values return the shared 422 envelope. Balance is all-time across non-archived accounts and is independent of the selected month; monthly activity includes archived accounts/categories and uses inclusive first/last calendar-date bounds. Spending groups negative transactions by category with positive totals sorted by total descending then category ID; recent rows are the latest ten in the month. `budgets` is always `[]` in M4. Safe-integer or SQLite aggregate overflow returns 409 `CONFLICT` for the whole response.
- `/accounts`, `/categories`, and `/transactions` provide guarded household-scoped management. Transactions support income/expense entry, calendar dates, description search, month/account/category/type filters, full edit, and hard delete with an accessible confirmation.
- New transaction writes reject archived account or category references. An edit may retain the transaction's own archived account/category reference, but may not switch to a different archived reference.
- Transaction history returns the full matching result set without pagination; description search uses SQLite's ASCII-only case-insensitive folding, so non-ASCII case variants are not normalized.
- Account balances derive from exact integer-cent transaction sums; the transaction workflow observed readable `4.410,00 €` (`EUR 4410.00`) in the UI and raw `balance: 441000` from `GET /api/accounts/{id}`.
- Transaction amounts are nonzero signed cents bounded to `[-9007199254740991, 9007199254740991]`; malformed amounts/dates, sign/category mismatches, and aggregate overflow return validation/conflict errors.
- Unknown `/api/*` paths return the shared JSON error envelope and never receive the Angular index document.

## Accounts and categories

- Account initial balances are signed integer cents in `[-9007199254740991, 9007199254740991]`; input accepts up to 14 whole digits and two decimals with comma or dot separators and no grouping.
- Names are trimmed, limited to 1–100 Unicode code points, and use case-sensitive exact uniqueness per household (categories per household and type). Archived names remain reserved.
- Archive is a soft, idempotent action: active rows show by default, archived rows are revealed on demand and read-only, and there are no delete or unarchive endpoints.
- Editing an account's initial balance warns that it changes the account's current balance and the baseline for its history and requires acknowledgement before saving.
- The optional default-category prompt runs only during new `init-household`; existing households are never seeded retroactively.


Budgets and budget progress, settings UI, registration, email recovery, backups, and production network changes belong to later milestones.
