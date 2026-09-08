# M2 Task 4 implementation report

## Changed files

- `frontend/src/app/core/api/models.ts` — public account/category API types.
- `frontend/src/app/features/accounts/accounts.service.ts` and `accounts.page.ts` — account HTTP service and complete list/create/edit/archive workflow.
- `frontend/src/app/features/accounts/accounts.page.spec.ts` — native-form account regression coverage.
- `frontend/src/app/features/categories/categories.service.ts` and `categories.page.ts` — category HTTP service and complete list/create/edit/archive workflow.
- `frontend/src/app/features/categories/categories.page.spec.ts` — native-form category regression coverage.
- `frontend/src/app/features/dashboard/dashboard.page.ts` — extracted identity dashboard.
- `frontend/src/app/layout/app-shell.ts` — reusable authenticated shell navigation and child outlet.
- `frontend/src/app/app.routes.ts` — guarded dashboard/accounts/categories route tree.
- `frontend/src/app/shared/utilities/validators.ts` — shared code-point length validator.
- `frontend/src/app/features/login/login.page.ts` — migrated validator import without changing password/login semantics.

## Verification

Commands run from `frontend`:

- `npm run build -- --configuration development` — passed; Angular application bundle generated.
- `npm test -- --watch=false --include=src/app/features/accounts/accounts.page.spec.ts --include=src/app/features/categories/categories.page.spec.ts --include=src/app/features/login/login.page.spec.ts --include=src/app/shared/utilities/money.spec.ts` — passed: 4 files, 13 tests.
- `npm test -- --watch=false --include=src/app/core/auth/auth.guard.spec.ts --include=src/app/app.component.spec.ts` — passed: 2 files, 2 tests.
- Focused account/category rerun after refresh-state fixes — passed: 2 files, 8 tests.

The focused page specs exercise native controls/events, negative comma money, invalid/overflow no-write behavior, changed-balance acknowledgement, conflict field association/value preservation, expense/income creation, name-only category rename, and failed category save preservation. No real backend/browser smoke was run in this worker; integrated real-browser acceptance remains Task 5.

## Self-review

- API payloads use camelCase and category updates send only `name`.
- Money remains text input and uses `parseSignedMoney`, `signedMoneyInput`, and `formatMoney`; browser state never recomputes balances.
- Archived rows are visibly read-only and omit edit/archive actions.
- List errors are separate from empty states, retry only GET, and stale list responses are ignored.
- Save/archive requests are guarded against duplicates; form values remain on write failure.
- Detail fetches are used before editing and archived detail is not editable.
- Archive confirmation is inline, names the resource, supports cancel, and restores focus.
- Native labels, associated live errors, warnings, and responsive layouts are included.
- Existing login/logout/auth interceptor behavior was retained.

## Concerns

- Real-browser desktop/390px interaction and disposable-backend verification are intentionally left to Task 5.

## Commit

Implementation commit: `84c450f` (amended once to include this final SHA).
