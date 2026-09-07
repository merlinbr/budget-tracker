# Authentication and Household Bootstrap Implementation Plan

> **For agentic workers:** Use the available `subagent-driven-development` skill for genuinely independent implementation slices, or execute inline. Steps use checkbox syntax for tracking. This document plans the work; it does not authorize implementation or deployment.

**Goal:** Complete the second implementation stage, **Milestone 1 — Authentication + household bootstrap**, so individual household users can securely log in and out before financial features are introduced.

**Architecture:** Extend the existing synchronous FastAPI/SQLAlchemy application with identity tables, CLI administration, opaque database-backed sessions, and one household-authorization dependency. Keep Angular and FastAPI same-origin through the existing development proxy and Caddy. Reuse Angular HttpClient's XSRF support and the existing API error envelope; do not add an authentication framework, repository layer, or state library.

**Tech Stack:** Existing Angular 22.1.x, TypeScript, reactive forms, Router, HttpClient, Python 3.13–3.14, FastAPI, Pydantic, SQLAlchemy 2.x, Alembic, SQLite, pytest, Vitest, Playwright, Docker Compose and Caddy; add a pinned `argon2-cffi` dependency for Argon2id.

## Global Constraints

- Source of truth: `BUDGET_TRACKER_MVP_SPEC.md`, especially §§7–8, 20–23, 26, 29, 31, 33, 35–36, 39–40, 42 and Milestone 1 in §44.
- This expands Tasks 1.1–1.2 of `docs/superpowers/plans/2026-09-07-budget-tracker-mvp.md`; retain that plan's established contracts unless explicitly corrected below.
- One active household membership per user. Roles: `owner` and `member`.
- Passwords: Argon2id, minimum 12 characters, no maximum below 128 characters, no arbitrary character-mixture rules.
- Sessions: cryptographically random, at least 256 bits of entropy, only token hashes in the database, 30 days maximum, immediate server-side logout invalidation.
- Production cookie: `budget_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no Domain attribute.
- Mutating APIs require Origin verification and CSRF protection, including anonymous login.
- Every household-data endpoint must enforce authenticated session and household membership. Never trust a household ID supplied by the browser.
- Public registration, email recovery, JWT, cloud identity, Redis and financial features are excluded.
- Keep passwords, session tokens, CSRF tokens and request cookies out of logs and committed files.
- Forms require labels, keyboard operation, visible focus and associated error messages. Login must not reveal private household data.
- Do not edit or recreate the real `data/budget.db` for verification; use isolated disposable databases.

## Grounded Starting Point

The user confirmed that “step 2” means authentication, not the specification's Milestone 2 (accounts/categories).

The current checkout provides `create_app(settings)` in `backend/app/main.py`, `get_db()` and SQLite configuration in `backend/app/db.py`, shared exception handlers in `backend/app/errors.py`, migration `0001_initial`, an Angular root outlet/public foundation shell, and test runners. Identity models, authentication modules and login routes do not exist yet. `state.md` records the foundation as complete.

Specific integration issues to address with authentication:

- `Settings.session_max_age_days` currently permits 365 days; constrain it to 1–30.
- `create_app(settings)` currently uses the supplied settings for app construction, while dependencies can still use cached global settings. Register a settings dependency override for the app so authentication, cookie and Origin behavior use the same supplied configuration. Continue using the existing database dependency; tests override it explicitly.
- Local development documentation opens `http://127.0.0.1:4200`, but default allowed origins only contain `http://localhost:4200`. Permit both exact development origins.
- `.env.example` publishes HTTPS on 8443 but declares `https://localhost` as its origin. Use `https://localhost:8443` and secure cookies for the HTTPS Compose example. Do not change the user's real `.env` automatically.
- Playwright currently starts only Angular. Authentication browser checks also need an isolated, migrated, seeded backend.
- The current component test checks foundation wording rather than authentication behavior. Replace that check, rather than preserving its copy assertions.

## Decisions and Alternatives

**Recommended: extend the existing plan's opaque sessions and signed double-submit CSRF design.** It fits the SQLite deployment, supports revocation, and matches Angular's built-in cookie/header support. JWT would complicate immediate invalidation and contradict the spec. A third-party identity service would violate the private local-login design.

