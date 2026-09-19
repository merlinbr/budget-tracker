# Milestone 5 — Monthly Budgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Planning is not authorization to implement, commit, push or deploy.

**Goal:** Let household members set, edit, remove and copy monthly expense-category budgets, with exact-cent usage and accessible budget progress on both Budgets and Dashboard.

**Architecture:** Add one budgets table and one direct FastAPI feature router. A single budget-reporting function supplies the budgets API and the existing dashboard within its read snapshot. Angular uses the existing category API, money utilities, request-state pattern and pending-write guard; one small presentation component renders budget usage in both pages.

**Tech Stack:** Existing Angular 22 / RxJS / TypeScript, FastAPI / Pydantic / SQLAlchemy / SQLite / Alembic, pytest, Vitest and Playwright. No new dependencies.

## Global Constraints

Source of truth: `BUDGET_TRACKER_MVP_SPEC.md`, especially §§7.7, 9, 11–14, 18, 21, 22.6, 23–25, 35–39, 42–44. This expands Task 5.1 and the decisions in `docs/superpowers/plans/2026-09-07-budget-tracker-mvp.md`. Keep the existing product spec; do not create a competing specification.

- “Money must **never** use binary floating-point storage.” Store/transport monetary amounts as integer EUR cents, bounded by `±9007199254740991`. The dimensionless progress ratio may be a finite floating-point number; never use it to reconstruct money.
- “Every household-data query must be scoped using the authenticated user's household membership.” Derive household identity from `require_household`; owner/member financial permissions remain identical.
- “Only expense categories may have a budget.” “Budget amount cannot be negative.” Zero is valid and is not the absence of a budget.
- “Month must be 1–12.” Preserve the implemented year range `1–9999` and inclusive calendar-date month bounds, including December 9999.
- “Do not overwrite current-month values without confirmation.” Copy is included because the existing roadmap explicitly includes the API and overwrite contract.
- “Do not communicate budget state using color alone.” Labels, associated errors, semantic buttons, keyboard operation, visible focus and readable money/status text are required.
- Reuse CSRF protection, explicit camelCase response schemas, generic foreign/missing-resource 404s, existing 422/409 error envelopes, 401 recovery and pending navigation/sign-out protection.
- Use only migrated disposable test databases and Playwright-owned temporary data/generated credentials. Never reset/downgrade `data/budget.db`, overwrite `.env`, or test against real financial data.
- No settings/export, deployment/backups/restore, transfers, import, recurrence, rollover balances, budget templates, bulk-save endpoint, charts, global month store or production-readiness claims.
- Do not commit, push or deploy without separate authorization. Preserve previous milestone plans and handoffs.

---

## 1. Starting Point and Proposed Decisions

M4 is implemented; M5 remains unimplemented. This plan was refreshed on **2026-09-18** against the current source, retaining its original path so existing handoffs keep pointing to one implementation plan.

The app assessment immediately before this planning refresh reran the integrated checks: **117 backend tests passed (111 deprecation warnings)**, **36 frontend tests across 11 files passed**, **production build passed**, and **10 real-backend browser scenarios passed**. Fresh dashboard ready-state screenshots were visually inspected at desktop and phone widths, with no obvious clipping. This does not verify the other M4 visual states or M3 list loading/failure rendering, and it is not M5 acceptance evidence.

The user requested planning M5, not implementation. Review this plan before starting implementation; planning does not mark M5 complete. The refresh checked the current schema, category lookup/service, money helpers, authentication/database transaction behavior, dashboard snapshot regression and browser seed isolation. All eight Python examples parsed successfully. A disposable SQLite probe using the current database configuration confirmed that an authentication-style SELECT permits subsequent `BEGIN IMMEDIATE` and rollback; this is a narrow transaction-assumption check, not proof of the future budget endpoints.

### Inspected integration points

| File / symbol | Reuse or required change |
|---|---|
| `backend/app/models.py` | Add `Budget` beside existing financial models, matching explicit constraints and UTC timestamps. |
| `backend/migrations/versions/0004_transactions.py` | Current migration head; new revision is `0005_budgets`. |
| `backend/app/categories.py::get_category` | Existing household-scoped category lookup with generic 404; use for writes. Category type is immutable. |
| `backend/app/money.py::Cents`, `checked_cents` | Strict request cents and calculated-amount overflow rejection. Do not create a second money implementation. |
| `backend/app/dashboard.py::get_dashboard` | Already opens `BEGIN` for one WAL read snapshot. Add budget reporting to that transaction, not a separate session or nested transaction. |
| `backend/app/schemas.py::DashboardResponse` | Replace the intentionally empty `budgets` schema with `list[BudgetResponse]`. |
| `backend/app/main.py::create_app` | Register the new direct feature router under the existing global CSRF dependency. |
| `frontend/src/app/features/dashboard/dashboard.page.ts` | Reuse local-month initialization, bounded month navigation and loading/error/ready state pattern. Add the budget overview in the ready branch. |
| `frontend/src/app/features/categories/categories.page.ts` | Follow explicit save/cancel, inline confirmation, focus restoration and pending-write patterns. Do not copy its compressed formatting or redundant loading flags. |
| `frontend/src/app/features/categories/categories.service.ts` | Use existing active category list; filter expense categories in the editor. No new category endpoint. |
| `frontend/src/app/shared/utilities/money.ts` | Reuse `parseMoney`, `moneyInput`, `formatMoney`, `localToday`. Blank input is invalid; only explicit removal deletes a budget. |
| `frontend/src/app/core/api/models.ts::DashboardResponse` | Replace `never[]` with `Budget[]`; keep existing dashboard fields unchanged. |
| `frontend/src/app/core/pending-form.service.ts`, `app.routes.ts`, `layout/app-shell.ts` | Add protected Budgets route/link and reuse the one-pending-write contract. |
| `backend/tests/conftest.py`, `frontend/playwright.config.ts`, `backend/scripts/seed_e2e.py` | Reuse migrated disposable fixtures and generated browser identities. Budget browser totals need their own households, not M4's households. |

Before modifying existing exported symbols during implementation, use LSP references where available, otherwise inspect all callers. Re-read any files changed since planning. Do not rename existing period types or money APIs just for this milestone.

### Alternatives

1. **Recommended: per-category explicit saves, direct SQL reporting, shared usage display.** Follows existing forms and roadmap; failures affect one deliberate operation and no financial calculation is duplicated in the browser.
2. **Save-all grid.** Adds batch validation, dirty-row tracking and partial/atomic-save policy without a requirement. Do not add it.
3. **Client aggregation or general reporting infrastructure.** Requires downloading transactions or a reporting abstraction before a second real reporting need. Keep one concrete budget query instead.

