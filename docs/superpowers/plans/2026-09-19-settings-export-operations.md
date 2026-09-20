# Milestone 6 — Settings, Export and Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` when executing genuinely independent slices; otherwise execute inline, task by task. Steps use checkbox (`- [ ]`) syntax for tracking. **User-approved on 2026-09-20.** Read `docs/LUNA_M6_HANDOFF.md` before implementation. Approval and handoff preparation do not themselves authorize implementation, commits, pushes, network-policy changes or deployment; begin implementation when the user initiates it.

**Goal:** Finish the household-budget MVP with profile settings, safe transaction CSV downloads, recoverable private deployment, and evidence for the complete release gate.

**Architecture:** Extend the existing direct FastAPI feature routers and guarded Angular shell. Keep SQLite, one backend worker, and Caddy serving the production Angular build; add two Python administrator scripts rather than a backup API, scheduler service or admin framework. Separate application completion from production readiness: actual LAN/Tailscale/TLS and recovery evidence is mandatory for the latter.

**Tech Stack:** Existing Angular 22.1.x / TypeScript / RxJS, Python 3.13–3.14 / FastAPI / Pydantic / SQLAlchemy / Alembic / SQLite, pytest / Vitest / Playwright, Docker Compose v2 / Caddy, host-managed Tailscale. No new runtime dependencies.

## Global Constraints

Source of truth: `BUDGET_TRACKER_MVP_SPEC.md`, especially §§7–8, 19, 21–23, 27–39, 42–44 and 50. This document expands M6 Tasks 6.1–6.3 in `docs/superpowers/plans/2026-09-07-budget-tracker-mvp.md`; it does not replace the product specification. Requirements and implementation steps are kept together, as in the focused M5 plan.

- “Every household-data query must be scoped using the authenticated user's household membership.” Never accept a client household ID as authority.
- “Money must **never** use binary floating-point storage.” Keep signed integer EUR cents bounded to `±9007199254740991`; format CSV directly from integers.
- “Production authentication must use HTTPS.” Keep `budget_session` HttpOnly, Secure, SameSite=Lax, Path=/ and the existing signed, session-bound CSRF flow.
- “Do not provide browser-triggered database restore in MVP.” Backup and restore remain administrator/server operations.
- “Do not configure router NAT/port forwarding to Budget.” No public registration, public reverse proxy, Tailscale Funnel, cloud database or new identity provider.
- “Do not communicate budget state using color alone.” Preserve labels, error associations, keyboard access, visible focus, contrast and readable monetary/status text at desktop and phone widths.
- Use existing schema revision `0005_budgets`; no M6 migration is expected. Do not create tables for exports, backup jobs, preferences or deployment state.
- Preserve the single-worker, bounded in-memory login limiter. Shared/multi-worker limiting remains out of scope; do not silently enable extra workers.
- Use migrated disposable databases, generated browser credentials and isolated Compose mounts/volumes for verification. Never reset, downgrade or restore over `data/budget.db`; never overwrite the real `.env`.
- No household rename/member administration, bank import, transfer model, recurrence, attachments, email recovery, pagination, global state library, export background jobs or generic reporting framework.
- Node.js 24.15 or newer in the Node 24 line; Python 3.13 or 3.14. Retain installed dependency versions unless a demonstrated blocker requires a separate decision.
- Preserve earlier plans and historical handoffs. No commits, pushes or production/network changes without separate authorization.

---

## 1. Baseline and Design Decisions

### Grounded starting point

Inspected on 2026-09-19 after M5 commit `2003555` and Playwright-port follow-up `fd7d935`. M5 implementation and its reported verification are accepted as the baseline, not rerun as part of planning. `state.md` records 211 backend tests, 52 frontend tests, a production build, 12 browser scenarios and migration evidence; those are prior results, not new M6 evidence.

| Existing surface | M6 implication |
|---|---|
| `backend/app/auth/router.py::change_password` | Already validates the current password, replaces its hash, revokes all that user's sessions and clears cookies. Reuse it; correct its wrong-current-password status before exposing the form. |
| `frontend/src/app/core/auth/auth.service.ts::restore` | Caches ready identity. Calling `restore()` after editing the profile will not refresh it; update the state from the successful profile response. |
| `backend/app/schemas.py::ResourceName`, `UserResponse` | Reuse strict trimmed-name validation and existing public user shape. |
| `backend/app/transactions.py::list_transactions` | Existing household scope, archived-resource lookup, signed amount semantics and stable descending order. There is no date-range export API or reusable generic query service. |
| `backend/app/main.py::create_app` | Global CSRF and trusted-host middleware already exist. Cache prevention currently covers auth routes only; production disables Swagger/ReDoc but not OpenAPI JSON. |
| `backend/app/config.py::Settings` | Production already rejects weak secrets, insecure cookies and relative database paths. Origin checking uses an HTTPS prefix, and trusted-host rejection does not reject every wildcard/URL form. Tighten rather than duplicate this validator. |
| `backend/Dockerfile`, `docker-compose.yml` | Non-root UID 10001, two services, migrations before startup, persistent data/Caddy volumes and no published backend port already exist. Host bind-mount ownership still needs an operator procedure. |
| Compose health check | Sends a loopback Host header. Exact production trusted hosts would reject it; fix the probe instead of adding localhost to production allowed hosts. |
| `Caddyfile`, `frontend/angular.json` | Internal TLS and same-origin routing exist; security headers are absent and the production build has default critical-CSS inlining. Verify CSP against the actual built app. |
| `backend/scripts/seed_e2e.py`, `frontend/playwright.config.ts` | Existing disposable browser database and per-width M4/M5 identities. Add isolated M6 identities; never change the shared user's password. |

### Alternatives considered

1. **Recommended: focused feature additions plus host-operated recovery.** Use existing auth/forms/queries, Python `csv` and SQLite backup API, and the current two-service deployment. All mandatory scope is covered without new services.
2. **Export-only finish.** Smaller, but omits settings and recovery/network acceptance already required by the product and roadmap; rejected.
3. **Admin/backup platform.** Browser restore, job history, a scheduler container and streaming export jobs create security and lifecycle work without an MVP need; rejected.

No new layout concept needs a visual-design decision: use the existing responsive cards, native forms and shell. Real browser visual inspection remains an acceptance gate.

### Completion states

- **Application/recovery implementation verified:** all repository deliverables and disposable-environment gates pass.
- **Release candidate, deployment gates pending:** code may be ready, but one or more actual-host/device checks are unexecuted. List them explicitly; do not call the full MVP complete or production-ready.
- **MVP release accepted:** every source §43 criterion, settings/accessibility requirement and §50 production prerequisite has passing evidence, followed by user review.

## 2. Fixed Feature Specification

### 2.1 Profile and household