- Integer IDs; Python snake_case; explicit camelCase response aliases; never serialize ORM users directly.
- Normalize usernames with trim + lowercase at CLI/login boundaries; enforce 1–100 characters after normalization. Trim display/household names, reject blank values, bound them at 100 characters. Never trim passwords; maximum 1024 characters.
- Fixed session expiry, no sliding extension. Do not write `last_seen_at` on every read. Store UTC technical timestamps consistently; account for SQLite returning naive datetime objects when reading expiration values.
- `init-household` and `create-user` use hidden password confirmation and a single database transaction. Include `reset-password` and `cleanup-sessions`, already specified by the existing implementation plan. No default-category prompt until categories exist in Milestone 2.
- Implement the existing plan's change-password API now, but not a settings page. Verify current password and revoke all sessions, including the caller's.
- Five failed attempts per normalized username and separately per client IP in 15 minutes; the next request is rejected with 429 and `Retry-After`. Success clears the username failures, not unrelated IP failures. Use bounded, expiring in-memory state and synchronization appropriate to synchronous FastAPI handlers; one worker only.
- Do not trust arbitrary `X-Forwarded-For`. Initially run Uvicorn with `--no-proxy-headers`, using the socket peer for limiting. Behind Caddy, the IP bucket is consequently shared: conservative protection, but possible household-wide temporary throttling. Document this known ceiling with a `ponytail:` comment. Preserve username limiting. Only enable real forwarded client addresses when the immediate proxy trust boundary is explicitly configured and verified; never use wildcard trust merely to recover client IPs.
- Render `/dashboard` as the authenticated household landing page with user/household identity and logout only. No invented balances, charts, empty financial APIs, or navigation links to features that do not exist.

## Shared Contracts

### Persistence and authorization

`backend/app/models.py` defines `Base`, `User`, `Household`, `HouseholdMember`, and `UserSession`. Keep the ORM session model distinct from SQLAlchemy's `Session`.

| Table | Fields and constraints |
|---|---|
| `users` | Integer PK, unique normalized `username`, `display_name`, `password_hash`, `is_active`, UTC `created_at`/`updated_at` |
| `households` | Integer PK, `name`, UTC `created_at`/`updated_at` |
| `household_members` | Integer PK, household/user FKs, unique `user_id`, role CHECK (`owner`, `member`), UTC `created_at`, household index |
| `sessions` | Integer PK, user FK, unique `token_hash`, UTC `created_at`, `expires_at`, nullable `last_seen_at`; user/expiry indexes |

The unique indexes on username, membership user ID and token hash already satisfy those lookup-index requirements; do not duplicate them.

`backend/app/auth/dependencies.py` exports the following context and a FastAPI `require_household` dependency consuming the request cookie, `get_db`, and `get_settings`:

```python
@dataclass(frozen=True)
class HouseholdContext:
    user_id: int
    household_id: int
    role: Literal["owner", "member"]
```

Reject missing/invalid/expired sessions, inactive users and absent membership with `401 AUTH_REQUIRED`. Resolve membership from the database on every request, not from cookie claims. Both roles can access household data. Future resource lookups must filter by both resource ID and `context.household_id`, returning 404 for missing or foreign records.

### HTTP

| Endpoint | Request | Success |
|---|---|---|
| `GET /api/auth/csrf` | None; works anonymously | 204, sets readable signed `XSRF-TOKEN` cookie, no private data |
| `POST /api/auth/login` | `{username, password}` + Origin/XSRF | 200 `AuthState`; fresh session and bound CSRF cookies |
| `GET /api/auth/me` | Session cookie | 200 `AuthState` |
| `POST /api/auth/logout` | Valid session + Origin/XSRF | 204; delete current DB session and clear cookies |
| `POST /api/auth/change-password` | `{currentPassword, newPassword}` + session/Origin/XSRF | 204; replace hash atomically, revoke all user's sessions, clear cookies |

```typescript
export interface AuthState {
  user: { id: number; username: string; displayName: string };
  household: { id: number; name: string };
}
```

