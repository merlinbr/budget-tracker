# Household Budget Tracker MVP Implementation Plan

> **For agentic workers:** Use the available `subagent-driven-development` skill when executing independent implementation slices; otherwise execute inline, task by task. Steps use checkbox syntax for tracking. Do not begin implementation merely because this plan exists.

**Goal:** Build the complete private, self-hosted household budget MVP defined in `BUDGET_TRACKER_MVP_SPEC.md`.

**Architecture:** Caddy serves the Angular production build and proxies same-origin `/api/*` requests to one FastAPI process. SQLAlchemy accesses household-scoped SQLite data; opaque, database-backed sessions authenticate individual household members. LAN firewall rules and Tailscale Grants restrict reachability independently of application authorization.

**Tech Stack:** Angular, TypeScript, reactive forms, Router, HttpClient; Python, FastAPI, Pydantic, SQLAlchemy 2.x, Alembic, SQLite, Argon2id; Docker Compose, Caddy, host-managed Tailscale.

## Global Constraints

- Source of truth: `BUDGET_TRACKER_MVP_SPEC.md`; keep it in place rather than creating a second specification.
- Frontend: Angular. Backend: FastAPI. Database: SQLite. Deployment: Docker Compose. Reverse proxy / TLS: Caddy.
- Household currency: `EUR`. Store and transport money as integer cents; never binary floating-point money storage or backend decimal-string parsing.
- One active household membership per user; roles are `owner` and `member`, with identical financial permissions.
- No public registration, JWT access tokens, third-party identity service, cloud database, public proxy, router port forwarding, or Tailscale Funnel.
- Every household-data endpoint requires a valid session, active user, and household membership. Derive household scope server-side.
- Passwords: Argon2id; minimum 12 characters; no maximum below 128; no arbitrary character-mixture rules.
- Session tokens: at least 256 bits of entropy; database stores only token hashes. Normal maximum lifetime: 30 days.
- Production cookie: `budget_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.
- Mutating APIs require CSRF protection, including login and logout. Protect login against repeated failures.
- Transaction dates are calendar dates; technical timestamps are UTC. Browser-local today is the form default.
- Maximum lengths: username/display name/account name/category name 100 characters; description 500 characters.
- Accounts and categories retain historical references when archived. Transactions may be hard-deleted.
- Production FastAPI has no published host port. Only Caddy exposes Budget HTTPS.
- No production secrets, databases, backups, or TLS private keys in Git.
- Phone usability and the accessibility requirements in spec §39 are required, not optional polish.
- All deferred features in spec §§3.2, 45–49 remain excluded. Do not create their tables, fields, endpoints, or empty abstractions.

## Starting Point and Execution Strategy

The repository currently contains the specification and license, with no application code. All application paths below are proposed new files; later tasks modify files introduced by earlier tasks.

Follow milestones 0–6 in the source specification. Build backend and frontend together within each domain milestone, rather than completing an entire backend before the first usable screen. A backend-first sequence delays UX feedback; building every feature concurrently makes authentication and contract integration unnecessarily risky.

Each task includes implementation steps and observable checks. Commit a coherent task after its checks pass if commits are requested by the execution workflow. Run formatting/builds after concurrent edits settle, not from sibling agents mid-flight. No implementation or test execution is claimed by this planning document.

## Decisions Resolving Specification Gaps

These are explicit implementation defaults within the MVP, not revisions to the selected architecture.

| Area | Decision |
|---|---|
| Production topology | Two services: `caddy` with compiled Angular assets, and `backend` with one worker. No frontend runtime server, Redis, cron container, or repository-interface layer. |
| Local development | Angular dev server proxies `/api` to loopback FastAPI. A clearly isolated development configuration permits localhost HTTP; production rejects insecure configuration. |
| Identifiers and JSON | Integer primary keys; Python snake_case internally; camelCase JSON through Pydantic aliases. Strict integer validation rejects floats and booleans for monetary fields. |
| Membership | Unique `household_members.user_id` enforces one membership. No membership switching or browser household selector. |
| Username | Trim and lowercase at CLI/login boundaries; enforce uniqueness on normalized username. Never trim or transform passwords. Bound passwords at 1024 characters. |
| CSRF bootstrap | Add `GET /api/auth/csrf`, exposing no user/household data. It issues a signed random double-submit token through a readable `XSRF-TOKEN` cookie and returns 204; Angular sends `X-XSRF-TOKEN`. Validate signature, constant-time cookie/header equality, and exact allowed Origin for every unsafe method. Bind token signature to the current session-token hash after login; anonymous bootstrap is separately signed. Rotate on login and clear on logout. Signing uses `SESSION_SECRET`. |
| Sessions | Fixed expiry, no sliding expiry. Logout deletes the session. Password change verifies the current password, updates its hash, revokes all sessions, and requires a fresh login. Opportunistically remove expired sessions without writing `last_seen_at` on every read. |
| Login limiting | In-memory bounded limiter for one worker: five failed attempts per normalized username and separately per client IP in 15 minutes; temporary 429 with Retry-After. Successful login clears username failures, not unrelated IP failures. Document reset-on-restart limitation. Trust forwarded client IP only from the configured Caddy proxy. |
| Resource denial | Household-scoped lookup returns 404 for absent or foreign IDs. Missing/invalid session returns 401. CSRF failure returns 403. All use the spec error envelope. |
| Archive API | Use `POST /api/accounts/{id}/archive` and `POST /api/categories/{id}/archive`, idempotently. Omit hard-delete routes for these resources. Lists support `includeArchived`; historical displays request referenced archived records. |
| Archive editing | New transactions and changed references require active account/category. An existing transaction may retain its own archived references while correcting other fields. Archived resources remain readable and contribute to historical reports. No unarchive UI in MVP. |
| Account/category edits | Account name/type can change; initial balance can change only through a clearly warned UI. Category type is immutable after creation, avoiding invalidating transactions/budgets. |
| Amount/sign rules | Nonzero transactions; positive requires income category, negative requires expense category. No override in MVP. Zero budget is valid; negative budget is invalid. |
| Money bounds | Set explicit safe-integer request bounds and reject aggregate overflow before JSON serialization; all API money must remain within JavaScript's exact integer range. Use SQLite integer aggregation and test limits. |
| Dashboard periods | Income/expenses/net/spending/budgets and recent transactions use the selected month. Current balance is all-time across non-archived accounts, not an end-of-month balance. Monthly activity includes archived resources. Recent transactions: latest 10 within the selected month. |
| Budget removal | Add `DELETE /api/budgets/{categoryId}?year=...&month=...`; missing budget and zero limit remain distinct. A zero-limit progress ratio is null; UI shows textual zero/over-budget state without division. |
| Copy budgets | Include copy-previous because it is explicitly listed in the API. Default copies missing active expense-category budgets; conflicts return 409 without partial writes. Explicit `overwrite: true` follows a confirmation and applies atomically. January copies December of the previous year. |
| Settings API gaps | Add `PATCH /api/users/me` for display name and `GET /api/household` for household name/member display names and roles. Password change uses the specified auth endpoint. No household rename or member-administration UI. |
| Transaction listing | Server-side filters without pagination initially, as permitted. Search is bounded literal case-insensitive description substring matching; SQL parameters and escaped LIKE wildcards. Add an ID descending tie-breaker after the specified sort keys. |
| CSV | Use Python `csv`; decimal point, exactly two fractional digits, EUR column. Escape CSV structure and neutralize spreadsheet formula prefixes in user-controlled text fields; signed numeric amount fields stay numeric. |
| Backup retention | Configurable daily retention, default 30 successful daily backups. This meets multiple historical versions without implementing optional weekly/monthly tiers. |

Transfers entered manually as income/expense affect income and expense totals. Document that limitation; do not silently introduce transfer semantics or exclude these transactions from reports.

## Proposed File Map

Create files only in the task that needs them. Angular-generated workspace files are retained; do not create empty future feature folders.

| Paths | Responsibility |
|---|---|
| `README.md`, `.env.example`, `.gitignore` | Development instructions, configuration contract, secret/data exclusions |
| `docker-compose.yml`, `Caddyfile`, `frontend/Dockerfile`, `backend/Dockerfile` | Two-service deployment and static Angular build |
| `backend/pyproject.toml`, `backend/alembic.ini`, `backend/migrations/env.py`, `backend/migrations/versions/*.py` | Dependencies, test configuration, ordered schema migrations |
| `backend/app/main.py`, `config.py`, `db.py`, `errors.py` | Application wiring, validated settings, session factory, common errors |
| `backend/app/models.py`, `schemas.py` | Small initial SQLAlchemy model set and shared API schemas; split by domain only when size warrants it |
| `backend/app/auth/passwords.py`, `sessions.py`, `csrf.py`, `dependencies.py`, `rate_limit.py`, `router.py` | Authentication primitives and HTTP boundary |
| `backend/app/cli.py` | Household bootstrap, additional-user creation, offline password reset, session cleanup |
| `backend/app/api/accounts.py`, `categories.py`, `transactions.py`, `dashboard.py`, `budgets.py`, `settings.py`, `export.py` | Domain-specific HTTP handlers and direct SQLAlchemy queries |
| `backend/app/money.py` | Exact money bounds and CSV decimal formatting, only where shared |
| `backend/tests/conftest.py`, `test_*.py` | Isolated SQLite/API tests for spec-required observable contracts |
| `frontend/src/app/app.config.ts`, `app.routes.ts`, `layout/app-shell.ts` | Angular providers, routing, responsive authenticated navigation |
| `frontend/src/app/core/auth/auth.service.ts`, `auth.guard.ts`, `auth.interceptor.ts` | Restore/login/logout state, UX guard, 401/CSRF HTTP behavior |
| `frontend/src/app/core/api/models.ts`, `frontend/src/app/shared/money.ts` | API types and exact text-to-cents conversion |
| `frontend/src/app/features/<feature>/<feature>.page.ts`, adjacent templates/styles/services/specs as needed | Login, accounts, categories, transactions, dashboard, budgets, settings |
| `frontend/e2e/household.spec.ts`, `frontend/playwright.config.ts` | Required small end-to-end workflow |
| `scripts/backup.py`, `scripts/restore.py` | SQLite-safe backup and offline guarded restore using Python stdlib |
| `docs/DEPLOYMENT.md`, `docs/BACKUP_RESTORE.md`, `docs/tailscale-policy.example.json` | Operator configuration and release evidence checklist |
| `data/.gitkeep` | Persistent database directory placeholder; other contents ignored |

## Shared Contracts and Dependency Order

Backend dependency contract:

```python
@dataclass(frozen=True)
class HouseholdContext:
    user_id: int
    household_id: int
    role: Literal["owner", "member"]

# Defined in app/db.py and app/auth/dependencies.py respectively.
def get_db() -> Iterator[Session]: ...
def require_household(...) -> HouseholdContext: ...
```

The dependency resolves the cookie hash, rejects expired sessions/inactive users/missing membership, and never accepts a browser household ID. Handler queries use both the resource ID and `context.household_id`; write handlers also scope every foreign reference.

API contract baseline:

```typescript
type Money = number; // runtime-validated safe integer cents
interface Period { year: number; month: number; }
interface AuthState {
  user: { id: number; username: string; displayName: string };
  household: { id: number; name: string };
}
interface ApiError {
  error: { code: string; message: string; fields?: Record<string, string> };
}
```

- Auth `login` and `me` return `AuthState`; session credentials never appear in JSON.
- Account: `id, name, type, initialBalance, balance, isArchived`.
- Category: `id, name, type, isArchived`.
- Transaction: `id, accountId, categoryId, amount, description, transactionDate, createdAt, updatedAt`; date is `YYYY-MM-DD`.
- Budget: `categoryId, year, month, limitAmount, spent, remaining, progress`; progress is a ratio or null, never Infinity/NaN.
- Dashboard uses the exact top-level structure from spec §22.2.
- Collection endpoints return arrays initially. Create returns 201; successful deletion/archive/logout/password change returns 204. Updates return the updated resource except budget removal. Validation errors use 422; uniqueness conflicts use 409.
- Money parsing contract: `parseMoney(text: string): number | null`, accepts nonnegative decimal entry with either comma or period and up to two decimal places, no grouping/exponents; caller applies income/expense sign. Parse whole/fraction digit strings rather than multiplying a floating-point decimal.

Dependency chain: **M0 → M1 security gate → M2 → M3 → M4 → M5 → M6 release gate**. Settings can follow M1 while financial work continues; backup tooling can follow M0 once the DB path is stable. Authentication, shared schema migrations, and routing each have one integration owner during concurrent work.

---

## Milestone 0 — Runnable Repository and Infrastructure

### Task 0.1: Establish the same-origin runnable application

**Files:** Create workspace manifests, both Dockerfiles, Compose, Caddyfile, `.env.example`, `.gitignore`, README, `data/.gitkeep`, `backend/app/{main,config,db,errors}.py`, Alembic setup, Angular root/config/routes, and test-runner configurations.

**Consumes:** Source specification only. **Produces:** `/` Angular shell, `GET /api/health` returning 200 without private details, `get_db()`, consistent error mapping, explicit development/production configuration.

- [ ] Select mutually supported stable Angular/Node and Python/package versions at implementation time; pin dependencies/lockfiles and document required runtimes. Use sync SQLAlchemy sessions; no async DB wrapper is needed.
- [ ] Generate Angular with strict TypeScript, Router and reactive-form support. Configure a development `/api` proxy and a production relative API base.
- [ ] Initialize FastAPI, settings validation and request-scoped SQLAlchemy sessions. Enable SQLite foreign keys on every connection, WAL on database initialization, and bounded busy timeout.
- [ ] Configure Alembic against the same database URL; create the initial revision. Migration execution is an explicit backend startup prerequisite, before serving traffic, and failures stop startup.
- [ ] Build Angular assets into the Caddy image. Route `/api/*` exclusively to FastAPI without stripping `/api`; SPA fallback handles frontend routes but never API errors.
- [ ] Mount database and Caddy state persistently. Publish only explicitly configured HTTPS bindings. Backend has no host `ports` entry. Provide development-only loopback startup instructions.
- [ ] Validate production secret entropy, database location, exact allowed origins/trusted hosts, and secure cookie mode. Reject empty/default secrets and insecure production origins.
- [ ] Configure backend pytest, Angular test runner, and Playwright for the later required checks. Add a minimal health integration check, not tests for generated scaffolding.
- [ ] Document install, development start, tests, build, Compose startup, and migration commands; ignore real env files, SQLite sidecars, backups and private keys.

**Verification:** `docker compose config`; `docker compose up --build -d`; `curl --cacert <trusted-root.pem> https://<configured-host>/api/health` returns 200; open `/` and a frontend route in a browser; an unknown `/api/...` returns an API error, not index.html. Run `python -m pytest` from backend and `npm test -- --watch=false` plus `npm run build` from frontend. Certificate/hostname arguments are deployment inputs, not committed defaults.

**Gate:** Review the runnable milestone before adding authentication. Do not enter real household data.

## Milestone 1 — Authentication and Household Bootstrap

### Task 1.1: Persist identities and provide safe administration

**Files:** Create `backend/app/models.py`, auth password/session modules, CLI, migration `0002_identity.py`, `backend/tests/test_bootstrap.py`, `test_auth.py`.

**Produces:** Users, households, unique membership, hashed sessions; CLI `init-household`, `create-user`, `reset-password`, `cleanup-sessions`.

- [ ] Add spec identity/session columns and indexes; unique normalized username and user membership; role constraint; session expiry indexes. Do not store raw credentials or optional user-agent history.
- [ ] Implement Argon2id hash/verify and a dummy-hash verification for unknown usernames to avoid an obvious fast-path distinction. Use the library's supported parameters; rehash successful logins when needed.
- [ ] Implement interactive `init-household` with hidden password confirmation, atomic household/owner creation, refusal on a second initialization, and optional exact seed categories from spec §41 when category storage exists. Until Task 2.1, do not offer category seeding; add it there.
- [ ] Implement `create-user` joining the existing household and offline `reset-password` revoking that user's sessions. Neither command accepts plaintext passwords as command-line arguments. Document both administration flows.
- [ ] Implement 32-byte random tokens, SHA-256 lookup hashes, fixed expiry, token rotation and cleanup; no session token response field.
- [ ] Test bootstrap rollback, duplicate initialization/user refusal, membership uniqueness and password verification through observable login behavior.

**Verification:** `python -m pytest tests/test_bootstrap.py tests/test_auth.py`; run bootstrap and additional-user CLI against a disposable database and verify two users resolve to the same household.

### Task 1.2: Secure browser sessions end to end

**Files:** Create remaining auth modules, `backend/tests/test_csrf.py`, `test_rate_limit.py`, `test_authorization.py`; create Angular auth files, login page, app shell and auth specs. Modify main/config/errors/routes.

**Consumes:** Identity storage. **Produces:** CSRF bootstrap; login/logout/me/change-password; `require_household`; Angular restored auth state and protected navigation.

- [ ] Implement signed CSRF issuance/validation from the decisions table using stdlib HMAC and constant-time comparison; require explicit allowed Origin on unsafe methods. Expose no financial metadata from public endpoints.
- [ ] Implement generic credential errors, bounded login limiting, valid-session dependency, immediate logout invalidation, cookie expiry/deletion and consistent errors. Do not log cookie/header credentials or submitted passwords.
- [ ] Reject inactive users and absent memberships on each authenticated request. Preserve unknown-versus-invalid credential response equivalence.
- [ ] Implement password change with current-password verification and revocation of every session; return 204 and clear authentication cookies.
- [ ] Implement Angular CSRF bootstrap before login, built-in same-origin XSRF header configuration, auth restore via `me`, guards, login redirection and global 401 state clearing. Distinguish a failed-login message from expired-session navigation.
- [ ] Build labeled, keyboard-operable login and responsive shell with all intended routes; do not expose private UI before auth restoration completes. Unimplemented feature links remain absent until their tasks land.
- [ ] Add required automated cases: valid login, invalid/unknown credentials, session creation/rotation, expiry, logout replay, unauthenticated rejection; CSRF missing/mismatch/foreign Origin; rate-limit exhaustion and recovery; password change revokes other devices.
- [ ] Test Angular auth service/guard behavior, refreshing an authenticated page, failed login and 401 recovery. Use actual browser navigation to confirm cookie flags and absence of private data when logged out.

**Verification:** `python -m pytest tests/test_auth.py tests/test_csrf.py tests/test_rate_limit.py tests/test_authorization.py`; Angular auth tests; browser login → refresh → logout → back/deep-link rejection. Inspect responses/logs for leaked secrets.

**Gate:** Security review before financial features. Verify token lifecycle, CSRF including anonymous login, session scope, proxy/IP trust and no public registration. Resolve findings before M2.

## Milestone 2 — Accounts and Categories

### Task 2.1: Household-scoped account/category management

**Files:** Modify models/schemas/CLI; create migration `0003_accounts_categories.py`, account/category API modules and Angular feature pages/services; create `backend/tests/test_accounts.py`, `test_categories.py` and main-form frontend specs.

**Consumes:** `HouseholdContext`, error envelope, auth-aware HTTP. **Produces:** Account/category list/get/create/update/archive contracts above and bootstrap seed option.

- [ ] Add schema fields, permitted types, household indexes, account-name uniqueness within household and category-name uniqueness within household/type. Names are trimmed, nonempty and length-bounded.
- [ ] Implement scoped CRUD without physical deletion; consistent idempotent archive endpoints, `includeArchived` listing and resource-not-found errors.
- [ ] Implement active reference validation and immutable category type; show an explicit warning before initial-balance changes. Return initial balance as account balance until transactions land.
- [ ] Add default categories to the existing atomic bootstrap flow. Do not duplicate seed lists across application paths.
- [ ] Build list/create/edit/archive UI, account-type selector, income/expense category sections, empty states, associated validation errors, visible focus and archive confirmation.
- [ ] Create two households in tests. Prove isolation for list/detail/update/archive and cross-household identifiers; check duplicates, initial balances and archive visibility.
- [ ] Exercise main forms at desktop and phone widths, including keyboard-only submission and negative initial account balances.

**Verification:** `python -m pytest tests/test_accounts.py tests/test_categories.py tests/test_bootstrap.py tests/test_authorization.py`; frontend form tests and browser creation/rename/archive. Historical-reference protection is exercised again after M3/M5 add references.

## Milestone 3 — Transactions

### Task 3.1: Exact transaction writes and filtered history

**Files:** Modify models/schemas/accounts API; create migration `0004_transactions.py`, transactions API, `backend/app/money.py`, `backend/tests/test_transactions.py`, `test_money.py`; create shared money conversion/tests and transactions Angular page/form/service.

**Consumes:** Scoped active account/category lookup. **Produces:** Spec §22.5 CRUD/filter API, exact account balances, reusable text-to-cents conversion.

- [ ] Add transaction foreign keys, household/date, account/date and category/date indexes. Keep creator attribution server-generated and unchanged on edit.
- [ ] Validate nonzero strict integer amounts, bounded values, valid calendar dates, description length, category/sign compatibility and same-household references on create and edit. Preserve unchanged historical archived references only.
- [ ] Calculate account balance as initial balance plus all signed account transactions, including edits/deletions. Do not persist a second mutable balance column.
- [ ] Implement date-range or year/month filters, account/category, income/expense and literal description search; validate inconsistent month/range inputs. Use the declared descending stable sort.
- [ ] Implement exact input parsing with digit components and safe-integer checks; default date from browser-local calendar components, never UTC `toISOString()` slicing.
- [ ] Build list, filters, add/edit form, delete confirmation, type-filtered category selection and saved/error/loading states. Preserve entered values when validation fails.
- [ ] Test required isolation across reads/writes/filters and forged foreign account/category IDs; sign mismatch, zero, fractions, overflow, invalid date, archived references, ordering, edit/delete balance changes and cent precision.
- [ ] Test frontend conversion for `84.72`, `84,72`, `0.01`, excess fractional digits, exponent/grouping input and out-of-range values; test actual form validation and income/expense submission.

**Concrete acceptance dataset:** Checking initial balance 100000, Salary +350000, Groceries -8472, Netflix -1799 yields 439729 cents. Editing Groceries to -9000 yields 439201; deleting Netflix then yields 441000. Assertions must query observable account/API totals, not inspect handler wiring.

**Verification:** `python -m pytest tests/test_transactions.py tests/test_money.py tests/test_accounts.py tests/test_authorization.py`; Angular conversion/form tests; browser add → filter → edit → delete from desktop and phone layout.

**Gate:** Real-data entry is technically usable, but production use still requires the final HTTPS/network/backup gates.

## Milestone 4 — Dashboard

### Task 4.1: Selected-month financial overview

**Files:** Create dashboard API, `backend/tests/test_dashboard.py`, Angular dashboard page/service; modify routes and shared API models.

**Consumes:** Accounts and transaction data. **Produces:** Spec §22.2 dashboard response; budgets is an empty array until M5.

- [ ] Implement integer SQL aggregates for selected-month income, absolute expenses, net and spending by expense category. Use inclusive month start/exclusive next-month start; handle December rollover.
- [ ] Calculate all-time balance across non-archived accounts independently from month filters; do not multiply sums through joins or issue one transaction query per account/category.
- [ ] Return latest 10 selected-month transactions and descending spending totals; keep archived-category/account names visible for historical entries.
- [ ] Build current-month default and previous/next controls, four summary cards, spending list and recent entries. Use readable currency formatting and text-only indicators as needed; no chart dependency.
- [ ] Test empty month, month/year boundaries, multiple accounts/categories, archived-account balance exclusion versus monthly inclusion, foreign-household isolation and exact totals.

**Concrete check:** For the original M3 dataset entirely in one month, dashboard balance 439729, income 350000, expenses 10271 and net 339729. Moving Netflix to the next month leaves current balance unchanged but changes the selected month's expenses to 8472 and net to 341528.

**Verification:** `python -m pytest tests/test_dashboard.py tests/test_authorization.py`; browser month navigation, empty period and responsive cards/list. Confirm current balance does not change just because the displayed month changes.

## Milestone 5 — Monthly Budgets

### Task 5.1: Budget editing, usage and copy action

**Files:** Modify models/schemas/dashboard; create migration `0005_budgets.py`, budgets API, `backend/tests/test_budgets.py`, Angular budgets page/service and budget form specs.

**Consumes:** Expense categories, month-scoped negative transaction sums. **Produces:** Budget list/upsert/delete/copy endpoints and populated dashboard budgets.

- [ ] Add unique household/category/year/month constraint, valid month/year bounds and nonnegative integer limits. Scope category references and reject income categories.
- [ ] Implement idempotent PUT upsert and explicit DELETE removal. Archived-category budgets remain reportable; new/changed category selection uses active expense categories.
- [ ] Return spent, remaining and nullable progress from backend, including no-spending, zero-limit and over-budget cases. Frontend does not recompute financial totals.
- [ ] Implement atomic previous-month copy with conflict response and explicit overwrite confirmation; do not copy archived categories into a new month.
- [ ] Build all-active-expense-category editing, missing versus zero limit, remove action, month navigation and copy confirmation. Dashboard displays every configured selected-month budget, including archived-category history.
- [ ] Test uniqueness/upsert, removal, cross-household access/reference rejection, income-category rejection, negative limits, zero progress behavior, over-budget values, January copy and rollback on conflict.

**Concrete check:** Groceries spending 8472 against limit 60000 produces remaining 51528 and progress 0.1412. Limit 8000 produces remaining -472 and progress 1.059. Limit 0 with spending produces null progress and a textual over-budget state, never Infinity/NaN.

**Verification:** `python -m pytest tests/test_budgets.py tests/test_dashboard.py tests/test_authorization.py`; budget frontend tests; browser zero/absent/over-budget states and copy conflict confirmation, with keyboard and non-color status cues.

## Milestone 6 — Settings, Export and Production Operations

### Task 6.1: Profile settings and safe CSV export

**Files:** Create settings/export API modules, `backend/tests/test_settings.py`, `test_export.py`, Angular settings page/service; modify routes/schemas.

**Consumes:** Auth/password-change contract and transaction filter queries. **Produces:** Display-name update, read-only household/member data, CSV download, backup guidance UI.

- [ ] Add display-name update and household member read endpoints scoped through the same auth dependency. Return no password/session details and no cross-household profiles.
- [ ] Build settings profile form, change-password form with current password, read-only household/members, CSV action and server-admin backup information. No browser restore or email workflow.
- [ ] Implement authenticated CSV export with optional inclusive `from`/`to`, account/category filters and all required columns. Reuse filtering behavior without building a generic query framework.
- [ ] Use `csv.writer`, exact integer-to-two-decimal rendering, standard download headers, private/no-store caching and formula neutralization for user-controlled text, including leading whitespace/control prefixes. Bound export request filters.
- [ ] Test household isolation, date/account/category filters, negative cents, commas/quotes/newlines/Unicode, spreadsheet formula text, header-only empty export and exact column order.
- [ ] Exercise display-name save, password change → re-login, member visibility and downloading/opening CSV from the actual browser.

**Verification:** `python -m pytest tests/test_settings.py tests/test_export.py tests/test_auth.py`; frontend main-form tests; browser settings/download flow. Confirm exported totals and dates match filtered transaction records.

### Task 6.2: Recoverable deployment and private network boundary

**Files:** Finalize Compose/Dockerfiles/Caddyfile/config; create backup/restore scripts, deployment/backup documentation and Tailscale example; update README and env example; create `backend/tests/test_production_config.py`.

**Consumes:** Stable SQLite schema/location and production auth behavior. **Produces:** Operable two-service deployment, daily backup command, offline restore procedure, explicit network release checks.

- [ ] Harden production configuration: non-root backend, writable data path only where required, persistent Caddy CA/state, exact trusted hosts/origins, constrained proxy trust and no debug SQL/request-body logs.
- [ ] Configure CSP compatible with the actual Angular build without unsafe development exceptions, nosniff, Referrer-Policy and restrictive Permissions-Policy. Add HSTS only after hostname/certificate trust is validated. Disable unnecessary public API documentation in production.
- [ ] Document trusted private DNS/host resolution and Caddy internal-root installation on household devices. Cover LAN and Tailscale paths without public DNS issuance or disabling Secure cookies.
- [ ] Bind HTTPS to intended host addresses/interfaces and document host-specific firewall rules. Check IPv4 and IPv6 plus Docker-published-port firewall behavior; do not assume a host firewall rule alone covers Docker forwarding.
- [ ] Supply a least-privilege Tailscale Grants example with household group, tag ownership and tcp:443. Explain additive grants and audit existing broad grants; preserve Emby access. If Emby also shares the same IP and port 443, require a separate Budget IP/Tailscale identity or port before claiming service isolation; hostname routing alone is not a port-level boundary.
- [ ] Implement `scripts/backup.py` using `sqlite3.Connection.backup()` into a temporary destination, integrity-check it, then atomically publish a timestamped snapshot. Retention deletes old completed backups only after a new successful backup. Use restrictive file permissions and a backup directory outside container writable layers.
- [ ] Document a host scheduler invoking backup daily, default 30-day retention, failure visibility and disk-space checks. Scheduling is a host operation, not a new application service.
- [ ] Implement `scripts/restore.py` requiring the backend stopped, explicit target/confirmation and a validated source. Preserve a pre-restore backup, clear obsolete WAL/SHM only while offline, restore atomically, fix ownership, then migrate/start. Invalidate restored sessions before exposing the service so old backup tokens cannot become valid again.
- [ ] Document backup confidentiality, Caddy root private-key protection, schema-version handling and recovery from a failed migration; never migrate production data without a fresh verified backup.
- [ ] Test production-startup refusal for insecure secrets/origins/settings. Run backup during writes against a disposable WAL database, restore to a separate deployment, and verify known records/totals and session invalidation.

**Verification commands:** `docker compose config`; `docker compose up --build -d`; `docker compose exec backend alembic current`; `docker compose exec backend python -m app.cli init-household`; `python scripts/backup.py --database <db-path> --destination <backup-directory> --keep-days 30`; `python scripts/restore.py --backup <snapshot> --database <offline-db-path> --confirm`.

The implementation must expose those script options and document whether scripts execute on the host or inside the backend image with mounted paths. No live production restore is part of automated validation.

**Required deployment evidence:** authorized LAN and Tailscale browser login succeeds; unauthorized tailnet device cannot establish Budget HTTPS but retains intended Emby access; public IPv4/IPv6 cannot reach the service; backend port is inaccessible externally; financial pages still require login from authorized devices. Real subnet, host OS, hostname, IP bindings and tailnet identities are deployment inputs. Without access to those environments, mark these checks unexecuted and do not declare a production-ready release.

### Task 6.3: Prove the complete MVP and document release status

**Files:** Create `frontend/e2e/household.spec.ts`; finalize README, deployment and backup docs with results; adjust only implementation files implicated by failures.

**Consumes:** All milestones. **Produces:** Passing required checks and a completed spec §43 acceptance checklist supported by evidence.

- [ ] Implement the required E2E sequence: login → create account → create category → add expense → observe dashboard → set budget → observe progress → logout → reject financial route. Use an isolated initialized database and real HTTP/browser behavior.
- [ ] Complete the required backend matrix: auth cases, two-household isolation for accounts/categories/transactions/budgets/dashboard/export, balances/monthly sums/net/category spending/budget remaining/over-budget/cent precision.
- [ ] Complete frontend auth-service/guard, money conversion and main-form tests. Financial aggregation remains backend-owned; test only actual frontend presentation/conversion logic.
- [ ] Run backend and frontend suites, Angular production build and E2E suite once the integrated tree is stable. Check the actual desktop/phone browser surface, keyboard navigation, labels/error associations, contrast and non-color budget states.
- [ ] Recreate containers without removing volumes; confirm users, transactions and budgets survive. Check migrations on both an empty database and an existing prior-milestone database.
- [ ] Complete the backup/restore drill and actual-network checks from Task 6.2. Record pass/fail/unexecuted status without substituting mocks for reachability checks.
- [ ] Update startup, upgrade, CLI administration and recovery instructions to match exercised commands. Remove throwaway scripts and generated artifacts, not permanent regression tests or operations scripts.

**Run from backend:** `python -m pytest`.

**Run from frontend:** `npm test -- --watch=false`, `npm run build`, `npx playwright test`.

**Final gate:** Every checkbox in source §43 is satisfied, settings and accessibility requirements are exercised, and §50's production prerequisites have actual evidence. Milestone completion alone is not a production release.

## Source Coverage Map

| Specification sections | Implementing tasks |
|---|---|
| §§1–6 purpose, scope, architecture, stack, repository | 0.1; global constraints and file map |
| §§7–8 auth and household model | 1.1–1.2; 6.1 profile/household settings |
| §§9–12 money, accounts, categories, transactions | 2.1, 3.1 |
| §13 budgets | 5.1 |
| §§14–18 dashboard and finance pages | 2.1–5.1 |
| §19 settings | 6.1, 1.2 password endpoint |
| §§20–21 login, routes, guards | 1.2, routes extended in each feature task |
| §§22–23 API and errors | 0.1 shared errors; 1.2–6.1 endpoint owners |
| §§24–26 schema, indexes, sessions | 1.1–3.1, 5.1 |
| §§27–31 network, TLS, Compose, environment | 0.1, 6.2 |
| §§32–34 backup, logging, headers | 1.2 credential hygiene; 6.2 operations |
| §§35–37 validation, dates, formatting | 2.1–5.1, 6.1 CSV |
| §§38–39 responsive UX and accessibility | Every frontend task; 6.3 final verification |
| §§40–41 bootstrap and seed categories | 1.1, 2.1 |
| §42 testing | All feature checks; 6.3 integrated matrix |
| §43 security acceptance | 1.1–1.2 authentication; 6.2 reachability/TLS; 6.3 final gate |
| §43 functional acceptance | 1.2 login/logout; 2.1 accounts/categories; 3.1 transactions/filters; 4.1 dashboard; 5.1 budgets; 6.1 export |
| §43 operational acceptance | 0.1 startup/migrations/persistence/dev docs; 6.2 backup/restore/secrets/deployment; 6.3 recreation proof |
| §44 milestones | Preserved as M0–M6; settings explicitly included in M6 |
| §§45–49 deferred roadmap and architectural decisions | Global constraints; no implementation of deferred functionality |
| §§50–52 useful-version and production prerequisites | M3/M4 usability gates; 6.2–6.3 production release gate |

## Implementation Handoff

Start with **Task 0.1 only** and review its working application before proceeding to M1. This plan authorizes no deployment changes and records no completed implementation. Execute inline for the initial shared foundation; use subagents only when genuinely independent frontend/backend or operations slices have stable contracts and distinct file ownership.
