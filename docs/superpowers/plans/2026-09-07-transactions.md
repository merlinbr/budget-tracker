# Milestone 3 — Transactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the available `subagent-driven-development` skill when implementing genuinely independent slices; otherwise execute inline, task by task. Steps use checkbox (`- [ ]`) syntax for tracking. This document is a future implementation assignment for Luna, not authorization to implement during the planning session.

**Goal:** Let authenticated household members create, browse, filter, edit and delete income/expense transactions with exact integer-cent amounts and correctly recalculated account balances.

**Architecture:** Extend the existing synchronous FastAPI/SQLAlchemy application and Angular feature-local pages/services. Authorize every financial query through `require_household`, validate account/category references inside the same database session as the write, and derive balances from transactions rather than maintaining a second balance column. Reuse Milestone 2 account/category services, archive semantics, money utilities and navigation wherever they already exist.

**Tech Stack:** Existing Angular 22.1.x, TypeScript, reactive forms, HttpClient, signals/RxJS; Python 3.13–3.14, FastAPI, Pydantic, SQLAlchemy 2.x, Alembic, SQLite; pytest, Angular's existing Vitest runner and Playwright. Keep installed versions and add no dependency.

## Global Constraints

Source: `BUDGET_TRACKER_MVP_SPEC.md`, especially §§7.7, 9–12, 15, 21, 22.3–22.5, 23–25, 33, 35–39, 42 and Milestone 3 in §44.

- “Money must **never** use binary floating-point storage.” Store and transport integer cents; currency is `EUR`; no multi-currency support.
- “Every household-data query must be scoped using the authenticated user's household membership.” Never accept client-supplied household ownership or creator identity.
- “The backend must verify that referenced account/category records belong to the same household as the transaction.” Foreign keys alone do not enforce this.
- “Amount must not be zero.” “Date must be valid.” Description maximum: `500 chars`.
- “Transaction dates are calendar dates, not timestamps.” Store `DATE`; technical timestamps are UTC; the add form defaults to browser-local today.
- “User may edit any transaction belonging to their household.” Owner/member financial permissions remain identical.
- “Archived accounts remain referenced by historical transactions.” “Archived categories remain visible on historical transactions.” Transactions may be hard-deleted.
- “The frontend converts the entered decimal amount to cents safely.” Backend validation remains authoritative.
- “MVP must remain usable on a phone.” Label inputs, associate errors, support keyboard operation, semantic buttons, readable amounts and visible focus.
- Preserve opaque cookie sessions, global Origin/CSRF checks, auth restoration and 401 handling. No new authentication implementation or request replay mechanism.
- Preserve the same-origin `/api` proxy, one-worker deployment, existing database configuration and dependency pins. Never modify real `.env`, `data/budget.db`, production networking or user records for verification.
- Do not commit, push or deploy without separate authorization. Do not mark a task complete based only on compiling or mocked HTTP responses.

---

## 1. Starting State, Authority and Preflight

The user reports **Milestone 2 is complete**. Treat that as the execution prerequisite, not a request to rebuild accounts/categories.

At planning time, the available checkout exposes identity/authentication code and revision `0002_identity`; `state.md`, `README.md` and the previous Luna handoff still describe Milestone 1. Account/category implementation files and `0003_accounts_categories` are not present in this visible snapshot. This is a checkout/context gap, not evidence that the reported completion is wrong. Consequently, this plan distinguishes inspected integration points from expected Milestone 2 contracts and does not pretend to know unavailable implementation symbols.

**Before editing, Luna must:**

- [ ] Read repository instructions, this entire plan, the MVP sections above, the completed Milestone 2 implementation/handoff, and the broader plan's “Decisions Resolving Specification Gaps” and Tasks 2.1–3.1.
- [ ] Work from the completed Milestone 2 checkout. Locate its account/category models, routers, public schemas, services, archive tests, shared money code and active migration head. Do not reset, switch branches destructively or overwrite unrelated work. If that checkout is unavailable, report the precise missing prerequisite; do not silently expand this assignment into Milestone 2.
- [ ] Record actual paths for the expected contracts below in the completion report. Reuse existing symbols rather than introducing a parallel convention. Inspect references before changing exported account response/balance functions or shared money utilities; use LSP references when available.
- [ ] Read the existing account/category tests as conventions, without rerunning checks merely to challenge the user's completion report. Later run them to verify the new transaction integration.

**Authority:** MVP requirements → completed Milestone 2 public contracts → this focused M3 plan → broader MVP plan → historical status notes. If a completed M2 contract differs from a proposed internal path here, adapt the path, not the externally promised behavior. A genuine product conflict must be reported rather than hidden.

### Inspected integration points

| File/symbol | Observed behavior and reuse |
|---|---|
| `backend/app/models.py` | One declarative `Base`; integer IDs; `utc_now`; technical timestamps with `default=utc_now`, `onupdate=utc_now`. Add the transaction model beside the existing models. |
| `backend/app/db.py` | `get_db()` yields synchronous sessions; SQLite foreign keys, WAL and busy timeout are configured. Do not introduce async DB access or a second session factory. |
| `backend/app/auth/dependencies.py` | `require_household(...) -> HouseholdContext(user_id, household_id, role)` checks live session/user/membership. All five transaction endpoints consume it. |
| `backend/app/main.py:create_app` | Global `Depends(csrf_guard)`, settings override, error registration, router registration. Include the transaction router without weakening global dependencies. |
| `backend/app/errors.py` | `APIError(status_code, code, message, fields=None)` and a shared 422 handler. Use camelCase field names in custom errors. |
| `backend/app/schemas.py` | Strict request models, forbidden extra fields, explicit aliases and public responses. Financial request classes must not inherit an authentication-specific request class. |
| `backend/tests/conftest.py` | `test_app`, `client`, `db_session`, `seeded_user`, `csrf_headers`; each test uses a migrated disposable SQLite database. Reuse rather than replace. |
| `frontend/src/app/core/api/models.ts` | Shared public TypeScript contracts; currently inspected auth contract uses camelCase. Reuse M2 Account/Category definitions. |
| `frontend/src/app/core/auth/auth.interceptor.ts` | API 401 clears auth and navigates to login; other failures remain available to the feature. |
| `frontend/src/app/features/login/login.page.*` | Standalone component, nonnullable reactive form, signals for pending/errors, labelled fields and preserved values on failure. Follow the M2 page pattern if newer. |
| `frontend/src/app/app.routes.ts`, `layout/app-shell.ts` | Authenticated routing/navigation integration points; preserve the shell changes delivered in M2. |
| `frontend/playwright.config.ts` | Migrates and seeds a real isolated backend; generated credentials via environment; owned temporary directories; global teardown. Extend the scenario, not the harness architecture. |

### Required Milestone 2 contracts

These are the broader plan's contracts, not claims that the corresponding files were inspected:

- `Account`: `id`, `name`, `type`, `initialBalance`, `balance`, `isArchived`.
- `Category`: `id`, `name`, `type` (`income` or `expense`), `isArchived`.
- `GET /api/accounts`, `GET /api/categories`: arrays; support `includeArchived=true` for historical display/filter options.
- Both resources have scoped detail/create/update and idempotent archive endpoints. Archive is not physical deletion.
- Account/category ownership is immutable. Category type is immutable after creation.
- Account balance is currently initial balance until transactions exist; M3 must replace that calculation in every account response path.
- Existing money validation/conversion, if present, is extended rather than duplicated.

## 2. Scope and Explicit Decisions

**Deliver all seven M3 bullets:** transaction CRUD, form, list, filters, signed model, cents storage, and household/account/category validation. Also deliver exact account balances: these are required by §10 and the broader plan's Task 3.1 and become observable as soon as transactions exist.

**Do not implement:** dashboard cards/charts/recent-transaction widgets/global month selector (M4), budgets (M5), export/settings/backup tooling/release networking (M6), pagination, transfers, imports, recurring transactions, soft-delete/audit infrastructure, attachment fields, optimistic version fields, background jobs or new state libraries. Do not label the app production-ready; backup/network/HTTPS release gates still apply.

| Question | Decision |
|---|---|
| Implementation shape | Direct feature router, explicit schemas, one Angular page and reusable form. No generic CRUD framework or repository/service layering with one caller. |
| List response/pagination | JSON array; server-side filters, no pagination. This is explicitly permitted by §15. Document the full-result-set ceiling; add pagination when real history size justifies it. |
| Period filter | `year` and `month` must appear together. Neither means all dates. Use a local month input on this page; default to current local month. Clear filters selects all dates. No second date-range API this milestone. |
| Sorting | `transaction_date DESC, created_at DESC, id DESC`. ID breaks exact timestamp ties deterministically. |
| Search | Trim query, maximum 500 Unicode code points; empty is no filter. Literal description substring using bound SQL parameters and escaped LIKE wildcards. SQLite's built-in case-insensitivity covers ASCII; do not promise full Unicode case folding or install a search dependency. |
| Amount bounds | Strict integer cents, `-9007199254740991 <= amount <= 9007199254740991`, excluding zero. Reject JSON booleans, floating-point numbers, strings and out-of-range values. Reuse the M2 safe-money constant/type if available. |
| Sign | Positive amount requires income category; negative requires expense. No override or independent writable `type` column/body field. |
| Description | Missing/null/empty becomes `null`; preserve nonempty content rather than silently normalizing financial notes. Reject more than 500 code points before storing. Render only as text. |
| Dates | Request accepts only an actual valid `YYYY-MM-DD` date string, years 0001–9999. Reject timestamps, epoch numbers and invalid dates. No past/future restriction; no timezone conversion of transaction dates. |
| Archived references | Create and changed reference IDs require active records. PUT may retain that transaction's own archived account/category, but ownership and sign compatibility still apply. Never offer arbitrary archived records as new choices. |
| Resource denial | Unknown/foreign transaction ID: generic 404. Unknown/foreign account/category, including a filter ID: same generic 404. Owned archived newly selected reference: 422 with the relevant field. No foreign names or existence distinction. |
| Update | Full PUT of editable fields; no PATCH. Creator, household, ID and created timestamp remain immutable. Last successful write wins; no new concurrency token contract. |
| Failure behavior | Validation and reference checks finish before mutation. One commit per write; rollback on failure. A rejected write changes neither transaction nor balances. No automatic retries of POST/PUT/DELETE. |
| Aggregate overflow | Account responses fail with 409 `CONFLICT` instead of returning unsafe/rounded money if a balance cannot fit the safe JSON range. Catch only SQLite's specific integer-SUM-overflow condition and translate it to that same error; do not hide unrelated DB failures. Stored transactions remain editable/removable so users can correct the range. |
| UI behavior | Explicit Apply/Clear filter buttons, native inputs/selects, inline add/edit form and an inline accessible delete confirmation. Avoid modal focus plumbing and a debounced-search dependency. |

### Public API contract

```typescript
export interface TransactionWrite {
  accountId: number;
  categoryId: number;
  amount: number; // nonzero safe integer cents, sign encodes type
  description?: string | null;
  transactionDate: string; // YYYY-MM-DD calendar date
}

export interface Transaction {
  id: number;
  accountId: number;
  categoryId: number;
  amount: number;
  description: string | null;
  transactionDate: string;
  createdAt: string; // ISO UTC timestamp
  updatedAt: string; // ISO UTC timestamp
}

export interface TransactionFilters {
  year?: number;
  month?: number;
  accountId?: number;
  categoryId?: number;
  type?: "income" | "expense";
  search?: string;
}
```

Do not add `householdId`, `createdByUserId`, account/category names, credentials or balances to the transaction JSON. Load name maps through M2 lists with archived records included. Responses are explicit schemas, not unrestricted ORM serialization.

| Method | Route | Success |
|---|---|---|
| GET | `/api/transactions` plus optional filters | 200 `Transaction[]` |
| POST | `/api/transactions` with `TransactionWrite` | 201 `Transaction` |
| GET | `/api/transactions/{id}` | 200 `Transaction` |
| PUT | `/api/transactions/{id}` with `TransactionWrite` | 200 updated `Transaction` |
| DELETE | `/api/transactions/{id}` | 204, empty body; subsequent GET/DELETE is 404 |

Malformed fields/query combinations: 422 `VALIDATION_ERROR`; missing session: 401 `AUTH_REQUIRED`; invalid Origin/CSRF: 403; scoped record denial: 404 `NOT_FOUND`. With invalid auth and invalid CSRF together, preserve the existing dependency ordering rather than inventing a new precedence rule.

Example POST body:

```json
{
  "accountId": 1,
  "categoryId": 5,
  "amount": -8472,
  "description": "REWE",
  "transactionDate": "2026-09-07"
}
```

## 3. File Map and Execution Order

Paths for new transaction files below are proposed. If M2 already established a different feature-module convention, follow it and record the exact substituted paths. Do not create both versions.

| Task | Create | Modify/reuse |
|---|---|---|
| 1 — Authorized transaction writes | `backend/app/transactions.py`; `backend/migrations/versions/0004_transactions.py`; `backend/tests/test_transactions.py` | `models.py`, `schemas.py`, `main.py`; M2 financial types/reference lookup; existing fixtures |
| 2 — Filtered history | No additional production file | `transactions.py`, `test_transactions.py` |
| 3 — Live account balances | `backend/app/money.py`, `backend/tests/test_money.py` only if M2 has no money module | Actual M2 account router/serializer and `backend/tests/test_accounts.py`; M2 money module otherwise |
| 4 — Usable Angular transaction workflow | `frontend/src/app/features/transactions/transactions.service.ts`, `transactions.page.ts`, `transactions.page.html`, `transactions.page.css`, `transaction-form.ts`, `transaction-form.html`, `transaction-form.spec.ts`; `frontend/src/app/shared/utilities/money.ts`, `money.spec.ts` only if no M2 equivalents exist | `core/api/models.ts`, `app.routes.ts`, actual M2 navigation; existing money/account/category services; reuse feature form styles before adding a separate form stylesheet |
| 5 — Integrated acceptance | `frontend/e2e/transactions.spec.ts` | Relevant regressions, `README.md`, `state.md`, `docs/LUNA_HANDOFF.md`; browser harness only if an actual integration requires it |