- Invalid/unknown/inactive login: `401 INVALID_CREDENTIALS`, message `Invalid username or password.` Use dummy Argon2 verification for unknown users to avoid a cheap existence timing distinction.
- CSRF rejection: `403 FORBIDDEN`. Rate limiting: `429 RATE_LIMITED` and `Retry-After`. Invalid input: 422. CLI duplicates: clean error and nonzero exit, no partial rows.
- All HTTP errors retain `{error: {code, message, fields?}}`. Use existing `APIError`; the existing Starlette HTTP exception handler already preserves headers for rate-limit responses.
- Auth responses use `Cache-Control: no-store`. Never return password hashes, session IDs, token hashes, or cookie contents in JSON.
- Require JSON for login/password bodies; reject oversized/invalid fields through bounded schemas before hashing. Do not expose input values through validation errors or logging.

### CSRF and session lifecycle

- Session issuance uses `secrets.token_urlsafe(32)` and stores the SHA-256 hex digest only. Session creation commits before cookies are returned. A successful re-login invalidates any presented prior session and creates a fresh one; independent device sessions remain valid.
- `XSRF-TOKEN` is a host-only cookie with Path=/, SameSite=Lax, Secure matching the transport, and **not** HttpOnly so Angular can read it. `budget_session` remains HttpOnly.
- Token format: fixed-size random nonce plus HMAC-SHA256 signature. Sign an unambiguous, domain-separated message containing the nonce and either an explicit anonymous marker or the current session-token hash, using `SESSION_SECRET`.
- For POST/PUT/PATCH/DELETE under `/api`, reject absent, null or non-allowlisted Origin. Require bounded, well-formed cookie/header tokens, constant-time equality, and a valid signature for the current session binding. Verify before endpoint side effects. SameSite alone is insufficient.
- CSRF bootstrap signs for the current valid session, or anonymously if unauthenticated; never return user details from this endpoint. Bootstrap and validation must agree on invalid/expired-cookie handling so expired sessions cannot trap the login page.
- Login rotates the CSRF cookie to the new session binding. Reusing an anonymous or different-session token after login must fail. Logout/password change clear both cookies using the original path/domain settings.
- Clear expired session cookies on auth rejection; the frontend obtains fresh anonymous CSRF state before attempting login. Do not automatically retry an unsafe business request after CSRF failure.
- Opportunistically clean expired session rows during successful login and expose explicit CLI cleanup; no scheduler or per-request write amplification.

## Task 1 — Identity persistence and CLI administration

**Files:** Create `backend/app/models.py`, `backend/app/cli.py`, `backend/app/auth/__init__.py`, `backend/app/auth/passwords.py`, `backend/migrations/versions/0002_identity.py`, and `backend/tests/test_bootstrap.py`. Modify `backend/migrations/env.py`, `backend/pyproject.toml`, `backend/requirements.lock`, and `backend/tests/conftest.py`.

**Consumes:** Existing SQLAlchemy engine/session factory and Alembic baseline. **Produces:** The four tables, Argon2id password functions, and executable administration commands.

- [ ] Add and pin `argon2-cffi` using the existing dependency/lock format. Use its maintained `PasswordHasher` Argon2id defaults and `check_needs_rehash`; no homemade password hashing or new CLI framework.
- [ ] Add models and migration from the table contract. Point Alembic `target_metadata` to `Base.metadata`. Do not call `create_all` at production startup.
- [ ] Extend test fixtures to use a per-test temporary SQLite file, the real migration, and `get_db` overrides. Avoid the current unshared in-memory connection pattern for authentication data. Dispose engines and clear dependency overrides after each test.
- [ ] Implement `python -m app.cli init-household`, `create-user`, `reset-password`, and `cleanup-sessions` with stdlib `argparse`/`getpass`. Password input and confirmation must not be command-line arguments. `create-user` assigns `member` to the existing household; `init-household` assigns `owner` and refuses any second initialization. Handle EOF/interruption without committing partial data.
- [ ] Keep the first-initialization check and writes under a SQLite write transaction (`BEGIN IMMEDIATE`) so concurrent bootstrap processes cannot create two initial households. Do not impose a global one-household DB constraint: isolation tests need two households.
- [ ] Add tests for successful owner/member provisioning, normalized duplicate username refusal, second-bootstrap refusal, failed-input rollback, membership uniqueness, password length boundaries, and password-reset session revocation once Task 2 supplies sessions.