| Endpoint | Contract |
|---|---|
| `PATCH /api/users/me` | Body exactly `{ "displayName": "Alex" }`; authenticated user only, under `require_household` and global CSRF. Trim and validate 1–100 Unicode code points using `ResourceName`; strict body rejects extra fields. Return existing `UserResponse`: `{id, username, displayName}`. No session rotation/revocation for a name edit. |
| `GET /api/household` | Return `{id, name, members:[{id, displayName, role, isActive}]}` for the authenticated household. Member `id` is the user ID; roles are `owner` or `member`. Include current membership rows, including inactive users labelled Inactive; order by display name then user ID. No usernames, hashes, session details or unrelated household members. |
| `POST /api/auth/change-password` | Existing `{currentPassword,newPassword}` request, 12–1024 characters, no trimming or character-mixture rules. Success remains 204, revokes every session for that user, and clears cookies. Confirmation is a client-only field. |

**Wrong-current-password cutover:** return 422 `VALIDATION_ERROR` with `fields.currentPassword`, rather than the existing 401 `INVALID_CREDENTIALS`. A typo must not masquerade as an expired login or trigger the global interceptor. Password hash, cookies and every session remain unchanged on this failure. Authentication dependencies still return 401 for missing/expired/revoked sessions, inactive users or lost membership. On unsafe requests, the existing global CSRF guard can reject a stale session-bound token with 403 before the handler reaches its 401 check; preserve that precedence, never replay the mutation, and use a protected GET to confirm session loss when needed. Change wrong-password semantics at the backend boundary and update affected auth tests; do not add an interceptor exception that suppresses real authentication failures.

`/settings` is a protected child of the existing shell, with four sections:

1. **Profile:** read-only username; editable display name; explicit Save and an announced success/error.
2. **Password:** current/new/confirm inputs with appropriate `autocomplete` values and no persisted password state. Explain that success signs out all sessions. On 204 clear local auth and secret inputs, release the pending guard, navigate to Login and show a non-secret one-time success notice.
3. **Household:** name and member display names/roles/active status, read-only for owners and members alike.
4. **Data:** CSV filter/download controls and static, honest backup guidance: CSV is not a full backup; database recovery is an administrator operation; users should ask their administrator about the configured schedule. Do not invent a last-backup timestamp or imply a scheduler is already installed.

Reuse `PendingFormService` for mutations: one write at a time, prevent duplicate Save and route-away/sign-out while pending, release on success/error. Wrong-password, 403 and connection failures show errors without automatic replay; retain profile input, never cache secrets outside the password form. Clear password inputs on success or page destruction. Read failures offer GET-only Retry and must not render as empty member lists.

### 2.2 CSV request, content and browser behavior

`GET /api/export/transactions.csv` requires `require_household`. Owner/member behavior is identical. It supports only the specified optional filters:

| Parameter | Meaning and validation |
|---|---|
| `from` | Inclusive calendar date, exactly `YYYY-MM-DD`, valid date in years 0001–9999; alias the Python name `from_date`. |
| `to` | Inclusive calendar date with the same validation; if both supplied, `from <= to`, otherwise 422 with a field error. |
| `accountId` / `categoryId` | Integer IDs bounded to `1–9007199254740991` before SQLite binding; malformed/out-of-range values return 422. Reuse `get_account` / `get_category`; missing and foreign IDs return the same generic 404. Archived references remain valid. This bounds the new export API, not an unrelated transaction-ID refactor. |

No filters means all household transactions. A single bound is valid. No month/type/search additions are needed to satisfy this endpoint. Preserve existing transaction-list filtering and ordering; do not broaden its public contract just to implement CSV.

One joined query reads transaction date/description/amount and current account/category names, with explicit household predicates on transactions **and both joins**. Include archived history and renamed resources; never use an active-only selector to hide historical records. Sort by `transaction_date DESC, created_at DESC, id DESC`. Produce all rows from one query snapshot, not per-row follow-up queries.

Exact column order:

```csv
date,description,account,category,type,amount,currency
2026-09-07,Groceries,Checking,Food,expense,-84.72,EUR
```

- UTF-8 without BOM, comma delimiter, CRLF record endings, normal `csv.writer` quoting. Null descriptions become empty cells; quotes, commas, Unicode and embedded line breaks remain structurally valid.
- `date` is ISO calendar text; `type` is `income` for positive and `expense` for negative cents; `currency` is always `EUR`.
- Amounts use an optional minus sign, decimal point and exactly two fractional digits. No exponent/grouping/localization and no floating-point division. Apply `checked_cents` before emitting a row; overflow returns the normal 409 envelope before download headers/body start.
- Neutralize spreadsheet formulas in **description, account and category**, never numeric amount. Prefix a literal apostrophe when the first meaningful character is `=`, `+`, `-` or `@` after leading whitespace/control/format characters, or when the original text begins with a control/format character. Preserve the original text after the prefix. CSV quoting alone is not formula protection.
- This protection deliberately changes dangerous text cells. State that CSV is a spreadsheet-safe export, not a lossless database backup; saving/reopening through third-party spreadsheet software is outside this endpoint's guarantees.
- Empty results return 200 and the header row, not 404 or 204.
- Headers: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="transactions.csv"`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`. Use a fixed filename, not user input.
- Build the small household export before returning `Response`. No export job table or streaming generator tied to a request-scoped session. Record the deliberate O(n) buffered-size ceiling in a `ponytail:` comment; revisit only if measured exports outgrow memory.

Settings provides optional native date controls and account/category selectors populated by existing services with archived entries included and labelled. Dates and selectors default blank (all history); filters are page-local. Download through `HttpClient` with `responseType: "blob"` so 401 recovery still runs; create a temporary same-origin Blob URL only on success, trigger the download, then remove the anchor and revoke the URL after the download has been initiated. No new file-saving library.

Lookup failures are separate from export availability: the existing account-list API computes balances and can fail on aggregate overflow even when every transaction is exportable. Show a selector-load error with GET-only Retry, but leave unfiltered/date-only export available; do not silently clear a previously selected filter or include a stale selection under an “All” label.

Blob error responses still contain the shared JSON envelope: decode a JSON error Blob for field errors; never download an error page or dump raw HTML/tracebacks into the UI. Prevent duplicate downloads, reset busy state on error, cancel an abandoned GET on destruction, and offer an explicit retry. Downloads are reads, not global pending writes; no mutation replay or session token in query strings.

### 2.3 Production security and operations

Keep a single Compose file and the existing two images; configuration and operator-supplied environment values select development or production. Retain development defaults in `.env.example` and put production setup instructions in `docs/DEPLOYMENT.md`, not a second competing Compose stack.

Required behavior:

