# Luna — Milestone 2 Accounts and Categories Handoff

## Assignment and Correct Sequence

Implement **Milestone 2 — Accounts and categories only**, end to end, using the focused plan below. M0 is complete; M1 authentication/household bootstrap is complete (`d503e60`, as reported). **M2 is now implemented and verified on this checkout.** Do not search for a presumed completed M2 branch, rebuild M1 or skip ahead to transactions.

Sequence: **M0 → M1 → M2 this assignment → M3 transactions → M4 dashboard → M5 budgets → M6 export/operations.**

This handoff began as a planning-only assignment; the M2 implementation, integrated acceptance gates, security review, and status updates are now complete. M3 remains untouched.
## M2 Completion Evidence

- Backend: `cd backend && python -m pytest` — **55 passed**.
- Frontend: `npm test -- --watch=false` — **8 files / 19 tests passed**; `npm run build -- --configuration development` passed.
- Browser: `npx playwright test` — **6 passed** against a real backend at `1280×900` and `390×844`, including account/category CRUD, exact negative cents, warned balance acknowledgement, category grouping/type immutability, archive/read-only behavior, reload, logout, and protected deep-link denial.
- Migrations: disposable fresh `0002_identity → 0003_accounts_categories` preserved identity/session rows and exact `-8472` cents; a separate `0003 → 0002 → 0003` cycle preserved identity/session rows while removing/recreating financial tables; an empty database reached `0003_accounts_categories` head.
- Bootstrap: disposable real PTY runs accepted all **17** exact default category pairs and declined with **0** category rows.
- Security: focused M2 review found no confirmed Critical, High, Medium, or Low vulnerability. Optional defense-in-depth notes remain documented in `state.md`; no M3 artifact changed.

## Read First

1. `BUDGET_TRACKER_MVP_SPEC.md` — source of truth; focus on §§5, 7.7, 9–11, 16–17, 21–25, 33, 35, 37–43 and M2 in §44.
2. `docs/superpowers/plans/2026-09-08-accounts-categories.md` — complete five-task M2 plan, fixed API/helper contracts, exact file map, implementation examples, verification matrix and completion gates. Read in full before editing.
3. `docs/superpowers/plans/2026-09-07-budget-tracker-mvp.md` — existing gap decisions and Task 2.1; the focused plan expands that task.
4. `README.md`, `state.md` and the existing M1 source/tests — actual runtime commands, auth/CSRF/session behavior, fixtures, form conventions and migration parent `0002_identity`.
5. `docs/superpowers/plans/2026-09-07-transactions.md` §1 required M2 contracts — compatibility context only, not authorization to implement M3.

The current user correction supersedes historical claims that M2 was already complete. Reuse existing code/conventions and follow the MVP on mandatory product requirements. Record any justified path adaptations instead of creating duplicate helpers.

## Preserve Milestone 3

- **Do not overwrite or edit** `docs/superpowers/plans/2026-09-07-transactions.md` during M2 implementation.
- The previous active M3 handoff is preserved unchanged as `docs/LUNA_M3_HANDOFF.md`. Leave it intact too.
- Both M3 documents describe future work after completed M2. Their old starting-state assumption is historical, not the current assignment.
- After verified M2, request user review before activating the preserved M3 work. Do not silently execute it.

## Deliver All Five Tasks

| Task | Required result |
|---|---|
| 1 — Household-scoped APIs | Account/category models, `0003_accounts_categories`, strict schemas, list/detail/create/update/archive APIs, exact initial balances and real two-household authorization tests |
| 2 — Optional bootstrap defaults | Exact §41 seed set accepted/declined through existing `init-household`, atomic with household/owner creation, no retroactive seeding |
| 3 — Exact money utilities | Safe signed initial-balance parsing, unsigned parsing compatible with M3, precise edit/display through both safe-integer endpoints |
| 4 — Angular management | Guarded account/category pages; shared navigation/logout; create/edit/archive, warnings, confirmation, accessible phone/desktop forms and reliable failure states |
| 5 — Integrated acceptance | Real-backend browser lifecycle, M1-data migration preservation, actual CLI prompt exercise, focused security review and evidence-backed status updates |

Do not stop after models, routes, unit tests or an unexercised screen. The complete plan's acceptance checklist defines completion.

## Non-Negotiable Contracts

