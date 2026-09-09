# Milestone 2 — Accounts and Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the available `subagent-driven-development` skill for genuinely independent implementation slices; otherwise execute inline, task by task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a future implementation assignment for Luna, not authorization to implement during the planning session.

**Goal:** Give authenticated household members working account/category create, read, edit and archive APIs and Angular pages, with exact-cent initial balances, household isolation and optional default-category bootstrap.

**Architecture:** Extend the existing synchronous FastAPI/SQLAlchemy application, single declarative model module and Angular standalone feature pages. Reuse `require_household`, the shared error envelope, global CSRF/Origin checks, reactive forms and cookie-aware HttpClient. Use direct feature routers, native form controls and one small shared money utility; no generic CRUD framework or new dependency.

**Tech Stack:** Existing Angular 22.1.x, TypeScript, reactive forms, HttpClient, signals/RxJS; Python 3.13–3.14, FastAPI, Pydantic, SQLAlchemy 2.x, Alembic, SQLite; pytest, Angular's existing Vitest runner and Playwright. Preserve installed versions and the README's Node 24.15+ requirement within the Node 24 line.

## Global Constraints

Source: `BUDGET_TRACKER_MVP_SPEC.md`, especially §§5, 7.7, 9–11, 16–17, 21–25, 33, 35, 37–43 and Milestone 2 in §44. The existing broader plan's Task 2.1 supplies previously selected defaults.

- “Money must **never** use binary floating-point storage.” Store and transport integer cents; household currency is `EUR`; multi-currency is out of scope.
- “Every household-data query must be scoped using the authenticated user's household membership.” Ownership comes from `HouseholdContext`, never request JSON/query parameters.
- Account types: `checking`, `savings`, `cash`, `credit_card`, `other`. Category types: `income`, `expense`.
- Maximum account/category name lengths: `100 chars`. Trim names; reject blank names. Backend validation is authoritative.
- “Archived accounts remain referenced by historical transactions.” “Archived categories remain visible on historical transactions.” Never physically delete these resources.
- “initial balance editable only with a clear warning”; signed initial balances, including zero and negative credit-card balances, are valid.
- Owner and member have identical financial permissions. Preserve M1 session/user/membership checks and Angular auth restoration/401 recovery.
- “MVP must remain usable on a phone”; labelled inputs, associated errors, keyboard access, semantic buttons, readable money, sufficient contrast and visible focus are required.
- Preserve same-origin `/api`, dependency pins, SQLite configuration and single-worker deployment. Do not alter `.env`, real databases, production networking or unrelated work for verification.
- Do not commit, push or deploy without separate authorization. Documentation-only planning does not constitute implementation or runtime verification.

---

## 1. Correct Sequence and Starting State

**M0 complete → M1 complete (`d503e60`, as reported) → M2 this assignment → M3 existing transaction plan → M4 dashboard → M5 budgets → M6 export/operations.**

The current checkout has the M1 implementation and migration `0002_identity`. `state.md` already leaves M2 unchecked. The prior M3 planning assumed a completed M2 checkout; the user and Luna have clarified that M2 is missing on this branch. Implement M2 first rather than searching for a supposedly completed M2 branch or implementing transactions now.

Protected future work:

- `docs/superpowers/plans/2026-09-07-transactions.md` remains unchanged. Its starting-state assumption is historical; this document and the active handoff correct sequencing without rewriting its M3 tasks.
- `docs/LUNA_M3_HANDOFF.md` preserves the previous M3 handoff. It is inactive until M2 has passed its gates and the user authorizes M3.
- `docs/LUNA_HANDOFF.md` is the active M2 assignment.
- `docs/superpowers/plans/2026-09-07-budget-tracker-mvp.md` remains the overall roadmap. This focused plan expands Task 2.1, not Task 3.1.

Authority: MVP mandatory requirements → current user sequencing correction → broader plan's established public contracts → this plan's implementation details → historical status/handoff assumptions. The product scope is already specified; no new framework, design system or product-discovery stage is needed.

### Inspected integration points

| Existing file/symbol | Reuse/change |
|---|---|
| `backend/app/models.py` | `Base`, integer IDs, `utc_now`, UTC technical timestamps. Add `Account` and `Category` beside identity models. |
| `backend/migrations/versions/0002_identity.py` | Parent of new `0003_accounts_categories`; preserve all identity tables and rows. |
| `backend/app/auth/dependencies.py` | `require_household(...) -> HouseholdContext(user_id, household_id, role)` verifies live identity and membership. Every resource route consumes it. |
| `backend/app/db.py` | Existing synchronous `get_db()` sessions and SQLite configuration; no second DB layer. |
| `backend/app/main.py:create_app` | Global `Depends(csrf_guard)` and shared error registration; register two routers without weakening either. |
| `backend/app/schemas.py` | Explicit camelCase aliases and strict request models. Do not inherit financial requests from `AuthRequest`. |
| `backend/app/errors.py` | `APIError(status_code, code, message, fields=None)`; validation handler exposes field names from Pydantic locations. Use camelCase aliases/custom field keys. |
| `backend/app/cli.py:_init_household` | Prompts → `BEGIN IMMEDIATE` → household/user/member → one commit; insert optional seed rows before this commit. `_run` already rolls back CLI/input/integrity errors. |
| `backend/tests/conftest.py` | Real migrated temporary DB, `test_app`, `client`, `db_session`, `seeded_user`, `csrf_headers`; do not replace with `create_all` or fake household dependencies. |
| `backend/tests/test_bootstrap.py:run_cli` | Input/getpass iterators and injected session factory. Adjust successful bootstrap callers for the new prompt. |
| `frontend/src/app/core/api/models.ts` | Currently `AuthState` only. Add the public types below. |
| `frontend/src/app/features/login/login.page.*` | Standalone component, nonnullable reactive forms, signals for pending/errors, preserved failed form state. Reuse its patterns. |
| `frontend/src/app/layout/app-shell.ts` | Currently both dashboard identity content and logout shell. Keep logout here; move identity content into a small child landing page and add a router outlet/navigation. |
| `frontend/src/app/app.routes.ts` | Login and protected dashboard only. Add protected nested accounts/categories while preserving `/dashboard` as identity landing, not M4 analytics. |
| `frontend/playwright.config.ts`, `backend/scripts/seed_e2e.py` | Owned temporary DB, real backend, generated credentials, identity-only seed. Extend scenarios, not harness architecture. |

Before implementation, read these files and repository instructions. Use symbol references before changing exported existing symbols; use LSP where available. If intervening work already supplies a helper/module, reuse it and record the actual path instead of creating a duplicate. Do not rerun M1 checks merely to dispute its reported completion; later run them for M2 regression coverage.

## 2. Fixed Contracts and Scope Decisions

### Public JSON / TypeScript

Add to `frontend/src/app/core/api/models.ts`:

```typescript
export type AccountType = "checking" | "savings" | "cash" | "credit_card" | "other";
export type CategoryType = "income" | "expense";

export interface AccountWrite {
  name: string;
  type: AccountType;
  initialBalance: number; // signed safe integer cents; zero allowed
}
export interface Account extends AccountWrite {
  id: number;
  balance: number;
  isArchived: boolean;
}
export interface CategoryCreate {
  name: string;
  type: CategoryType;
}
export interface CategoryUpdate {
  name: string;
}
export interface Category extends CategoryCreate {
  id: number;
  isArchived: boolean;
}
```

Do not expose household ownership, identity credentials or internal timestamps in these responses. Do not accept `id`, `householdId`, `household_id`, `balance` or `isArchived` in writes. Category updates accept **name only**, so category type cannot be changed, even if the browser forges a field. Account PUT includes every editable field; no PATCH/upsert.

| Method | Accounts | Categories | Result |
|---|---|---|---|
| GET | `/api/accounts` | `/api/categories` | 200 array; active only by default |
| GET | `/api/accounts?includeArchived=true` | `/api/categories?includeArchived=true` | 200 array, active and archived |
| POST | `/api/accounts` + `AccountWrite` | `/api/categories` + `CategoryCreate` | 201 resource |
| GET | `/api/accounts/{id}` | `/api/categories/{id}` | 200 owned resource, including archives |
| PUT | `/api/accounts/{id}` + `AccountWrite` | `/api/categories/{id}` + `CategoryUpdate` | 200 updated resource |
| POST | `/api/accounts/{id}/archive` | `/api/categories/{id}/archive` | 204 empty body, idempotent |

Use the dedicated archive convention already chosen by the broader plan: **no DELETE routes**, no unarchive endpoint/UI and no archive boolean in create/update payloads. Archive flips `is_archived` only; repeated archive succeeds without changing the already-archived row. Unknown/foreign IDs return identical generic 404 `NOT_FOUND`, including archive. Owned archived resources are readable but read-only through PUT: 409 `CONFLICT`; offer no edit controls for them.

Other fixed decisions:

- `MAX_SAFE_CENTS = 9007199254740991`; inclusive negative/positive limits. Request booleans, floats (including `1.0`), numeric strings, null and out-of-range cents are 422. Initial balance zero is valid; transaction nonzero rules do **not** apply yet.
- Trim then validate names as 1–100 Unicode code points; preserve case and internal whitespace. Uniqueness is **case-sensitive exact equality of the trimmed name**, matching SQLite default `BINARY` semantics. No Unicode normalization/casefold columns or locale-specific matching. `Checking` and `checking` are different names.
- Account unique key: `(household_id, name)`; category unique key: `(household_id, type, name)`. Archived names stay reserved. Same category name in expense and income is permitted; different households may use the same names.
- Duplicate create/rename is 409 `CONFLICT` with `fields.name`; invalid types, blank/long names, forbidden fields and malformed `includeArchived` are 422. Preserve existing 401/403 ordering when auth and CSRF are both invalid; do not invent different precedence.
- List sort: `name ASC, id ASC` for accounts; `type ASC, name ASC, id ASC` for categories. UI groups expense/income explicitly. Lists are arrays with no pagination or search in M2.
- Account `balance` is derived from `initial_balance` in **one** response helper, used by list/detail/create/update. Do not add a balance DB column. With no transactions this is the full correct calculation, not a fake transaction implementation; M3 replaces the calculation in every response path.
- All resource lookups are scoped before mutation. Both roles may change household resources. A rejected request leaves resource values, ownership and timestamps unchanged. Validate before assignment, one commit per successful mutation, rollback failed commits.
- Keep names plain text in the DOM. Never log financial payloads or expose raw database exceptions.
- Initial-balance edits show a persistent warning and require acknowledgement only when the value differs from the loaded value. This is a UI safety step, not a new API field/permission. Warning: “Changing the initial balance changes this account's current balance and the baseline for its history.”
- Optional default categories are added to **new household bootstrap only**, in the existing transaction. Do not seed during migration/startup/login, or retroactively modify existing M1 households. Existing households create categories through the new page; no additional seed command is needed.

**Not M2:** transactions/reference-validation endpoints, transaction aggregates, dashboard metrics/month selector, budgets, settings/export, production release/backup tooling, transfers, imports, recurring entries, default accounts, category icons/colors, unarchive, pagination, optimistic concurrency, generic CRUD repositories or state libraries. Do not add unused reference-validation helpers before M3 has references to validate.

## 3. File Map and Execution Order

New paths follow the inspected compact `backend/app` layout rather than introducing the older roadmap's unused `app/api` directory.

| Task | Create | Modify/reuse |
|---|---|---|
| 1 — Scoped financial APIs | `backend/app/accounts.py`, `backend/app/categories.py`, `backend/app/money.py`, `backend/migrations/versions/0003_accounts_categories.py`, `backend/tests/test_accounts.py`, `backend/tests/test_categories.py` | `models.py`, `schemas.py`, `main.py`, `tests/conftest.py`, `tests/test_authorization.py` |
| 2 — Atomic optional seeds | No new module | `backend/app/cli.py`, `backend/tests/test_bootstrap.py` |
| 3 — Exact money entry/display | `frontend/src/app/shared/utilities/money.ts`, adjacent `money.spec.ts` | Existing TypeScript target/tooling only as consumers; no config change expected |
| 4 — Angular management | `frontend/src/app/features/accounts/accounts.service.ts`, `accounts.page.ts`, `accounts.page.html`, `accounts.page.css`, `accounts.page.spec.ts`; equivalent five `categories` files; `frontend/src/app/features/dashboard/dashboard.page.ts` | `core/api/models.ts`, `app.routes.ts`, `layout/app-shell.ts`; extract the existing login `codePointLengthValidator` to `shared/utilities/validators.ts` and import it in login/accounts/categories rather than defining a second convention |
| 5 — Integrated acceptance | `frontend/e2e/accounts-categories.spec.ts` | In-scope regressions, `README.md`, `state.md`, active `docs/LUNA_HANDOFF.md`; existing browser harness only if integration requires it |

Inline order: **1 → 2 → 3 → 4 → 5**. If concurrency is genuinely useful, a backend owner handles Tasks 1–2 while a frontend owner handles Tasks 3–4 against the fixed contracts. No two workers edit shared models/schemas/routes simultaneously. Concurrent workers skip builds/tests/linters until edits settle; the integration owner runs validation centrally. Do not delegate planning/contract discovery.

## Task 1 — Household-Scoped Persistence and APIs

**Files:** Task 1 row above.

**Consumes:** `Base`, `utc_now`, `get_db()`, `require_household() -> HouseholdContext`, `APIError`, global CSRF and existing disposable fixtures.

