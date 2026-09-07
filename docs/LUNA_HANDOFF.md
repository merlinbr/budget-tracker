# Luna — Authentication and Household Bootstrap Handoff

## Assignment

Implement **Milestone 1 — Authentication + household bootstrap only**, including verification and security review.

The user confirmed that “step 2” means the second implementation stage: authentication after the completed Milestone 0 foundation. It does **not** mean Milestone 2 (accounts and categories).

This handoff replaces the previous Task 0.1 assignment. Proceed with implementation; do not restart foundation work or produce another plan instead of the requested implementation.

## Read First

Use these documents in order of authority:

1. `BUDGET_TRACKER_MVP_SPEC.md` — product and security requirements; focus on §§7–8, 20–23, 26, 29, 31, 33, 35–36, 39–40, 42 and Milestone 1 in §44.
2. `docs/superpowers/plans/2026-09-07-authentication-household-bootstrap.md` — the complete four-task execution plan, exact file map, shared contracts, edge cases, verification commands and acceptance checklist.
3. `docs/superpowers/plans/2026-09-07-budget-tracker-mvp.md` — broader architecture and later milestone boundaries. The focused authentication plan expands its Tasks 1.1–1.2 and supplies the current implementation defaults.
4. This handoff — assignment, execution boundaries and reporting requirements.
5. `state.md` and `README.md` — recorded project status and development commands; update them after verified implementation.

Read the focused plan in full before editing. Follow mandatory specification requirements if a plan detail conflicts with them; record the correction. Preserve unrelated work and adapt file locations to any implementation changes made since this handoff.

## Starting State

- Milestone 0 is complete according to the user and `state.md`.
- The inspected checkout contains Angular, FastAPI, synchronous SQLAlchemy/SQLite setup, Alembic baseline `0001_initial`, shared API errors, Caddy/Compose and backend/frontend/browser test runners.
- At planning time, identity models, authentication modules and login routes were not implemented.
- The focused plan was checked for structure and scope. That is not runtime verification or a security-review result.
- A database exists under `data/`. Treat it and any real `.env` as user-owned; do not overwrite, seed, reset or downgrade them for testing.

## Deliver All Four Tasks

| Task | Required result |
|---|---|
| 1 — Identity persistence and CLI | Users, households, household_members and sessions; `0002_identity` migration; Argon2id; hidden-input `init-household`, `create-user`, `reset-password` and `cleanup-sessions` commands |
| 2 — Secure authentication API | CSRF bootstrap, login, logout, me and change-password; hashed opaque sessions; expiry/revocation; household dependency; bounded login limiting; configuration corrections |
| 3 — Angular authentication | Accessible login, auth restoration, guards, 401 recovery and protected household landing page with logout |
| 4 — Integration and review | Real CLI/browser/HTTPS checks, spec-required automated coverage, security review, resolved findings and accurate documentation/status |

Do not stop after persistence, a backend-only implementation, or a login screen that has not been exercised against the real backend. The detailed steps and contracts remain in the focused plan; this table does not replace them.

## Non-Negotiable Contracts

- Keep the existing stack and direct feature-local code. Add pinned `argon2-cffi`; no JWT, public signup, identity provider, Redis, generic repository framework or new frontend state library.
- Derive household scope from the authenticated database membership. Never accept a browser-selected household as authorization. Use two households in dependency/isolation tests even though initial deployment is single-household.
- Passwords are never stored reversibly or supplied as CLI arguments. Normalize usernames, not passwords. Enforce the plan's password bounds and use maintained Argon2id library defaults.
- Generate at least 256 bits of session entropy, store only the token hash, enforce fixed expiry of at most 30 days, rotate on login and invalidate the presented prior session. Logout revokes the current session; password change/reset revokes all sessions for that user.
- Session cookies remain host-only, HttpOnly, Secure for HTTPS, SameSite=Lax and Path=/. No session credentials in JSON or browser storage.
- Enforce exact allowed Origin and signed cookie/header CSRF validation on unsafe API methods, including anonymous login. Bind authenticated CSRF tokens to the session, rotate on login, and prove expired-cookie recovery works.
- Use the existing error envelope and explicit public response schemas. Never expose password hashes, tokens, submitted passwords or private household metadata in unauthenticated responses/logs.
- Preserve one-worker bounded rate limiting. Do not trust arbitrary forwarded headers. The plan uses `--no-proxy-headers`; document that Caddy clients initially share an IP bucket and test that spoofed headers cannot evade it.
- Preserve `/api/health` as public and non-sensitive. Keep FastAPI's container port unpublished.
- `/dashboard` is an authenticated identity/household landing page for this milestone, not a fake financial dashboard. No private-content flash before auth restoration completes.