- Production validates high-entropy secret policy, Secure cookies, absolute SQLite file path, session lifetime, nonempty exact host allowlist and exact HTTPS origins. Parse origins with `urllib.parse.urlsplit`; reject credentials, wildcard hosts, paths (including trailing slash), query, fragment, malformed ports and whitespace. Require each origin hostname to occur in the trusted-host allowlist. A hostname entry is not a URL or `host:port`; no wildcard patterns or loopback hosts in production. Preserve development/test behavior.
- Disable `/docs`, `/redoc` **and `/openapi.json`** in production. Do not expose them through the SPA fallback.
- Apply `Cache-Control: private, no-store` to `/api` responses, including financial data, settings, exports and errors. Static fingerprinted assets are not financial API data and need not inherit this policy.
- Backend runs UID 10001, one worker, with no published host port and `--no-proxy-headers`. Keep the conservative socket-IP limiter rather than trusting arbitrary forwarded headers. Document that clients behind Caddy share its IP bucket; username buckets remain separate. Per-client trusted-proxy tuning is not required for this milestone.
- Fix the internal health probe by supplying a configured trusted Host header while connecting to `127.0.0.1:8000`; keep the exact same database-backed health route. Reject or fail clearly for malformed host configuration; do not weaken TrustedHostMiddleware to make the probe pass.
- Protect application files from writes by the runtime user: root-owned code, runtime-writable database directory; a read-only container root plus a small `/tmp` tmpfs is acceptable if the real migration/startup/CLI smoke passes. Drop capabilities and use `no-new-privileges` on the backend. Do not make Caddy unable to manage its own data/CA volumes.
- Publish only Budget HTTPS on intended host address(es). Current Compose supports one binding: document a reviewed explicit second binding if LAN and tailnet use distinct host addresses; inspect the resolved port list, since Compose list merging can retain unwanted bindings. Do not replace this with `0.0.0.0` merely for convenience. TCP is sufficient; do not add public port 80 or UDP exposure.
- Persist and protect Caddy CA/state; clients trust the public root certificate, never receive the CA private key. Keep HTTPS and Secure cookies on LAN and Tailscale.

**CSP decision:** use a static policy compatible with the current static-Caddy architecture. Disable production critical-CSS inlining so no inline script/onload exception is needed. Allow inline **styles only** for Angular's existing injected component styles, as documented by Angular; no script `unsafe-inline`, no `unsafe-eval`, no wildcard script origins, no nonce-generation service. This is a deliberate style-level limitation, not a development-JIT exception.

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Prove the built application, dynamic component styles, login, all routes and download work under this policy; do not infer compatibility from the dev server. HSTS is an explicit operator-enabled step **after** certificate and hostname trust succeeds: start with `max-age=86400`, then `max-age=31536000` after validation; no `includeSubDomains` or preload for the private deployment. Record whether it is enabled.

**Network contract:** household devices may reach Budget; Emby-only friends/siblings may not establish Budget HTTPS, while intended Emby access remains available. A new restrictive grant cannot override an existing broad grant. If both services share IP and port 443, hostname routing is not service isolation: deployment must supply a separate Budget address/tailnet identity or an explicitly chosen separate port, with matching policy/origins. Do not guess or automatically alter the existing Emby policy.

### 2.4 Backup and restore

Add root-level `scripts/backup.py` and `scripts/restore.py`, executed with host Python against host paths. Both use only stdlib; the existing `backend/scripts` remains browser-seeding infrastructure. No container scheduler and no web backup/restore endpoints.

Commands, from repository root:

```text
python scripts/backup.py --database <absolute-db-path> --destination <absolute-backup-directory> --keep-days 30
python scripts/restore.py --backup <absolute-snapshot-path> --database <absolute-offline-db-path> --confirm
```

Angle-bracket values are operator inputs, never literal defaults. Document concrete disposable examples and actual deployment values privately; do not commit real secrets or financial paths in evidence.

**Backup contract:**

1. Resolve and validate explicit paths. Source must be an existing regular database file; open SQLite URI `mode=ro` so a typo cannot create a new empty source. Reject unsafe source/destination aliases and symlink targets; backup directory must not be within the app's static files or ephemeral container layer.
2. Create a uniquely named temporary destination inside the backup directory with restrictive permissions. Use `sqlite3.Connection.backup()`; a live WAL database is supported. Bound busy/retry time via progress/deadline handling so the daily job exits nonzero rather than waiting forever.
3. Validate the snapshot with `PRAGMA integrity_check` and `foreign_key_check`, require the expected Budget tables and `alembic_version`, close/checkpoint its connections, flush the completed file, and atomically publish a UTC timestamped `budget-<timestamp>.sqlite` in the same directory. It must reopen as a standalone database without adjacent WAL/SHM. Avoid timestamp collisions; never overwrite a previous snapshot.
4. Only after successful publication, remove script-owned completed backups older than the configured UTC age cutoff; default `--keep-days 30`, positive integer. Never prune on backup failure, prune temporary files as historical snapshots, follow symlinks or delete unrelated files. Always retain the snapshot just created. A pruning failure is visible/nonzero even if backup publication succeeded.
5. Exit 0 only for a successful backup and retention pass. Print path/revision/success information, not table contents, financial details, credentials or tokens. Clean only this invocation's temporary files on error.

Retention resolves the broad roadmap wording as **30 calendar days of completed snapshots**, not 30 guaranteed successful runs: a missed day is an operational failure to investigate. Do not silently claim daily coverage when the scheduler failed. Weekly/monthly/offsite tiers are not required.

**Restore contract:**

1. The documented workflow stops the backend and verifies the Compose service is stopped before invoking the script. Stop the backup scheduler and any standalone CLI/app database connections too. `--confirm` attests to this offline requirement and intentional replacement; without it, fail before opening a writable target. A SQLite lock alone cannot prove that no idle backend process exists; do not advertise automatic process detection.
2. Reject missing/corrupt/non-Budget input, source/target aliases, symlink targets and unsupported schema versions before changing the target. M6 restores revision `0005_budgets`; older/newer snapshots require the matching application release and an explicit migration procedure, not schema guessing.
3. Prepare a new standalone database on the target filesystem using the backup API, leaving the source snapshot immutable. Validate it, delete **all rows from `sessions` in the staged database**, commit and verify again. Never reintroduce saved session tokens to the live service; changing `SESSION_SECRET` alone is not session revocation.
4. If a target exists, produce a verified, uniquely named pre-restore snapshot outside retention pruning before replacement. Use the same backup primitive with pruning disabled, not raw copying of a possibly WAL-backed target. If preservation fails, leave the target untouched and abort. If the target is already corrupt, fail safely and retain it for a manual recovery procedure; do not add a force-delete flag.
5. While offline, checkpoint/close the old target, preserve its known ownership/mode or require a writable prepared destination, then remove only its obsolete `-wal`/`-shm` after successful preservation and before `os.replace`. Publish the staged file atomically in the target directory; flush file/directory metadata where supported. Never delete the target first. Failures before replacement retain the original usable database; failures after replacement keep the verified recovery files and backend stopped.
6. On POSIX use 0600 files/private directories and preserve target UID/GID when replacing an existing database; abort if required ownership cannot be preserved. For a new target the operator prepares/chowns the directory for UID 10001 before starting. On Windows, document restricted NTFS ACLs: `chmod` alone does not prove confidentiality.
7. With the backend still offline, run Alembic against the restored volume using a one-shot backend container, inspect revision, then start. All previous browser sessions must get 401; a fresh login reads the restored records. Keep source/pre-restore snapshots until the drill is accepted. Restoring credentials also restores their historical state; an incident recovery must reset affected passwords offline before reopening access.

