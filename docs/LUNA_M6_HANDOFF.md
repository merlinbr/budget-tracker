# Luna — Milestone 6 Settings, Export and Operations Handoff

## Assignment and Authorization

The focused M6 plan is implemented. This document now records the delivered application, recovery and production-shaped verification boundary; it does not authorize commits, pushes, deployment, real-data restoration or network-policy changes.

All reachable repository and disposable-environment work passed. The release classification is **release candidate with deployment gates pending** because actual host, device, DNS, firewall, Tailscale/Emby, scheduler and production recovery checks require separate environment inputs and authorization.

## Read First

1. `BUDGET_TRACKER_MVP_SPEC.md` — product source of truth, especially §§7–8, 19, 21–23, 27–39, 42–44 and 50.
2. `docs/superpowers/plans/2026-09-19-settings-export-operations.md` — **read in full before editing**. Contains the approved behavior, exact interfaces, file map, implementation examples, regression boundaries and release checklist.
3. `README.md`, `state.md`, and the M5 completion evidence in `docs/LUNA_HANDOFF.md` — existing commands, reported verification and remaining visual/deployment limitations.
4. `docs/superpowers/plans/2026-09-07-budget-tracker-mvp.md`, M6 Tasks 6.1–6.3 — milestone context. The focused M6 plan resolves detailed settings, CSV, retention and recovery contracts.
5. Current source and tests named in the focused plan. Re-read before editing and preserve changes made since planning.

This handoff is an execution guide, not a second specification. Preserve historical M3/M4/M5 plans and handoffs. Where current code differs from planning assumptions, trace the real callers and adapt the implementation without silently changing approved behavior.

## Starting State

- M1–M5 remain implemented; M5 is recorded at commit `2003555`, with `fd7d935` restoring canonical Playwright ports. The M6 changes are uncommitted working-tree work; do not discard intervening user changes.
- Migration head remains `0005_budgets`; no M6 migration was required.
- Existing stack remains Angular 22.1.x, Node 24.15+ in the Node 24 line, Python 3.13–3.14, FastAPI/Pydantic/SQLAlchemy/Alembic/SQLite, pytest/Vitest/Playwright, Docker Compose v2 and Caddy. No runtime dependency was added.
- M6 delivered settings/profile/member APIs and UI, safe CSV export, host backup/restore scripts and guides, strict production validation, Caddy security routes/headers, and dedicated settings/full-household browser identities.
- Repository verification: backend **286 passed** with **244 warnings**, frontend **71 tests across 13 files passed**, production build passed, and full Playwright passed **16 scenarios** at both widths with one worker for the shared disposable SQLite database.
- Disposable production-shaped Compose/recovery verification used generated credentials, isolated mounts and `lvh.me`; real host/device/network acceptance remains unexecuted.
- Real Chrome visual inspection covered desktop/phone login, dashboard, accounts, categories, transactions, budgets including over-budget text, settings, populated data, validation/error states, and mobile overflow regression.

## Delivered Tasks and Gates

| Task | Required result | Gate |
|---|---|---|
| **6.1a — Settings/export API** | Self-profile update, household-member read, correct password-error semantics, safe filtered CSV | Scoped API/CSRF/session/CSV boundary regressions against migrated disposable SQLite |
| **6.1b — Settings UI** | Protected Settings page, reactive identity update, password change/re-login and real CSV download | Form tests plus real browser scenarios at 1280×900 and 390×844 |
| **6.2a — Backup/recovery** | Host Python backup/restore scripts and operator guide | Live WAL snapshot, safe failure behavior, separate offline restore and restored-session denial |
| **6.2b — Production configuration** | Exact production validation, working health probe, CSP/headers, private deployment/TLS/firewall/Grants docs | Disposable production Compose and built-app HTTPS checks; real-host checks separately recorded |
| **6.3 — Integrated acceptance** | Full household workflow, persistence/migration/recovery proof, visual checks and release evidence | Final suites/build plus every applicable source §43 and plan §4 gate |
All five M6 tasks are implemented. The gates below distinguish repository/disposable proof from external production acceptance.

