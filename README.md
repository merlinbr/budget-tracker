# Household Budget Tracker

A private, self-hosted web app for tracking a household's income, expenses and monthly budgets. Each member has their own login and shares the same household financial data.

Built with **Angular**, **FastAPI** and **SQLite**, with **Caddy** providing HTTPS for container deployments. Designed for home LAN and authorized Tailscale access—not public internet exposure.

## Features

- **Accounts and categories:** organize your money, track balances and archive old accounts or categories without losing transaction history.
- **Transactions:** record income and expenses; edit, delete, search and filter by month, account, category or type.
- **Monthly dashboard:** see income, expenses, net activity, current balances and recent transactions.
- **Category budgets:** set monthly limits, track spending and remaining amounts, and copy limits from the previous month.
- **Household access:** individual logins, shared data, profile settings and password changes.
- **Export and backups:** download filtered CSV exports; use administrator-operated database backup and recovery scripts.

Amounts are stored as integer cents; the current UI uses EUR. Bank synchronization, bank imports and recurring transactions are not included.

**Project status:** the MVP features are implemented. Open code findings and real-host deployment checks remain before release acceptance. See [project status](state.md) and the [application review and next tasks](docs/APP_REVIEW.md).

## Run locally

### Requirements

- Python **3.13 or 3.14**
- Node.js **24.15 or newer within the Node 24 line**, with npm

Docker is not needed for local development. Start from the repository root.

### 1. Start the backend

Create a virtual environment:

```sh
cd backend
python -m venv .venv
```

Activate it with the command for your shell:

```powershell
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
```

```sh
# Linux/macOS
source .venv/bin/activate
```

Install dependencies, create the database and set up your first household:

```sh
python -m pip install -r requirements.lock
alembic upgrade head
python -m app.cli init-household
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

`init-household` prompts for the household name, first user's credentials and optional default categories. Run it only for a new installation; on later starts, skip that command. There is no public registration.

### 2. Start the frontend

In a second terminal, starting from the repository root:

```sh
cd frontend
npm ci
npm start
```

Open **[http://127.0.0.1:4200](http://127.0.0.1:4200)** and sign in with the account you created. The development proxy forwards API requests to the backend on port 8000. Local data is stored in `data/budget.db`.

## Run with Docker

Requires Docker Engine and Compose v2. From the repository root, copy `.env.example` to `.env` if you do not already have one:

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

```sh
# Linux/macOS
cp .env.example .env
```

The example config is for **local development only**. Before starting on Linux, prepare the data directory's ownership for container UID/GID `10001` as described in the [deployment guide](docs/DEPLOYMENT.md#3-data-and-ownership).

```sh
docker compose config
docker compose up --build -d
docker compose exec backend python -m app.cli init-household
```

Skip `init-household` if the database already contains your household. Open **[https://localhost:8443](https://localhost:8443)** using the example configuration. Trust Caddy's local root certificate on your client before browser use; see [certificate setup](docs/DEPLOYMENT.md#6-trusting-the-caddy-root-certificate).

Only Caddy publishes a host port; SQLite data persists in `data/`. For a real LAN/Tailscale installation, follow the [deployment guide](docs/DEPLOYMENT.md). Do not expose the app publicly or use real financial data before the network and recovery checks pass.

## Administration and checks

With the backend virtual environment active, run these from `backend/`:

```sh
python -m app.cli create-user       # Add a household member
python -m app.cli reset-password    # Reset a password and revoke that user's sessions
python -m app.cli cleanup-sessions  # Remove expired sessions
python -m pytest                    # Backend tests
```

From `frontend/`:

```sh
npm test -- --watch=false
npm run build
npx playwright install chromium     # First-time browser setup
npx playwright test
```

Browser checks start their own backend/frontend against disposable data. Stop the local development servers first, and activate the backend virtual environment in the browser-check terminal too, or set `PYTHON` to its interpreter path.

## Further documentation

- [Project status](state.md) — current progress and recorded verification.
- [Application review](docs/APP_REVIEW.md) — code findings, refactoring notes and prioritized tasks.
- [Deployment](docs/DEPLOYMENT.md) — configuration, permissions, HTTPS and network acceptance.
- [Backup and restore](docs/BACKUP_RESTORE.md) — scheduling, retention and isolated recovery. CSV exports are not database backups.
- [MVP specification](BUDGET_TRACKER_MVP_SPEC.md) — product scope and detailed behavior contracts.

## License

[MIT](LICENSE).