`docs/BACKUP_RESTORE.md` supplies daily scheduler instructions (systemd timer or cron for the chosen Linux host, Task Scheduler if the actual server is Windows), exact host-path commands, a no-overlap rule, exit/log checks, disk-space monitoring and a periodic drill. Backups contain financial data and password hashes; restrict access. CA private-key/state protection and recovery are documented separately from the SQLite snapshot. Never run migrations on production data without a fresh verified backup.

## 3. File Map and Execution Order

| Task | Create | Modify/reuse |
|---|---|---|
| 6.1a — Settings/export API | `backend/app/settings.py`, `backend/app/export.py`, `backend/tests/test_settings.py`, `backend/tests/test_export.py` | `backend/app/schemas.py`, `main.py`, `auth/router.py`, `backend/tests/test_auth.py`; reuse `accounts.py`, `categories.py`, `money.py`, `transactions.py` semantics |
| 6.1b — Settings UI and browser download | `frontend/src/app/features/settings/settings.service.ts`, `settings.page.ts`, `settings.page.spec.ts`, `frontend/e2e/settings.spec.ts` | `frontend/src/app/core/api/models.ts`, `core/auth/auth.service.ts`, `core/auth/auth.service.spec.ts`, `features/login/login.page.ts`, `app.routes.ts`, `layout/app-shell.ts`, `backend/scripts/seed_e2e.py`, `frontend/playwright.config.ts` |
| 6.2a — Recoverable database operations | `scripts/backup.py`, `scripts/restore.py`, `backend/tests/test_backup_restore.py`, `docs/BACKUP_RESTORE.md` | Existing migrations, model/table definitions and disposable fixtures are references, not a new schema |
| 6.2b — Private production deployment | `docs/DEPLOYMENT.md`, `docs/tailscale-policy.example.json` | `backend/app/config.py`, `main.py`, `backend/tests/test_config.py`, `test_health.py`, `backend/Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.env.example`, `frontend/angular.json`; `.gitignore` only if a new artifact format requires it |
| 6.3 — Integrated release acceptance | `frontend/e2e/household.spec.ts` | Browser seed/config if needed; after proof, `README.md`, `state.md`, `docs/LUNA_HANDOFF.md`, deployment/recovery docs |

Default order is 6.1a → 6.1b → 6.2a → 6.2b → 6.3. API work and standalone recovery scripts can be implemented independently if explicitly parallelized. A frontend owner may consume the fixed API contract after it is frozen. One integration owner serializes shared `main.py`, schemas, browser seed/config and docs; concurrent workers skip tests/build/lint until edits settle, and the controller validates centrally. Do not split out scaffolding-only tasks.

Before changing exported symbols, inspect references with LSP when available, otherwise every caller. Re-read changed source: this document is a contract, not permission to overwrite later user work. Commits are optional checkpoints only after separate user authorization.

## Task 6.1a — Scoped Settings and Safe CSV API

**Consumes:** `require_household`, `HouseholdContext`, `get_db`, existing identity/financial models, `ResourceName`, `UserResponse`, `APIError`, `checked_cents`, household-scoped resource lookups and migrated pytest fixtures.

**Produces:** the three settings contracts in §2.1; export in §2.2; `ProfileUpdate`, `HouseholdMemberResponse`, `HouseholdDetailsResponse`; two feature routers registered in `create_app`. The existing password endpoint stays in `auth/router.py`.

- [ ] **1. Add a profile/session regression using existing fixtures; run it before implementation.** For example:

```python
def test_profile_is_persisted_without_revoking_session(authenticated_client, csrf_headers):
    response = authenticated_client.patch(
        "/api/users/me",
        json={"displayName": "  Renamed member  "},
        headers=csrf_headers(),
    )
    assert response.status_code == 200
    assert response.json()["displayName"] == "Renamed member"
    me = authenticated_client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["user"]["displayName"] == "Renamed member"
```

Run from `backend`: `python -m pytest tests/test_settings.py tests/test_auth.py`. The new profile case should fail because its endpoint does not exist. Extend the existing auth regression to assert wrong-current-password 422 plus a still-valid session, and successful change invalidating a second independent session.

- [ ] **2. Add explicit schemas and profile/household routes.** New profile schema uses the same strict-body convention, not a second name validator:

```python
class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    display_name: ResourceName = Field(alias="displayName")
```

Use `context.user_id` for the update and `context.household_id` for membership queries. Return only `UserResponse` fields, validate response before commit, and roll back failures following existing handlers. The household query joins `HouseholdMember.user_id == User.id`, filters the membership household, and explicitly builds `{id,displayName,role,isActive}` records. Do not serialize SQLAlchemy identity objects wholesale. Register both new routers under global dependencies.

- [ ] **3. Correct wrong-password semantics at the existing source.** Preserve the rollback and all other branches:

```python
raise APIError(
    422,
    "VALIDATION_ERROR",
    "The request could not be processed.",
    {"currentPassword": "Current password is incorrect."},
)
```

Update tests/callers that expected the old wrong-password 401. Genuine 401 behavior and existing cookie/session revocation tests must remain intact.

- [ ] **4. Add export request validation and one household-scoped joined projection.** Use query aliases `from`/`to`, strict regex/date parsing like `TransactionWrite.calendar_date`, positive ID bounds and the existing scoped lookup helpers. Reuse the few filter predicates and sort conventions locally; do not extract a generic query framework or change `TransactionFilters` just for four export filters. Both date bounds are optional, and invalid/misordered bounds fail before querying/exporting.

Core query shape, adding only supplied filter predicates:

```python
statement = (
    select(Transaction, Account.name, Category.name)
    .join(Account, (Account.id == Transaction.account_id)
          & (Account.household_id == context.household_id))
    .join(Category, (Category.id == Transaction.category_id)
          & (Category.household_id == context.household_id))
    .where(Transaction.household_id == context.household_id)
    .order_by(Transaction.transaction_date.desc(),
              Transaction.created_at.desc(), Transaction.id.desc())
)
```

Rows and current names come from this one statement; do not call account-balance aggregation or load all other households. Keep query values parameterized.

- [ ] **5. Write CSV through stdlib with integer-only amount rendering and text neutralization.** Keep these CSV-only helpers in `export.py`, not a new utility hierarchy:

```python
import unicodedata


def csv_amount(cents: int) -> str:
    cents = checked_cents(cents)
    whole, fraction = divmod(abs(cents), 100)
    return f"{'-' if cents < 0 else ''}{whole}.{fraction:02d}"


def csv_text(value: str | None) -> str:
    value = value or ""
    index = 0
    while index < len(value) and (
        value[index].isspace()
        or unicodedata.category(value[index]) in {"Cc", "Cf"}
    ):
        index += 1
    begins_control = bool(value) and unicodedata.category(value[0]) in {"Cc", "Cf"}
    begins_formula = index < len(value) and value[index] in "=+-@"
    return "'" + value if begins_control or begins_formula else value
```

Use `io.StringIO(newline="")`, `csv.writer`, one exact header row and the fixed attachment headers from §2.2. Validate/build fully before returning `Response`; errors remain JSON. No floating-point money or spreadsheet escaping on amount cells.

- [ ] **6. Keep boundary tests that defend real contracts.** In `test_settings.py`: anonymous 401, CSRF 403, strict/blank/oversized name 422, active owner's/member's own profile only, foreign household excluded, inactive member labelled without credential disclosure. In `test_export.py`: two-household isolation including poisoned cross-household joins, missing/foreign filter parity, owner/member access, inclusive one-/two-sided dates including leap/year bounds, archived/renamed names, stable ties, empty header, cents `-1`, `-8472`, `9007199254740991`, exact columns and download headers, CSV parsing of commas/quotes/newlines/Unicode, formula prefixes with whitespace/control/BOM. Check safe ordinary text is unchanged and numeric negatives remain numeric.

For a concrete parser oracle:

```python
import csv
import io


def test_empty_export_is_a_download(authenticated_client):
    response = authenticated_client.get("/api/export/transactions.csv")
    assert response.status_code == 200
    assert list(csv.reader(io.StringIO(response.text))) == [
        ["date", "description", "account", "category", "type", "amount", "currency"]
    ]
    assert response.headers["content-disposition"] == 'attachment; filename="transactions.csv"'
    assert "no-store" in response.headers["cache-control"]
```

Use current fixture/API creation patterns; no shared real DB, manual-schema fixtures or tests that only inspect source text. Run `python -m pytest tests/test_settings.py tests/test_export.py tests/test_auth.py tests/test_authorization.py`.

**Acceptance:** profile updates persist without logout; a wrong password preserves the login; successful password changes revoke all sessions; household details and CSV reveal only allowed records; parsed CSV matches exact filtered transactions.

## Task 6.1b — Settings Forms and Real Browser Download

**Consumes:** §2.1–2.2 API shapes, existing `AuthState`, account/category services, `authGuard`, `PendingFormService`, form error/focus patterns and generated Playwright credentials.

**Produces:** guarded `/settings`, Settings navigation, `SettingsService.household()` and `exportTransactions(filters)`, `AuthService.updateDisplayName(displayName)` and `changePassword(currentPassword,newPassword)`, actual download/password browser evidence.

- [ ] **1. Extend types and service methods without another auth store.** Add `HouseholdDetails`/member and `ExportFilters` types in the existing API model file; `ExportFilters` is `{ from?: string; to?: string; accountId?: number; categoryId?: number }`. Add these concrete AuthService methods:

```typescript
updateDisplayName(displayName: string): Observable<AuthState["user"]> {
  return this.http.patch<AuthState["user"]>("/api/users/me", { displayName }).pipe(
    tap((user) => this._authState.update((state) =>
      state?.user.id === user.id ? { ...state, user } : state)),
  );
}

changePassword(currentPassword: string, newPassword: string): Observable<void> {
  return this.http.post<void>("/api/auth/change-password", { currentPassword, newPassword }).pipe(
    tap(() => this.clear()),
  );
}
```

Use the existing HttpClient CSRF configuration for authenticated mutations. Do not call `restore()` as a profile refresh or resend a failed mutation after 403. After profile success, replace the matching current user's display name in the page's member list too; do not leave the shell and Members disagreeing. `SettingsService.household(): Observable<HouseholdDetails>` issues the household GET; `exportTransactions(filters: ExportFilters): Observable<Blob>` uses `HttpParams` built from defined filter values and `http.get('/api/export/transactions.csv', {params, responseType:'blob'})`. A late profile response must not resurrect a cleared login or overwrite a different user's identity.

- [ ] **2. Implement the four settings sections and route/link.** Reuse standalone reactive forms, labelled controls, associated field errors, success live regions, pending ownership and focus restoration. Separate household load failure from profile state; one failed read must not erase the logged-in identity. Use code-point length for the name consistently with existing forms. Add a protected shell child and its navigation link, not a second shell.

Password confirmation must match before sending; autocomplete is `current-password` / `new-password`. On success clear passwords and pending state before navigating to exact `/login`; preserve the existing guard's explicit permission for that login path during pending work. Use navigation state `{passwordChanged:true}` for a one-time Login notice; consume only that fixed boolean and clear it from history state after reading. Never put passwords, arbitrary return URLs or server messages into navigation storage. Keep the interceptor unchanged.

- [ ] **3. Implement the CSV controls and Blob download/error path.** Include archived options via existing list calls; do not compute balances/totals client-side to generate CSV. Load selectors independently from export so account-balance overflow cannot disable date-only/all-history downloads. The backend remains authoritative for range/ID validation. Keep input on validation/network failures and show an alert; a response Blob with JSON error type is parsed only for the existing envelope, with a generic fallback if parsing fails. Create/revoke object URLs only for successful CSV responses and avoid persistent browser storage.

- [ ] **4. Add narrowly scoped frontend checks.** Cover observable contracts: profile save updates the shell name without re-login; wrong-password validation preserves identity and allows correction; success clears auth and permits Login navigation; pending writes prevent duplicate/route/sign-out actions and release on failure; confirmation mismatch sends nothing; malformed-range errors remain visible; failed exports never produce a download. Test bodies should exercise rendered forms and public HTTP behavior, not private flags or method-forwarding echoes.

Run from `frontend`: `npm test -- --watch=false --include=src/app/features/settings/settings.page.spec.ts --include=src/app/core/auth/auth.service.spec.ts`.

- [ ] **5. Seed dedicated M6 identities and exercise the actual browser at both widths.** Add generated `BUDGET_E2E_SETTINGS_PASSWORD` → backend `E2E_SETTINGS_PASSWORD`; seed `e2e-settings-1280` and `e2e-settings-390`, each in its own household with a second member for read-only listing. Never change `e2e-user`, dashboard or budget credentials. For retries, normalize only the dedicated disposable settings identities or use an isolated per-attempt household; a successful password change in a failed attempt must not poison the retry.

In `e2e/settings.spec.ts`, use real UI/HTTP, not route mocks:

1. Log in; edit name; observe shell/household after refresh and persistence after reload.
2. Submit wrong current password; remain on Settings, display the field error, and prove a financial GET still succeeds.
3. With a second browser context already authenticated as that same user, change the password correctly; first context returns to Login, second session gets 401, old password fails and new password succeeds. Restore the dedicated seed password through the real change-password endpoint after the scenario, or make retry seeding deterministic without touching other test identities.
4. Seed/create known transactions including archived references and CSV-special text, select date/account/category filters, download the real response and parse the saved bytes through Python `csv` or assert against a known `csv.writer` oracle. Do not parse CSV by splitting on comma/newline.
5. Assert the exact date/amount/row set and formula neutralization; export an empty interval and read its header.
6. Exercise keyboard navigation, associated validation, pending UI and real offline failure; inspect screenshots at 1280×900 and 390×844, including loading/error states. No document overflow or clipped form actions.

Core Playwright download sequence:

```typescript
const downloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: "Download CSV", exact: true }).click();
const download = await downloadPromise;
expect(await download.failure()).toBeNull();
expect(download.suggestedFilename()).toBe("transactions.csv");
await download.saveAs(testInfo.outputPath("transactions.csv"));
```

Run `npx playwright test e2e/settings.spec.ts`. Visual inspection requires actually opening the page or screenshots; image creation alone is not visual proof.

**Acceptance:** user-visible settings and download work through the real app at both sizes; no accidental logout on a password typo, stale shell name, downloaded error response or shared-test credential mutation.

## Task 6.2a — Verified Snapshots and Offline Recovery

**Consumes:** current `0005_budgets` database, `sessions` table, stdlib SQLite/argparse/path/tempfile/os/date facilities, existing migrated pytest fixture and administrator-owned explicit filesystem paths.

**Produces:** §2.4 commands and documented lifecycle. Share only `create_snapshot(database: Path, destination: Path) -> None` from `scripts/backup.py`; it writes a new standalone verified destination without retention. `restore.py` imports this sibling when run as a script. Each executable has `main(argv: list[str] | None = None) -> int` and a `__main__` guard; importing does not execute CLI work.

- [ ] **1. Add observable subprocess regressions against a migrated temporary database.** Tests invoke the root scripts with `sys.executable` and explicit paths, not imports of the application global database. Make the first backup test fail because the script does not exist. Seed identity/account/category/transaction/budget data and an active session in the existing temporary fixture.

```python
result = subprocess.run(
    [sys.executable, str(repo_root / "scripts" / "backup.py"),
     "--database", str(database), "--destination", str(backups), "--keep-days", "30"],
    capture_output=True, text=True, timeout=30,
)
assert result.returncode == 0, result.stderr
snapshots = list(backups.glob("budget-*.sqlite"))
assert len(snapshots) == 1
with sqlite3.connect(snapshots[0]) as restored:
    assert restored.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    assert restored.execute("SELECT sum(amount) FROM transactions").fetchone() == (-8472,)
```

Define `repo_root`, `database`, `backups` inside the test from `Path(__file__).resolve().parents[2]`, the migrated fixture's database path and `tmp_path`; do not infer the application's normal DB path.

- [ ] **2. Implement backup validation/publication before retention.** The core operation uses:

```python
source_uri = database.resolve().as_uri() + "?mode=ro"
with sqlite3.connect(source_uri, uri=True) as source:
    with sqlite3.connect(destination) as target:
        source.backup(target, pages=256, progress=check_deadline, sleep=0.1)
        if target.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("Snapshot integrity check failed.")
        if target.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ValueError("Snapshot foreign-key check failed.")
```

`check_deadline(status: int, remaining: int, total: int) -> None` compares `time.monotonic()` to a deadline established before the backup (default 60 seconds) and raises `TimeoutError` when exceeded. Explicitly close both SQLite connections: connection context managers commit/rollback but do not close. Finish the standalone-journal/file-flush validation and exclusive temp/publication handling before declaring success. Share this primitive with restore rather than duplicating it.

- [ ] **3. Implement retention and failure visibility.** Parse generated filenames to determine the UTC age cutoff; only known final backup names qualify, not arbitrary `*.sqlite` files or pre-restore snapshots. Validate `--keep-days > 0`. Use a host-scheduler no-overlap setting and document one writer per destination. Test successful pruning, failed backup preserving old snapshots, unrelated-file retention, missing/corrupt source refusing without creating a database, timeout/failed publication cleanup, and file permissions where the OS supports them.

- [ ] **4. Implement offline restore as staged publication.** Follow the ordered contract in §2.4. Validate first; stage; delete sessions in the staging DB; snapshot the existing target to `budget-pre-restore-<UTC timestamp>.sqlite`; checkpoint/close the old target; remove stale sidecars; `os.replace(staged, database)`. Inspect the SQLite checkpoint result and abort on busy/incomplete checkpoint before touching any sidecar; a backup alone does not prove the old main file contains its WAL. Never edit the source backup or start the backend from the script. Document the difference between operator-confirmed offline state and SQLite locks. Provide actionable errors, not a flag to bypass source validation or preservation.

- [ ] **5. Keep data-loss/session regressions and run an actual drill.** Test that missing `--confirm`, corrupt/wrong-revision source and failure to preserve the existing target leave it unchanged; source snapshot bytes stay unchanged; restored records/totals match the saved point; post-snapshot records disappear as expected; pre-restore snapshot retains them; restored `sessions` is empty; target and snapshots reopen without sidecars. Exercise live WAL backup while a second connection commits transactions; check a consistent referentially valid state, not a predetermined racing row count.

Run from `backend`: `python -m pytest tests/test_backup_restore.py`. Then run the scripts as real commands against disposable database directories. Start the real app against the restored DB, verify old cookie 401 and fresh-login dashboard/budget/CSV exact values. Retain command/output evidence; no mock is a substitute for this recovery drill.

- [ ] **6. Write the operator guide from exercised commands.** Include scheduler install/enable/check steps for the selected host, backup path/retention/permissions, zero-overlap behavior, failure logs and disk capacity, offline restore, UID 10001 handling, migration pre-backup rule, incompatible-revision handling, damaged-target manual preservation, and periodic drill cadence (monthly and before upgrades). Use a recovery Compose project with separate data/Caddy volumes and host port, not the production project or `down -v`.

**Acceptance:** a live WAL snapshot restores independently; failed operations do not erase good backups/target data; retained sessions cannot authenticate; commands and scheduling/recovery instructions agree.

## Task 6.2b — Private, Validated Production Configuration

**Consumes:** existing Compose/Caddy topology, `Settings`, working M6 app and verified recovery commands. Actual deployment inputs are collected before applying host/network changes (see §4).

**Produces:** hardened configuration, built-app CSP evidence, private deployment/CA/firewall documentation and a least-privilege Tailscale policy example.

- [ ] **1. Extend production-config tests around actual rejected values.** Keep `backend/tests/test_config.py`; do not create a second production settings implementation or redundant config-test file. Cover valid exact HTTPS origin with/without a nondefault port, wildcard trusted host, userinfo, trailing slash/path/query/fragment, invalid port, HTTP, wildcard/missing host, origin/allowlist mismatch, insecure secret/cookies and a relative DB path. Test development defaults still start.

