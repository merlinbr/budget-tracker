# Household Budget Tracker

Private, self-hosted household budget tracker. Milestones 1–2 provide local authentication, household membership, account/category management, exact-cent balances, and archive workflows; transactions and later financial features remain out of scope.

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

- Backend: `55` tests passed.
- Angular: `8` test files / `19` tests passed; development build passed.
- Playwright: `6` browser tests passed at `1280×900` and `390×844`, including the real accounts/categories lifecycle, keyboard validation, archive/read-only behavior, logout, and protected deep-link denial.
- Alembic: fresh `0002_identity → 0003_accounts_categories` preserved identity/session rows and exact `-8472` cents; a separate `0003 → 0002 → 0003` cycle preserved identity/session rows and removed/recreated financial tables; an empty database reached head.
- Bootstrap CLI: disposable real PTY runs accepted all `17` exact default category pairs and declined with `0` category rows.
- Focused M2 security review: no confirmed Critical/High/Medium/Low vulnerabilities.

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

The identity schema is Alembic revision `0002_identity`; accounts and categories are revision `0003_accounts_categories`:

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
- `/dashboard` displays the authenticated user and household identity.
- `/accounts` and `/categories` provide guarded household-scoped account/category management with exact-cent balances, optional archive visibility, and read-only archived rows.
- Account/category API queries and writes derive household ownership from the authenticated session; no household ID is accepted from clients.
- Unknown `/api/*` paths return the shared JSON error envelope and never receive the Angular index document.

## Accounts and categories

- Account initial balances are signed integer cents in `[-9007199254740991, 9007199254740991]`; input accepts up to 14 whole digits and two decimals with comma or dot separators and no grouping.
- Names are trimmed, limited to 1–100 Unicode code points, and use case-sensitive exact uniqueness per household (categories per household and type). Archived names remain reserved.
- Archive is a soft, idempotent action: active rows show by default, archived rows are revealed on demand and read-only, and there are no delete or unarchive endpoints.
- Editing an account's initial balance warns that it changes the account's current balance and the baseline for its history and requires acknowledgement before saving.
- The optional default-category prompt runs only during new `init-household`; existing households are never seeded retroactively.


Transactions, budgets, dashboard calculations, settings UI, registration, email recovery, backups, and production network changes belong to later milestones.
