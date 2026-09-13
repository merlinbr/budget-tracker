# Luna — Milestone 3 Transactions Handoff

## Assignment

Implement **Milestone 3 — Transactions only**, end to end, after reading the focused plan below. The user reports **Milestone 2 is complete**. Do not restart authentication or rebuild accounts/categories. This handoff supersedes the previous Milestone 1 assignment.

This is an assignment for a later implementation session. The planning session changed documentation only; it did not implement or verify transactions.

## Read First

1. `BUDGET_TRACKER_MVP_SPEC.md` — product source of truth; focus on §§7.7, 9–12, 15, 21, 22.3–22.5, 23–25, 33, 35–39, 42 and Milestone 3 in §44.
2. `docs/superpowers/plans/2026-09-07-transactions.md` — complete five-task plan, exact public contracts, proposed file map, implementation details, edge cases, checks and acceptance gates. Read it in full before editing.
3. The completed Milestone 2 code/handoff — reuse its account/category models, routers, archive semantics, money helpers, Angular services/navigation and tests.
4. `docs/superpowers/plans/2026-09-07-budget-tracker-mvp.md` — overall architecture, gap decisions and Tasks 2.1–3.1. The focused transaction plan expands Task 3.1.
5. `README.md` and `state.md` — run commands and historical evidence; update status only after verified implementation.

Follow the MVP if a plan detail conflicts with a mandatory requirement. Reuse completed M2 public contracts and internal conventions; record justified path/symbol adaptations rather than adding duplicate helpers.

## Starting-State Caveat

The checkout visible during planning contains authentication code and revision `0002_identity`; its README/state still describe Milestone 1. The completed M2 internal files were not available to inspect. This does **not** override the user's report that M2 is complete.

Start implementation from the completed M2 checkout and locate its actual financial files and migration head. The focused plan marks M2 paths/contracts as expected rather than inspected. If those files remain unavailable, report the missing checkout prerequisite. Do not silently implement M2 as part of this assignment, reset unrelated work or invent a migration parent.

## Deliver All Five Tasks

| Task | Required result |
|---|---|
| 1 — Authorized transaction writes | Model/migration, strict schemas, authenticated scoped POST/detail/PUT/DELETE, sign/reference/archive validation and regression coverage |
| 2 — Filtered history | Scoped list, year/month/account/category/type/literal search filters and deterministic descending order |
| 3 — Live account balances | Initial balance plus all signed transactions across every account response; exact create/edit/move/delete behavior; safe aggregate overflow errors |
| 4 — Angular workflow | Exact money entry/display, local calendar dates, guarded page, list/filters, add/edit/delete, archived history, accessible phone/desktop UI |
| 5 — Integration gate | Real-backend browser workflow, M2-data migration preservation, focused security review, integrated tests and accurate documentation |

Do not stop after a migration, backend API, parser or unexercised screen. The focused plan defines the complete deliverable and exact task contracts.

## Non-Negotiable Contracts

- Existing stack and dependencies only; direct feature-local code. No generic CRUD framework, additional state library, repository abstraction or new money package.
- Derive household and creator server-side. Every transaction lookup/filter/account aggregate is scoped. Validate each referenced account and category within the same household.
- Money is nonzero strict integer cents in `[-9007199254740991, 9007199254740991]`. Reject booleans, floating-point JSON numbers, numeric strings, zero and overflow. Positive requires income; negative requires expense.
- Preserve safe M2 money helpers. Parse decimal digit components, not `parseFloat * 100`; prove edit/display precision through the largest accepted cent value.
- Date is a real `YYYY-MM-DD` calendar date; reject timestamp/epoch inputs. Default from browser-local calendar components, never UTC ISO slicing. Technical timestamps remain UTC.
- Description is optional/null, maximum 500 Unicode code points, displayed as plain text. Do not log financial notes or full request payloads.
- New/changed references require active records. An edit can retain only its own original archived references; household and category/sign validation still apply.
- Preserve creator/household/created timestamp on edit. Full PUT; hard transaction deletion; no transaction upsert or account/category hard deletion.
- Keep all five `/api/transactions` endpoints, array collection responses and the existing error envelope. Create 201, update/detail/list 200, delete 204; scoped absent/foreign resources 404, validation 422, aggregate overflow 409.
- Filters: paired year/month or all-time, account, category, income/expense, bounded literal description search. Sort by transaction date, creation time and ID descending. No pagination this milestone.
- Account balance is derived, never stored in a mutable second column. Include all-time signed activity, including history referencing archives. Reject unsafe aggregate results rather than rounding or returning floats.
- Preserve global CSRF/Origin/session checks and Angular 401 handling. No auth bypass, browser storage of financial form state, optimistic deletion or automatic unsafe replay.
- Preserve entered values on failed writes and distinguish successful save followed by failed refresh from failed save. Keep failed list loading distinct from an empty history.

## Verification

Use existing disposable test fixtures and the Playwright-owned temporary database. Never downgrade/reset the user's `data/budget.db`, overwrite `.env`, alter production deployment or use fixed committed E2E credentials.

After edits settle, run:

```text
# backend
python -m pytest

# frontend
npm test -- --watch=false
npm run build
npx playwright test
```

Also prove:

- Two-household isolation for list/detail/create/update/delete/filter references and account aggregates; same-household member editing; creator immutability; unchanged data after rejected writes.
- Strict cents/sign/date/description boundaries; literal SQL search; archive retention versus new archive selection.
- Checking `100000 + 350000 - 8472 - 1799 = 439729`; edit Groceries to `-9000` gives `439201`; delete Netflix gives `441000`. Moving a transaction changes both account balances.
- Safe-integer and SQLite integer-SUM overflow produce explicit errors, not rounded totals; transaction correction remains usable.
- Disposable M2-data upgrade, transaction write/read, downgrade to actual M2 revision and re-upgrade, preserving M2 records.
- Real browser login → M2 resource creation → add/filter/edit/delete → account balance → refresh → logout/deep-link denial. Inspect desktop and phone layouts, keyboard entry, field errors, failed-save preservation and local-date timezone behavior.
- Focused authorization/security review with actionable findings fixed and their reproductions rerun. Passing tests is not itself a security review.

If a runtime capability is missing, finish reachable work and name the precise unverified gate. Do not claim a pass or full completion without evidence.

## Execution Boundaries

Implement inline unless backend/frontend slices genuinely run concurrently after contracts are fixed. One backend owner handles models/schemas/migration/account integration; one frontend owner handles shared types/money/routes/navigation. Concurrent workers skip builds/tests/linters; validate centrally after edits settle.

After runtime proof, remove owned throwaway artifacts and update README/state/this handoff with actual results. Do not commit, push or deploy without separate authorization.

Out of scope: M4 dashboard, M5 budgets, M6 export/settings/operations/release work, transfers, imports, recurring entries, attachments, pagination, audit infrastructure and public registration. Do not claim the application is production-ready.

**Stop after verified Milestone 3. Request user review before Milestone 4 — Dashboard.**

## Completion Report

Report completed behavior; actual changed files and M2 path adaptations; real test/command counts; balance/migration/browser evidence; security findings and fixes; explicit unverified gates; and the user-review boundary before M4. The focused plan's acceptance checklist is the completion definition.
