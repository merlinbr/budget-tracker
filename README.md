# Household Budget Tracker

Private, self-hosted household budget tracker. Task 0.1 provides the runnable Angular/FastAPI foundation only; authentication and financial features are intentionally not present yet.

## Requirements

- Node.js 24.15 or newer in the Node 24 line
- Python 3.13 or 3.14
- Docker Engine with Compose v2

The frontend is pinned to Angular 22.1.x. The backend uses FastAPI, SQLAlchemy 2.x, Alembic, and SQLite.

## Local development

Create a backend environment and install the pinned dependencies:

```text
cd backend
python -m venv .venv
# Windows PowerShell: .\.venv\Scripts\Activate.ps1
# POSIX shell: source .venv/bin/activate
python -m pip install -r requirements.lock
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

In a second terminal:

```text
cd frontend
npm ci
npm start
```

Open `http://127.0.0.1:4200/`. The Angular development proxy forwards `/api/*` to FastAPI at `http://127.0.0.1:8000`.

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

## Compose

Copy the development values, then validate the resolved configuration:

```text
# PowerShell
Copy-Item .env.example .env

docker compose config
docker compose up --build
```

Compose runs the Alembic baseline before serving FastAPI. Caddy is the only published service; the backend has no host port. Database files persist in `./data`, and Caddy state persists in named volumes.

The development Compose binding uses Caddy's internal CA at `https://localhost:8443`:

```text
curl --insecure https://localhost:8443/api/health
curl --insecure https://localhost:8443/api/unknown
```

Install and trust the Caddy root certificate on a device before using a browser without a certificate warning. Production must replace the development environment values with a high-entropy secret, an exact HTTPS origin, an exact trusted host, and secure cookies; production HTTPS and private-network checks are later release-gate work.

## Migrations

The empty Alembic baseline is the only schema in Task 0.1. Run it explicitly during local setup or let Compose run it before Uvicorn:

```text
cd backend
alembic upgrade head
alembic current
```

## API foundation

- `GET /api/health` returns `{"status":"ok"}` after a database connectivity check.
- Unknown `/api/*` paths return the shared JSON error envelope and never receive the Angular index document.
- No authentication, household models, financial routes, or future feature placeholders exist yet.