### Fixed behavior

| Concern | Contract |
|---|---|
| Resource identity | Household/category/year/month. Internal budget ID and timestamps are stored but not exposed; routes address category ID and explicit period. |
| List | `GET /api/budgets?year=2026&month=9` returns configured budgets only, including archived-category history, ordered by category name then ID. `[]` means no configured budgets. |
| Editor rows | Show every active expense category, including unconfigured categories. Union in configured archived categories, labelled Archived. Income categories never appear. Use category IDs, never names, for merging. |
| Upsert | `PUT /api/budgets/{categoryId}?year=...&month=...` with `{ "limitAmount": 60000 }`. Both creation and replacement return 200 with the updated budget and usage. Repeating the request leaves one row. |
| Archived correction | Existing archived-category budgets remain editable/removable to correct history, like retained archived transaction references. Creating a budget where none exists for an archived category returns 409. Copy never creates or changes an archived-category budget. |
| Removal | `DELETE /api/budgets/{categoryId}?year=...&month=...` returns 204 if removed; absent/foreign budget returns the same generic 404. Removing a limit leaves category and transactions untouched. |
| Spending | Magnitude of the sum of negative transactions in the selected calendar month for that household/category. Include archived accounts and categories; no account filter, no positive transactions, no all-time carryover. |
| Exact values | `spent` and `remaining = limitAmount - spent` are validated integer cents. `progress = spent / limitAmount` for positive limits, otherwise `null`. Do not clamp the returned ratio to 1. |
| State labels | Missing: “No budget”. Zero/no spending: “Zero budget — no spending”. Zero/with spending: “Over budget” plus exact overage, with no ratio. Positive/no spending: 0%. At the limit: “At budget”. Beyond the limit: percentage above 100% and “Over budget” plus exact overage. |
| Dashboard | Every configured selected-month budget, including zero limits, categories without spending and archived history. No budget widget data request beyond the existing dashboard GET. Empty overview says “No budgets for this month.” |
| Copy request | `POST /api/budgets/copy-previous` body `{ "year": 2026, "month": 9, "overwrite": false }`; body is strict and rejects extra fields. `overwrite` defaults to false. Response 200 is the full target-month `Budget[]`. |
| Copy collision | Eligible source = previous-month budgets of currently active expense categories in this household. If any eligible category already has a target budget, default request returns 409 and writes **nothing**, including otherwise-missing rows. This resolves the older roadmap's “copies missing” wording as all-or-nothing, not a silent skip/partial merge. |
| Copy confirmation | Only the copy-collision 409 carries `error.fields.overwrite`. Show source/target months and warn that matching current-month limits will be replaced. Confirm retries with `overwrite: true`; Cancel makes no write. Other 409s, including overflow, never trigger overwrite confirmation. |
| Overwrite | Atomically upsert eligible source limits; retain target-only budgets and all archived-category budgets. Copy limits, not IDs/timestamps, spending or remaining values. Re-read source/target inside the confirmed request transaction. |
| Calendar copy | January uses December of the previous year. At `0001-01`, disable Copy and return 422 if called directly. No source budgets is a successful no-op returning current target budgets. |
| Default/selection | Browser-local current month on entry, native labelled month input and Previous/Next buttons. Page-local selection only. Disable navigation at `0001-01`/`9999-12`. |
| Draft safety | One inline category editor at a time. Disable month changes, opening another editor and copy while it is open; Save or Cancel closes it. Do not claim a new global dirty-form guard: route-away unsaved drafts follow existing form behavior. |
| Pending safety | During PUT/DELETE/copy, synchronously set `PendingFormService`, block duplicate actions/month changes/cancel and route-away/sign-out. Clear pending on success/error; 401 remains interceptor-owned. Do not cancel a write merely because a read selection changes. |
| Refresh/error | Failed writes retain input and show associated errors. Successful writes announce success then reload categories and budgets. Refresh failure says the mutation succeeded but refresh failed; Retry performs only GETs. Never display old-month values under a new month or treat failure as an empty month. |

No new layout design is required: native month controls and existing responsive cards/forms cover this milestone. No visual companion or dependency is needed to resolve the above contracts. Actual desktop/phone visual inspection is still an implementation acceptance gate.

## 2. File Map and Ownership

| Task | Create | Modify |
|---|---|---|
| 1 — Persistence, API and dashboard reporting | `backend/migrations/versions/0005_budgets.py`, `backend/app/budgets.py`, `backend/tests/test_budgets.py` | `backend/app/models.py`, `schemas.py`, `main.py`, `dashboard.py`, `backend/tests/test_dashboard.py` |
| 2 — Budget editor and usage presentation | `frontend/src/app/features/budgets/budgets.service.ts`, `budgets.page.ts`, `budgets.page.spec.ts`, `budget-usage.ts` | `frontend/src/app/core/api/models.ts`, `app.routes.ts`, `layout/app-shell.ts`, `features/dashboard/dashboard.page.ts`, `features/dashboard/dashboard.page.spec.ts` under `frontend/src/app/` |
| 3 — Real integration and milestone evidence | `frontend/e2e/budgets.spec.ts` | `backend/scripts/seed_e2e.py`, `frontend/playwright.config.ts`; after proof, `README.md`, `state.md`, `docs/LUNA_HANDOFF.md` |

Tasks 1 and 2 can run concurrently against the fixed contract below; one owner per backend/frontend shared file. Task 3 integrates them. Concurrent workers skip formatters, linters, builds and tests until edits settle; the controller validates centrally. Inline execution is equally valid. No migration-only, scaffold-only or routing-only deliverable.

### Execution checkpoints

| Checkpoint | Deliverable before moving on | Acceptance gate |
|---|---|---|
| 5.1 — Backend | New migration, list/upsert/delete/copy, shared usage query and populated dashboard response | Lifecycle plus household, zero, archive, overflow, atomic-copy and snapshot checks pass against migrated disposable SQLite. |
| 5.2 — Frontend | Navigable Budgets page, explicit editor/confirmations and shared dashboard usage display | Form/state checks pass; zero versus missing, failed-save preservation, pending actions and confirmed overwrite work. |
| 5.3 — Integration | Actual desktop/phone workflows, migration-cycle and focused security/visual evidence | Integrated suites/build pass; M4 data survives the migration cycle; documentation records actual M5 results and any remaining gates. |