**Dependency order:** 1 → 2 → 3 → 4 → 5 is the simple inline path. After preflight contracts are fixed, frontend Task 4 can run concurrently with backend Tasks 1–3, but live acceptance waits for both. Task 2 modifies Task 1's files and is not an independent sibling. One backend owner handles models/schemas/migration/account integration; one frontend owner handles types/money/routes/navigation. Do not dispatch agents to discover/negotiate this plan. Concurrent workers skip builds/tests/linters until edits settle; the integration owner runs validation centrally.

## Task 1 — Authorized Transaction Persistence and Writes

**Files:** New migration, `backend/app/transactions.py`, `backend/tests/test_transactions.py`; modify `backend/app/models.py`, `schemas.py`, `main.py` and reuse M2 financial validation.

**Consumes:** `Base`, `utc_now`, M2 `Account`/`Category`, `get_db()`, `require_household()`, `HouseholdContext`, `APIError`, existing CSRF guard and fixtures.

**Produces:** `Transaction` ORM model, `TransactionWrite`/`TransactionResponse` Pydantic schemas, `transactions.router`, POST/detail/PUT/DELETE contracts above. These model/schema names are Python-local; the TypeScript transaction contract remains as defined above.

- [ ] **1. Establish behavior tests before implementing the write path.** Extend M2 authenticated resource setup; use real login and CSRF fixtures, not a fake household dependency. A minimal reusable login helper in `test_transactions.py` is:

```python
def login(client, seeded_user, csrf_headers):
    response = client.post(
        "/api/auth/login",
        json={"username": seeded_user.username, "password": seeded_user.password},
        headers=csrf_headers(),
    )
    assert response.status_code == 200


def create_record(client, csrf_headers, route, payload):
    response = client.post(route, json=payload, headers=csrf_headers())
    assert response.status_code == 201, response.text
    return response.json()


def test_transaction_write_lifecycle(client, seeded_user, csrf_headers):
    login(client, seeded_user, csrf_headers)
    account = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 100000,
    })
    category = create_record(client, csrf_headers, "/api/categories", {
        "name": "Groceries", "type": "expense",
    })
    payload = {
        "accountId": account["id"], "categoryId": category["id"],
        "amount": -8472, "description": "REWE",
        "transactionDate": "2026-09-07",
    }
    saved = create_record(client, csrf_headers, "/api/transactions", payload)
    url = f"/api/transactions/{saved['id']}"
    assert client.get(url).json()["amount"] == -8472
    changed = client.put(url, json={**payload, "amount": -9000}, headers=csrf_headers())
    assert changed.status_code == 200
    assert changed.json()["amount"] == -9000
    assert changed.json()["createdAt"] == saved["createdAt"]
    removed = client.delete(url, headers=csrf_headers())
    assert removed.status_code == 204 and removed.content == b""
    assert client.get(url).status_code == 404
```

Align only the account/category creation payload to the actual M2 public contract if needed; do not change the transaction contract. Keep this function-scoped fixture local to the transaction test module:

```python
import pytest
from sqlalchemy import func, select
from app.models import Transaction

@pytest.fixture
def transaction_setup(client, seeded_user, csrf_headers):
    login(client, seeded_user, csrf_headers)
    account = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 100000,
    })
    category = create_record(client, csrf_headers, "/api/categories", {
        "name": "Groceries", "type": "expense",
    })
    payload = {
        "accountId": account["id"], "categoryId": category["id"],
        "amount": -8472, "description": "REWE", "transactionDate": "2026-09-07",
    }
    return client, csrf_headers, payload

@pytest.mark.parametrize("amount", [0, True, -1.5, -8472.0, "-8472", -(2**53), 2**53])
def test_rejects_invalid_amount_without_creating_record(
    transaction_setup, amount, db_session, seeded_user,
):
    client, csrf_headers, payload = transaction_setup
    response = client.post(
        "/api/transactions", json={**payload, "amount": amount}, headers=csrf_headers(),
    )
    assert response.status_code == 422
    assert "amount" in response.json()["error"]["fields"]
    count = db_session.scalar(select(func.count()).select_from(Transaction).where(
        Transaction.household_id == seeded_user.household_id,
    ))
    assert count == 0
```

The case `-8472.0` specifically catches permissive integer coercion. Once Task 2 provides the public list endpoint, replace the scoped persistence count with the public empty-list assertion defined there.

Run from `backend`: `python -m pytest tests/test_transactions.py -k 'write_lifecycle or invalid_amount'`. Expected initially: missing transaction behavior, not unrelated infrastructure/import failure.

- [ ] **2. Add the model and migration.** Use the next free revision following the completed M2 head; `0004_transactions`/`0003_accounts_categories` are expected names, not permission to fork migration history. Migration upgrade creates only this table and its indexes; downgrade removes only them. Do not rewrite M1/M2 migrations.

Required columns:

```text
id                  INTEGER PRIMARY KEY
household_id        INTEGER NOT NULL REFERENCES households(id) ON DELETE RESTRICT
account_id          INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT
category_id         INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT
amount              INTEGER NOT NULL
description         TEXT NULL
transaction_date    DATE NOT NULL
created_by_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT
created_at          DATETIME NOT NULL  [UTC]
updated_at          DATETIME NOT NULL  [UTC]
```

Match M2 model/migration integer conventions, while keeping foreign-key deletion restrictive to protect history. Add named checks for nonzero amount, safe integer range, SQLite integer storage type, and nullable description length <= 500. SQLite type affinity alone can otherwise accept REAL values through direct writes.

```python
CheckConstraint("typeof(amount) = 'integer'", name="ck_transactions_amount_integer")
CheckConstraint("amount != 0", name="ck_transactions_amount_nonzero")
CheckConstraint(
    "amount BETWEEN -9007199254740991 AND 9007199254740991",
    name="ck_transactions_amount_range",
)
CheckConstraint(
    "description IS NULL OR length(description) <= 500",
    name="ck_transactions_description_length",
)
```

Indexes: `ix_transactions_household_date(household_id, transaction_date)`, `ix_transactions_account_date(account_id, transaction_date)`, `ix_transactions_category_date(category_id, transaction_date)`. No transfer/import/recurrence fields. Set creator and timestamps server-side, not as database values copied from requests.

- [ ] **3. Define strict request and explicit response schemas.** Reuse M2 financial base/types if they carry the same semantics. The important Pydantic shape is:

```python
import re
from datetime import date
from typing import Annotated
from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_SAFE_CENTS = 2**53 - 1  # import the M2 constant instead when already defined

class TransactionWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    account_id: Annotated[int, Field(alias="accountId", gt=0)]
    category_id: Annotated[int, Field(alias="categoryId", gt=0)]
    amount: Annotated[int, Field(ge=-MAX_SAFE_CENTS, le=MAX_SAFE_CENTS)]
    description: Annotated[str | None, Field(max_length=500)] = None
    transaction_date: date = Field(alias="transactionDate")

    @field_validator("amount")
    @classmethod
    def nonzero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("Amount must not be zero.")
        return value

    @field_validator("transaction_date", mode="before")
    @classmethod
    def calendar_date(cls, value: object) -> date:
        if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            raise ValueError("Use a valid YYYY-MM-DD date.")
        return date.fromisoformat(value)

    @field_validator("description")
    @classmethod
    def empty_description(cls, value: str | None) -> str | None:
        return None if value == "" else value
```

Keep explicit camelCase aliases in `TransactionResponse` for account/category/date/timestamps, with `from_attributes=True` and the existing population convention. Return only the fields in the TypeScript contract. Serialize technical timestamps with a UTC offset or `Z`; SQLite may return naive datetimes, so interpret those known UTC storage values as UTC rather than local time. `transactionDate` serializes directly as a date string, never through a timestamp. Schema-generated `fields` keys must match form controls.

- [ ] **4. Implement scoped detail/write/delete operations and register the router.** Use synchronous handlers and `Depends(get_db)` / `Depends(require_household)` as in M2. Load an existing transaction with both predicates before inspecting update references:

```python
transaction = db.scalar(select(Transaction).where(
    Transaction.id == transaction_id,
    Transaction.household_id == context.household_id,
))
if transaction is None:
    raise APIError(404, "NOT_FOUND", "The requested resource was not found.")
```

For POST/PUT, separately load Account and Category scoped to `context.household_id`; missing or foreign returns the same 404. Reject newly selected archived references with 422 field errors. On PUT compare each ID against the stored transaction's own corresponding ID; another transaction using an archive does not authorize this transaction to select it. Verify `category.type == ("income" if body.amount > 0 else "expense")` even when the category ID is unchanged.

Perform all checks first, then assign **only** `account_id`, `category_id`, `amount`, `description`, `transaction_date`. POST additionally assigns household/creator from context. PUT preserves creator/household/created time, updates `updated_at` for an actual edit, and commits once. Refresh before returning. DELETE performs the scoped lookup and one hard delete/commit. Return `Response(status_code=204)` with no JSON body. Keep DB exceptions visible except for established narrowly handled constraint conflicts; rollback before translating errors.

Registration follows the existing shape:

```python
from .transactions import router as transactions_router
# Inside create_app, alongside the other feature router registrations:
app.include_router(transactions_router)
```

Do not put only the list behind authorization. Every endpoint must require household context, including DELETE and detail.

- [ ] **5. Prove security, archive preservation and validation.** Add focused behavior tests with these concrete cases, preferably extending the M2 two-household fixture:

| Boundary | Required observation |
|---|---|
| Household B transaction ID as A | Detail/PUT/DELETE all 404; B's persisted values unchanged |
| B account or B category supplied by A | POST and PUT 404; no row created and original row unchanged |
| Different member in A | Can edit/delete another A member's transaction; creator attribution does not change |
| Forged server fields | `householdId`, `createdByUserId`, `id`, `createdAt` rejected with 422 |
| Invalid values | zero, bool, float, numeric string, unsafe cents; invalid ID; sign/category mismatch; 501-code-point description; impossible date; datetime/epoch input all rejected |
| Correct boundaries | +/- one cent and both safe integer endpoints with matching category; 500-code-point description including non-BMP characters; leap day 2028-02-29 accepted |
| Archive after creation | Existing detail remains readable; amount/description correction retaining original archived references succeeds |
| Archive replacement | New transaction or changing an existing reference to a different archived record fails; changing to an active owned record succeeds |
| Retained category changed sign | Fails even when category is unchanged/archived; changing to a matching active category succeeds |
| Authentication/CSRF | Anonymous safe read 401; authenticated unsafe write with absent/bad CSRF or disallowed Origin 403; no write occurs |
| Unknown/deleted ID | Generic 404; no implicit upsert on PUT |

Run `python -m pytest tests/test_transactions.py tests/test_authorization.py tests/test_csrf.py`. Add a disposable migration check in Task 5; no real-database downgrades. Task 1 is complete only when the write lifecycle and security boundaries work through the actual API.

## Task 2 — Household-Scoped Filtered History

**Files:** `backend/app/transactions.py`, `backend/tests/test_transactions.py`.

**Consumes:** Task 1 model/response/auth/reference rules.

**Produces:** `GET /api/transactions` with `TransactionFilters` and stable array response; no additional data-access abstraction.

- [ ] **1. Add a dataset that makes filters distinguishable.** Through the Task 1 setup create two owned accounts, income and expense categories, and these records; create a separate household with a same-date/same-description record to catch scope leaks:

| Description | Date | Account | Category | Amount |
|---|---|---|---|---:|
| REWE weekly | 2026-09-07 | Checking | Groceries | -8472 |
| Salary | 2026-09-01 | Checking | Salary | 350000 |
| REWE cash | 2026-09-08 | Cash | Groceries | -101 |
| REWE August | 2026-08-31 | Checking | Groceries | -201 |
| 100%_literal | 2026-09-07 | Checking | Groceries | -301 |

Example assertion after storing the first record's ID as `weekly_id` and the created reference IDs:

```python
response = client.get("/api/transactions", params={
    "year": 2026, "month": 9, "accountId": checking_id,
    "categoryId": groceries_id, "type": "expense", "search": "rewe",
})
assert response.status_code == 200
assert [row["id"] for row in response.json()] == [weekly_id]
```

Make this a complete test in the file using the creation helper, not free variables copied into a test. Assert exact IDs for independent filters and the combined filter; do not merely assert that a list got shorter. Searching `%_` must find only the literal matching record. Add descriptions with a backslash and quote to prove escaping/parameterization; never concatenate them into SQL.

- [ ] **2. Validate query parameters and compose one scoped select.** Bound `year` to 1–9999, `month` to 1–12, reference IDs to positive integers, `type` to the two literals, and raw search to 500 code points. Reject year-only/month-only and invalid values with field-associated 422. An absent period means all-time. Validate owned account/category filter references, allowing archived records. A valid owned filter with no matches returns `[]`.

Use native calendar boundaries without timestamp conversion, including December 9999:

```python
from calendar import monthrange
from datetime import date

statement = select(Transaction).where(
    Transaction.household_id == context.household_id,
)
if year is not None and month is not None:
    first = date(year, month, 1)
    last = date(year, month, monthrange(year, month)[1])
    statement = statement.where(Transaction.transaction_date.between(first, last))
if search is not None and search.strip():
    statement = statement.where(
        Transaction.description.icontains(search.strip(), autoescape=True),
    )
statement = statement.order_by(
    Transaction.transaction_date.desc(), Transaction.created_at.desc(), Transaction.id.desc(),
)
```