## Integration Details Not to Miss

The focused plan identifies existing integration points that must change with authentication:

- Constrain the current 365-day session configuration allowance to 1–30 days.
- Ensure supplied `create_app(settings)` settings also govern authentication dependencies, cookies and Origin validation; do not mix them with cached global settings accidentally.
- Allow both exact localhost development origins used by the project.
- Correct the HTTPS Compose example Origin to include port 8443 and enable secure cookies for that HTTPS example. Do not silently edit the user's real `.env`.
- Replace foundation-copy assertions with authentication behavior checks rather than re-pinning old wording.
- Give Playwright an isolated, migrated and seeded real backend, not just Angular or mocked login responses.
- Make first-household bootstrap atomic under concurrent execution. Ensure concurrent login cannot recreate a valid session from a password hash superseded by password change/reset.
- Distinguish invalid credentials, expired authentication, CSRF rejection and network/server failure in the frontend. Do not blindly replay unsafe requests or falsely report successful logout on network failure.

## Execution Rules

1. Inspect applicable repository instructions and current implementation before editing. Reuse existing conventions; avoid unrelated refactors.
2. Track the focused plan's tasks and acceptance items. Mark completion only after observable verification.
3. Implement inline unless there are genuinely independent slices. If delegating, establish contracts first and assign one integration owner for shared models, migrations, routing and fixtures. Sibling agents must not run project-wide validation during concurrent edits; run it centrally after integration.
4. Retain the requested automated tests for security boundaries and observable behavior. Use deterministic clocks for expiry/rate limits rather than sleeps. Never ship test-user HTTP endpoints or bypass authentication for browser tests.
5. Use isolated temporary SQLite databases and separate Compose data mounts/projects for verification. Keep actual user data, secrets, production firewall/Tailscale rules and deployment untouched.
6. After smoke verification, remove temporary artifacts and update `README.md` and `state.md` with exact commands, limitations and results. Do not claim any later milestone is complete.
7. Do not commit, push or deploy without separate user authorization or an explicit existing workflow authorizing it.

## Verification and Security Gate

Run the focused checks in each plan task, then final integrated checks:

```text
# From backend
python -m pytest

# From frontend
npm test -- --watch=false
npm run build
npx playwright test
```

Also verify:

- Migrations and all four administration commands against disposable data.
- Real browser login → protected landing page → refresh → logout → back/deep-link denial; expired-session recovery; keyboard-only operation and a phone-width viewport.
- Actual HTTPS Compose login/logout with exact Origin and secure cookies, plus no published backend host port. `docker compose config` alone is not runtime proof.
- Session replay denial, multi-device revocation, CSRF attacks including anonymous/cross-session replay, temporary limiting, membership removal/inactive-user denial and two-household resolution.

Perform an explicit security review of session lifecycle, CSRF construction/binding, credential disclosure/enumeration, limiter concurrency/proxy trust, household authorization and cookie/logging behavior. Use a security reviewer when available. Fix actionable findings and rerun their reproductions before recording the gate as passed. Passing tests alone is not a security review.

If a runtime capability is unavailable, finish all reachable implementation and checks, name the missing prerequisite, and leave that acceptance gate unverified. Never replace real browser/HTTPS evidence with a fabricated pass. Production LAN/Tailscale reachability and backup/restore remain later release requirements.

## Out of Scope and Stop Condition

Do not implement accounts, categories/default-category seeding, transactions, financial totals/charts, budgets, profile/settings UI, public registration/email recovery, additional roles, backup tooling or production network changes.

**Stop after the complete, verified Milestone 1 deliverable and its security review. Request user review before Milestone 2.** Do not continue to accounts/categories automatically.

## Completion Report

Return a concise evidence-backed report:

- **Completed:** Working behavior and covered plan tasks.
- **Changed:** Main files and any justified deviation from the focused plan.
- **Verified:** Exact commands/scenarios and actual outcomes, including CLI, browser and HTTPS evidence.
- **Security review:** Findings, fixes, rerun evidence and remaining risks.
- **Unverified/blocked:** Specific missing capabilities or unmet acceptance items; never hide them behind “done.”
- **Next:** User review before Milestone 2 — Accounts + categories.

Do not describe the application as production-ready based on this milestone alone.