Default execution is 5.1 → 5.2 → 5.3 inline. If backend/frontend work is explicitly parallelized, freeze the JSON contract first, assign disjoint file ownership and defer validation until both owners settle. Integration still comes last. Do not rerun the unchanged M4 baseline merely to begin work; rerun affected checks after implementation.

## Task 1 — Budget Persistence, Mutations and Shared Reporting

**Consumes:** `HouseholdContext`, `require_household`, `get_db`, `Category`, `Transaction`, `get_category(db, category_id, household_id)`, `Cents`, `MAX_SAFE_CENTS`, `checked_cents`, `utc_now`, existing error handling and migrated test fixtures.

**Produces:** `Budget` model; Alembic revision `0005_budgets`; `BudgetWrite`, `BudgetCopyRequest`, `BudgetResponse`; `budgets.router`; `budget_rows(db: Session, household_id: int, year: int, month: int, *, category_id: int | None = None) -> list[BudgetResponse]`; four endpoints in the fixed behavior table; populated `DashboardResponse.budgets`.

- [ ] **1. Add model and matching migration.** Add this model to `backend/app/models.py` using existing imports. Migration `0005_budgets.py` revises `0004_transactions`, creates the same columns/constraints/index, and drops only its own index/table on downgrade. Use `sa.Column`, `sa.CheckConstraint`, `sa.UniqueConstraint` and `op.create_index` as in revision 0004; model and migration must agree. No changes to existing tables.

```python
class Budget(Base):
    __tablename__ = "budgets"
    __table_args__ = (
        UniqueConstraint(
            "household_id", "category_id", "year", "month",
            name="uq_budgets_household_category_period",
        ),
        CheckConstraint("typeof(year) = 'integer' AND year BETWEEN 1 AND 9999", name="ck_budgets_year"),
        CheckConstraint("typeof(month) = 'integer' AND month BETWEEN 1 AND 12", name="ck_budgets_month"),
        CheckConstraint("typeof(limit_amount) = 'integer'", name="ck_budgets_limit_integer"),
        CheckConstraint("limit_amount BETWEEN 0 AND 9007199254740991", name="ck_budgets_limit_range"),
        Index("ix_budgets_household_period", "household_id", "year", "month"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(Integer, ForeignKey("households.id", ondelete="RESTRICT"), nullable=False)
    category_id: Mapped[int] = mapped_column(Integer, ForeignKey("categories.id", ondelete="RESTRICT"), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    limit_amount: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)
```

The API enforces same-household category references and expense type before writes, matching transactions' existing application-boundary pattern. Foreign keys alone do not enforce that rule; include adversarial API coverage below. No triggers or cross-table schema redesign.

- [ ] **2. Define strict schemas before implementing routes.** Add to `backend/app/schemas.py` before `DashboardResponse`; then replace its empty-budget field with `budgets: list[BudgetResponse]` and explicitly supply it in the dashboard handler.

```python
class BudgetWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    limit_amount: Cents = Field(alias="limitAmount", ge=0)


class BudgetCopyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    year: int = Field(ge=1, le=9999)
    month: int = Field(ge=1, le=12)
    overwrite: bool = False


class BudgetResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    category_id: int = Field(alias="categoryId")
    category_name: str = Field(alias="categoryName")
    is_archived: bool = Field(alias="isArchived")
    year: int = Field(ge=1, le=9999)
    month: int = Field(ge=1, le=12)
    limit_amount: Cents = Field(alias="limitAmount", ge=0)
    spent: Cents = Field(ge=0)
    remaining: Cents
    progress: float | None = Field(ge=0, allow_inf_nan=False)
```

- [ ] **3. Add the exact observable lifecycle test in `backend/tests/test_budgets.py`.** Use the existing fixtures, not a new shared fixture framework:

```python
def test_budget_usage_zero_and_removal(authenticated_client, csrf_headers):
    client = authenticated_client

    def create(route, payload):
        result = client.post(route, json=payload, headers=csrf_headers())
        assert result.status_code == 201, result.text
        return result.json()

    account = create("/api/accounts", {"name": "Checking", "type": "checking", "initialBalance": 0})
    category = create("/api/categories", {"name": "Groceries", "type": "expense"})
    create("/api/transactions", {
        "accountId": account["id"], "categoryId": category["id"],
        "amount": -8472, "transactionDate": "2026-09-07",
    })
    params = {"year": 2026, "month": 9}
    route = f"/api/budgets/{category['id']}"
    assert client.get("/api/budgets", params=params).json() == []
    for limit, remaining, progress in [(60000, 51528, 0.1412), (8000, -472, 1.059), (0, -8472, None)]:
        response = client.put(route, params=params, json={"limitAmount": limit}, headers=csrf_headers())
        assert response.status_code == 200, response.text
        expected = {
            "categoryId": category["id"], "categoryName": "Groceries", "isArchived": False,
            "year": 2026, "month": 9, "limitAmount": limit,
            "spent": 8472, "remaining": remaining, "progress": progress,
        }
        assert response.json() == expected
        assert client.get("/api/budgets", params=params).json() == [expected]
        assert client.get("/api/dashboard", params=params).json()["budgets"] == [expected]
    assert client.delete(route, params=params, headers=csrf_headers()).status_code == 204
    assert client.get("/api/budgets", params=params).json() == []
    assert client.get("/api/dashboard", params=params).json()["summary"]["expenses"] == 8472
```

Run from `backend`: `python -m pytest tests/test_budgets.py -q` before route implementation; record the actual failing request. This guards missing versus zero, same-key upsert, exact remaining/ratio and deletion preserving spending.

- [ ] **4. Implement one shared usage query in `backend/app/budgets.py`.** Imports: `sqlite3`, `calendar.monthrange`, `datetime.date`; FastAPI `APIRouter`, `Depends`, `Path`, `Query`, `Response`; SQLAlchemy `and_`, `delete`, `func`, `select`, `text`; dialect `insert` from `sqlalchemy.dialects.sqlite`; `OperationalError`, `Session`; existing dependencies/models/schemas/money/error functions. Query only configured budgets; do not download transactions or issue one query per category.