Add `account_id`, `category_id` and `amount > 0` / `amount < 0` predicates only when their filters are supplied; combine with AND. Do not join household tables without scope or load all rows and filter in Python. Keep list loading to a single transaction select after the bounded optional reference checks. No per-row account/category DB lookups.

- [ ] **3. Cover history edge cases.** Assert list isolation with no filter and each foreign reference filter; archived records remain in history; null description doesn't match nonempty search; whitespace search behaves as no search; leap month and December/year boundaries; no period returns all records; identical dates/created timestamps order by descending ID. Set timestamps deliberately in the test DB for the tie case instead of sleeping.

After list exists, finish the rejected-write tests with the observable assertion:

```python
assert client.get("/api/transactions").json() == []
```

Run `python -m pytest tests/test_transactions.py`. Expected: exact dataset matches, stable order and no cross-household rows. Document the no-pagination and SQLite ASCII-search ceilings without adding a new search subsystem.

## Task 3 — Exact Live Account Balances

**Files:** Actual M2 account query/response implementation and `backend/tests/test_accounts.py`; existing money helper or `backend/app/money.py` / `backend/tests/test_money.py` if absent.

**Consumes:** M2 Account response, Task 1 transactions, shared safe-money bound.

**Produces:** Every account response's `balance` equals `initial_balance + SUM(all owned account transaction amounts)`; `initialBalance` itself remains unchanged.

- [ ] **1. Add the specification's exact-cent acceptance test.** Reuse API setup and assert observable account detail/list results, not mock calls or an isolated sum helper:

```text
Checking initialBalance = 100000
Salary                 = +350000
Groceries              =   -8472
Netflix                =   -1799
GET account balance    = 439729
PUT Groceries -> -9000  => balance 439201
DELETE Netflix         => balance 441000
```

Keep this complete balance test beside the transaction helpers in `test_transactions.py`; extend existing `test_accounts.py` for account-specific regressions rather than importing one test module from another:

```python
def test_balance_tracks_transaction_corrections(transaction_setup):
    client, csrf_headers, groceries_body = transaction_setup
    checking_id = groceries_body["accountId"]
    salary = create_record(client, csrf_headers, "/api/categories", {
        "name": "Salary", "type": "income",
    })
    netflix = create_record(client, csrf_headers, "/api/categories", {
        "name": "Netflix", "type": "expense",
    })
    create_record(client, csrf_headers, "/api/transactions", {
        **groceries_body, "categoryId": salary["id"],
        "amount": 350000, "description": "Salary",
    })
    groceries = create_record(client, csrf_headers, "/api/transactions", groceries_body)
    subscription = create_record(client, csrf_headers, "/api/transactions", {
        **groceries_body, "categoryId": netflix["id"],
        "amount": -1799, "description": "Netflix",
    })
    account_url = f"/api/accounts/{checking_id}"
    assert client.get(account_url).json()["balance"] == 439729
    changed = client.put(
        f"/api/transactions/{groceries['id']}",
        json={**groceries_body, "amount": -9000}, headers=csrf_headers(),
    )
    assert changed.status_code == 200
    assert client.get(account_url).json()["balance"] == 439201
    removed = client.delete(
        f"/api/transactions/{subscription['id']}", headers=csrf_headers(),
    )
    assert removed.status_code == 204
    assert client.get(account_url).json()["balance"] == 441000
```

Also move an existing expense between two accounts and assert **both** balances; update an account's initial balance and verify its response still includes all transaction activity.

- [ ] **2. Replace initial-balance-only responses everywhere.** Locate M2's shared account serializer/query and every caller. List/detail/update/archive-related reads must not disagree. Use one household-scoped aggregate subquery outer-joined to owned accounts, with `coalesce(sum, 0)` only for missing transactions. Preserve archive list semantics; date filters on the transactions page never affect this all-time balance.

```python
from sqlalchemy import func, select

activity = (
    select(Transaction.account_id, func.sum(Transaction.amount).label("total"))
    .where(Transaction.household_id == context.household_id)
    .group_by(Transaction.account_id)
    .subquery()
)
statement = (
    select(Account, func.coalesce(activity.c.total, 0))
    .outerjoin(activity, activity.c.account_id == Account.id)
    .where(Account.household_id == context.household_id)
)
# Apply the existing account ID/archive predicates, then for each (account, total):
balance = account.initial_balance + total
```

Compute the final addition in Python integers, not SQLite arithmetic that might promote an overflowing addition to REAL. Pass `balance` through the existing safe-money checker (or the minimal helper below). Do not use SQL `TOTAL`, float casts, decimal strings, frontend sums, a mutable balance column or per-account extra queries.

```python
from .errors import APIError

MAX_SAFE_CENTS = 2**53 - 1

def checked_cents(value: int) -> int:
    if not -MAX_SAFE_CENTS <= value <= MAX_SAFE_CENTS:
        raise APIError(409, "CONFLICT", "The calculated balance exceeds the supported range.")
    return value
```

Reuse the existing M2 constant/helper if present. SQL `SUM` uses signed 64-bit integers and can overflow before Python sees a result; narrowly catch the SQLAlchemy wrapper whose original SQLite error is `integer overflow`, rollback if necessary, and return the same public 409. Do not parse money as Decimal or fall back to float. This deliberately refuses an overflowing SQLite aggregation even if a different summation order could cancel it back into range; the user can correct the contributing records through the transaction API.

- [ ] **3. Verify real edge cases.** Empty accounts return their initial balance; negative initial/credit-card balances preserve signs; archived categories/transactions still contribute; archived accounts retain readable balances; moving/deleting/editing records changes the correct accounts only; two-household aggregation is isolated; repeated one-cent entries stay exact. A safe maximum balance succeeds; initial maximum plus one cent returns 409 rather than rounding. Force SQLite integer SUM overflow with enough valid maximum-valued transactions (1025 suffices) in the disposable DB and prove the API returns the envelope, not 500 or REAL. Transaction list/edit/delete must remain usable after this error. If `checked_cents` is new, retain a tiny boundary test in `test_money.py`; do not duplicate the financial API dataset there.

Run from `backend`: `python -m pytest tests/test_accounts.py tests/test_transactions.py tests/test_money.py` (omit `test_money.py` only when the corresponding existing M2 tests cover the helper under another recorded path). Task 3 is complete when the concrete dataset and overflow behavior pass through actual account endpoints.

## Task 4 — Angular Transaction Entry and History

**Files:** Feature files and integration points in §3; existing M2 money/account/category services and error styles.

**Consumes:** Exact TypeScript/API contracts in §2, auth-aware HttpClient, M2 account/category records including archives, shared navigation.

**Produces:** Guarded `/transactions`, `TransactionsService`, `TransactionsPage`, `TransactionForm`, exact money parsing/formatting, usable CRUD/filter workflow. Reuse existing shared money symbols even if their path differs.