**Produces:** ORM `Account`, `Category`; `MAX_SAFE_CENTS`, `Cents`; schemas `AccountWrite`, `AccountResponse`, `CategoryCreate`, `CategoryUpdate`, `CategoryResponse`; `accounts.router`, `categories.router`; scoped `get_account(db: Session, account_id: int, household_id: int) -> Account`, `get_category(db: Session, category_id: int, household_id: int) -> Category`; `account_response(account: Account) -> AccountResponse`. Lookup helpers allow archives and return 404 for missing/foreign records; write handlers enforce archive read-only behavior separately. These are the seams M3 can reuse without an unused generic abstraction.

- [ ] **1. Add real authenticated lifecycle regressions.** Add an `authenticated_client` fixture in `tests/conftest.py` which POSTs `/api/auth/login` with `seeded_user` credentials and `csrf_headers()`, asserts 200 and returns the existing client. Preserve every existing fixture. In `test_accounts.py`, begin with:

```python
def test_account_lifecycle(authenticated_client, csrf_headers):
    client = authenticated_client
    payload = {"name": " Checking ", "type": "checking", "initialBalance": -8472}
    created = client.post("/api/accounts", json=payload, headers=csrf_headers())
    assert created.status_code == 201, created.text
    account = created.json()
    url = f"/api/accounts/{account['id']}"
    assert account == {
        "id": account["id"], "name": "Checking", "type": "checking",
        "initialBalance": -8472, "balance": -8472, "isArchived": False,
    }
    assert client.get(url).json() == account
    assert client.get("/api/accounts").json() == [account]
    changed = client.put(url, json={
        "name": "Main", "type": "savings", "initialBalance": 1,
    }, headers=csrf_headers())
    assert changed.status_code == 200
    assert changed.json()["balance"] == 1
    for _ in range(2):
        archived = client.post(url + "/archive", headers=csrf_headers())
        assert archived.status_code == 204 and archived.content == b""
    assert client.get("/api/accounts").json() == []
    assert client.get(url).json()["isArchived"] is True
    assert client.get("/api/accounts?includeArchived=true").json() == [client.get(url).json()]
    assert client.put(url, json={
        "name": "Changed archive", "type": "cash", "initialBalance": 0,
    }, headers=csrf_headers()).status_code == 409
    assert client.get(url).json()["name"] == "Main"
```

In `test_categories.py` add:

```python
def test_category_type_and_archive(authenticated_client, csrf_headers):
    client = authenticated_client
    created = client.post("/api/categories", json={
        "name": " Groceries ", "type": "expense",
    }, headers=csrf_headers())
    assert created.status_code == 201, created.text
    category = created.json()
    url = f"/api/categories/{category['id']}"
    assert category["name"] == "Groceries"
    changed = client.put(url, json={"name": "Food"}, headers=csrf_headers())
    assert changed.status_code == 200 and changed.json()["name"] == "Food"
    rejected = client.put(url, json={"name": "Invalid", "type": "income"}, headers=csrf_headers())
    assert rejected.status_code == 422
    assert client.get(url).json() == changed.json()
    for _ in range(2):
        response = client.post(url + "/archive", headers=csrf_headers())
        assert response.status_code == 204 and response.content == b""
    assert client.get("/api/categories").json() == []
    assert client.get("/api/categories?includeArchived=true").json() == [client.get(url).json()]
    assert client.put(url, json={"name": "Changed archive"}, headers=csrf_headers()).status_code == 409
```

Run from `backend`: `python -m pytest tests/test_accounts.py tests/test_categories.py`. Before implementation these must fail on missing routes, not broken fixture setup.

- [ ] **2. Add bounded cents and explicit schemas.** In `app/money.py`:

```python
from typing import Annotated
from pydantic import Field

MAX_SAFE_CENTS = 9007199254740991
Cents = Annotated[int, Field(strict=True, ge=-MAX_SAFE_CENTS, le=MAX_SAFE_CENTS)]
```

In `app/schemas.py`, use financial request models distinct from auth. This is the complete validation shape; response models have no ownership fields:

```python
from typing import Annotated, Literal
from pydantic import AfterValidator
from .money import Cents


def clean_resource_name(value: str) -> str:
    value = value.strip()
    if not 1 <= len(value) <= 100:
        raise ValueError("Name must contain 1–100 characters.")
    return value


ResourceName = Annotated[str, AfterValidator(clean_resource_name)]
AccountType = Literal["checking", "savings", "cash", "credit_card", "other"]
CategoryType = Literal["income", "expense"]


class AccountWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    name: ResourceName
    type: AccountType
    initial_balance: Cents = Field(alias="initialBalance")


class CategoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    name: ResourceName
    type: CategoryType


class CategoryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    name: ResourceName


class AccountResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: int
    name: str
    type: AccountType
    initial_balance: Cents = Field(alias="initialBalance")
    balance: Cents
    is_archived: bool = Field(alias="isArchived")


class CategoryResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: int
    name: str
    type: CategoryType
    is_archived: bool = Field(alias="isArchived")
```

Request aliases accept camelCase only; `populate_by_name` is for response construction, not financial request ownership bypass. The existing `BaseModel`, `ConfigDict`, `Field` imports remain. Do not add a second error handler.

- [ ] **3. Add both models and an explicit migration.** Model columns match §§10–11: integer PK, non-null household FK, name, type, archive flag, created/updated timestamps; account also has signed integer `initial_balance`. Use `default=utc_now` / `onupdate=utc_now` as in identity models. Household FK uses `ondelete="RESTRICT"`; no cascade deletion of financial resources. `is_archived` is non-null Boolean, default false. Use SQLAlchemy `Integer` on SQLite (64-bit storage), never Float/Numeric/REAL.

The migration declares `revision = "0003_accounts_categories"`, `down_revision = "0002_identity"`, `branch_labels = None`, `depends_on = None`. Use the following table construction inside `upgrade()`; mirror named constraints in ORM `__table_args__`:

```python
op.create_table(
    "accounts",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("household_id", sa.Integer(), sa.ForeignKey("households.id", ondelete="RESTRICT"), nullable=False),
    sa.Column("name", sa.String(100), nullable=False),
    sa.Column("type", sa.String(20), nullable=False),
    sa.Column("initial_balance", sa.Integer(), nullable=False),
    sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    sa.UniqueConstraint("household_id", "name", name="uq_accounts_household_name"),
    sa.CheckConstraint("type IN ('checking','savings','cash','credit_card','other')", name="ck_accounts_type"),
    sa.CheckConstraint("length(name) BETWEEN 1 AND 100", name="ck_accounts_name_length"),
    sa.CheckConstraint("typeof(initial_balance) = 'integer' AND initial_balance BETWEEN -9007199254740991 AND 9007199254740991", name="ck_accounts_initial_balance"),
)
op.create_index("ix_accounts_household_id", "accounts", ["household_id"])
op.create_table(
    "categories",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("household_id", sa.Integer(), sa.ForeignKey("households.id", ondelete="RESTRICT"), nullable=False),
    sa.Column("name", sa.String(100), nullable=False),
    sa.Column("type", sa.String(20), nullable=False),
    sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    sa.UniqueConstraint("household_id", "type", "name", name="uq_categories_household_type_name"),
    sa.CheckConstraint("type IN ('income','expense')", name="ck_categories_type"),
    sa.CheckConstraint("length(name) BETWEEN 1 AND 100", name="ck_categories_name_length"),
)
op.create_index("ix_categories_household_id", "categories", ["household_id"])
```

