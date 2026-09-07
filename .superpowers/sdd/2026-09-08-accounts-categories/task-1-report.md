# M2 Task 1 Report

## Status

DONE

## Commit

- `3296ffc` — `feat: add household-scoped account and category APIs`

## Files changed

- `backend/app/accounts.py` — household-scoped account list/detail/create/update/idempotent archive routes, duplicate handling, and `account_response` seam.
- `backend/app/categories.py` — household-scoped category list/detail/create/update/idempotent archive routes and duplicate handling.
- `backend/app/money.py` — strict bounded `Cents` type and `MAX_SAFE_CENTS`.
- `backend/app/models.py` — `Account` and `Category` ORM models with timestamps, scoped foreign keys, named uniqueness/check constraints, and indexes.
- `backend/app/schemas.py` — strict financial write schemas, trimmed resource names, account/category literals, and public response schemas.
- `backend/migrations/versions/0003_accounts_categories.py` — explicit accounts/categories migration and downgrade.
- `backend/app/main.py` — registered both routers while retaining auth, CSRF, and global handlers.
- `backend/tests/conftest.py` — authenticated HTTP client fixture.
- `backend/tests/test_accounts.py` — real authenticated account lifecycle, validation, duplicate, archive, ordering, and query regressions.
- `backend/tests/test_categories.py` — real authenticated category lifecycle, immutable type, validation, duplicate, archive, ordering, and query regressions.
- `backend/tests/test_authorization.py` — parameterized real two-household isolation and same-household member mutation regression.

Unrelated documentation changes were not staged or modified.

## Focused verification

From `backend`:

- `python -m pytest tests/test_accounts.py tests/test_categories.py tests/test_authorization.py`
  - **PASS: 11 passed**, 13 dependency deprecation warnings.
  - Fixture setup migrated disposable SQLite databases through `0003_accounts_categories`.
- `python -m py_compile app/accounts.py app/categories.py app/money.py app/models.py app/schemas.py`
  - **PASS**.
- Strict schema smoke check for trimmed 100-code-point Unicode names and both safe cent endpoints
  - **PASS** (`schema boundaries ok`).

## Self-review findings

- Ownership is always derived from `HouseholdContext`; all lookup, list, and mutation queries are household-scoped.
- Detail lookups include archived rows; active lists filter archives unless `includeArchived=true`; archive is idempotent and never deletes.
- Writes use strict Pydantic models, reject extra ownership/output fields, trim and bound names, and reject non-strict/out-of-range cents.
- Duplicate handling relies on the database uniqueness constraints, rolls back first, classifies only SQLite unique violations, and re-raises other integrity failures.
- Account responses use one explicit balance seam and expose no ownership or timestamp fields.
- Category updates accept name only, preserving immutable category type.
- Both financial routers retain the application-wide CSRF/Origin guard and existing exception envelope.

## Concerns

- Focused verification intentionally omitted the project-wide suite, formatters, linters, frontend, and Task 2 bootstrap seeding per assignment scope. No known implementation concern remains for Task 1.

## Follow-up Fix Report

Main-agent review identified missing regression coverage (production code was unchanged). Added focused HTTP tests for:

- Anonymous list/detail and unsafe-route authentication denial with valid anonymous CSRF.
- Missing CSRF, foreign-session CSRF, and disallowed Origin rejection while preserving resource data.
- Cross-household list isolation after the owner resource is archived.
- Forged ownership/output fields on account and category writes, with no mutation.
- Safe positive/negative cent boundaries, `-1`, `credit_card`, unknown account type, Unicode/plain-text names, failed rename preservation, archive-reserved uniqueness, and absence of DELETE success.

Amended focused command from `backend`:

```text
python -m pytest tests/test_accounts.py tests/test_categories.py tests/test_authorization.py
```

Result: **PASS — 19 passed**, with 21 dependency deprecation warnings.

- Follow-up commit: `3cb4bae` — `test: complete account category security regressions`.