### 4A. Money and date boundaries

- [ ] **1. Prove decimal parsing and edit round-trips before wiring the form.** Extend M2 utilities rather than adding a competing parser. Public helper contracts:

```typescript
parseMoney(text: string): number | null; // unsigned entry, safe integer cents or null
moneyInput(cents: number): string;      // absolute cents -> exact dot-decimal edit text
formatMoney(cents: number): string;     // signed cents -> readable EUR display
localToday(now?: Date): string;         // YYYY-MM-DD from local calendar components
```

`parseMoney` accepts trimmed digits with an optional comma OR dot and one/two fractional digits; no grouping, exponent, sign, currency symbol, bare fraction or trailing separator. It may return zero so it remains reusable for initial balances; the transaction form rejects zero. Prevent a huge digit input before BigInt conversion, without silently truncating it. This implementation fits the accepted range (14 whole digits maximum):

```typescript
export function parseMoney(text: string): number | null {
  const match = /^([0-9]{1,14})(?:[.,]([0-9]{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

export function moneyInput(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError("Invalid integer cents");
  const absolute = BigInt(cents < 0 ? -cents : cents);
  return `${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function localToday(now = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
```

If the M2 parser already accepts arbitrarily many leading zeros safely, preserve that existing valid input behavior instead of narrowing it to this sample regex. Never use `parseFloat(text) * 100`, `valueAsNumber`, or `new Date().toISOString().slice(0, 10)` for these boundaries.

For exact display even near `Number.MAX_SAFE_INTEGER`, avoid dividing a large cent number by 100 and letting binary rounding lose the last cent. Prefer M2's exact formatter; otherwise use native `Intl.NumberFormat` with BigInt whole units, inserting the two cent digits into `formatToParts`:

```typescript
const eur = new Intl.NumberFormat("de-DE", {
  style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function formatMoney(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError("Invalid integer cents");
  const absolute = BigInt(cents < 0 ? -cents : cents);
  const whole = absolute / 100n;
  const signedWhole = cents < 0 ? (whole === 0n ? -0 : -whole) : whole;
  const fraction = String(absolute % 100n).padStart(2, "0");
  return eur.formatToParts(signedWhole)
    .map((part) => part.type === "fraction" ? fraction : part.value).join("");
}
```

Keep the existing chosen locale if M2 has one. Show explicit Income/Expense text in rows so meaning is not color-only.

Runnable unit-test cases:

```typescript
it("parses exact cents and rejects ambiguous amounts", () => {
  expect(parseMoney("84.72")).toBe(8472);
  expect(parseMoney("84,72")).toBe(8472);
  expect(parseMoney("0.01")).toBe(1);
  expect(parseMoney("84.7")).toBe(8470);
  expect(parseMoney("0")).toBe(0);
  expect(parseMoney("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
  for (const text of ["", "-1", "+1", "1e2", "1.234", "1,000.00", "1 000", ".5", "1.", "90071992547409.92"]) {
    expect(parseMoney(text)).toBeNull();
  }
});

it("round trips edit text without losing a cent", () => {
  for (const cents of [1, 8472, Number.MAX_SAFE_INTEGER]) {
    expect(parseMoney(moneyInput(-cents))).toBe(cents);
  }
  expect(formatMoney(-1)).toContain("-0,01");
  expect(formatMoney(Number.MAX_SAFE_INTEGER)).toContain("90.071.992.547.409,91");
});
```

Test `localToday(new Date(2026, 8, 7, 0, 5)) === "2026-09-07"`. In Task 5 run the real browser with a timezone offset where UTC is on another date; do not rely solely on the developer machine's timezone.

### 4B. Service, form and page

- [ ] **2. Define public types and a feature-local HTTP service.** Reuse Account/Category types. Use `HttpParams` or a typed `params` object; omit undefined/empty filters rather than serializing `undefined`. Use relative `/api/transactions` URLs so existing XSRF/auth configuration applies. Required method signatures are:

```typescript
list(filters: TransactionFilters): Observable<Transaction[]>;
get(id: number): Observable<Transaction>;
create(body: TransactionWrite): Observable<Transaction>;
update(id: number, body: TransactionWrite): Observable<Transaction>;
remove(id: number): Observable<void>;
```

Keep methods direct HttpClient calls, e.g. `return this.http.post<Transaction>("/api/transactions", body)`. Do not add a global financial store, cache or redundant service unit tests that only assert forwarding.

- [ ] **3. Implement a reactive form with a clear component boundary.** `TransactionForm` takes required `accounts: Account[]`, `categories: Category[]`, optional `transaction: Transaction | null`, `pending: boolean`, `fieldErrors: Record<string, string>` and `submitError: string | null`; emits `save: TransactionWrite` and `cancel: void`. The parent owns HTTP and pending/error state. Use normal Angular inputs/outputs (or the M2 signal-input convention), not a second form architecture.

Controls: `type` (`expense` default), `amount` string, `transactionDate` local today, required `accountId` and `categoryId` numeric-or-null selects, optional `description` string. The amount input is `type="text" inputmode="decimal"`; selects use `[ngValue]` so IDs stay numbers. All labels/error associations must work with a keyboard. The form's submit conversion follows:

```typescript
const raw = this.form.getRawValue();
const cents = parseMoney(raw.amount);
this.form.markAllAsTouched();
if (this.pending || this.form.invalid || cents === null || cents === 0 ||
    raw.accountId === null || raw.categoryId === null) return;
this.save.emit({
  accountId: raw.accountId,
  categoryId: raw.categoryId,
  amount: raw.type === "expense" ? -cents : cents,
  description: raw.description === "" ? null : raw.description,
  transactionDate: raw.transactionDate,
});
```

Add form validation that actually marks invalid money/date/description and displays an associated message, rather than merely returning from submit. Count description Unicode code points to match Pydantic; reuse M2 validation rather than copying login's private helper. Validate full calendar round-trip without accepting dates normalized into another month. A native date input provides UX, not the only validation layer.

Edit uses sign from `amount`, absolute exact `moneyInput(amount)`, stored calendar date and the original IDs. Reinitialize only on Add/Edit/Cancel or a different selected transaction; ordinary parent change detection and failures must not reset a dirty form. Account choices are active accounts plus the edit target's own retained archived account. Category choices are matching-type active categories plus the edit target's own retained archived matching category; label archived options. Type change clears an incompatible selection. No active account or matching category: disable successful save and show links to `/accounts` or `/categories`; do not auto-create defaults.

Use `(ngSubmit)`, semantic Save/Cancel, and disable duplicate submission while pending. Field 422s map to the named controls; general errors use `role="alert"`; successful saves use a status message. Preserve form values on 422/403/network/500 and permit deliberate user retry. A 403 tells the user the request was not verified; do not log them out. A 401 follows the interceptor and does not preserve private transaction state in browser storage.

- [ ] **4. Implement the list and filters in `TransactionsPage`.** On route entry load account/category lists with archives included through M2 services, and list transactions for the current local year/month. Display date, exact signed EUR amount, textual type, account/category names, description, Edit and Delete. Render a date as calendar text without `new Date("YYYY-MM-DD")` timezone shifting. Render descriptions with interpolation/text content only, never `innerHTML`.

Use one named filter form with Month, Account, Category, Type and Search, plus Apply and Clear. Month value `YYYY-MM` becomes numeric year/month; empty month omits both. Include archived references in filters. Keep filter selection and empty results visible after applying; no-match state differs from a failed request. Loading and error states must not masquerade as zero transactions.

An RxJS `switchMap` request stream on Apply/Clear prevents a slow older filter response from replacing newer results:

```typescript
private readonly filterRequests = new Subject<TransactionFilters>();
// Subscribe once during page setup, with lifecycle cleanup:
this.filterRequests.pipe(
  switchMap((filters) => this.transactions.list(filters).pipe(
    map((rows) => ({ kind: "ready" as const, rows })),
    catchError((error: unknown) => of({ kind: "error" as const, error })),
    startWith({ kind: "loading" as const }),
  )),
  takeUntilDestroyed(this.destroyRef),
).subscribe((state) => this.listState.set(state));
```

Define `destroyRef = inject(DestroyRef)` and imports from Angular core, Angular rxjs-interop and RxJS in the actual component; `listState` is a signal of the union emitted above. Initialize the stream before its first current-month emission. Keep errors inside `switchMap` so Retry still works after an error. Reuse an existing equivalent M2 request-state pattern if present.

On Edit, GET the detail rather than assuming a stale list row is authoritative; if now 404, explain it and refresh the list. On Save, POST/PUT once, close/reset the editor only on success, then refetch the current filtered list and account data. If the saved transaction no longer matches the filters, say it was saved and may be hidden by the current filters; do not reset filters. If save succeeds but refresh fails, report the refresh failure separately—never invite a duplicate create by claiming the save failed. On returning to Accounts, it must refetch live balances rather than reuse stale M2 initial values.

On Delete, display an inline confirmation identifying the selected date/amount/description, with Confirm delete and Cancel. Cancel sends no request. Confirm calls DELETE once; preserve the row on 403/network/500, refresh after 204, and explain an already-deleted 404 before refreshing. Restore focus to a sensible surviving control after deletion/cancel. No automatic unsafe replay, optimistic deletion or undo API.

- [ ] **5. Wire route/navigation and make it usable at phone width.** Add `/transactions` to the existing authenticated shell and navigation. Preserve M2 dashboard/accounts/categories routing rather than replacing the shell with the inspected old M1 version. A standalone route follows `{ path: "transactions", component: TransactionsPage, canActivate: [authGuard] }` only if M2 still uses top-level protected routes; otherwise add the equivalent protected child. No placeholder links/pages for M4/M5/M6.

At approximately 390px width, stack filter/form fields and use readable rows/cards or an intentionally scrollable labelled table region; the whole document must not overflow horizontally. Keep focus styles, contrast, associated errors and accessible action names such as “Edit transaction REWE” and “Delete transaction REWE”. No new UI library.

- [ ] **6. Add meaningful form tests and verify the changed surface.** In `transaction-form.spec.ts`, use the existing TestBed/Vitest setup to interact with rendered inputs and submit the form. Required scenarios: invalid/zero/excess-precision amount blocks save with an associated error; expense `84,72` emits `-8472` and income emits positive cents; switching type clears an incompatible category; edit retains its own archived option but does not offer another archived record; server field error leaves entered values visible. Treat emitted payload as the form's public contract, not as a mock echo of a service call. Exercise stale-response ordering/error recovery with HttpTestingController only if the page request-state code introduces uncertainty not already covered by an existing M2 pattern.

Run from `frontend`: `npm test -- --watch=false` and `npm run build` after integration. Exact browser surface proof belongs to Task 5; unit tests alone are not UI verification.

## Task 5 — Integrated Acceptance and Luna Completion Gate

**Files:** `frontend/e2e/transactions.spec.ts`, relevant regression tests and documentation/status files. No new production feature scope.

**Consumes:** Tasks 1–4 and completed M2 fixtures/browser harness.

**Produces:** Evidence that real entry works, all seven M3 deliverables are complete, and remaining release/later-milestone gates are accurately recorded.

- [ ] **1. Add one real-backend transaction E2E workflow.** Extend the existing Playwright harness without fixed committed credentials, mocked APIs, auth bypass routes or ownership-teardown regressions. Read `BUDGET_E2E_USERNAME` and `BUDGET_E2E_PASSWORD` like `auth.spec.ts`; log in through the UI. Use unique resource names for this scenario and obtain account/category IDs from real responses when assertions require them. Create accounts/categories through the M2 UI, using its actual labels.

The scenario must perform:

```text
login
→ create Checking with initial EUR 1000.00
→ create Salary income, Groceries expense and Netflix expense categories
→ open Transactions; select September 2026 explicitly
→ add Salary +3500.00, Groceries -84.72 and Netflix -17.99
→ filter by month/account/category/expense/search and see exactly Groceries
→ clear/adjust filters; edit Groceries to -90.00
→ cancel Netflix deletion once (row remains), then confirm deletion
→ navigate to Accounts and see Checking EUR 4410.00
→ refresh and verify persisted state
→ sign out; deep-link/back to Transactions cannot expose financial content
```

Assert real `/api/accounts/{id}` balance is `441000` in addition to readable UI text, using the authenticated browser context request API. Test both current-month-hidden saves and archived historical correction either in this workflow or the focused manual exercise; backend archive tests remain mandatory. Do not assert dashboard cards or budget progress: those are later milestones.

Use existing labels/selectors where possible; transaction selectors can use the accessible names from Task 4. This local login helper matches the inspected harness and may be reused by the complete scenario above:

```typescript
import { expect, test, type Page } from "@playwright/test";

async function loginForTransactions(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username").fill(process.env["BUDGET_E2E_USERNAME"]!);
  await page.getByLabel("Password").fill(process.env["BUDGET_E2E_PASSWORD"]!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
```

Call the helper from the scenario's test body, then execute every step in the acceptance sequence. Account/category selectors must come from the completed M2 UI, which was unavailable during planning; do not replace their UI creation with fake responses or silently omit those steps. Test the transaction page against the accessible labels defined in Task 4.

- [ ] **2. Exercise the actual page at desktop and phone widths.** Launch the application with disposable data and inspect it in a real browser at roughly 1280px and 390px widths. Enter an expense keyboard-only, see validation/focus, change filters, edit/delete, and check loading/empty/failure states. Capture actual screenshots or browser observations and describe what was exercised. Run a browser context with `timezoneId: "Pacific/Kiritimati"` and a fixed instant `2026-09-06T12:30:00Z`; the fresh form must default to `2026-09-07`, while explicitly stored `2026-09-07` remains that date. Use Playwright's clock for the frontend only; do not expire real backend sessions by changing server time.

Verify descriptions containing `<script>`/HTML appear as plain text. Verify a session expiration during save leads to login, and a connection/403 failure does not erase input or show false success. No automated unsafe request replay. Tests are regression coverage; actual browser inspection is the visual gate.

- [ ] **3. Prove migration safety on a disposable database containing M2 records.** Use the existing isolated fixture/migration pattern from `backend/tests/conftest.py`; do not run downgrade with the default database URL. Explicitly point Alembic at a newly allocated temporary file and the actual M2 revision, seed one household/account/category through existing helpers, upgrade to head, and verify those records and initial balances survive. Create/read a transaction after upgrade. On that disposable copy only, downgrade back to the M2 revision, verify M2 records remain, and upgrade again. Record actual revision names and outcomes. `alembic current` alone is not a preservation test.

- [ ] **4. Run final integrated checks once edits settle.** Commands from the stated working directories:

```text
# backend
python -m pytest

# frontend
npm test -- --watch=false
npm run build
npx playwright test
```

The existing Playwright config owns its temporary directory and runs migrations/seed before Uvicorn. Preserve ownership-safe teardown and generated secrets. If Chromium is missing, use the documented `npx playwright install chromium`. Do not replace unavailable browser verification with a claimed pass. Fix any actual regression introduced by the transaction contract, especially M2 account responses and archive behavior.

- [ ] **5. Perform a focused financial authorization/security review.** Trace every transaction route, combined filters and account aggregation for household predicates; creator immutability; changed/retained archive references; category/sign enforcement; strict cents/date validation; literal search parameterization; explicit response fields; transaction descriptions rendered as text; no private data logging; preserved CSRF/401 flow. Run each actionable finding's reproduction after its fix. Use a reviewer if available only after implementation settles; passing tests is not itself a security review.

- [ ] **6. After runtime proof, finish documentation and remove temporary artifacts.** Update `README.md` with transaction entry/filter/archive behavior, exact-cent bounds, overflow errors and existing run commands. Update `state.md` to record M2 as previously completed and M3 as implemented only after this plan's gates pass; include actual command results, revision and visual scenarios. Update `docs/LUNA_HANDOFF.md` with the completed assignment/next user-review boundary. Preserve evidence of earlier work rather than fabricating counts. Delete throwaway verification scripts/data owned by this task; keep the narrowly justified regression tests. Do not change the MVP specification or claim M4 is complete.

**Stop after verified M3 and request user review before M4.** If a gate cannot be exercised, finish reachable work and report the exact missing prerequisite and unverified gate. Do not describe a backend-only or UI-only partial implementation as this milestone's completion.

## 4. Acceptance Checklist and Source Coverage

| Requirement | Implementation | Required evidence |
|---|---|---|
| M3 transaction CRUD; §§12, 22.5 | Task 1 | Actual create/detail/update/delete statuses, persistence, immutable attribution |
| M3 form; §15.1 | Task 4 | Reactive form, signed input, local date, owned active choices, field errors, preserved failed entry |
| M3 list; §15 | Tasks 2, 4 | Stable descending history, exact names/amounts/dates, archived references, empty/loading/error states |
| M3 filters; §§15, 22.5 | Tasks 2, 4 | Month/account/category/type/literal search independently and combined; all-time reset and query validation |
| M3 signed model; §12 | Tasks 1, 4 | Positive-income/negative-expense compatibility; no zero or override |
| M3 money cents; §§9, 35, 37 | Tasks 1, 3, 4 | Strict integer API/storage, parser boundaries, exact display/edit round-trip and real balance dataset |
| M3 household/account/category validation; §§7.7, 12, 24 | Tasks 1–3 | Two households; reads/writes/filter IDs/aggregates cannot cross scope |
| Accounts become transaction-backed; §10 | Task 3 | 439729 → 439201 → 441000; moved transaction updates both accounts; overflow is explicit |
| History/archive semantics; §§10–12 | Tasks 1, 2, 4 | Archived names/history survive; only original archived references can be retained |
| DB/index/date requirements; §§24–25, 36 | Tasks 1, 2, 5 | Migration on M2 data; foreign keys/checks/indexes; calendar boundaries and UTC timestamps |
| Errors/security/logging; §§7, 21, 23, 33, 35 | Tasks 1, 4, 5 | Shared envelope, scoped denial, unchanged CSRF/session flow, no HTML execution or financial note logging |
| Responsive/accessibility; §§38–39 | Tasks 4–5 | Desktop/phone browser observation, keyboard operation and associated errors |
| Testing requirements relevant to M3; §42 | All tasks | Backend security/precision tests, frontend amount/form tests, real-backend browser workflow |

Final gate checklist:

- [ ] Completed M2 checkout was used; no duplicate accounts/categories implementation or invented migration parent.
- [ ] All five endpoints work with exact public contracts and authenticated household scoping.
- [ ] Full transaction form/list/filter/edit/delete workflow is usable at desktop and phone widths.
- [ ] Exact cents, date boundaries, sign rules and archive retention pass their checks.
- [ ] Account balances reflect create/edit/move/delete and reject unsafe aggregates without corrupting records.
- [ ] M2 data survives the disposable migration cycle; existing auth/account/category tests still pass.
- [ ] Real-browser workflow and focused security review have recorded evidence, or precise outstanding gates prevent a completion claim.
- [ ] README/state/handoff describe only observed results; no later milestone or production-readiness claim.

## 5. Completion Report for Luna

Return a concise evidence-backed report containing:

1. **Completed behavior:** Tasks 1–5 and any acceptance item that is not complete.
2. **Changed files/contracts:** Actual M2 integration paths, migration parent/head, and justified deviations from this plan.
3. **Verification:** Commands with real counts/results; concrete balance dataset; migration preservation; desktop/phone/date/browser observations.
4. **Security review:** Findings, fixes and reproduction results; explicit remaining risks.
5. **Unverified/blocked:** Exact missing capability or unmet gate, without a false “done.”
6. **Next:** User review before Milestone 4 — Dashboard. No automatic continuation.

**Planning status:** This document was grounded against the MVP and the visible authentication implementation; completed M2 internal files require execution-time alignment as described in §1. No application code was changed or runtime implementation checks claimed during planning.

### Planning verification

- Checked the seven Milestone 3 deliverables against the source-coverage table and all five task boundaries.
- Automated document checks passed: five numbered tasks, balanced code fences, 12 syntactically valid Python snippets, resolved Markdown paths in the Luna handoff, and exact acceptance-dataset arithmetic.
- Executed the proposed TypeScript money/date helper examples after transpilation: valid/invalid decimal inputs, maximum-safe-cent boundary, edit round-trips, negative sub-euro display, maximum-cent formatting and local calendar date all passed.
- These are plan/example checks, not application, migration, browser or security-review results. All implementation acceptance gates remain for Luna.