Import `from alembic import op` and `import sqlalchemy as sa`. `downgrade()` drops category index/table, then account index/table only. No identity table rebuild, seed insert, transaction table or historical migration edit. Do not import mutable current ORM models into the migration.

- [ ] **4. Implement direct routers and the single balance response seam.** Each router uses `APIRouter(prefix="/api/accounts", tags=["accounts"])` or the category equivalent. Every handler has `context: HouseholdContext = Depends(require_household)` and `db: Session = Depends(get_db)`. Require positive integer path IDs with `Path(gt=0)`. Scoped lookup pattern:

```python
def get_account(db: Session, account_id: int, household_id: int) -> Account:
    account = db.scalar(select(Account).where(
        Account.id == account_id, Account.household_id == household_id,
    ))
    if account is None:
        raise APIError(404, "NOT_FOUND", "Resource not found.")
    return account


def account_response(account: Account) -> AccountResponse:
    return AccountResponse(
        id=account.id, name=account.name, type=account.type,
        initial_balance=account.initial_balance, balance=account.initial_balance,
        is_archived=account.is_archived,
    )
```

`get_category` uses the category model and same scoped predicate/error. This is deliberate tiny feature-local code, not a shared generic lookup.

For account lists, build `select(Account).where(Account.household_id == context.household_id)`, add `Account.is_archived.is_(False)` unless `include_archived: bool = Query(False, alias="includeArchived")`, order by name/id, and map through `account_response`. Detail uses `get_account` then `account_response`. Category lists/detail build `CategoryResponse` explicitly with id/name/type/is_archived.

Create accounts with server ownership and validated fields:

```python
account = Account(
    household_id=context.household_id,
    name=payload.name, type=payload.type,
    initial_balance=payload.initial_balance,
)
db.add(account)
try:
    db.commit()
except IntegrityError as exc:
    db.rollback()
    if getattr(exc.orig, "sqlite_errorname", None) == "SQLITE_CONSTRAINT_UNIQUE":
        raise APIError(409, "CONFLICT", "An account with this name already exists.",
                       {"name": "Choose a different name."}) from None
    raise
db.refresh(account)
return account_response(account)
```

Register create with `status_code=201, response_model=AccountResponse`. Category creation uses `Category`, payload name/type and the category conflict message. Apply the same uniqueness-error handling around account/category PUT commits, rolling back first and re-raising non-unique failures. Do not catch every `IntegrityError` as a duplicate or return its raw text. The database constraint, not a preflight duplicate query, is the race-safe authority.

For account PUT: scoped lookup; reject archive with 409; assign only name/type/initial_balance; commit/refresh; `account_response`. For category PUT: scoped lookup; reject archive with 409; assign only name; commit/refresh; explicit `CategoryResponse`. Never copy arbitrary request dictionaries onto ORM objects.

Archive write pattern, in each router with its own lookup:

```python
account = get_account(db, account_id, context.household_id)
if not account.is_archived:
    account.is_archived = True
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
return Response(status_code=204)
```

The broad archive catch only guarantees rollback and re-raises; it does not suppress/classify unexpected exceptions. Archive has no request body and never deletes rows. Register both routers in `create_app` beside auth. Preserve all global dependencies and exception handlers.

- [ ] **5. Prove isolation and validation through HTTP.** Extend `test_authorization.py` with a parameterized account/category case. Use `seeded_user` as household A; insert household B, a hashed-password user and `HouseholdMember` with the real models/DB fixture; use a second `TestClient(test_app)` with its own cookies and CSRF bootstrap to log in as B. Create resources through HTTP, not bypassed authorization. B then attempts GET/PUT/archive of A's ID; assert identical 404 envelope to an absent positive ID and unchanged A data. B lists (with and without archives) must exclude A; B may create its own identical name. Add another member in A and prove that member can edit/archive A's resources. Never override `require_household` to make these pass.

Minimal per-resource request loop after independent sessions/resources are set up:

```python
before = owner_client.get(resource_url).json()
assert foreign_client.get(resource_url).status_code == 404
assert foreign_client.put(resource_url, json=valid_update, headers=foreign_headers).status_code == 404
assert foreign_client.post(resource_url + "/archive", headers=foreign_headers).status_code == 404
assert owner_client.get(resource_url).json() == before
```

Here `resource_url` is A's created detail URL, `valid_update` is the resource's documented PUT body, and `foreign_headers` is B's own post-login CSRF cookie value plus allowed Origin; create those values in the test, not shared browser cookies. Repeat list isolation with an archived A resource to exercise both list branches.

Required additional observable cases:

| Boundary | Assert |
|---|---|
| No session | Both lists/details deny 401; unsafe requests with valid anonymous CSRF still deny authentication |
| CSRF/Origin | Real logged-in create/update/archive with missing/foreign CSRF or disallowed Origin deny 403 and preserve data |
| Forged ownership/output fields | POST/PUT extra ownership, id, archive or balance fields deny 422; no row creation/change |
| Names | Trimmed storage; whitespace-only and 101 code points deny; 100 Unicode code points succeed; rendering is plain text |
| Uniqueness | Same trimmed account name conflicts; same category type/name conflicts; cross-type category and cross-household equality succeed; failed rename keeps old record |
| Archived uniqueness | Archive then duplicate create still conflicts; archive detail remains readable; no physical DELETE route succeeds |
| Money | `0`, `-1`, both safe endpoints succeed; boolean, float, numeric string, null, either overflow fail 422 with no mutation |
| Types | All five account types and both category types allowed; unknown enum denied; category PUT `type` denied |
| Query | Active default, inclusive `includeArchived=true`, explicit false, invalid boolean 422; deterministic ordering |

Run from `backend`: `python -m pytest tests/test_accounts.py tests/test_categories.py tests/test_authorization.py`. Finish this task only when complete APIs—not just model creation—pass. Keep regressions that catch these real permission/precision/lifecycle failures; do not add route-wiring/source-text tests.

## Task 2 — Atomic Optional Category Bootstrap

**Files:** `backend/app/cli.py`, `backend/tests/test_bootstrap.py`.