Use `urlsplit` and parsed `hostname`/`port`, checking literal origin shape as well as parser output; reject whitespace that `urlsplit` may silently strip. Keep current secret checks rather than claiming string diversity proves entropy. Document generating `SESSION_SECRET` with `secrets.token_urlsafe(48)`.

- [ ] **2. Close production API metadata/cache gaps and fix health.** Set `openapi_url=None` in production alongside existing docs flags. Extend the existing response middleware's cache policy from auth-only to `/api` and `/api/*`; ensure errors also carry it. Test protected JSON and CSV responses/401s, and production OpenAPI absence, through a configured app.

The Compose healthcheck connects locally while sending a configured allowed Host header, using Python `urllib.request.Request(..., headers={"Host": host})`. Derive `host` from the same production trusted-host configuration; do not add a fake public hostname or loopback exception. Prove the real container becomes healthy under `APP_ENV=production`, not only in a TestClient.

- [ ] **3. Harden the existing images/Compose without multiplying services.** Keep backend source root-owned and chown only `/app/data` rather than all `/app`. Preserve executable/readable migrations and CLI code, single worker, disabled proxy-header trust and no backend `ports`. Add backend capability drops/no-new-privileges and test read-only-root/tmpfs compatibility if selected. Prepare bind-mount ownership explicitly; build-time chown does not change an existing host mount. Do not mount backups or secrets into the frontend image.

- [ ] **4. Add built-app security headers and the documented CSP configuration.** In the production build set:

```json
"optimization": {
  "scripts": true,
  "styles": { "minify": true, "inlineCritical": false },
  "fonts": false
}
```

Apply the headers in §2.3 through Caddy. Keep `/api` routing ahead of the SPA fallback, including unknown API routes. No insecure TLS browser override is acceptable as production trust evidence. HSTS remains off until the operator validates hostname/CA trust, then is enabled using the documented staged max-age.

Run an isolated production Compose build and use a browser to exercise login, shell navigation, Settings, budgets and download. Capture console/CSP violations and response headers; if the actual build needs another source, identify the exact asset and solve it narrowly rather than adding script `unsafe-inline`/`unsafe-eval`.

- [ ] **5. Write deployment and Grants documentation with explicit boundaries.** `docs/DEPLOYMENT.md` includes first boot, high-entropy secret creation, private DNS on LAN/tailnet, Caddy root-certificate trust, data ownership, bootstrap/member/reset CLI, start/stop/upgrade/rollback, backups before migration, binding verification and the release table in §4. Supply `docs/tailscale-policy.example.json` as a merge example, not a policy-replacement command:

```json
{
  "groups": { "group:household": ["household-user@example.com"] },
  "tagOwners": { "tag:budget": ["autogroup:admin"] },
  "grants": [
    { "src": ["group:household"], "dst": ["tag:budget"], "ip": ["tcp:443"] }
  ]
}
```

These are illustrative identities; the operator maps them to real tailnet users/device tags and includes deny assertions for actual Emby-only identities. Audit all existing ACLs/grants, shared-node paths and subnet-router routes for additive access. Preserve existing Emby access. If a dedicated Budget port is chosen, change the grant/origin/listener consistently and record that decision.

For Linux Docker Engine, document its actual iptables/nftables backend and Docker forwarding path; do not claim UFW INPUT rules alone protect published ports. For Docker Desktop/Windows hosts, use the relevant host firewall and verify actual behavior instead of copying Linux commands. Include both IPv4 and IPv6; no AAAA record is not proof of no IPv6 reachability. Do not automate firewall changes blindly or expose the service while testing denial.

- [ ] **6. Run focused configuration/deployment checks.** From `backend`: `python -m pytest tests/test_config.py tests/test_health.py tests/test_auth.py tests/test_export.py`. Against a disposable project: `docker compose config`, `docker compose build`, `docker compose up -d`, backend health/revision, bootstrap and real HTTPS browser login. Inspect resolved port mappings, UID, writable mounts, cookie flags, private/no-store and security headers. Disable/redact secret-bearing Compose output in saved evidence. Run real network checks only with authorization and access to the required devices.

**Acceptance:** production config fails closed on invalid settings; valid isolated production deployment becomes healthy and renders the app under CSP/TLS; operator docs clearly describe the remaining real-host checks, not fictional pass results.

## Task 6.3 — Complete Workflow and Release Evidence

**Consumes:** all completed feature/operations tasks and previous milestone regression coverage. **Produces:** source §42's complete E2E sequence, §43 acceptance evidence, honest release status and current operator/user documentation.

- [ ] **1. Add one full-household scenario at both existing viewport sizes.** Use its own generated `BUDGET_E2E_HOUSEHOLD_PASSWORD` → `E2E_HOUSEHOLD_PASSWORD` and `e2e-household-1280` / `e2e-household-390` identities. Do not reuse settings identities whose passwords change. Keep real forms/navigation/API and a fixed browser calendar; use full unique resource suffixes or fresh households so retries cannot collide.

Exact oracle, for a selected September 2026 period:

| Step | Expected observable result |
|---|---|
| Login, create checking account with initial `100000` cents | Balance `100000` |
| Create expense category Food, add `-8472` dated `2026-09-07` | Transaction shows `-84,72 €` in existing locale |
| Open September Dashboard | Income `0`, expenses `8472`, net `-8472`, balance `91528`, Food spending `8472`, expense appears in recent rows |
| Set Food budget `60000` | Spent `8472`, remaining `51528`, progress `0.1412`; Budget/Dashboard show readable corresponding values |
| Export September | One expense row with `-84.72`, `EUR`, correct date/account/category |
| Logout, back/reload/protected deep-link | No financial data; Login required; direct API returns 401 |

The browser asserts user-visible behavior and exact API cents where needed; it does not recalculate dashboard finance logic as a new implementation. Preserve separate settings/session-revocation coverage.

- [ ] **2. Map existing tests to §42 and fill only real gaps.** Review authentication, two-household accounts/categories/transactions/budgets/dashboard isolation, financial sums/precision/over-budget and frontend auth/guard/money/main-form coverage already present. Add export/settings and restoration boundaries from earlier tasks; do not duplicate passing milestone suites just to inflate counts. Check log output excludes request cookies, password/CSRF/session values and transaction descriptions.

- [ ] **3. Inspect actual desktop/phone surfaces, including carried visual gaps.** Visit Accounts, Categories, Transactions, Dashboard, Budgets and Settings in the real built app. Inspect ready/empty/loading/error displays where applicable, keyboard focus, field error associations, contrast, non-color budget states and overflow. Previous screenshot creation or automation-only evidence does not close the visual gap; view the actual captures. Record limitations as unexecuted rather than silently dropping them.