**Verification:** From `backend`, run `python -m pytest tests/test_bootstrap.py`. On a disposable database, run `python -m alembic upgrade head`, exercise all four CLI commands, and run `python -m alembic current`; expect `0002_identity`. Check downgrade/upgrade only on a separate disposable database. Never downgrade real data.

## Task 2 — Session, CSRF and authorization API

**Files:** Create `backend/app/schemas.py`, `backend/app/auth/sessions.py`, `csrf.py`, `dependencies.py`, `rate_limit.py`, `router.py`; create `backend/tests/test_auth.py`, `test_csrf.py`, `test_rate_limit.py`, and `test_authorization.py`. Modify `backend/app/main.py`, `backend/app/config.py`, `backend/tests/conftest.py`, `backend/tests/test_config.py`, `.env.example`, and `docker-compose.yml`. Modify `errors.py` only if an exercised error contract needs it.

**Consumes:** Task 1 tables and password verification. **Produces:** All five auth endpoints and `require_household`, with the shared HTTP/security contract.

- [ ] Add strict, bounded auth request schemas and explicit public response schemas. Wire the app's settings dependency consistently, set session age to 1–30, and add exact development origins. Test insecure production settings and invalid session durations.
- [ ] Implement random-token issuance/hash lookup, fixed expiry, replacement-session invalidation, cookie set/clear helpers, and active-user/membership resolution. Support concurrent devices without sharing raw tokens.
- [ ] Implement CSRF bootstrap and central unsafe-method enforcement, including anonymous login. Use stdlib HMAC/constant-time comparison and Angular's existing cookie/header names. Reject malformed tokens before expensive work.
- [ ] Implement the bounded one-worker limiter with a monotonic clock, TTL expiry and locking around shared mutations. Enforce username and IP buckets independently; account for requests already verifying passwords when checking concurrent limits. Inject/patch the clock in tests rather than sleeping.
- [ ] Implement login, me, logout and password change through the shared dependencies. Wrong current password must leave password and sessions unchanged. Password update/session revocation is atomic; ensure concurrent login cannot resurrect a session based on a superseded password hash.
- [ ] Register the router and CSRF handling in `create_app`. Preserve `/api/health` as public and non-sensitive. Add no public registration or financial routes.
- [ ] Correct the HTTPS example Origin/secure-cookie configuration and disable untrusted proxy headers in the Compose Uvicorn command. Keep one worker and the backend port unpublished.
- [ ] Add the behavioral tests below, including actual login/session use rather than mocked authorization success.

**Concrete regression example:** Extend `conftest.py` with `seeded_user` (real migrated user/household, exposing username/password for the test) and `csrf_headers(client)` (GET CSRF, then return exact `Origin` and cookie-derived `X-XSRF-TOKEN`). A session replay test must exercise this flow:

```python
def test_logout_revokes_copied_session(client, seeded_user, csrf_headers):
    response = client.post(
        "/api/auth/login",
        json={"username": seeded_user.username, "password": seeded_user.password},
        headers=csrf_headers(client),
    )
    assert response.status_code == 200
    token = client.cookies.get("budget_session")
    assert token
    assert client.get("/api/auth/me").status_code == 200
    assert client.post(
        "/api/auth/logout", headers=csrf_headers(client)
    ).status_code == 204
    client.cookies.clear()
    client.cookies.set("budget_session", token)
    assert client.get("/api/auth/me").status_code == 401
```

**Required additional cases:**