**Consumes:** Task 1 `Category`, existing `_init_household`, `_begin_immediate`, `_add_user`, `_run`, and `run_cli` test helper.

**Produces:** `init-household` prompts for optional defaults, with a single tuple constant `DEFAULT_CATEGORIES` in `cli.py`; selected defaults, household and owner commit atomically. No new command/API/automatic migration seeding.

- [ ] **1. Add yes/no and rollback tests.** Use the existing helper, with valid confirmed passwords. Explicit `"n"` yields no categories; `""`/`"y"`/`"yes"` selects all 17 defaults; accept case-insensitive `n/no` too. A non-answer such as `maybe` returns 1 with no rows. Verify stored `(type, name)` pairs, correct household ownership, and default rows visible through a real owner's `GET /api/categories` after login. Keep existing duplicate-household, password-reset and cleanup coverage.

A concrete decline check:

```python
def test_init_can_decline_default_categories(monkeypatch, test_app):
    factory = test_app.state.session_factory
    assert run_cli(monkeypatch, factory, "init-household",
                   ["Family", "owner", "Owner", "n"],
                   ["correct horse battery staple", "correct horse battery staple"]) == 0
    with factory() as db:
        assert db.scalar(select(Household.id)) is not None
        assert db.scalars(select(Category)).all() == []
```

Import `Category` in this test module. For rollback, monkeypatch `cli.DEFAULT_CATEGORIES` to two identical valid pairs, run a yes bootstrap, assert exit 1 and no households/users/members/categories in the database. This exercises a real database uniqueness failure inside the transaction, not a mocked commit echo.

- [ ] **2. Add the exact seed set once.** In `cli.py`:

```python
DEFAULT_CATEGORIES = (
    ("income", "Salary"), ("income", "Bonus"), ("income", "Other Income"),
    ("expense", "Housing"), ("expense", "Groceries"), ("expense", "Restaurants"),
    ("expense", "Car"), ("expense", "Public Transport"), ("expense", "Insurance"),
    ("expense", "Subscriptions"), ("expense", "Kids"), ("expense", "Health"),
    ("expense", "Shopping"), ("expense", "Entertainment"), ("expense", "Travel"),
    ("expense", "Utilities"), ("expense", "Other"),
)
```

After password confirmation, before beginning the write transaction:

```python
answer = input("Create default categories? [Y/n]: ").strip().lower()
if answer not in {"", "y", "yes", "n", "no"}:
    raise CLIError("Answer yes or no.")
seed_categories = answer in {"", "y", "yes"}
```

After household/user creation and before the existing `db.commit()`:

```python
if seed_categories:
    db.add_all(Category(household_id=household.id, type=kind, name=name)
               for kind, name in DEFAULT_CATEGORIES)
```

Import `Category`; retain duplicate-initialization refusal and hidden password handling. No extra commit, seed class or separate list in another application file.

- [ ] **3. Migrate every prompt caller.** All `run_cli(..., "init-household", ...)` paths that reach the new prompt need a final explicit answer, including duplicate-household attempts, password reset setup and cleanup setup. Mismatched-password paths still exit before the seed prompt and need no extra answer. Do not globally change `run_cli` to silently manufacture input. `scripts/seed_e2e.py` directly constructs identity rows and does not call the CLI; leave it identity-only so the E2E scenario exercises category creation.

Run from `backend`: `python -m pytest tests/test_bootstrap.py tests/test_categories.py`. Then exercise `python -m app.cli init-household` interactively against two separately migrated disposable databases, accepting and declining defaults. Record real prompt/results; never initialize/reset the user's database to prove this task.

## Task 3 — Exact Money Entry and Display

**Files:** `frontend/src/app/shared/utilities/money.ts`, `money.spec.ts`.

**Consumes:** Safe cent bounds and EUR contract from Task 1; installed TypeScript BigInt/Intl support.

**Produces:** `parseMoney(text: string): number | null` for unsigned decimal entry; `parseSignedMoney(text: string): number | null` for signed initial balances; `moneyInput(cents: number): string` for **absolute** exact dot-decimal edit values; `signedMoneyInput(cents: number): string`; `formatMoney(cents: number): string` for signed EUR display. M3's planned unsigned transaction parser/edit helper remain compatible; signed initial balances do not widen `parseMoney` to accept transaction signs.

- [ ] **1. Add focused precision/grammar regressions.** In `money.spec.ts`:

```typescript
import { expect, it } from "vitest";
import { formatMoney, moneyInput, parseMoney, parseSignedMoney, signedMoneyInput } from "./money";

it("keeps signed initial balances and unsigned transaction entry exact", () => {
  expect(parseMoney("84,72")).toBe(8472);
  expect(parseMoney(" 84.7 ")).toBe(8470);
  expect(parseSignedMoney("-0.01")).toBe(-1);
  expect(parseSignedMoney("0")).toBe(0);
  expect(parseMoney("-1")).toBeNull();
  for (const text of ["", "+1", "1e2", "1.234", "1,000.00", "1 000", ".5", "1.", "--1", "90071992547409.92"]) {
    expect(parseSignedMoney(text)).toBeNull();
  }
  for (const cents of [0, 1, -8472, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
    expect(parseSignedMoney(signedMoneyInput(cents))).toBe(cents);
    expect(parseMoney(moneyInput(cents))).toBe(Math.abs(cents));
  }
  expect(formatMoney(-1)).toContain("-0,01");
  expect(formatMoney(Number.MAX_SAFE_INTEGER)).toContain("90.071.992.547.409,91");
});
```

Run from `frontend`: `npm test -- --watch=false --include=src/app/shared/utilities/money.spec.ts`. Initially this fails on the missing module; do not change the runner or install a new test framework.

- [ ] **2. Implement the complete utility.** Parse digit components with BigInt before safe conversion. Never use `parseFloat(text) * 100`, `toFixed` on a divided large cent number, or a locale currency formatter receiving already-rounded fractional euros.

