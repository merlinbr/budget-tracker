# Project State

## Current milestone

**Milestone 2 — Accounts + categories**

Milestone 2 is implemented and verified. The application now supports household-scoped account and category management with exact-cent initial balances, warnings, archiving, and retained read-only history; transactions and later financial features remain out of scope.

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

## Verification

- `cd backend && python -m pytest`: **55 passed**.
- `cd frontend && npm test -- --watch=false`: **8 files, 19 tests passed**.
- `cd frontend && npm run build -- --configuration development`: **passed**.
- `cd frontend && npx playwright test`: **6 passed** at `1280×900` and `390×844`, including real account/category creation, exact negative cents, warned balance acknowledgement, category type grouping/immutability, archive cancellation/confirmation, reload, logout, and protected deep-link denial.
- Disposable migration matrix: fresh `0002_identity → 0003_accounts_categories` preserved identity/session rows and exact `-8472` cents; separate `0003 → 0002 → 0003` preserved identity/session rows while removing/recreating financial tables; empty database reached `0003_accounts_categories` head.
- Disposable CLI PTY runs: accepted all **17** exact default category pairs; declined with **0** category rows.

The development Compose environment uses Caddy's internal CA; clients must trust
that CA or use an explicit development-only certificate bypass.

## Security review

- M1 security review found no remaining concrete authentication issue. Fixed findings remain covered by the M1 regression suite.
- Focused M2 review found no confirmed Critical, High, Medium, or Low vulnerability across household authorization, CSRF/session boundaries, archive enforcement, money bounds, migration constraints, route guards, rendering, or E2E hygiene.
- Deferred defense-in-depth: explicit private/no-store headers for financial GETs, CSP/HSTS, full UUID E2E suffixes, and shared/multi-worker limiter operation. These have no demonstrated M2 exploit in the current deployment.

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
- [ ] M3 / Task 3.1 — Exact-cent transactions and filtered history
- [ ] M4 / Task 4.1 — Selected-month dashboard
- [ ] M5 / Task 5.1 — Monthly budgets
- [ ] M6 / Task 6.1 — Settings and CSV export
- [ ] M6 / Task 6.2 — Deployment, backups, restore, and network boundary
- [ ] M6 / Task 6.3 — Complete MVP acceptance evidence

## Next

Request user review before starting Milestone 3 — transactions.