```python
def budget_rows(db: Session, household_id: int, year: int, month: int, *, category_id: int | None = None) -> list[BudgetResponse]:
    first = date(year, month, 1)
    last = date(year, month, monthrange(year, month)[1])
    statement = (
        select(Budget.category_id, Category.name, Category.is_archived,
               Budget.limit_amount, func.coalesce(func.sum(Transaction.amount), 0))
        .select_from(Budget)
        .join(Category, and_(Category.id == Budget.category_id, Category.household_id == Budget.household_id))
        .outerjoin(Transaction, and_(
            Transaction.household_id == Budget.household_id,
            Transaction.category_id == Budget.category_id,
            Transaction.transaction_date.between(first, last),
            Transaction.amount < 0,
        ))
        .where(Budget.household_id == household_id, Budget.year == year,
               Budget.month == month, Category.type == "expense")
        .group_by(Budget.id, Budget.category_id, Category.name, Category.is_archived, Budget.limit_amount)
        .order_by(Category.name, Budget.category_id)
    )
    if category_id is not None:
        statement = statement.where(Budget.category_id == category_id)
    try:
        rows = db.execute(statement).all()
    except OperationalError as exc:
        if isinstance(exc.orig, sqlite3.OperationalError) and str(exc.orig) == "integer overflow":
            raise APIError(409, "CONFLICT", "The calculated amount exceeds the supported range.") from None
        raise
    result = []
    for id_, name, archived, limit, signed_spent in rows:
        limit = checked_cents(limit)
        spent = checked_cents(-signed_spent)
        result.append(BudgetResponse(
            category_id=id_, category_name=name, is_archived=archived,
            year=year, month=month, limit_amount=limit, spent=spent,
            remaining=checked_cents(limit - spent),
            progress=None if limit == 0 else spent / limit,
        ))
    return result
```

This helper does not begin/commit/rollback transactions. Its caller owns them. Negate the integer aggregate in Python, not via SQLite REAL/`TOTAL()` or `ABS()` fallback. Only translate real integer overflow; let unexpected database errors reach existing handling.

- [ ] **5. Implement list, PUT and DELETE with explicit transaction ownership.** `router = APIRouter(prefix="/api/budgets", tags=["budgets"])`. List takes required bounded `year`/`month`, household context and session, and returns `budget_rows(...)`. PUT takes `BudgetWrite` and `category_id: int = Path(gt=0)` plus the same period/context/session. DELETE uses the same path/query constraints and 204 response.

For PUT/DELETE/copy, put `db.execute(text("BEGIN IMMEDIATE"))`, financial lookup/validation, mutation, response construction and `db.commit()` inside one `try` block; an `except Exception` block calls `db.rollback()` and re-raises. Existing authentication performs only SELECTs; pysqlite does not physically begin a transaction for them. Acquiring the write transaction first prevents archive/copy/upsert decisions racing another writer. The disposable planning probe confirmed the SELECT-to-BEGIN assumption on the current runtime; recheck it if shared database/authentication configuration changes. Do not alter shared transaction configuration or add retries.

Inside PUT, scope the key and apply this core:

```python
household_id = context.household_id
category = get_category(db, category_id, household_id)
key = (
    Budget.household_id == household_id, Budget.category_id == category_id,
    Budget.year == year, Budget.month == month,
)
existing_id = db.scalar(select(Budget.id).where(*key))
if category.type != "expense":
    raise APIError(422, "VALIDATION_ERROR", "Only expense categories can have budgets.")
if category.is_archived and existing_id is None:
    raise APIError(409, "CONFLICT", "Cannot create a budget for an archived category.")
now = utc_now()
statement = insert(Budget).values(
    household_id=household_id, category_id=category_id, year=year, month=month,
    limit_amount=payload.limit_amount, created_at=now, updated_at=now,
)
db.execute(statement.on_conflict_do_update(
    index_elements=[Budget.household_id, Budget.category_id, Budget.year, Budget.month],
    set_={"limit_amount": statement.excluded.limit_amount, "updated_at": now},
))
response = budget_rows(db, household_id, year, month, category_id=category_id)[0]
```

Build the validated response **before** committing so a calculation failure rolls back the mutation rather than returning an error after saving. Commit, then return that response without a post-commit reporting query. SQL upsert preserves `created_at`; explicitly supply `updated_at` because SQL conflict updates do not apply the ORM `onupdate` automatically.

DELETE executes `delete(Budget).where(...)` with all four key predicates. If `rowcount == 0`, raise `APIError(404, "NOT_FOUND", "Resource not found.")`; otherwise commit and return `Response(status_code=204)`. Do not run usage calculation before removal: an overflowing budget must still be removable.

- [ ] **6. Implement atomic copy using current active source categories.** Route `POST /copy-previous`, strict `BudgetCopyRequest`, list response. At `(1, 1)` return 422 with `fields={"year": "There is no previous month before January 0001."}`. Otherwise derive the previous period without timestamps:

```python
source_year = payload.year - (1 if payload.month == 1 else 0)
source_month = 12 if payload.month == 1 else payload.month - 1
```

Inside the same `BEGIN IMMEDIATE`/commit/rollback boundary, use this core (the target is `payload.year`, `payload.month`):

```python
source = db.execute(
    select(Budget.category_id, Budget.limit_amount)
    .join(Category, and_(Category.id == Budget.category_id, Category.household_id == Budget.household_id))
    .where(Budget.household_id == context.household_id,
           Budget.year == source_year, Budget.month == source_month,
           Category.type == "expense", Category.is_archived.is_(False))
).all()
source_ids = {category_id for category_id, _ in source}
target_ids = set(db.scalars(select(Budget.category_id).where(
    Budget.household_id == context.household_id,
    Budget.year == payload.year, Budget.month == payload.month,
)))
if not payload.overwrite and source_ids & target_ids:
    raise APIError(409, "CONFLICT", "Some target-month budgets already exist.",
                   {"overwrite": "Confirm replacement of existing limits."})
now = utc_now()
for category_id, limit in source:
    statement = insert(Budget).values(
        household_id=context.household_id, category_id=category_id,
        year=payload.year, month=payload.month, limit_amount=limit,
        created_at=now, updated_at=now,
    )
    if payload.overwrite:
        statement = statement.on_conflict_do_update(
            index_elements=[Budget.household_id, Budget.category_id, Budget.year, Budget.month],
            set_={"limit_amount": statement.excluded.limit_amount, "updated_at": now},
        )
    db.execute(statement)
response = budget_rows(db, context.household_id, payload.year, payload.month)
```

Commit only after the response is validated. There is one short insert per configured source category, not per transaction; avoid a bulk framework. Empty source still returns the current target list. Neither conflicts nor response overflow may leave partial copies. No copy/delete action may affect another household.