| Area | Observable assertions |
|---|---|
| Credentials | Valid login; unknown username and wrong password have identical public status/body; inactive/membershipless user cannot obtain usable authentication |
| Secrets | Password is Argon2id-hashed; DB session value differs from cookie and matches its hash; no secret fields in auth JSON |
| Lifecycle | Fresh token per login; previous presented token rejected; expiry boundary rejected; second device remains valid until password change/reset revokes both |
| Cookies | HTTPS responses set Secure/HttpOnly/SameSite/Path correctly; logout clears both cookies; localhost development remains usable |
| CSRF | Missing/mismatched/malformed/tampered token, foreign/null/missing Origin, anonymous token replay after login and cross-session replay rejected without mutation; valid same-origin request succeeds |
| Expiry recovery | Expired session → auth rejection → fresh anonymous CSRF → login succeeds, rather than an endless 401/403 loop |
| Limiter | Five failures → 429 on next attempt; Retry-After present; clock advance recovers; success resets username state; IP bucket remains effective across usernames; forged forwarded header cannot evade it |
| Household | Two households log in independently; `/me` resolves each actual membership; browser-supplied household selection cannot change scope; inactive user/removed membership invalidates subsequent access |
| Password change | Wrong current password leaves existing sessions valid; valid change rejects old password, accepts new password, and invalidates every old session |

**Verification:** From `backend`, run `python -m pytest tests/test_auth.py tests/test_csrf.py tests/test_rate_limit.py tests/test_authorization.py tests/test_bootstrap.py tests/test_config.py`. Use a test-only endpoint protected by `require_household` if needed to exercise dependency denial; do not ship a fake financial route. Full resource-isolation tests belong to Milestone 2 onward.

## Task 3 — Angular login, restoration and protected landing page

**Files:** Create `frontend/src/app/core/auth/auth.service.ts`, `auth.guard.ts`, `auth.interceptor.ts`, adjacent behavior specs, `frontend/src/app/core/api/models.ts`, `frontend/src/app/features/login/login.page.ts`, `login.page.html`, `login.page.css`, `login.page.spec.ts`, and `frontend/src/app/layout/app-shell.ts`. Modify `frontend/src/app/app.config.ts`, `app.routes.ts`, and `app.component.ts`. Replace the foundation-only assertions in `app.component.spec.ts` with the relevant auth tests.

**Consumes:** Task 2 HTTP contract. **Produces:** Accessible `/login`, authenticated `/dashboard`, restored state after refresh and consistent logout/401 recovery.

Auth service public operations: `restore(): Observable<AuthState | null>`, `login(username: string, password: string): Observable<AuthState>`, `logout(): Observable<void>`, and `clear(): void`. Keep one signal containing `AuthState | null` and an explicit restoration state (`loading`, `ready`, `error`). Concurrent guards share the in-flight restore request; errors must not leave that request cached forever.

- [ ] Implement the service using relative `/api` URLs. Bootstrap CSRF before login; use Angular's built-in `XSRF-TOKEN`/`X-XSRF-TOKEN` support. Do not store credentials or session tokens in localStorage/sessionStorage.
- [ ] Resolve `/auth/me` before rendering private content. A 401 means signed out; a network/5xx error means restoration failed and must display a retry action, not silently misreport invalid credentials.
- [ ] Add auth and anonymous-only guards returning router redirects, not side-effect navigation loops. `/` routes to `/dashboard`; protected navigation redirects to `/login`; authenticated visits to `/login` redirect to `/dashboard`.
- [ ] Add a same-origin API 401 interceptor that clears auth state and redirects once. Let login's credential failure stay on its form; let initial restore's 401 resolve normally. Do not treat a CSRF 403 as session expiry or automatically replay POST requests.
- [ ] Build a reactive login form with explicit username/password labels, autocomplete `username`/`current-password`, password-manager paste support, associated field errors, submit error announcement and pending-state duplicate-submit prevention. Never echo a password in an error.
- [ ] Move the existing public shell out of `app.component.ts`, retaining the root outlet. The protected shell displays the authenticated identity and logout; no financial sample values or unfinished feature links. Logout waits for server invalidation; a network failure must not falsely claim the remote session was revoked.
- [ ] Add auth service/guard/form tests covering restore-before-render, login success/failure, loading/error/retry, authenticated login redirect, logout, subsequent 401 clearing and keyboard form submission. Use the existing Angular/Vitest runner; do not add a second unit-test framework.