- [ ] **4. Prove migration/persistence/recovery in an isolated deployment.** Upgrade an empty database to head and a seeded M5 copy to head (no-op expected unless a separately justified migration was needed); compare original users/households/account/category/transaction/budget rows and exact totals. Recreate containers without deleting volumes, then log in and recheck data. Back up during real writes, restore into a distinct offline target/deployment, verify old-session denial/fresh-login restored totals and a subsequent successful new write. Never test a downgrade on the real DB.

- [ ] **5. Run final integrated checks once the tree is stable.** From the indicated directories:

```text
# backend
python -m pytest

# frontend
npm test -- --watch=false
npm run build
npx playwright test
```

Also retain the actual disposable Compose/HTTPS/CSP/recovery commands and output. Fix failures in their source; report actual results, not predicted counts or inherited M5 evidence as new proof.

- [ ] **6. Execute or explicitly leave open every real-network release check in §4.** Unit tests, policy JSON validation, local loopback and a screenshot are not substitutes for allowed/denied-device reachability or CA trust. A blocked external gate does not prevent finishing local work, but it prevents full-MVP/production-ready status.

- [ ] **7. Update current docs only after proof and hand off for user review.** Update `README.md` with settings/export contracts, backup/deployment links and exercised startup/admin commands; remove its now-obsolete “settings and CSV remain out of scope” wording. Update `state.md` with exact task/gate status and evidence, including the historical empty-dashboard-budgets line as historical rather than current behavior. Update only current `docs/LUNA_HANDOFF.md` to the M6 boundary; retain historical M3/M4/M5 handoffs/plans. Remove this work's throwaway scripts/generated data, not permanent recovery/regression code or user files. Do not mark source acceptance boxes passed unless actual evidence supports them.

**Acceptance:** all specified application and recovery behavior is proven; full release status is determined by §4, not by a green build alone. Stop for user review before any production rollout or publication.

## 4. Actual Deployment Inputs and Release Checklist

Planning and local implementation do not require guessing the following inputs. Collect and record them with the operator **before production deployment**:

- Server OS, Docker Engine versus Desktop and firewall backend; actual database/backup paths, UID/ACL ownership and scheduler.
- Budget private hostname, LAN subnet/interface/address, tailnet address/device/tag and whether IPv6 is routed/published.
- Household users/devices and an available denied Emby-only user/device; current complete ACL/Grants policy, shared-node/subnet routes, and Emby's listener IP/port.
- Private DNS behavior on/off LAN, household client OS/browser CA-install procedures, deployment/restore window and explicit authorization for network changes.

The development workstation OS is not evidence of the production server OS. Do not commit actual credentials, secrets, financial exports or CA private keys while recording these inputs.

| Required evidence | Expected outcome | Initial status |
|---|---|---|
| M6 API/frontend/browser suites and full-household workflow | Pass with exact financial/CSV/session assertions | Not executed by this plan |
| Production Compose, health, empty/existing migration, container recreation | Healthy; no unexpected schema/data change or loss | Not executed by this plan |
| Live WAL backup and separate offline restore | Standalone valid snapshot, matching data, revoked restored sessions | Not executed by this plan |
| Daily host scheduler and permissions | Successful scheduled backup, visible failure path, private retained files | Requires actual host |
| Allowed LAN device | Trusted HTTPS, login required, usable financial/settings pages | Requires actual host/device |
| Allowed Tailscale device away from LAN | Trusted HTTPS, application login still required | Requires actual tailnet/device |
| Emby-only device/user | Budget TCP connection denied; intended Emby access still succeeds | Requires actual policy/devices |
| Public IPv4 and IPv6 paths | No Budget connection; router forwarding/Funnel absent | Requires external vantage and host review |
| Backend port | Not published and unreachable from LAN/tailnet/public paths | Requires deployed host/path checks |
| TLS/cookies/CSP/headers/HSTS | Trusted certificate, correct cookie flags, working built app, no unexpected violations; HSTS status recorded | Requires deployed HTTPS browser |
| Source §§42–43 plus settings/accessibility | Each item linked to a command, observed result or explicit open gate | Pending implementation |

A release record includes date, build/commit, tested environment/device roles, command/action, observed result and remaining gate. Redact secrets. Any failed or unexecuted required deployment row leaves **release candidate, deployment gates pending**, not “MVP complete”.

## 5. Coverage and Review Gate

| Source requirement | Owning task/proof |
|---|---|
| §19 profile/password/read-only household/data/backup guidance | 6.1a APIs; 6.1b Settings/browser; 6.2a guide |
| §§7–8, 21, 23 security/session/CSRF/error conventions | 6.1a wrong-password/session/isolation regressions; 6.1b guard/pending behavior |
| §22.7 optional date/account/category export and columns | 6.1a exact CSV contract/parser tests; 6.1b real filtered download |
| §§27–29 LAN/Tailscale/Emby isolation/TLS | 6.2b documentation/config; §4 actual-network gate |
| §§30–31 production Compose/persistence/config validation | 6.2b configured startup/health; 6.3 recreation/migration |
| §32 daily/historical/external backups and restore drills | 6.2a scripts/scheduler/docs; 6.3 real recovery; §4 host schedule |
| §§33–34 logging/headers/CSP/HSTS | 6.2b built-app checks; 6.3 focused log inspection; §4 HTTPS trust |
| §§35–37 authoritative validation/calendar dates/exact cents | 6.1a boundary matrix and CSV integer formatting; 6.1b forms |
| §§38–39 responsive accessibility | 6.1b Settings visual/keyboard checks; 6.3 all-page inspection |
| §42 auth/isolation/finance/frontend/E2E testing | Existing tests retained plus 6.1/6.2 regressions and 6.3 complete workflow |
| §43 every security/functional/operational checkbox | 6.3 evidence mapping, with required external gates in §4 |
| §44 M6 deliverables and §50 production prerequisites | All tasks; no production-readiness claim before §4 passes |

**Approval and execution boundary:** the user approved this plan on **2026-09-20** and requested the implementation handoff at `docs/LUNA_M6_HANDOFF.md`. No M6 code, tests, deployment, backup or release verification has been executed during planning/handoff preparation. The approved contracts include the wrong-password status correction, spreadsheet-safe text behavior, style-only CSP allowance and operator-owned release prerequisites. Inline execution is the default when the user initiates implementation; independent API/UI/recovery ownership is possible with the contracts and shared-file limits above. Commits, pushes and actual production/network operations require separate authorization.

### Primary references checked during planning

- [Angular security/CSP guidance](https://angular.dev/best-practices/security): injected component styles, nonce alternatives and the documented style-only inline allowance.
- [Docker packet filtering and firewalls](https://docs.docker.com/engine/network/packet-filtering-firewalls/): published traffic and Docker/UFW/forwarding behavior.
- [Tailscale Grants syntax](https://tailscale.com/docs/reference/syntax/grants): additive permissions, source/destination selectors and `tcp:443` capability syntax.
