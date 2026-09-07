# Luna — Budget Tracker Implementation Handoff

## Assignment

Implement the Household Budget Tracker from these documents, in this order of authority:

1. `BUDGET_TRACKER_MVP_SPEC.md` — product requirements and architectural source of truth.
2. `docs/superpowers/plans/2026-09-07-budget-tracker-mvp.md` — implementation sequence, file map, contracts, decisions, and verification gates.
3. This handoff — execution instructions and current status.

Read the specification and complete implementation plan before editing. If a plan default conflicts with a mandatory specification requirement, follow the specification and record the correction. Do not silently reduce scope or replace the chosen stack.

## Current State

- Planning is complete; application implementation has not started in this conversation.
- The initial repository contained `BUDGET_TRACKER_MVP_SPEC.md` and `LICENSE`.
- The implementation plan adds seven milestones, ten tasks, explicit defaults for ambiguous behavior, and a source-coverage map.
- Plan structure and numerical examples were checked. No application builds, tests, browser flows, Docker deployment, or network checks have been run.
- Inspect the actual working tree before starting: changes made after this handoff take precedence over this status snapshot. Preserve unrelated work.

## Start Here: Task 0.1 Only

Implement **Milestone 0 — Runnable Repository and Infrastructure**, following Task 0.1 in the plan.

Deliver:

- Strict Angular application with Router, development API proxy, and test configuration.
- FastAPI application with settings validation and consistent API errors.
- SQLite/SQLAlchemy connection with foreign keys enabled and Alembic configured.
- Public, non-sensitive `GET /api/health` endpoint.
- Two-service production Docker Compose setup: Caddy and backend.
- Multi-stage Angular build whose static assets are served by Caddy.
- Caddy routing that preserves `/api` and never serves SPA fallback for API errors.
- Persistent database and Caddy state; no published backend host port.
- Safe configuration examples, secret/data exclusions, and accurate local-development instructions.
- Working backend/frontend test runners and the planned E2E runner configuration.

Do **not** implement authentication, household/domain models, financial pages, seed data, or future-feature scaffolding during this task.

Verify the actual application: build it, start it, open the Angular surface, exercise `/api/health`, check API error routing, run applicable checks, and record exact results. If Docker or browser execution is unavailable, finish all locally verifiable work and name the missing prerequisite; do not claim the runtime gate passed.

**Stop after the complete, verified Milestone 0 deliverable and request review before starting Milestone 1.** This is the explicit milestone review boundary from the specification and plan, not permission to stop partway through Task 0.1.

## Later Milestones

Proceed only after the preceding review gate is satisfied:

| Milestone | Plan tasks | Deliverable / gate |
|---|---|---|
| 0 | 0.1 | Runnable application; review before authentication |
| 1 | 1.1–1.2 | Household bootstrap, sessions, login/logout, CSRF, limiting; security review before financial features |
| 2 | 2.1 | Household-scoped accounts and categories, archive behavior |
| 3 | 3.1 | Exact-cent transactions, CRUD, filters, account balances |
| 4 | 4.1 | Selected-month dashboard and all-time current balance |
| 5 | 5.1 | Monthly budgets, usage, removal, copy-previous behavior |
| 6 | 6.1–6.3 | Settings, CSV, secure deployment, backup/restore, integrated acceptance evidence |

The full task details remain in the plan; do not replace them with this table.

## Non-Negotiable Implementation Rules

- Keep Angular, FastAPI, SQLAlchemy 2.x, Alembic, SQLite, Caddy and Docker Compose. No JWT, public signup, cloud identity, Redis, PostgreSQL or extra infrastructure.
- Prefer direct, feature-local code and the standard library. No generic repository framework, speculative interfaces, empty modules, or deferred-feature schema fields.
- Store and expose money as validated integer cents in EUR. Parse input decimal strings exactly. Keep financial totals backend-owned and within the declared exact-integer bounds.
- Derive household scope from the authenticated membership. Scope every query and validate every account/category reference server-side. Test with two households even though deployment initially has one.
- Use Argon2id and opaque server-side sessions with hashed token storage. Production cookies retain HttpOnly, Secure and SameSite protection.
- Protect every unsafe request with CSRF and Origin validation, including anonymous login. Do not log passwords, raw sessions, CSRF tokens or financial request bodies.
- Review the plan's proposed signed double-submit/session binding carefully during the authentication security gate; do not treat planning as security verification.
- Retain historical references when archiving accounts/categories. Distinguish missing budgets from zero budgets; never return Infinity or NaN.
- Preserve phone usability, keyboard operation, labels, associated errors, visible focus and non-color budget indicators throughout implementation.
- No public exposure, router forwarding or Tailscale Funnel. Tailscale access does not replace application login.
- Never claim Tailscale isolates two services sharing the same IP and port based solely on HTTP hostname routing. Resolve that deployment topology as described in the plan.
- Use SQLite-safe backups and prove restore on disposable data. Never experiment with restore against the real household database.

## Working Method

1. Inspect current files and applicable repository instructions. Select supported dependency versions when creating the workspace; pin them and document runtime requirements.
2. Track the current milestone's tasks using the plan checkboxes or the available task tracker. Mark completion only after observable verification.
3. Implement the smallest coherent change that satisfies the task. Keep docs and configuration aligned with the actual implementation.
4. Keep the spec-required automated tests. Test observable behavior, security boundaries, monetary precision and transitions rather than generated scaffolding or internal wiring.
5. Use real browser checks for UI changes and actual CLI/Compose execution for operational changes. Record commands and outcomes precisely.
6. If delegating, use independent slices with explicit contracts and distinct file ownership. Keep a single owner for shared migrations, routes and contracts; run integrated validation after concurrent edits settle.
7. Read back delegated results and verify their claimed deliverables. A subagent's completion message is not test evidence.
8. Remove temporary verification artifacts once useful checks have run. Keep regression tests and operational backup/restore scripts.
9. Do not commit, push, change a production firewall/tailnet, or deploy real household data without the user's authorization or an explicit existing workflow authorizing it.

If this environment provides the `subagent-driven-development` skill, use it for suitable independent implementation slices. Missing skill names are not a reason to block: execute inline while preserving the plan's contracts and review gates.

## Deployment Inputs and Honest Blocking

Local development and implementation do not require the household's production network details. Do not ask for them before they become necessary.

Production verification will require the actual server OS, LAN subnet, hostname/DNS configuration, host bindings, existing Caddy/Emby topology, tailnet policy and authorized/unauthorized test devices. Obtain those from available configuration first; ask only for information that cannot be discovered safely.

Without access to the real environment, mark reachability, firewall, TLS trust and Tailscale checks **unexecuted**. A generated policy, passing unit test or successful `docker compose config` does not prove private production exposure.

## Milestone Completion Report

Return a short evidence-based report:

- **Completed:** milestone/task and working behavior.
- **Changed:** principal files and any documented deviation from the plan.
- **Verified:** exact commands/scenarios and results, including actual browser or deployment checks.
- **Not verified / blocked:** specific missing prerequisites and remaining acceptance checks.
- **Next gate:** review required before the next milestone; for Milestone 1, explicitly request security review.

Do not label the MVP production-ready until the full specification §43 checklist and §50 production prerequisites have been exercised, including restore and allowed/disallowed network access.