**Verification:** From `frontend`, run `npm test -- --watch=false` and `npm run build`. In a real browser check login → `/dashboard` → refresh → logout → back/deep link rejection, including a 390px-wide viewport and keyboard-only navigation. Inspect the Network/Cookies surface; no private identity should flash before auth restoration succeeds.

## Task 4 — Integrated verification and security review gate

**Files:** Create `frontend/e2e/auth.spec.ts`. Update `frontend/playwright.config.ts`, `frontend/e2e/smoke.spec.ts`, `README.md`, and `state.md`. Add only the minimal disposable-backend setup needed by the browser suite; never seed the production database from an E2E hook.

**Consumes:** Tasks 1–3 working together. **Produces:** Reproducible local auth verification, documented administration and an explicit security-review result.

- [ ] Configure browser verification with an isolated temporary SQLite database, migrations and a test-only seeded household/user. Start real FastAPI plus Angular. Pass credentials through the test environment; do not add an HTTP test-user endpoint or reuse an unknown live backend. Ensure process/database teardown is reliable on Windows.
- [ ] Update the old public-shell smoke flow to expect the login route. Add an E2E login → refresh → logout → protected-route denial flow using real cookies and backend responses, plus expired-session recovery.
- [ ] Run the existing backend suite once after integration, then frontend tests/build and `npx playwright test`. Record actual results, not expected pass counts. Verify the HTTPS Compose path too: corrected Origin, secure cookie, CSRF-protected login/logout, no published backend port.
- [ ] Run CLI bootstrap and additional-user creation against disposable data; verify distinct users resolve to the same household and logout of one device does not revoke another unless password change/reset is used.
- [ ] Security-review token generation/storage/lifecycle, CSRF bindings and anonymous login, credential enumeration, limiter bounds/concurrency/proxy assumptions, household resolution, cookie flags, public responses and secret logging. Fix findings and rerun their reproductions before marking the milestone accepted.
- [ ] After smoke checks pass, remove temporary artifacts. Update README with migration/bootstrap/login/reset/cleanup commands, localhost versus HTTPS origins, the single-worker/shared-proxy-IP limiter ceiling, and local verification instructions. Update `state.md` with verified Milestone 1 status without claiming later financial or production network gates passed.

**Commands:** Run `python -m pytest` from `backend`; run `npm test -- --watch=false`, `npm run build`, and `npx playwright test` from `frontend`. Use `docker compose config` and a disposable-data Compose run for HTTPS checks; do not bootstrap the existing household database merely to demonstrate success.

**Gate:** Milestone 1 is complete only after the functional checks and security review pass. Do not begin accounts/categories, or describe the application as production-ready, before that gate. LAN/Tailscale reachability, trusted-device TLS and backup/restore verification remain release requirements, not evidence supplied by authentication tests.

## Scope and Acceptance Checklist

- [ ] Users, households, household_members and sessions persist through Alembic migrations.
- [ ] Hidden-input CLI creates the first owner and additional household members safely.
- [ ] Argon2id password storage and opaque, hashed, expiring server-side sessions work.
- [ ] Login, logout, `/auth/me`, password change and offline password reset behave as specified.
- [ ] Angular login, guards, refresh restoration, error recovery and accessible logout work against the real backend.
- [ ] Unsafe methods, including anonymous login, enforce exact Origin plus signed CSRF protection.
- [ ] Login limiting is bounded, temporary, single-instance-safe and cannot be bypassed with arbitrary forwarded headers.
- [ ] Authentication/household dependency tests use two households; no client-chosen household scope is trusted.
- [ ] Production cookie requirements and the actual HTTPS Compose authentication flow are verified.
- [ ] Security findings are resolved and exact verification results recorded before Milestone 2.

**Intentionally excluded:** Accounts, categories and default-category seeding; transactions; financial dashboard calculations; budgets; profile/settings UI; registration/recovery UI; roles beyond owner/member; deployment firewall/Tailscale changes; backup implementation. These retain their existing milestone ownership.

## Planning Verification

This plan was grounded in the current source, configuration, test setup and the existing MVP implementation plan. Coverage was checked against all Milestone 1 deliverables and the related authentication/security requirements. No application code was changed and no runtime/security verification is claimed by this planning document.