```typescript
export function parseMoney(text: string): number | null {
  const match = /^([0-9]{1,14})(?:[.,]([0-9]{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

export function parseSignedMoney(text: string): number | null {
  const value = text.trim();
  if (!/^-?[0-9]{1,14}(?:[.,][0-9]{1,2})?$/.test(value)) return null;
  const negative = value.startsWith("-");
  const cents = parseMoney(negative ? value.slice(1) : value);
  return cents === null ? null : negative && cents !== 0 ? -cents : cents;
}

export function moneyInput(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError("Invalid integer cents");
  const absolute = BigInt(Math.abs(cents));
  return `${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function signedMoneyInput(cents: number): string {
  return `${cents < 0 ? "-" : ""}${moneyInput(cents)}`;
}

const wholeEuroFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

export function formatMoney(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError("Invalid integer cents");
  const absolute = BigInt(Math.abs(cents));
  return `${cents < 0 ? "-" : ""}${wholeEuroFormatter.format(absolute / 100n)},${String(absolute % 100n).padStart(2, "0")}\u00a0€`;
}
```

The 14 whole-digit bound rejects overlong inputs before converting arbitrarily large BigInts; leading zeros remain valid under this grammar. Document this grammar in the input hint. Decimal comma OR dot, no grouping/exponents, at most two fraction digits, optional leading minus for initial balances only. `-0` normalizes to zero. Do not add dates or transaction-sign application yet.

- [ ] **3. Run the focused spec and retain it.** These boundary checks catch plausible financial corruption and earn a permanent test. Task 4 must exercise these functions through actual form entry/display, not merely import them.

## Task 4 — Usable Angular Account/Category Management

**Files:** Task 4 row in the file map, plus Task 3 utilities as consumers.

**Consumes:** Public types/HTTP contracts in §2, `AuthService`, `authGuard`, `anonymousGuard`, existing auth interceptor, `codePointLengthValidator`, Task 3 money functions.

**Produces:** `AccountsService` and `CategoriesService`; standalone `AccountsPage`, `CategoriesPage`, `DashboardPage`; protected `/accounts`, `/categories` and preserved `/dashboard`; shared authenticated navigation/logout. Both management pages are complete workflows, not a compiling scaffold.

- [ ] **1. Add public types and small feature services.** Implement `AccountsService` as below; `CategoriesService` follows the explicit signatures listed after it, with category payload types rather than a generic CRUD base:

```typescript
import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Account, AccountWrite } from "../../core/api/models";

@Injectable({ providedIn: "root" })
export class AccountsService {
  private readonly http = inject(HttpClient);
  list(includeArchived = false) {
    return this.http.get<Account[]>("/api/accounts", { params: { includeArchived } });
  }
  get(id: number) { return this.http.get<Account>(`/api/accounts/${id}`); }
  create(body: AccountWrite) { return this.http.post<Account>("/api/accounts", body); }
  update(id: number, body: AccountWrite) { return this.http.put<Account>(`/api/accounts/${id}`, body); }
  archive(id: number) { return this.http.post<void>(`/api/accounts/${id}/archive`, null); }
}
```

`CategoriesService.list(includeArchived = false): Observable<Category[]>`, `get(id: number): Observable<Category>`, `create(body: CategoryCreate): Observable<Category>`, `update(id: number, body: CategoryUpdate): Observable<Category>`, `archive(id: number): Observable<void>` call the five category URLs in §2 with the same HttpClient pattern. No service-level cache/retry or financial localStorage/sessionStorage. Existing Angular XSRF/interceptor wiring owns credentials/errors.

- [ ] **2. Make the existing shell reusable without building M4.** Move only the identity-card markup/styles from `AppShellComponent` to a new standalone `DashboardPage`, injecting `AuthService` for its current identity data. Keep sign-out/error handling in the shell unchanged. Add `RouterOutlet`, `RouterLink` and `RouterLinkActive` to shell imports, a navigation landmark with Dashboard/Accounts/Categories links, and a child outlet within the single main content region. Links use `ariaCurrentWhenActive="page"`; navigation wraps or stacks at phone width. No links to unimplemented features.

The resulting route shape is:

```typescript
export const routes: Routes = [
  { path: "login", component: LoginPage, canActivate: [anonymousGuard] },
  {
    path: "", component: AppShellComponent, canActivate: [authGuard],
    children: [
      { path: "", pathMatch: "full", redirectTo: "dashboard" },
      { path: "dashboard", component: DashboardPage, canActivate: [authGuard] },
      { path: "accounts", component: AccountsPage, canActivate: [authGuard] },
      { path: "categories", component: CategoriesPage, canActivate: [authGuard] },
    ],
  },
  { path: "**", redirectTo: "dashboard" },
];
```

Add the component imports to `app.routes.ts`; guards on children protect transitions while the shell is already mounted. Keep existing root auth initialization and 401 recovery. Adapt existing tests only where this legitimate routing/content move changes a contract; preserve login/logout/deep-link assertions.

- [ ] **3. Add page form behavior tests before handlers.** Use the existing Angular TestBed/HttpTestingController and Vitest conventions; keep HTTP-backed form checks on observable request bodies and rendered state rather than mocked service forwarding. `accounts.page.spec.ts` must cover negative-cent entry, invalid/overflow entry sending no write, a changed initial balance blocked until acknowledgement, and a 409 preserving values with a name-associated error. `categories.page.spec.ts` covers expense/income create, rename sending name only, and failed save preserving name/type. Use actual native form controls/events in at least one test per page.

Concrete account form assertions after TestBed supplies the page, its initial GET is flushed and fields are entered:

```typescript
fixture.nativeElement.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
const request = http.expectOne({ method: "POST", url: "/api/accounts" });
expect(request.request.body).toEqual({ name: "Card", type: "credit_card", initialBalance: -8472 });
request.flush({ error: { code: "CONFLICT", message: "Name already used.", fields: { name: "Choose a different name." } } },
              { status: 409, statusText: "Conflict" });
fixture.detectChanges();
expect(fixture.nativeElement.querySelector("#account-name").value).toBe("Card");
expect(fixture.nativeElement.querySelector("#initial-balance").value).toBe("-84,72");
expect(fixture.nativeElement.querySelector("#account-name").getAttribute("aria-describedby")).toContain("account-name-error");
```

Here `fixture` is `TestBed.createComponent(AccountsPage)` and `http` is the injected `HttpTestingController`; configure HttpClient then its testing provider as existing specs do, flush `GET /api/accounts?includeArchived=false`, and enter Card/credit_card/-84,72 through labelled controls before this snippet. Flush outstanding requests and call `http.verify()` in each test's cleanup. Do not add per-method service echo tests.

- [ ] **4. Implement native account form and exact initial-balance editing.** Page uses a nonnullable reactive form with `name`, `type`, `initialBalance` text, `acknowledgeBalanceChange` boolean. New record defaults: blank name, checking type, `"0.00"` initial balance, no acknowledgement. Edit fetches detail then uses `signedMoneyInput(account.initialBalance)`, preserving exact cents even at the maximum. Category form has `name` and a type selector only during create; editing shows immutable type text and sends name only.

Extract the existing `codePointLengthValidator` unchanged from login into `shared/utilities/validators.ts`, export it and migrate login/accounts/categories imports. Names use `codePointLengthValidator(1, 100, value => value.trim())`; do not use UTF-16 `maxlength` alone to reject otherwise valid 100-code-point names. Preserve password validation semantics while moving the helper. Use a form-local money validator invoking `parseSignedMoney`, and a native text input (not number/float coercion) so negative comma input works.

Account submission's decisive gate:

```typescript
const raw = this.form.getRawValue();
const cents = parseSignedMoney(raw.initialBalance);
this.form.markAllAsTouched();
if (this.isSubmitting() || this.form.invalid || cents === null) return;
const original = this.editingAccount();
if (original && cents !== original.initialBalance && !raw.acknowledgeBalanceChange) {
  this.form.controls.acknowledgeBalanceChange.setErrors({ required: true });
  return;
}
const body: AccountWrite = { name: raw.name.trim(), type: raw.type, initialBalance: cents };
const write = original ? this.accounts.update(original.id, body) : this.accounts.create(body);
```

Define `form` with typed `AccountType` controls, `isSubmitting = signal(false)`, `editingAccount = signal<Account | null>(null)` and `accounts = inject(AccountsService)`. Subscribe to this `write` exactly once with the save-state transitions below. Clear a stale acknowledgement error when the balance returns to its original value or the checkbox is checked; reset acknowledgement whenever a different account is loaded. Do not send the checkbox in the API request.

Native money field structure:

```html
<label for="initial-balance">Initial balance (EUR)</label>
<input id="initial-balance" type="text" inputmode="decimal" formControlName="initialBalance"
       aria-describedby="initial-balance-hint initial-balance-error"
       [attr.aria-invalid]="form.controls.initialBalance.invalid && form.controls.initialBalance.touched" />