- Existing stack/dependencies only. Direct feature routers/services; no generic CRUD framework, state library, repository layer or new money package.
- Every resource query/lookup/write is scoped by `require_household`. Server derives ownership; owner/member financial permissions are identical. Unknown/foreign ID is the same generic 404.
- Account types: `checking`, `savings`, `cash`, `credit_card`, `other`. Category types: `income`, `expense`; category PUT accepts name only, so type remains immutable.
- Trim names, 1–100 Unicode code points. Case-sensitive exact trimmed uniqueness: account per household; category per household/type. Archived names remain reserved. Duplicate create/rename is 409 with a name field error.
- Initial balance is strict signed integer cents in `[-9007199254740991, 9007199254740991]`; zero allowed. Reject booleans, floats, numeric strings, null and overflow. Currency is EUR.
- `Account` JSON: `id`, `name`, `type`, `initialBalance`, `balance`, `isArchived`. `Category`: `id`, `name`, `type`, `isArchived`. No exposed/writable household ownership or arbitrary ORM serialization.
- Lists return arrays, active by default; `includeArchived=true` includes retained archives. Detail can read archives. Owned archived resources are read-only through PUT (409).
- Use idempotent `POST /api/accounts/{id}/archive` and category equivalent, returning 204. **No DELETE/unarchive endpoints**, hard deletion or archive body field.
- Create returns 201; GET/PUT 200; validation 422; uniqueness/read-only conflict 409. Preserve existing error envelope, global Origin/CSRF checks and Angular 401 handling.
- Account balance is initially initial balance, returned through one response helper. Do not store a second balance column or build transaction aggregation before M3.
- Decimal input is parsed from digit components, never `parseFloat * 100`. Keep M3-compatible unsigned `parseMoney`/absolute `moneyInput`; signed account entry uses separate small wrappers.
- Initial-balance edits show a clear warning and require acknowledgement when the value changes. Preserve form values after failed writes; successful save followed by failed refresh is not a failed save or a reason to replay POST.
- Archive requires an accessible confirmation; cancellation sends nothing, failure keeps the row. Failed list loading is not an empty list. Render all resource names as plain text.
- Optional seeds belong only to new bootstrap, in the existing single transaction. No migration/startup seeding, default accounts, existing-household mutation or extra seed command.

## Verification and Data Safety

Use existing migrated disposable test fixtures and the Playwright-owned temporary database/generated credentials. Never downgrade/reset real `data/budget.db`, overwrite `.env`, alter production deployment or commit fixed E2E credentials.

After edits settle:

```text
# backend
python -m pytest

# frontend
npm test -- --watch=false
npm run build
npx playwright test
```

Also prove:

- Two independent authenticated households cannot list/read/edit/archive each other's records, including archived-list branches and forged ownership payloads. Same-household member writes succeed. Rejected requests leave data unchanged.
- Safe-cent boundaries, signed/zero balances, exact decimal round trips/display, enum/name/uniqueness boundaries, immutable category type, archive idempotency and retained rows.
- Disposable M1-data upgrade to `0003_accounts_categories` preserves identity/membership/session behavior; a separate disposable downgrade/re-upgrade preserves M1 identities. Downgrade intentionally removes M2 tables/data; never claim otherwise.
- Real `init-household` prompt with defaults accepted and declined; rollback on actual seed uniqueness failure; no defaults automatically added to existing households.
- Real browser at 1280×900 and 390×844: login → create account/category → rename/type or warned balance edit → cancel/confirm archive → show archived → refresh → logout → financial deep-link denial. Include keyboard use, labelled errors, failed-save preservation and readable exact amounts.
- Focused authorization/security review, concrete findings fixed and reproductions rerun. Passing suites alone is not the review.

If runtime tooling is unavailable, finish reachable work and report the exact unverified gate. Do not claim complete implementation without evidence.

## Execution and Completion

Execute inline unless a backend owner (Tasks 1–2) and frontend owner (Tasks 3–4) genuinely run concurrently against the plan's fixed contracts. Shared models/schemas/migrations/routes have one owner each. Concurrent workers skip builds/tests/linters; validate centrally after edits settle.

Runtime proof is complete. `README.md`, `state.md`, and this active handoff now record the actual behavior, exact command counts, migration/CLI/browser evidence, security result, and remaining unverified later-release work. Owned disposable databases and browser-run artifacts were removed. Do not commit, push or deploy without separate authorization.

Out of scope: M3 transactions/aggregates, M4 analytics, M5 budgets, M6 export/settings/operations/release, transfers/imports/recurrence, icons/colors, unarchive, pagination, public registration and production-readiness claims.

**Stop after verified Milestone 2. Request user review before Milestone 3 — Transactions.**
