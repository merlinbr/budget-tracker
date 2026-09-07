# Household Budget Tracker

Private, self-hosted household budget tracker. Milestone 1 provides local authentication, household membership, and an authenticated identity landing page; financial features remain out of scope.

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

The bootstrap command reads the household name, username, display name, and password confirmation interactively. Passwords are never command-line arguments. Add later members with `python -m app.cli create-user`; use `reset-password` and `cleanup-sessions` for administration.

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

Verified locally against disposable databases and Compose mounts:

- Backend: `27` tests passed.
- Angular: `5` test files / `9` tests passed; production build passed.
- Alembic: disposable `upgrade → downgrade 0001_initial → upgrade` cycle passed; `0002_identity (head)` reported.
- Playwright: `4` browser tests passed at phone width, including keyboard-only login, refresh restoration, logout, expired valid-session recovery, and teardown ownership preservation.
- HTTPS Compose: CSRF `204`, login `200`, `/me` `200`, logout `204`; Secure/SameSite=Lax/Path=/ cookies; session cookie HttpOnly; backend had no published host port.

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

The identity schema is Alembic revision `0002_identity`:

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
- `/dashboard` displays only the authenticated user and household identity.
- Unknown `/api/*` paths return the shared JSON error envelope and never receive the Angular index document.

Accounts, categories, transactions, budgets, dashboard calculations, settings UI, registration, email recovery, backups, and production network changes belong to later milestones.