<p id="initial-balance-hint">Use up to 14 whole digits and two decimals, comma or dot, no grouping. A leading minus means money owed.</p>
<p id="initial-balance-error" aria-live="polite">{{ initialBalanceError() }}</p>
```

Define `initialBalanceError(): string` from touched/invalid control state and server `initialBalance` field errors. Provide analogous labelled controls and associated messages for account/category names and selectors. The warning and labelled acknowledgement are visible during account editing when the parsed balance differs. Display `formatMoney(account.balance)` in lists; never recompute balances from browser state.

- [ ] **5. Complete list/edit/archive/error transitions on both pages.** Use feature-local signals for data/loading/listError/isSubmitting/saveError/fieldErrors/editing record/archive target/archive pending. Define these states directly in each page, not a generic state machine module.

| User action/result | Required state transition |
|---|---|
| Initial GET | Show loading; an error shows alert + Retry, never an empty-list message |
| Successful empty GET | Explicit empty state and Add account/category action |
| Show archived toggle | Refetch with `includeArchived`; distinguish archive rows with text; no edit/archive buttons on them |
| Add/Edit | Inline labelled form; Edit fetches owned detail to avoid editing a stale list row; now-archived detail becomes read-only and cancels editing with explanation |
| Submit | Validate, disable duplicate save/archive/navigation that would discard this form while pending; send exactly one write |
| Write 422/409 | Preserve every value; map known camelCase server fields to associated errors; clear old server errors on edit/new submission |
| Write 403/network/5xx | Preserve form, show actionable error; no automatic unsafe replay; do not claim success |
| Write succeeds | Clear/close form, announce saved, refetch list using current archive toggle |
| Save succeeds but GET fails | Report saved + refresh failure; Retry repeats GET only, never POST |
| Begin archive | Inline confirmation naming resource; Confirm archive and Cancel, focus moves to confirmation |
| Cancel archive | No HTTP request; return focus to triggering button |
| Confirm archive | POST once; preserve row on failure; 204 refreshes current list and announces archived |
| Detail/archive 404 | Explain unavailable record, refresh list without exposing foreign ownership |
| Leave/logout/401 | Destroy financial page/form state; preserve global auth handling; no browser storage |

Disable the archive toggle while its GET is pending (or use the existing RxJS cancellation pattern) so a slower earlier response cannot replace a later toggle result. On successful archive move focus to Add or the next surviving record; show archived data only on demand. Category list has separate “Expense Categories” and “Income Categories” headings and type-specific empty states.

Native list cards or a responsive table are sufficient. Use semantic edit/archive buttons with resource-specific accessible names; text-only values for name/type/balance/archive status. At 390px wide there must be no page-level horizontal scrolling or inaccessible minus entry; verify paste and physical/onscreen keyboard behavior for negative balances. Avoid dialogs, UI libraries, global money pipes and duplicate logout implementations.

- [ ] **6. Run targeted UI checks and exercise the real pages.** From `frontend`: `npm test -- --watch=false --include=src/app/features/accounts/accounts.page.spec.ts --include=src/app/features/categories/categories.page.spec.ts --include=src/app/shared/utilities/money.spec.ts`. Also run the existing login tests because the validator moved. Launch the actual application with a disposable backend and verify keyboard create/rename/type change/warned balance edit/archive at desktop and phone widths. A mocked HTTP form test alone does not finish this task.

## Task 5 — Integrated Acceptance and Luna Handoff

**Files:** `frontend/e2e/accounts-categories.spec.ts`; in-scope fixes, README/state/active handoff after proof.

**Consumes:** All preceding tasks, existing real-backend Playwright config/generated credentials and temporary ownership teardown.

**Produces:** Recorded migration/API/browser/security evidence, accurate M2 completion status and an explicit user-review boundary before M3. Do not execute or rewrite the M3 plan as part of this task.

- [ ] **1. Add a real-backend browser lifecycle.** Use `process.env["BUDGET_E2E_USERNAME"]` and `process.env["BUDGET_E2E_PASSWORD"]` as existing auth tests do. Generate resource names using a per-run suffix so retries/repeated runs do not collide. Run the same workflow at 1280×900 and 390×844; use accessible label/role selectors, not fixed record IDs or backend mocks for the happy path.

```typescript
import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`manages accounts and categories at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/login");
    await page.getByLabel("Username", { exact: true }).fill(process.env["BUDGET_E2E_USERNAME"]!);
    await page.getByLabel("Password", { exact: true }).fill(process.env["BUDGET_E2E_PASSWORD"]!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole("link", { name: "Accounts", exact: true }).click();
    await expect(page).toHaveURL(/\/accounts$/);
    await page.getByRole("button", { name: "Add account", exact: true }).click();
    const name = `Card ${crypto.randomUUID()}`;
    await page.getByLabel("Account name", { exact: true }).fill(name);
    await page.getByLabel("Account type", { exact: true }).selectOption("credit_card");
    await page.getByLabel("Initial balance (EUR)", { exact: true }).fill("-84,72");
    await page.getByRole("button", { name: "Save account", exact: true }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByText(/-84,72\s*€/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  });
}
```

Extend **inside each test before it ends** with the rest of the acceptance workflow: edit account name/type; change initial balance to `-90.00`, prove submission blocked without acknowledgement, acknowledge and see `-90,00 €`; create expense Groceries and income Salary with unique suffixes; rename category and confirm type is not editable; cancel an archive and observe resource unchanged; confirm archive for both an account and category; verify active lists hide them and Show archived reveals their retained names/status; refresh; sign out; direct `/accounts` and `/categories` navigation must return to login. Scope amount assertions to the created record once multiple records exist. Include keyboard-only submission of one resource, associated invalid-money/name feedback, and failure-preservation checks through the component specs or explicit browser fault scenarios (do not substitute them for real-backend success).

