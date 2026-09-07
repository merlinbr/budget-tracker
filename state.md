# Project State

## Current milestone

**Milestone 0 — Runnable repository and infrastructure**

Task 0.1 is complete and reviewed. The application foundation is approved for the next milestone.

## Completed

- Strict Angular 22.1.x workspace with Router, HttpClient, reactive-form support, dev proxy, unit-test runner, and Playwright configuration.
- FastAPI application with validated settings, sync SQLAlchemy sessions, SQLite foreign keys/WAL/busy timeout, Alembic baseline, `/api/health`, and shared API errors.
- Two-service Docker Compose deployment: Caddy serves the Angular build and proxies `/api/*` to the backend.
- Persistent database and Caddy volumes, environment example, ignore rules, Dockerfiles, and local development documentation.
- No authentication, household models, financial routes, or future-feature scaffolding.

## Verification

- Backend tests: 4 passed.
- Angular unit tests: 1 passed.
- Angular production build: passed.
- Playwright configuration listing: 1 smoke test recognized.
- Alembic revision: `0001_initial (head)`.
- Docker Compose build/start: passed.
- Compose backend: healthy; no published host port.
- Compose Caddy: serving `127.0.0.1:8443`.
- Compose `/`: 200 Angular document.
- Compose `/api/health`: 200 `{"status":"ok"}`.
- Compose unknown `/api/*`: 404 JSON error envelope.
- Compose unknown frontend route: SPA fallback returned 200.

The development Compose environment uses Caddy's internal CA; clients must trust that CA or use an explicit development-only certificate bypass.

## Milestone checklist

- [x] M0 / Task 0.1 — Runnable repository and infrastructure
- [ ] M1 / Task 1.1 — Identity persistence and bootstrap administration
- [ ] M1 / Task 1.2 — Browser sessions, CSRF, authorization, and login UI
- [ ] M2 / Task 2.1 — Household-scoped accounts and categories
- [ ] M3 / Task 3.1 — Exact-cent transactions and filtered history
- [ ] M4 / Task 4.1 — Selected-month dashboard
- [ ] M5 / Task 5.1 — Monthly budgets
- [ ] M6 / Task 6.1 — Settings and CSV export
- [ ] M6 / Task 6.2 — Deployment, backups, restore, and network boundary
- [ ] M6 / Task 6.3 — Complete MVP acceptance evidence

## Next

Start Milestone 1 only after the Task 0.1 review gate. Authentication must implement the existing specification and plan: Argon2id passwords, opaque database-backed sessions, CSRF including anonymous login, rate limiting, household membership, and no public registration.