- [ ] **7. Populate Dashboard and register the router.** Add `from .budgets import budget_rows` to `dashboard.py`, and add the following argument to its `DashboardResponse(...)` construction:

```python
budgets=budget_rows(db, household_id, year, month),
```

Keep the existing `BEGIN` and use the same `db`; never call the HTTP list handler internally. Update the snapshot comment so it no longer claims exactly four reads. Import/register `budgets_router` in `main.py` beside existing feature routers. No change to existing summary, ordering, balance or date behavior.

- [ ] **8. Cover the uncertain money/security/atomicity boundaries.** Extend `test_budgets.py` with focused tests for the rows below. Use real migrated SQLite and API requests; concurrency tests may coordinate a second actual connection, following `test_dashboard.py::test_queries_share_one_snapshot_despite_concurrent_write` rather than asserting SQL strings.

| Check | Observable assertions |
|---|---|
| No spending / at limit | Configured category without transactions returns spent 0, remaining equal to limit and progress 0 for positive limits / null for zero. Spend exactly the positive limit: remaining 0, progress 1. |
| Calendar and signs | September excludes Aug 31 and Oct 1; February 2028 includes Feb 29; December 9999 works. Spend across two accounts counts once. Other household and income-category transactions never contribute. |
| Input trust boundary | Negative, float, boolean, string, over-safe-integer and missing limits; extra `householdId`; invalid category ID; missing/invalid year/month; invalid/extra copy fields all reject with the established envelope. Exact `MAX_SAFE_CENTS` is accepted. |
| Household authorization | Anonymous budget operations reject; missing CSRF rejects writes; foreign/missing category PUT and budget DELETE have indistinguishable 404s. Same-household member sees and can modify the owner's budgets; another household cannot list/copy/delete/update them. |
| History | After account/category archive, budget spending remains. Existing archived-category limit can be corrected/deleted; missing archived-category budget cannot be created. Renaming an active category changes reported name without changing identity. |
| Uniqueness / races | Repeated and concurrent same-key PUTs leave one budget, never duplicate/500 due to unique collision; final limit equals one complete submitted value. Verify raw invalid month/limit and duplicate inserts fail on the migrated DB constraints. |
| Copy rollback | Previous month A=60000, B=20000; target A=8000, C=30000. Default copy returns 409 with overwrite field, A stays 8000, B is absent, C stays 30000. Confirmed copy yields A=60000, B=20000, C=30000, with target-month spending, not source spending. |
| Copy scope and calendar | January 2027 reads December 2026; `(1,1)` rejects; empty source changes nothing; zero limits copy; archived source categories are excluded; target-only/archived target rows survive; repeating confirmed copy leaves one row per category. A failed request rolls back every target change. |
| Range overflow | A category's aggregate above JS safe cents returns 409 without monetary payload; sum beyond SQLite integer range also returns 409. Unrelated household/month/unbudgeted-category overflow does not break the budget list. PUT/copy response overflow rolls back writes; DELETE still works. |
| Dashboard parity/snapshot | For the same stable period, dashboard budgets equal list budgets. Extend the existing real concurrent-write snapshot test with a configured budget: its usage sees the original transaction amount while a follow-up request sees the committed amount, just like the other dashboard sections. |

Keep M4 empty-budget assertions where their fixtures truly contain no budgets; do not delete valid empty-state coverage. In the snapshot test, create a limit of 1000 before the second-connection write and assert first budget spent=100/remaining=900/progress=0.1, follow-up spent=200/remaining=800/progress=0.2. Do not build new tests that merely pin error prose or helper wiring.

Run from `backend` after backend edits settle:

```text
python -m pytest tests/test_budgets.py tests/test_dashboard.py tests/test_authorization.py -q
```

**Task acceptance:** All four budget endpoints work end-to-end with authorization, exact usage, archived history, atomic copy and single-snapshot dashboard reporting. No exposed ORM objects or new financial log payloads.

## Task 2 — Usable Budgets Page and Shared Progress Display

**Consumes:** Existing `Category`, `DashboardPeriod`, category list service, money utilities, `PendingFormService`, auth/pending guards and the exact Task 1 JSON contract.

**Produces:** `Budget`, `BudgetWrite`, `BudgetCopyRequest` TypeScript types; `BudgetsService`; standalone `BudgetsPage` at `/budgets`; standalone `BudgetUsageComponent` with required `budget: Budget` input, used by both pages. No financial totals computed by Angular.

- [ ] **1. Add the frontend contract and thin HTTP service.** Add these interfaces to `core/api/models.ts`, and change `DashboardResponse.budgets` to `Budget[]`:

```typescript
export interface Budget {
  categoryId: number;
  categoryName: string;
  isArchived: boolean;
  year: number;
  month: number;
  limitAmount: number;
  spent: number;
  remaining: number;
  progress: number | null;
}
export interface BudgetWrite { limitAmount: number; }
export interface BudgetCopyRequest { year: number; month: number; overwrite: boolean; }
```

`budgets.service.ts` follows existing injected `HttpClient` services:

```typescript
import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable } from "rxjs";
import { Budget, BudgetCopyRequest, BudgetWrite, DashboardPeriod } from "../../core/api/models";

@Injectable({ providedIn: "root" })
export class BudgetsService {
  private readonly http = inject(HttpClient);
  list(period: DashboardPeriod): Observable<Budget[]> {
    return this.http.get<Budget[]>("/api/budgets", { params: { year: period.year, month: period.month } });
  }
  upsert(categoryId: number, period: DashboardPeriod, payload: BudgetWrite): Observable<Budget> {
    return this.http.put<Budget>(`/api/budgets/${categoryId}`, payload, { params: { year: period.year, month: period.month } });
  }
  remove(categoryId: number, period: DashboardPeriod): Observable<void> {
    return this.http.delete<void>(`/api/budgets/${categoryId}`, { params: { year: period.year, month: period.month } });
  }
  copyPrevious(payload: BudgetCopyRequest): Observable<Budget[]> {
    return this.http.post<Budget[]>("/api/budgets/copy-previous", payload);
  }
}
```

- [ ] **2. Implement the shared usage display in `budget-usage.ts`.** Use Angular `Component` and `input`, native `Intl.NumberFormat`, existing `formatMoney`, and `Budget`. No progress-bar library, Angular locale registration or client ratio calculation is necessary; a text percentage satisfies the spec's examples and remains truthful above 100%.