- [ ] **2. Prove migrations without touching real data.** On a fresh temporary DB, upgrade to `0002_identity`; create an M1 household/owner/member/session using the existing administration/auth flow; capture identities through the API and record existing rows. Upgrade to `0003_accounts_categories`; confirm the same login/member identities and existing valid session still work; create an account/category and verify exact cents. On a **separate disposable copy**, downgrade to `0002_identity`, confirm identity rows survive and financial tables are removed, then re-upgrade and create/read resources again. Also upgrade an empty DB to head. Downgrade intentionally discards M2 data and is never an upgrade strategy or preservation claim.

Use commands from `backend` with `DATABASE_URL` pointing explicitly at the disposable path:

```text
python -m alembic upgrade 0002_identity
python -m alembic upgrade 0003_accounts_categories
python -m alembic current
python -m alembic downgrade 0002_identity
python -m alembic upgrade head
```

Set `APP_ENV=test`, a throwaway `SESSION_SECRET`, allowed test origins/hosts and `SECURE_COOKIES=false` for local HTTP runtime as existing fixtures/harness do. Keep shell environment changes scoped to the test process. Never copy credentials into docs, alter `.env` or downgrade `data/budget.db`.

- [ ] **3. Run integrated verification after edits settle.** From `backend`: `python -m pytest`. From `frontend`: `npm test -- --watch=false`, `npm run build`, `npx playwright test`. Run the real CLI acceptance/decline scenario from Task 2 and visually inspect actual browser surfaces at both viewports. Record exact command results/counts, not expected counts from old M1 docs. If a runtime capability is unavailable, finish reachable work and name the specific unverified gate rather than claiming completion.

- [ ] **4. Perform a focused security review.** Trace every account/category read/write and referenced lookup for server-derived scope; verify archive/read-only and duplicate-name behavior, strict cents, unsafe-method CSRF/Origin enforcement, same-household member access, no foreign-name leakage and no physical deletion. Inspect rendered resource names/error handling for HTML injection and preservation after failed saves. Fix concrete findings and rerun their reproductions; passing tests alone is not a security review.

- [ ] **5. Update status only after proof.** README documents M2 routes, safe-cent input range/grammar, case-sensitive trimmed-name uniqueness, archive/no-unarchive convention, warned initial-balance editing and the new optional bootstrap prompt; states existing households are not automatically seeded. `state.md` marks M2 complete only with actual test/migration/browser/security evidence and sets M3 as next **after user review**. Update active `docs/LUNA_HANDOFF.md` with actual paths, commands/results and known verification gaps; link the preserved transaction plan/handoff, but do not rewrite either. Remove owned throwaway scripts/databases/artifacts, not permanent regression tests or user files. No commit/push/deploy without separate authorization.

## 4. Acceptance Checklist / Source Coverage

| MVP requirement / established contract | Task / proof |
|---|---|
| §44 M2 account CRUD/archive | Task 1 all five endpoints; Task 4 complete UI; Task 5 real browser lifecycle |
| §44 M2 category CRUD/archive | Task 1 immutable-type rename/archive; Task 4 income/expense sections; Task 5 browser lifecycle |
| §44 M2 Angular account/category pages | Task 4 guarded routes, usable forms/navigation/error/empty states; Task 5 both viewports |
| §44 M2 household scoping tests; §§7.7, 24, 42 | Task 1 independent real sessions/households on every read/write and archive-list branch; same-household member success |
| §§9–10, 35, 37 cents/balance/limits | Task 1 strict signed cents/API responses; Task 3 boundary round trips/display; Task 4 warned edits |
| §§10–11, 22.3–22.4 archive/history | Task 1 never physically deletes, detail and inclusive lists retain rows; M3 later tests real historical references |
| §25 household indexes | Task 1 model/migration constraints and indexes; Task 5 upgrade cycle |
| §§40–41 optional defaults; broader Task 2.1 | Task 2 exact seed set, opt-out, atomic rollback; Task 5 real CLI and existing-data preservation |
| §§21, 23, 33 auth/errors/logging | Tasks 1/4 reuse existing middleware/guards/interceptor/envelope; Task 5 focused security review |
| §§16–17, 38–39, 42–43 UX/accessibility | Tasks 4/5 keyboard, phone, labels/errors/focus, archive confirmation, failure preservation |
| M3 prerequisite contracts | §2 arrays/aliases/archive/immutable ownership and type; Task 1 single account response seam; Task 3 unsigned parser compatibility |

Before declaring M2 complete, Luna must check all of these:

- [ ] Complete create/list/detail/edit/archive for both resources; no hard deletion, cross-household leakage or role-only financial restriction.
- [ ] Strict exact-cent storage/API/form/display, including zero, negative balances and safe-integer endpoints; no rounded values or ambiguous input acceptance.
- [ ] Atomic optional seeds for new households only; original identities survive upgrade.
- [ ] Working guarded management pages and shared logout/navigation, mobile/keyboard/error-state proof; dashboard remains identity-only.
- [ ] Meaningful regressions, full integrated commands, disposable migrations, real CLI/browser exercise and focused security review have recorded results.
- [ ] README/state/active handoff reflect evidence; M3 plan and preserved M3 handoff unchanged; no real data/deployment changes.

**Stop after verified M2. Report completed behavior, changed files/public helper paths, exact verification results and any unverified gate. Request user review before starting Milestone 3.**

## Planning Verification Boundary

This file records an implementation plan, not completed accounts/categories. Planning checks cover source-contract consistency, documentation paths, example syntax/precision and preservation of the M3 artifacts. Application tests, migration runs, real CLI/UI acceptance and security verification remain Luna's implementation gates above.

Planning-session checks performed:

- Syntax-checked all 13 Python examples (handler excerpts checked within a function) and transpiled all 8 TypeScript examples with the installed compiler; this is not whole-application type checking.
- Executed the proposed Pydantic schemas against strict cents, forged ownership/output fields, the 100-code-point name boundary and immutable category-type inputs.
- Executed the money utility through signed/unsigned round trips, malformed inputs and both safe-integer endpoints; maximum display retained `90.071.992.547.409,91 €`.
- Executed the migration table-creation example on in-memory SQLite; checked exact signed storage, range/type constraints, category uniqueness/type separation and preservation of an existing household row. This is not the full M1 migration/session preservation gate.
- Checked all 17 default category pairs against §41, all 8 documentation references, and found no unresolved planning placeholders.
- SHA-256 comparison confirmed the M3 plan is byte-for-byte unchanged and the previous handoff is byte-for-byte preserved at `docs/LUNA_M3_HANDOFF.md`.