Implementation followed **6.1a → 6.1b → 6.2a → 6.2b → 6.3**. Shared `main.py`, schemas, browser seed/config and current documentation were integrated centrally; no new framework, scheduler service, backup API or browser restore was added.

Use the plan's file map. No setup-only deliverable, replacement auth store, generic query framework, scheduler service or new deployment stack. Before modifying exported symbols, inspect references using LSP where available, otherwise every caller.

## Critical Contracts and Known Integration Traps

### Settings and identity

- `PATCH /api/users/me`, strict `{displayName}`, returns existing `{id,username,displayName}`. Use `ResourceName` for trimmed 1–100-code-point validation; display names are not unique. Derive the user/household from `require_household`, never request input.
- `GET /api/household` returns `{id,name,members:[{id,displayName,role,isActive}]}`. Member IDs are user IDs; include current memberships, label inactive users, sort by display name then ID, and expose no credentials/session details or other-household records.
- Reuse `POST /api/auth/change-password` with `{currentPassword,newPassword}`. Passwords remain untrimmed, 12–1024 code points. Confirmation is client-only. Success stays 204, changes the hash, revokes every session for that user and clears cookies.
- Correct wrong-current-password to **422 `VALIDATION_ERROR`, `fields.currentPassword`**, preserving the password and sessions. The existing 401 would trigger the global interceptor even though authentication remains valid. Fix the backend boundary and affected regression, not an endpoint-specific interceptor bypass.
- Genuine auth loss remains 401; global CSRF can produce 403 first on a stale-token mutation. Preserve that precedence and never automatically replay a failed mutation.
- `AuthService.restore()` returns cached identity once ready. Profile success must update the existing auth signal from the returned user and the page's matching member row. A late response must not revive a cleared login or overwrite another user's identity.
- Use the existing shell, auth/pending guards and `PendingFormService`. It is a single boolean: serialize writes. Clear passwords/auth/pending state on successful password change and navigate to exact `/login` with the plan's fixed non-secret one-time notice.
- Household and backup information are read-only. No household rename, membership administration, fake backup status or browser restore.

### CSV

- Authenticated `GET /api/export/transactions.csv`; optional inclusive `from`/`to` calendar dates and positive safe-integer `accountId`/`categoryId`. Dates are exact `YYYY-MM-DD`, years 0001–9999. Reversed/invalid bounds return 422; foreign/missing resource filters share the generic 404.
- No filters means all household history, including archived references and current renamed account/category labels. Do not inherit the Transactions page's default month.
- One joined projection scopes **transactions, account joins and category joins** to the household; independent foreign keys do not guarantee tenant-consistent references. Preserve descending transaction-date/created-at/ID ordering. No per-row lookups or account-balance aggregation.
- Exact columns: `date,description,account,category,type,amount,currency`. UTF-8 without BOM, comma-separated, CRLF records, `csv.writer` quoting; empty export is a header-only 200 download.
- Render signed integer cents without floating point, e.g. `-8472 → -84.72`; currency is `EUR`. Neutralize dangerous spreadsheet prefixes in description/account/category, including leading whitespace/control/format characters. Do not neutralize signed numeric amounts. CSV is not a full or lossless database backup.
- Validate and buffer before starting the response so errors remain JSON. Fixed `transactions.csv` filename, private/no-store and nosniff headers. No streaming-job/session-lifetime abstraction.
- Use an HttpClient Blob download with object-URL cleanup, explicit error-Blob decoding and existing 401 handling. Do not download an error response. Account-selector loading can fail on aggregate overflow; that must not disable valid all-history/date-only export or silently alter selected filters.
- Browser assertions parse CSV correctly, not by splitting on commas/newlines. Arm the download event before clicking the real button.

### Backup and offline restore

Create root-level `scripts/backup.py` and `scripts/restore.py`, not replacements for `backend/scripts` E2E helpers. Run them on the host with explicit host paths:

```text
python scripts/backup.py --database <absolute-db-path> --destination <absolute-backup-directory> --keep-days 30
python scripts/restore.py --backup <absolute-snapshot-path> --database <absolute-offline-db-path> --confirm
```

- Use stdlib `sqlite3.Connection.backup()`, not live-file copying. Open existing sources with `mode=ro`, bound retries, validate integrity/foreign keys/schema, close/checkpoint, and atomically publish a standalone snapshot with restrictive access.
- Retention means **30 calendar days**, not 30 guaranteed successful runs. Prune only script-owned completed snapshots after successful publication; never prune on backup failure, follow symlinks or delete unrelated files. Expose failures through exit status/logs and configure a daily non-overlapping host schedule.
- Restore is offline. Stop and verify the backend, scheduler and other database users first; `--confirm` attests to that prerequisite. A SQLite lock cannot establish that no idle process exists.
- Validate source/revision/paths before changing the target. M6 restore accepts `0005_budgets`; mismatched snapshots require a matching release/migration procedure.
- Prepare a separate staged database; remove **all `sessions` rows there before publication**. Rotating `SESSION_SECRET` alone does not revoke saved session hashes. Keep the source snapshot immutable.
- Preserve a verified pre-restore snapshot of an existing target. If validation/preservation fails, abort without replacement. Inspect checkpoint completion before removing old WAL/SHM; publish with same-filesystem `os.replace`, not delete-then-copy.
- Preserve target ownership/permissions; UID 10001 must be able to write the restored database. Windows confidentiality requires NTFS ACLs, not a claim based on `chmod` alone.
- Migrate while offline, start only after validation, prove old-cookie 401 and fresh-login restored values. Incident recovery also accounts for historically restored passwords. No force-delete workaround or live production restore test.

### Production hardening

- Extend existing production settings validation; parse exact HTTPS origins, reject wildcard/URL-shaped trusted hosts and origin/allowlist mismatches. Retain Secure cookies, secret policy, absolute DB path and one-worker limiter.
- Disable production OpenAPI JSON as well as docs/ReDoc. Apply private/no-store to API responses and errors.
- Existing Compose health requests use a loopback Host that exact production allowlists reject. Supply a configured allowed Host while connecting locally; do not weaken TrustedHostMiddleware.
- Keep backend code root-owned, data writable by UID 10001, no published backend port and `--no-proxy-headers`. Document the shared Caddy socket-IP rate-limit bucket; do not enable arbitrary proxy trust or extra workers.
- Implement the approved static CSP: **no script `unsafe-inline` or `unsafe-eval`**, style-only inline allowance for existing Angular styles, and production critical-CSS inlining disabled. Verify the actual production build through Caddy, not only `ng serve`.
- Trust Caddy's public root certificate on clients; protect its private key/state. Enable staged HSTS only after hostname/certificate validation. No production certificate bypass or disabling Secure cookies.
- Bind intended addresses; inspect resolved Compose ports. Docker forwarding can bypass simple UFW INPUT assumptions. Use the actual host/firewall backend and check IPv4/IPv6.
- Tailscale permissions are additive. Audit existing grants/ACLs and preserve intended Emby access. Shared IP **and** port 443 cannot isolate Budget from Emby through hostname routing alone; the deployment needs the plan's separate address/identity or explicitly chosen port.

## Verification and Evidence

Use only migrated temporary databases, generated credentials and separately mounted Compose environments. Never overwrite `.env`, restore/downgrade `data/budget.db`, remove unrelated volumes, or commit databases/backups/exports/secrets/CA keys.

Dedicated browser users are required for Settings and the complete-household workflow, separately per viewport. Password changes must not mutate the shared `e2e-user` or M4/M5 identities. Ensure retries recover their own dedicated credentials/state without touching another scenario.

Focused commands from `backend`, after the corresponding task exists:

```text
python -m pytest tests/test_settings.py tests/test_export.py tests/test_auth.py tests/test_authorization.py
python -m pytest tests/test_backup_restore.py
python -m pytest tests/test_config.py tests/test_health.py tests/test_auth.py tests/test_export.py
```

Focused commands from `frontend`:

```text
npm test -- --watch=false --include=src/app/features/settings/settings.page.spec.ts --include=src/app/core/auth/auth.service.spec.ts
npx playwright test e2e/settings.spec.ts
npx playwright test e2e/household.spec.ts
```

The full-household scenario creates an account with `100000` initial cents, Food expense `-8472` dated `2026-09-07`, and budget `60000`. September must show income `0`, expenses `8472`, net `-8472`, balance `91528`, spent `8472`, remaining `51528`, progress `0.1412`; CSV must contain `-84.72`. Logout must deny financial routes and APIs.

After integration, run once on the stable tree:

```text
# backend
python -m pytest

# frontend
npm test -- --watch=false
npm run build
npx playwright test
```

Also executed the reachable disposable production checks: primary and recovery Compose projects started with `APP_ENV=production`, Caddy internal TLS served `lvh.me`, the backend remained unpublished, health returned `200`, API cache/security headers were observed, production docs/OpenAPI and unknown API routes returned `404`, and both migration/bootstrap and container recreation preserved the isolated database.

The live backup/restore drill used the host scripts against the isolated primary database. The verified snapshot contained two accounts; restore reached revision `0005_budgets`, removed sessions, preserved the transaction and budget, the old recovery cookie returned `401`, fresh recovery login read the restored values, and a new transaction returned `201`. Chrome inspection covered both widths and the relevant ready/empty/loading/error/over-budget/accessibility states.

Actual commands and results are recorded in `README.md`, `state.md`, `docs/LUNA_HANDOFF.md`, `docs/DEPLOYMENT.md`, and `docs/BACKUP_RESTORE.md`. No runtime claim in this handoff substitutes for the actual-environment release gate below.

## Actual-Environment Release Gate

Before production operations, obtain actual server OS/Docker/firewall, data/backup paths and ownership, scheduler, private DNS/hostname, LAN subnet/address, tailnet identity/address/tag, IPv6 behavior, household/denied-device identities and full existing Emby/Grants policy. Do not infer the production OS from the development workstation. Obtain explicit authorization before applying changes.

The plan's §4 table is mandatory. In particular, prove:

- Authorized LAN and remote Tailscale devices get trusted HTTPS and still require application login.
- An Emby-only identity cannot establish Budget HTTPS while intended Emby access still works.
- Public IPv4/IPv6 and external backend-port access are denied; no router forwarding or Funnel exposure.
- Real scheduled backups succeed with restricted access and visible failures; restore is demonstrated, not merely documented.
- Cookies, headers/CSP, hostname trust and enabled HSTS status match the actual deployment.

Unavailable host/devices are an external gate, not permission to invent evidence. Finish reachable implementation and document the exact missing prerequisite.

## Final Delivery and Stop Boundary

Current docs record the completed reachable proof. Throwaway Compose databases, backups, screenshots, and browser artifacts are removed during cleanup; retained source scripts, tests and operator guides remain.

Final report must include:

1. Status of each of the five tasks and concrete delivered files/behavior.
2. Focused/integrated commands and actual results, plus desktop/phone visual evidence.
3. Persistence/migration/live-backup/offline-restore results, including restored-session denial.
4. Security findings/fixes and exact actual-network checks performed or still unexecuted.
5. Release classification: **application/recovery verified**, **release candidate with deployment gates pending**, or **MVP release accepted** only when every required gate has passed and the user has reviewed it.

Stop for user review before production rollout or publication. Approval of this implementation plan/handoff is not blanket permission to commit, push, alter host/network policy or restore real data.

## Suggested Implementation Prompt

> Implement Milestone 6 using `docs/LUNA_M6_HANDOFF.md` and the approved `docs/superpowers/plans/2026-09-19-settings-export-operations.md`. Read both fully, then deliver all five tasks and their reachable verification gates. Preserve M1–M5, use disposable data, and follow the fixed settings/CSV/recovery/security contracts. Record actual evidence and leave unavailable real-host/device release checks explicitly open. Do not commit, push, deploy, change network policy or restore real data without separate authorization.