```typescript
import { Component, input } from "@angular/core";
import { Budget } from "../../core/api/models";
import { formatMoney } from "../../shared/utilities/money";

const budgetPercentFormatter = new Intl.NumberFormat("de-DE", {
  style: "percent", maximumFractionDigits: 2,
});

@Component({
  selector: "app-budget-usage",
  standalone: true,
  template: `
    <p>Spent {{ formatMoney(budget().spent) }} / Limit {{ formatMoney(budget().limitAmount) }}</p>
    @let progress = budget().progress;
    @if (progress !== null) {
      <p>{{ formatProgress(progress) }}</p>
    }
    @if (budget().remaining < 0) {
      <p><strong>Over budget</strong> by {{ formatMoney(-budget().remaining) }}</p>
    } @else if (budget().limitAmount === 0) {
      <p>Zero budget — no spending</p>
    } @else if (budget().remaining === 0) {
      <p>At budget</p>
    } @else {
      <p>Remaining {{ formatMoney(budget().remaining) }}</p>
    }
  `,
})
export class BudgetUsageComponent {
  readonly budget = input.required<Budget>();
  readonly formatMoney = formatMoney;
  readonly formatProgress = budgetPercentFormatter.format;
}
```

This follows the existing money formatter's native `Intl` convention. It formats the server ratio only, never computes or rounds money. Display exact spent/limit alongside rounded percentage so near-limit rounding cannot hide the textual status.

- [ ] **3. Implement the month-scoped editor state in `budgets.page.ts`.** Use standalone reactive forms and signals, with the same RxJS `Subject` → `switchMap` → inner `catchError`/`startWith` → `takeUntilDestroyed` pattern as Dashboard. Within each request, `forkJoin` the active category list and `budgetsService.list(period)`. Merge after both succeed; failure of either makes the page an error, not a partial editable list.

```typescript
type BudgetEditorRow = {
  categoryId: number;
  categoryName: string;
  isArchived: boolean;
  budget: Budget | null;
};
type BudgetsState =
  | { kind: "loading" }
  | { kind: "ready"; rows: BudgetEditorRow[] }
  | { kind: "error"; message: string };

// Run inside the successful forkJoin mapping; preserve budget-only rows if
// archive happened between the two reads. The backend remains authoritative.
const rows = new Map<number, BudgetEditorRow>();
for (const category of categories) {
  if (category.type === "expense") rows.set(category.id, {
    categoryId: category.id, categoryName: category.name,
    isArchived: category.isArchived, budget: null,
  });
}
for (const budget of budgets) rows.set(budget.categoryId, {
  categoryId: budget.categoryId, categoryName: budget.categoryName,
  isArchived: budget.isArchived, budget,
});
const editorRows = [...rows.values()].sort((a, b) =>
  (a.categoryName < b.categoryName ? -1 : a.categoryName > b.categoryName ? 1 : 0)
  || a.categoryId - b.categoryId,
);
```

Use selected month and bounded navigation code from Dashboard without extracting a global period service. The page methods are `selectMonth(value: string): void`, `moveMonth(delta: -1 | 1): void`, `retry(): void`, `startEdit(row: BudgetEditorRow): void`, `cancelEdit(): void`, `save(): void`, `beginRemove(row: BudgetEditorRow): void`, `confirmRemove(): void`, `cancelRemove(): void`, `copyPrevious(overwrite = false): void`, `cancelCopy(): void`.

The editor uses one non-nullable string control named `limitAmount`. Existing budget prefill is `moneyInput(row.budget.limitAmount)`; missing budget prefill is empty, not zero. Save marks it touched and calls `parseMoney`. Its failure branch is:

```typescript
const limitAmount = parseMoney(this.form.controls.limitAmount.value);
if (limitAmount === null) {
  this.form.controls.limitAmount.setErrors({ money: true });
  return;
}
```

Accept `0`, `600`, `600.00` and `600,00`; reject negatives, blank, grouping, exponent, excess decimals and amounts above safe cents. Use `type="text" inputmode="decimal"`, not a floating-point `valueAsNumber`. Map server `fields.limitAmount` to the field error. Call the service with the captured category ID, captured period and integer amount; never use a later month selection in the completion callback.

- [ ] **4. Render and wire explicit actions.** Use a semantic list of category cards within `<section aria-labelledby="budgets-title">`, a labelled native `Month` input and Previous/Next controls. Each card has a category heading, optional Archived text, `No budget` or `<app-budget-usage [budget]="..." />`, and Set/Edit limit plus Remove budget for configured rows. One inline form has a category-specific heading and labelled `Monthly limit (EUR)` input, `aria-invalid`, associated error element, Save budget and Cancel buttons. Keep styles consistent with existing max-width 52rem cards, wrapping content and 2.75rem controls.

No active categories and no history: say there are no expense categories and link to `/categories`. If only archived budgets exist, render them rather than hiding the page. Avoid treating `limitAmount === 0` as missing in any conditional.

Removal uses an inline confirmation describing the selected category/month and that transactions remain. Focus confirmation on opening; Cancel restores the trigger; completion returns focus to that row's Set limit button after reload. Copy collision uses a separate inline confirmation with source/target months, Confirm overwrite and Cancel. Disable unrelated local operations while a confirmation is open. Keep selected period stable through confirmation; cancel does not issue a request.

Use `PendingFormService.setPending(true)` synchronously before each write subscription and clear it with `finalize` on completion/error. Keep a local pending indicator only where needed to label/disable the active operation. For `copyPrevious(false)`, show the overwrite prompt only when the error is `HttpErrorResponse`, status 409 and `error.error?.error?.fields?.overwrite` is a string. All other failures render the server/network error normally.

After a successful operation, close editor/confirmation, announce the outcome and request fresh data. Preserve that success announcement if the reload fails, with Retry restricted to fetching. Keep form values on failed saves. Latest GET wins, but write requests are not driven through the read `switchMap`. Prevent handler-level duplicate saves/removes/copy and month changes, not only disabled buttons.

- [ ] **5. Integrate protected routing and Dashboard.** Import/register `BudgetsPage` as a child with the same `authGuard` and `pendingFormGuard` as Categories. Add the Budgets navigation link with `routerLinkActive` and `ariaCurrentWhenActive="page"`. Generalize shell's existing pending-operation message to cover saves, removals and copies without weakening the guard.

In Dashboard, import `BudgetUsageComponent` and insert this section inside the existing ready branch, before Spending by category:

```html
<section aria-labelledby="budget-overview-title">
  <h3 id="budget-overview-title">Budget overview</h3>
  @if (view.data.budgets.length === 0) {
    <p>No budgets for this month.</p>
  } @else {
    <ul class="cards" aria-label="Budget overview">
      @for (budget of view.data.budgets; track budget.categoryId) {
        <li>
          <h4>{{ budget.categoryName }}</h4>
          @if (budget.isArchived) { <p>Archived category</p> }
          <app-budget-usage [budget]="budget" />
        </li>
      }
    </ul>
  }
</section>
```

Do not add a dashboard request to `BudgetsService`. Leaving and returning to Dashboard refetches through its existing lifecycle; no cross-page cache invalidation/store is needed.

- [ ] **6. Add focused form/state tests and extend dashboard rendering tests.** Use existing `TestBed`, `provideHttpClientTesting`, `HttpTestingController` and DOM events in `budgets.page.spec.ts`; reuse project runner. Test actual form submission/rendering, not service forwarding. The following budget payloads are shared contract oracles:

```typescript
const baseBudget = {
  categoryId: 3, categoryName: "Groceries", isArchived: false,
  year: 2026, month: 9, limitAmount: 60000, spent: 8472,
  remaining: 51528, progress: 0.1412,
};
const zeroBudget = { ...baseBudget, limitAmount: 0, remaining: -8472, progress: null };
const overBudget = { ...baseBudget, limitAmount: 8000, remaining: -472, progress: 1.059 };
```

Cover these distinct plausible failures:

- Active expense category without budget is visible as No budget; income category is absent. Zero budget renders configured state and Remove, not No budget.
- Submit `600,00`: the outgoing PUT has integer `limitAmount: 60000` and the captured selected period. Invalid input issues no PUT and exposes a labelled error. A failed save retains the entered value.
- Pending write blocks duplicate requests, local month changes and existing pending navigation; resolves on success/error. Mutation success plus failed refresh retains explicit success and Retry issues GET only.
- Default copy collision makes no automatic overwrite request. Cancel makes none; explicit Confirm sends `overwrite: true` for the same target. An overflow 409 does not show the overwrite prompt.
- Removal requires confirmation and clears the configured state after reload; zero is not removal.
- Local default month, January rollover and `0001-01` copy disabled. A later GET selection cancels earlier GETs; loading/error never renders old budget cards or false No budget states. Failure of categories or budgets makes the load fail.
- Dashboard ready payload with `overBudget` renders category, exact spent/limit/overage, percentage above 100% and Over budget. With `zeroBudget`, exact overage and Over budget remain, but no NaN/Infinity/percentage is rendered. With zero/no spending, show the explicit zero state. Include one archived/no-spending configured budget to prove neither is filtered out.

For these dashboard payload assertions, extend the existing `dashboard.page.spec.ts` using its fixture setup; no separate component-test suite is necessary. A representative assertion block after flushing `overBudget` is:

```typescript
fixture.detectChanges();
const overview = fixture.nativeElement.querySelector('[aria-label="Budget overview"]') as HTMLElement;
expect(overview.textContent).toContain("84,72");
expect(overview.textContent).toContain("80,00");
expect(overview.textContent).toContain("4,72");
expect(overview.textContent).toContain("105,9");
expect(overview.textContent).toContain("Over budget");
```

Run from `frontend` after frontend edits settle:

```text
npm test -- --watch=false --include=src/app/features/budgets/budgets.page.spec.ts --include=src/app/features/dashboard/dashboard.page.spec.ts
npm run build
```

**Task acceptance:** A household member can manage every active expense category's selected-month limit, distinguish missing/zero, correct archived history, remove explicitly and copy without accidental replacement. Dashboard renders the same backend-calculated usage with keyboard-accessible, non-color status cues.

## Task 3 — Real Integration, Migration Safety and Milestone Gate

**Consumes:** Completed Tasks 1–2 and the existing Playwright-owned database/seed/teardown harness.

**Produces:** `frontend/e2e/budgets.spec.ts`, migration-cycle evidence, desktop/phone visual evidence and accurate milestone documentation. No production changes.

- [ ] **1. Add isolated generated browser identities.** Extend `playwright.config.ts` with `BUDGET_E2E_BUDGETS_PASSWORD`, generated using the existing `randomBytes(24).toString("base64url")` pattern, and forward as `E2E_BUDGETS_PASSWORD` to the seed process. Add `e2e-budgets-1280` / `e2e-budgets-390` users, each in its own household, in `seed_e2e.py` using the existing dashboard-user construction pattern. Do not reuse dashboard identities, fixed passwords or real databases.

On browser retries, clean only the scenario household: explicitly delete that household's budgets for the months exercised, delete its transactions, archive its active accounts/categories, then use unique new names. Use authenticated CSRF-protected APIs as the current dashboard harness does. Never introduce a global reset endpoint. Keep teardown ownership-marker checks unchanged.

- [ ] **2. Exercise the real budgets workflow at 1280×900 and 390×844.** Use `Pacific/Kiritimati` and browser clock `2026-08-31T12:30:00Z`, matching M4's local-September/UTC-August boundary. Set up/login with the scenario's generated identity. Use the UI for the main account/category/expense and budget workflows; API setup is permitted only for supplemental copy/archive fixtures.

Ordered acceptance scenario:

1. Login; create Checking, Groceries expense, Restaurants expense and Salary income categories; enter a Groceries expense `84.72` on `2026-09-07`.
2. Open Budgets via the real shell link; Month defaults to `2026-09`. Both expense categories show No budget and Salary is absent.
3. Set Groceries limit `600,00`; verify exact `84,72 €` spent, `600,00 €` limit, `515,28 €` remaining and `14,12%` (allow locale spacing). Restaurants still shows No budget.
4. Go to Dashboard; assert the same budget values alongside the existing expense total. Reload and verify persistence, then return to Budgets.
5. Edit Groceries to `80.00`; assert `4,72 €` overage and `105,9%` plus Over budget on both surfaces. Set `0`; assert configured zero limit, exact `84,72 €` overage, no undefined ratio. Set Restaurants to zero without spending and verify Zero budget — no spending.
6. Cancel a Remove confirmation and verify unchanged state; confirm removal of Groceries and verify No budget while dashboard expenses remain `84,72 €`.
7. Seed previous-month active limits A=60000/B=20000 and current A=8000/C=30000, using the scenario's expense categories. Copy previous: 409 leaves A unchanged and B missing. Cancel changes nothing. Repeat and Confirm overwrite: A=60000/B=20000/C=30000. Assert target-month spending, not copied source usage.
8. Exercise December/January copy, then archive one configured source category: historical selected-month budget remains visible, and copying it to the next month excludes it. Reload preserves results.
9. Complete a save and copy confirmation using keyboard. Delay a real write response and verify local controls/navigation/sign-out cannot leave or duplicate the pending operation; release the real request and verify recovery.
10. Delay a real GET to capture loading; use offline mode for a real load failure, verify old cards/false empty state are absent, restore network and Retry to a confirmed ready state. Capture the resulting screen, not just the absence of a spinner.
11. Sign out; direct `/budgets` and `/dashboard` access require login and do not expose financial DOM. Also exercise expired-session redirect during a budget request using the existing expired-session token mechanism.

