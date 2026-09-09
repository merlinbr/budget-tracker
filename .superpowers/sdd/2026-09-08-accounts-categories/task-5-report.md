# M2 Task 5 implementation report

## Status

Implemented the permanent real-backend browser lifecycle. Controller integrated verification and final review fix reruns are complete; this report records the full M2 Task 5 evidence.

## Files

- `frontend/e2e/accounts-categories.spec.ts`
  - Runs the same lifecycle at 1280×900 and 390×844.
  - Uses `BUDGET_E2E_USERNAME` and `BUDGET_E2E_PASSWORD` from the existing Playwright harness.
  - Uses a per-test `crypto.randomUUID()` suffix for account/category names.
  - Exercises real login, account creation with exact `-84,72` cents, reload, account type/name editing, warned `-90.00` balance editing and acknowledgement, keyboard-only invalid account submission, category expense/income creation, category rename with immutable type, archive cancel/confirm, active/archive visibility, refresh, logout, and protected deep links.
  - Uses accessible label/role selectors and does not use fixed record IDs or happy-path backend mocks.
  - Reviewer fix round: category cards are scoped to the accessible `Expense Categories` and `Income Categories` regions, so expense creation/rename and income creation assertions verify their actual groups. After reload with archived rows shown, category and account cards assert both Edit and Archive controls are absent.
- Fix-round details: replaced the category card’s ancestor-rooted inner locator with a page-rooted exact-name locator valid for relative card filtering. Added assertions that the active income category remains visible after expense archive and after reload with archived categories shown.
- Existing `accounts.page.spec.ts` and `categories.page.spec.ts` continue to cover failed-save value/error preservation; no duplicate browser fault route was added.
- `.superpowers/sdd/2026-09-08-accounts-categories/task-5-report.md`

## Tests/commands

- `cd frontend && npx playwright test e2e/accounts-categories.spec.ts --list`
  - Passed: 2 tests discovered (1280px and 390px lifecycle cases).
- `cd backend && python -m pytest`
  - Passed: 55 tests.
- `cd frontend && npm test -- --watch=false`
  - Passed: 8 test files / 19 tests.
- `cd frontend && npm run build -- --configuration development`
  - Passed.
- `cd frontend && npx playwright test`
  - Passed: 6 real-backend browser tests at 1280×900 and 390×844.

## Controller acceptance evidence

- Fresh disposable `0002_identity → 0003_accounts_categories` preserved identity/session rows and exact `-8472` cents.
- Separate disposable `0003 → 0002 → 0003` preserved identity/session rows while removing/recreating financial tables; an empty database reached `0003_accounts_categories` head.
- Real PTY bootstrap accepted all 17 exact default category pairs and declined with 0 category rows.
- Focused M2 security review found no confirmed Critical, High, Medium, or Low vulnerabilities. Optional cache/CSP/HSTS/UUID/limiter hardening remains outside M2.
- Disposable proof databases and browser-run artifacts were removed. No `.env`, production data, deployment, or M3 artifact changed.
- Final review fixes: `042acac` repaired 401 navigation recovery, stale detail loads, failed-list empty states, warning accessibility, commit rollback, and CLI conflict wording; `14442f7` added visible pending-navigation status feedback.
- Post-fix reruns: backend `55` passed; frontend `8` files / `19` tests passed; development build passed; real-backend Playwright `6` passed.

## Commits

Implementation and review-fix commits: `37e77ed`, `6a3b5e6`, `452436d`, `042acac`, `14442f7`. Report commits: `a4bf3d5`, `f0ab6f5`, plus the fix-round report updates.
