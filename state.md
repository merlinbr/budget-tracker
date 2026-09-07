# Project State

## Current milestone

**Milestone 1 — Authentication + household bootstrap**

Milestone 1 is implemented and verified. The application stops at an authenticated
identity and household landing page; accounts, categories, and financial features
remain out of scope.

## Completed

- Alembic revision `0002_identity` adds users, households, household members, and opaque sessions.
- Argon2id password hashing with bounded validation and hidden-input bootstrap administration.
- Atomic `init-household`, `create-user`, `reset-password`, and `cleanup-sessions` CLI commands.
- Hashed, rotating, expiring session cookies with logout and password-change/reset revocation.
- Signed double-submit CSRF tokens bound to anonymous or authenticated session state.
- Exact Origin checks, bounded five-failure login limiting, generic credential errors, and active membership checks.
- Angular login, auth restoration, guards, 401 recovery, accessible validation, and protected `/dashboard` identity landing page.
- HTTPS Compose example with exact origin, secure cookies, one backend worker, no published backend host port, and Caddy proxying.

## Verification

- `cd backend && python -m pytest`: **27 passed**.
- `cd frontend && npm test -- --watch=false`: **5 files, 9 tests passed**.
- `cd frontend && npm run build`: **passed**.
- `cd frontend && npx playwright test`: **4 passed** at phone width, including keyboard-only login, refresh restoration, logout, deep-link denial, expired valid-session recovery, and teardown ownership preservation.
- Disposable migration cycle `upgrade head → downgrade 0001_initial → upgrade head`: completed; `alembic current` reported `0002_identity (head)`.
- Disposable CLI run: `init-household`, `create-user`, `reset-password`, and `cleanup-sessions` completed successfully.
- Disposable HTTPS Compose run: Caddy served `https://localhost:18444`; CSRF bootstrap `204`, login `200`, `/me` `200`, logout `204`; session and CSRF cookies were Secure, SameSite=Lax, Path=/, with session HttpOnly and 30-day Max-Age; backend exposed only `8000/tcp` inside Compose.

The development Compose environment uses Caddy's internal CA; clients must trust
that CA or use an explicit development-only certificate bypass.

## Security review

- Static security re-review found no remaining concrete authentication issue.
- Fixed findings: cross-user session rotation deletion, active limiter-bucket eviction, frontend CSRF `403` handling, committed E2E credentials, and predictable repeated production secrets.
- Automated coverage includes session replay denial, multi-device revocation, anonymous and authenticated cross-session CSRF rejection, limiter recovery and forwarded-header spoof resistance, membership removal, inactive-user denial, and two-household membership resolution.

Residual boundary: the limiter is intentionally in-memory and single-worker. Behind
Caddy, clients initially share the socket-IP bucket because arbitrary forwarded
headers are not trusted. Production LAN/Tailscale reachability, firewall rules,
backups, restore, and multi-worker/shared-limiter operation remain unverified later
release work.

## Milestone checklist

- [x] M0 / Task 0.1 — Runnable repository and infrastructure
- [x] M1 / Task 1.1 — Identity persistence and bootstrap administration
- [x] M1 / Task 1.2 — Browser sessions, CSRF, authorization, and login UI
- [ ] M2 / Task 2.1 — Household-scoped accounts and categories
- [ ] M3 / Task 3.1 — Exact-cent transactions and filtered history
- [ ] M4 / Task 4.1 — Selected-month dashboard
- [ ] M5 / Task 5.1 — Monthly budgets
- [ ] M6 / Task 6.1 — Settings and CSV export
- [ ] M6 / Task 6.2 — Deployment, backups, restore, and network boundary
- [ ] M6 / Task 6.3 — Complete MVP acceptance evidence

## Next

Request user review before starting Milestone 2 — accounts and categories.