Use accessible card/list locators scoped by category name, not document-wide text assertions that might pass on an unrelated dashboard section. Synchronize with completed real responses and visible ready values, not sleeps. Keep pure no-source/year-boundary/overflow breadth in backend tests rather than duplicating every case in browsers.

Run from `frontend`:

```text
npx playwright test e2e/budgets.spec.ts e2e/dashboard.spec.ts e2e/auth.spec.ts
```

- [ ] **3. Prove migration safety on a disposable SQLite database.** Use a throwaway script with `TemporaryDirectory`, explicitly set its `DATABASE_URL` before importing app modules, and run Alembic through `command.upgrade` / `command.downgrade`. Never point downgrade commands at the normal development database.

Sequence (all data stays in the explicitly temporary database):

1. Upgrade to `0004_transactions`; seed one household/user/account/category and a September `-8472` transaction with account initial balance `100000`. Use direct exact SQL to record balance `91528` and expenses `8472`, along with the seeded row IDs/counts.
2. Upgrade to `0005_budgets`; verify prior rows/values survive. With the M5 application and matching schema, authenticate, check the dashboard baseline, create limit `60000` through the API and verify remaining `51528`.
3. Close application sessions/connections before downgrading to `0004_transactions`. Verify through direct SQL that the budgets table is gone and the original household/user/account/category/transaction rows, balance `91528` and expenses `8472` remain.
4. Re-upgrade to `0005_budgets`; verify the budgets table is empty and M4 data is unchanged. Reopen the application and verify Dashboard returns its original totals with an empty budgets list.
5. Separately prove empty database → head. Print revision, table presence, preserved IDs/counts and exact amounts at each stage; retain actual command/output evidence, then remove only the throwaway script/database.

Never call the M5 Dashboard against `0004_transactions`, either before the first upgrade or after downgrade: its reporting query requires the budgets table. Direct SQL is the historical-schema oracle; the authenticated API is the current-schema oracle. Downgrade intentionally discards newly created budgets only; it is a migration safety check, not a production rollback or backup procedure.

- [ ] **4. Inspect the actual UI and run final integrated checks.** Start the real application against disposable data using the existing runtime tools. Inspect desktop and phone budget editor/confirmations and dashboard overview, including ready, zero, over-budget, empty, loading and failure states. Open captured screenshots or view the actual browser; screenshot creation and overflow assertions alone are not pixel-level visual inspection. Confirm no horizontal overflow, readable labels/amounts, visible keyboard focus, associated errors and non-color over-budget cues. If visual inspection is unavailable, record that exact limitation rather than claiming it passed.

After all edits settle, run once from the indicated directories:

```text
# backend
python -m pytest

# frontend
npm test -- --watch=false
npm run build
npx playwright test
```

Review budget-specific authorization and mutation paths for household scoping, CSRF, archive races, atomic copy, rollback-before-error and finite exact output. Do not infer those checks from compilation. Resolve failures and record actual commands/results, not predicted test counts.

- [ ] **5. Update milestone documentation only after proof.** Update `README.md` with the budgets API/body/status contracts, selected-month editor behavior, missing/zero/removal, archive corrections, copy collision/confirmation and new migration head. Update `state.md` with M5 implementation status, actual focused/integrated/migration/browser evidence and retained visual limitations. Update the current `docs/LUNA_HANDOFF.md` to point to this plan and report the verified M5 boundary, without rewriting historical plans or `docs/LUNA_M3_HANDOFF.md` / `docs/LUNA_M4_HANDOFF.md`.

Do not mark M5 completed if required functionality is missing. If a verification surface is unavailable, record it explicitly. Stop before M6 settings/export/operations; request user review. Remove throwaway scripts/generated artifacts belonging to this work, not retained regression tests or unrelated user files.

**Task acceptance:** Real UI → authenticated API → migrated SQLite → Dashboard behavior is proven at both viewport sizes; migration retains M4 data; final checks and any remaining limitations are recorded accurately.

## 3. Requirement Coverage and Review Gate

| Requirement | Implementation / proof |
|---|---|
| §13 persistence, uniqueness, expense-only, zero/over/no-spending math | Task 1 steps 1–5 and 8 |
| §18 all active expense categories and selected-month editing | Task 2 steps 3–4; Task 3 workflow |
| Monthly CRUD and distinct removal | Task 1 step 5; Task 2 step 4; lifecycle test |
| §18/§22.6 previous-month copy with confirmation | Task 1 step 6; Task 2 step 4; Task 3 conflict/cancel/overwrite flow |
| §14.2 every configured dashboard budget | Task 1 step 7; Task 2 steps 2 and 5; dashboard parity/snapshot tests |
| Household security, authoritative validation, exact cents | Global constraints and Task 1 boundary matrix |
| Calendar bounds and archived history | Fixed behavior table; Task 1 boundary matrix; Task 3 rollover/archive flow |
| §39 accessibility and phone usability | Task 2 presentation/actions; Task 3 keyboard and visual inspection |
| §42 required money/auth/form/E2E coverage | All three task verification gates |
| M4 preservation, migration and evidence | Task 1 snapshot regression; Task 3 migration/final checks/docs |

Plan self-review: every M5 deliverable has a task and observable acceptance check; copy is included rather than silently deferred; GET/PUT/copy/Dashboard share the same `BudgetResponse`/`Budget` fields; missing and zero remain distinct; no financial calculation is moved to the browser; write responses are validated before commit; read snapshot ownership stays with Dashboard.

**Execution handoff:** Review and approve this plan before implementation. Then execute inline, or use separate backend/frontend owners concurrently against the fixed contract, followed by one integration owner. Do not start M6, commit, push or deploy as part of approving the M5 implementation plan.
