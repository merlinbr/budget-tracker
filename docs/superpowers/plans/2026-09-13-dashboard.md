# Milestone 4 — Selected-Month Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the authenticated identity landing page with an exact-cent, household-scoped dashboard showing the selected month's income, expenses, net, category spending and ten recent transactions, alongside all-time active-account balance.

**Architecture:** Add one read-only FastAPI feature router over existing accounts/categories/transactions. Return one complete dashboard response; Angular renders server-calculated totals using the existing money formatter and latest-request-wins loading pattern. Keep the existing protected route and shell, and use a sorted spending list rather than charts.

**Tech Stack:** Existing Angular 22 / RxJS / TypeScript frontend, FastAPI / Pydantic / SQLAlchemy / SQLite backend, pytest, Vitest and Playwright. No new dependencies or database migration.

## Global Constraints

Source of truth: `BUDGET_TRACKER_MVP_SPEC.md`, especially §§7.7, 9–12, 14, 21, 22.2, 23, 25, 33, 35–39, 42–44. This expands Task 4.1 of `docs/superpowers/plans/2026-09-07-budget-tracker-mvp.md`; it does not replace the product specification.

- “Money must **never** use binary floating-point storage.” Use integer EUR cents throughout; every returned monetary value must be within `±9007199254740991`.
- “Every household-data query must be scoped using the authenticated user's household membership.” Never accept household identity from the browser.
- “Transaction dates are calendar dates, not timestamps.” Preserve `YYYY-MM-DD` values; use the browser's local calendar month for the default selection.
- “Month must be 1–12.” Keep the implemented transaction API's year range `1–9999`.
- “The dashboard is the default authenticated route.” Preserve `/dashboard`, auth restoration, 401 recovery, guarded navigation and sign-out.
- “Keep visualizations simple.” Native controls, semantic HTML, existing styles and sorted text lists; no chart/date/state-management dependency.
- Labels, keyboard operation, associated input errors, visible focus, contrast and readable monetary text are required; color is supplementary.
- Use existing disposable migrated pytest fixtures and Playwright-owned temporary databases/generated credentials. Never reset/downgrade `data/budget.db`, overwrite `.env`, seed real financial data or modify deployment for this milestone.
- M5 owns budgets and budget progress. M6 owns settings/export/operations/release readiness. No transfers, imports, recurrence, pagination, caching, global period store or unrelated hardening in M4.

---

## 1. Starting Point and Decisions

The user reports M3 implemented and asks to plan M4. Accept M3 as the prerequisite; do not re-run its checks to challenge that report. `state.md` records 89 backend tests, 30 frontend tests, production build and 8 browser scenarios passing, with transaction loading/failure visual rendering still unverified. These are historical recorded results, not checks performed while writing this plan. Planning M4 does not implement it or mark it complete.

### Inspected integration points

| File / symbol | Existing behavior and planned reuse |
|---|---|
| `backend/app/accounts.py::_balance_query`, `_execute_balance_query`, `account_response` | Household/account-filtered SQL aggregation, SQLite integer-overflow handling and exact per-account balance validation. Reuse for active-account balances rather than duplicating the balance formula. These are internal module helpers, not HTTP calls. |
| `backend/app/transactions.py::TransactionFilters`, `list_transactions` | Years 1–9999, inclusive first/last calendar-date bounds, order by transaction date / created-at / ID descending. Follow these semantics without calling the unbounded list endpoint or changing M3 filtering. |
| `backend/app/money.py::Cents`, `checked_cents` | Strict integer schema and 409 `CONFLICT` on out-of-range calculations. Reuse; make the shared validation message refer to a calculated amount rather than only balance. |
| `backend/app/models.py::Account`, `Category`, `Transaction` | All required storage and household/date indexes exist in revision `0004_transactions`. No M4 persistence is necessary. |
| `backend/app/schemas.py`, `main.py` | Explicit camelCase response aliases and direct feature router registration. |
| `frontend/src/app/features/dashboard/dashboard.page.ts::DashboardPage` | Existing identity-only page; replace its content in place, not a second dashboard route. |
| `frontend/src/app/features/transactions/transactions.page.ts` | RxJS `switchMap`, inner `catchError`, `startWith`, and `takeUntilDestroyed` already implement cancellable request states. Reuse this pattern with one discriminated state, not its several redundant flags. |
| `frontend/src/app/shared/utilities/money.ts` | `formatMoney(number)` preserves exact cents even near the safe-integer boundary; `localToday()` uses local calendar fields. |
| `frontend/src/app/core/api/models.ts` | Add dashboard types alongside existing financial types. |
| `frontend/src/app/app.routes.ts`, `layout/app-shell.ts` | Dashboard child, auth/pending guards, navigation and sign-out already exist. Leave route configuration intact. Add a compact authenticated user/household line to the existing shell when removing the landing identity card. |
| `frontend/e2e/auth.spec.ts` | Two assertions pin the obsolete welcome heading. Remove those wording assertions; retain actual login/restoration/logout/guard coverage and verify authenticated identity independently of a welcome heading. |
| `backend/tests/conftest.py`, `frontend/playwright.config.ts` | Reuse authenticated client, session, CSRF and migrated temporary DB fixtures; existing browser tests share one household/database across files. Exact dashboard totals need isolated scenario credentials, described in Task 3. |

Before editing existing exported symbols, inspect their LSP references where available; otherwise inspect all callers. Do not rename routes, account helpers or money APIs merely for M4. Re-read files if intervening work has changed them.

### Alternatives and chosen scope

1. **Recommended: one aggregate endpoint, page-local month selection, sorted spending list.** Matches the existing roadmap and avoids downloading all transaction history or duplicating financial rules in Angular.
2. **Client aggregation through existing list APIs.** Fewer backend files, but unbounded history downloads, multiple lookup requests and duplicated exact-cent/authorization-sensitive reporting logic. Reject.
3. **Chart library plus shared cross-page month state.** More dependencies and coupling without a requirement. Defer until actual dashboard use demonstrates a need.

### Fixed reporting rules

| Concern | Decision |
|---|---|
| Request | `GET /api/dashboard?year=2026&month=9`; both parameters required. Missing/out-of-range/unparseable values return existing 422 error envelope; no server-local default. |
| Month bounds | Inclusive `date(year, month, 1)` through `date(year, month, monthrange(year, month)[1])`, matching M3's actual DATE implementation. This deliberately supersedes the older roadmap's exclusive-next-month recipe: equivalent for DATE columns and safe for December 9999. |
| Current balance | Sum current balances of non-archived household accounts; includes initial balances and every transaction date, including future-dated entries, exactly like Accounts. Independent of selected month. Validate each account balance and the final combined balance. |
| Monthly activity | All household transactions in that calendar month, including archived accounts/categories. Income = sum of positive amounts; expenses = magnitude of sum of negative amounts; net = income minus expenses. |
| Category spending | Only negative transactions, grouped by category ID/name, positive totals, descending total then category ID ascending for ties. Categories with no spending are omitted; never merge distinct categories by name. |
| Recent history | At most 10 selected-month rows ordered by `transaction_date DESC, created_at DESC, id DESC`. Include current account/category names even when archived. Not the latest 10 across all time. |
| Names | Return names directly with recent rows and category spending. Join by both ID and household. Render by interpolation, never HTML; no extra account/category requests from Dashboard. |
| No activity | Monthly totals zero, lists empty; balance can remain nonzero. An income-only month has no category spending but still has recent transactions. |
| Budgets | Return `budgets: []` as the established response contract. No empty budget widget, unavailable budget link or budget model/migration; M5 will populate and type this field. |
| Overflow | Reject the entire response with 409 `CONFLICT`; no rounded value, partial cards or `TOTAL()`/REAL fallback. Translate only genuine SQLite integer-overflow errors; do not mask other DB exceptions. Filter unrelated households and archived balance accounts before SQL aggregation. |
| Selection | Native labelled month input plus Previous month / Next month buttons. Default local current month on page creation; no URL persistence or cross-page synchronization in M4. Valid range `0001-01` through `9999-12`. |
| Loading/error | Replace previous data with loading state when selection changes. Error is not zero/empty data. Keep selection and show explicit Retry; latest request wins. Existing interceptor owns 401 recovery. |

## 2. File Map and Execution Order

| Task | Create | Modify | Intentionally unchanged |
|---|---|---|---|
| 1 — Read-only reporting API | `backend/app/dashboard.py`, `backend/tests/test_dashboard.py` | `backend/app/schemas.py`, `backend/app/main.py`, `backend/app/money.py` (generic error wording only) | Models, migrations, accounts/transactions behavior and authentication |
| 2 — Usable dashboard page | `frontend/src/app/features/dashboard/dashboard.service.ts`, `dashboard.page.spec.ts` in the same folder | `dashboard.page.ts`, `frontend/src/app/core/api/models.ts`, `frontend/src/app/layout/app-shell.ts`, `frontend/e2e/auth.spec.ts` | Routes, transaction filters/forms, shared money utilities, dependencies |
| 3 — Real integration and milestone gate | `frontend/e2e/dashboard.spec.ts` | `backend/scripts/seed_e2e.py`, `frontend/playwright.config.ts` only to add isolated dashboard test identities; after proof: `README.md`, `state.md`, `docs/LUNA_HANDOFF.md` | Historical milestone plans/handoffs and product spec |

Tasks 1 and 2 may run concurrently against the contract below, with separate backend/frontend owners. Task 2 owns shared frontend types and shell; Task 3 owns browser harness additions. Concurrent workers skip all builds/tests/linters until their edits settle; controller then runs validation centrally. Inline execution is equally suitable. No routing-only or scaffold-only task.

## Task 1 — Household-Scoped Dashboard API

**Files:** Backend files in Task 1 above.

**Consumes:** `require_household -> HouseholdContext`, `get_db -> Session`, existing `Account`, `Category`, `Transaction`, `Cents`, `checked_cents(value: int) -> int`, account balance helpers listed above.

**Produces:** `dashboard.router`, `GET /api/dashboard`, and response schemas/types below. No write endpoint.

- [ ] **1. Add the response contract to existing schema modules.** Pydantic definitions in `backend/app/schemas.py`:

```python
class DashboardPeriod(BaseModel):
    year: int = Field(ge=1, le=9999)
    month: int = Field(ge=1, le=12)


class DashboardSummary(BaseModel):
    balance: Cents
    income: Cents
    expenses: Cents
    net: Cents


class DashboardSpending(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    category_id: int = Field(alias="categoryId")
    category_name: str = Field(alias="categoryName")
    spent: Cents


class DashboardTransaction(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: int
    account_id: int = Field(alias="accountId")
    account_name: str = Field(alias="accountName")
    category_id: int = Field(alias="categoryId")
    category_name: str = Field(alias="categoryName")
    amount: Cents
    description: str | None
    transaction_date: date = Field(alias="transactionDate")


class DashboardResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    period: DashboardPeriod
    summary: DashboardSummary
    budgets: list[dict[str, object]] = Field(default_factory=list, max_length=0)
    spending_by_category: list[DashboardSpending] = Field(alias="spendingByCategory")
    recent_transactions: list[DashboardTransaction] = Field(alias="recentTransactions")
```

Use the existing `date` import in schemas; do not add a duplicate. The M4 empty-budget bound is intentional; M5 replaces it with its actual response schema. No user IDs, household IDs, creator data or ORM relationships leak through serialization.

- [ ] **2. Write a failing exact-total API check in `backend/tests/test_dashboard.py`.** Reuse `authenticated_client`, `csrf_headers`; no new shared fixture architecture:

```python
def test_selected_month_keeps_all_time_balance(authenticated_client, csrf_headers):
    client = authenticated_client

    def create(path, body):
        response = client.post(path, json=body, headers=csrf_headers())
        assert response.status_code == 201, response.text
        return response.json()

    account = create("/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 100000,
    })
    salary = create("/api/categories", {"name": "Salary", "type": "income"})
    groceries = create("/api/categories", {"name": "Groceries", "type": "expense"})
    subscriptions = create("/api/categories", {"name": "Subscriptions", "type": "expense"})
    for amount, category, day, description in [
        (350000, salary, "2026-09-07", "Salary"),
        (-8472, groceries, "2026-09-07", "REWE"),
        (-1799, subscriptions, "2026-10-01", "Netflix"),
    ]:
        create("/api/transactions", {
            "accountId": account["id"], "categoryId": category["id"],
            "amount": amount, "transactionDate": day, "description": description,
        })

    response = client.get("/api/dashboard", params={"year": 2026, "month": 9})
    assert response.status_code == 200, response.text
    september = response.json()
    assert september["summary"] == {
        "balance": 439729, "income": 350000, "expenses": 8472, "net": 341528,
    }
    assert september["period"] == {"year": 2026, "month": 9}
    assert september["spendingByCategory"] == [{
        "categoryId": groceries["id"], "categoryName": "Groceries", "spent": 8472,
    }]
    assert {row["description"] for row in september["recentTransactions"]} == {"Salary", "REWE"}
    assert all(row["accountName"] == "Checking" for row in september["recentTransactions"])
    assert september["budgets"] == []

    october = client.get("/api/dashboard", params={"year": 2026, "month": 10}).json()
    assert october["summary"] == {
        "balance": 439729, "income": 0, "expenses": 1799, "net": -1799,
    }
    assert [row["description"] for row in october["recentTransactions"]] == ["Netflix"]
```

Run from `backend`: `python -m pytest tests/test_dashboard.py -q`. Before route implementation, expect the new dashboard request to fail with 404; record the actual result, not an assumed failure.

- [ ] **3. Implement SQL reporting in `backend/app/dashboard.py`.** Use this complete core; query count is constant rather than one query per account/category. Balance aggregation remains the existing implementation, while monthly rows are aggregated in SQL and only ten detail rows are materialized.

```python
import sqlite3
from calendar import monthrange
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from .accounts import _balance_query, _execute_balance_query, account_response
from .auth.dependencies import HouseholdContext, require_household
from .db import get_db
from .errors import APIError
from .models import Account, Category, Transaction
from .money import checked_cents
from .schemas import (
    DashboardPeriod, DashboardResponse, DashboardSpending,
    DashboardSummary, DashboardTransaction,
)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardResponse)
def get_dashboard(
    year: int = Query(..., ge=1, le=9999),
    month: int = Query(..., ge=1, le=12),
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> DashboardResponse:
    household_id = context.household_id
    first = date(year, month, 1)
    last = date(year, month, monthrange(year, month)[1])
    monthly = (
        Transaction.household_id == household_id,
        Transaction.transaction_date.between(first, last),
    )
    balances = _execute_balance_query(
        db, _balance_query(household_id, include_archived=False),
    )
    balance = checked_cents(sum(
        account_response(account, activity).balance
        for account, activity in balances
    ))

    try:
        income, signed_expenses = db.execute(
            select(
                func.coalesce(func.sum(case(
                    (Transaction.amount > 0, Transaction.amount), else_=0,
                )), 0),
                func.coalesce(func.sum(case(
                    (Transaction.amount < 0, Transaction.amount), else_=0,
                )), 0),
            ).where(*monthly)
        ).one()
        income = checked_cents(income)
        expenses = checked_cents(-signed_expenses)
        net = checked_cents(income - expenses)

        spent = (-func.sum(Transaction.amount)).label("spent")
        spending_rows = db.execute(
            select(Category.id, Category.name, spent)
            .join(Transaction, Transaction.category_id == Category.id)
            .where(
                *monthly, Category.household_id == household_id,
                Category.type == "expense", Transaction.amount < 0,
            )
            .group_by(Category.id, Category.name)
            .order_by(spent.desc(), Category.id)
        ).all()
    except OperationalError as exc:
        if isinstance(exc.orig, sqlite3.OperationalError) and str(exc.orig) == "integer overflow":
            db.rollback()
            raise APIError(
                409, "CONFLICT", "The calculated amount exceeds the supported range.",
            ) from None
        raise

    recent_rows = db.execute(
        select(Transaction, Account.name, Category.name)
        .join(Account, Account.id == Transaction.account_id)
        .join(Category, Category.id == Transaction.category_id)
        .where(
            *monthly, Account.household_id == household_id,
            Category.household_id == household_id,
        )
        .order_by(
            Transaction.transaction_date.desc(),
            Transaction.created_at.desc(), Transaction.id.desc(),
        )
        .limit(10)
    ).all()

    return DashboardResponse(
        period=DashboardPeriod(year=year, month=month),
        summary=DashboardSummary(balance=balance, income=income, expenses=expenses, net=net),
        spending_by_category=[
            DashboardSpending(category_id=id, category_name=name, spent=checked_cents(total))
            for id, name, total in spending_rows
        ],
        recent_transactions=[
            DashboardTransaction(
                id=transaction.id, account_id=transaction.account_id,
                account_name=account_name, category_id=transaction.category_id,
                category_name=category_name, amount=transaction.amount,
                description=transaction.description,
                transaction_date=transaction.transaction_date,
            )
            for transaction, account_name, category_name in recent_rows
        ],
    )
```

Keep SQLite `SUM` integer semantics; intermediate SQL overflow is a controlled conflict even if a theoretical later cancellation could fit. Do not introduce custom arbitrary-precision SQL aggregation. Use `checked_cents` after Python integer calculations and before response serialization. In `money.py`, change only its message string to `The calculated amount exceeds the supported range.`; retain status/code/signature/bounds. Existing account-specific SQL-overflow wording may remain balance-specific.

Register without changing existing router order or guards:

```python
from .dashboard import router as dashboard_router
# Inside create_app, alongside the existing include_router calls:
app.include_router(dashboard_router)
```

- [ ] **4. Add focused regression scenarios to `test_dashboard.py`.** Keep tests about returned financial behavior, not query text, implementation fields or wording. Use `db_session` and model inserts for bulk/foreign fixtures, with valid household/category/account/creator references, and commit before API requests. Required independent boundaries:

| Scenario | Exact assertion / plausible bug defended |
|---|---|
| Empty household; then account with initial `-500` but no transactions | All activity/list fields empty/zero; balance first `0`, then `-500`. Prevents inner-join loss and fabricated activity from initial balances. |
| Multiple accounts and categories | Add a second active account initial `20000` with September expense `-100`; base September summary becomes balance `459629`, income `350000`, expenses `8572`, net `341428`. Groceries receives both accounts' transactions when category is shared; initial balance must not multiply through joins. |
| Archive after writes | Archive original Checking and Groceries: September activity stays `350000/8472/341528` and historical names stay readable, while current balance is `0` with no other active account. Rename before archive and assert current names rather than deleted/missing labels. |
| Expense ordering and recent limit | Insert 12 same-day rows with fixed `created_at`; recent IDs equal descending final ten IDs. Add same-date different timestamp and next-day rows to prove all three ordering keys. Two categories with equal spending sort by ID. Verify income-only categories do not appear in spending. |
| Calendar boundaries | Transactions on `2024-02-29`, `2024-03-01`, `2025-12-31`, `2026-01-01`, `0001-01-01`, `9999-12-31`; each appears only in its requested month and boundary requests succeed. |
| Validation | Missing year/month; year `0`/`10000`; month `0`/`13`; malformed numeric values return 422 with `error.code == VALIDATION_ERROR`, not a traceback. |
| Authorization | Anonymous GET returns 401 and no financial fields. Seed a fully valid second household with distinctive names/amounts and its own creator; authenticated first-household summary/lists do not change. Also authenticate a member of the first household: same financial response as its owner. |
| Safe integer limits | Return `MAX_SAFE_CENTS` exactly when valid. Two individually valid active account balances whose sum is `MAX_SAFE_CENTS + 1` return 409. Monthly income/expense overflow returns 409 even when opposing transactions make all-time net fit. No floats or partial payload. |
| SQLite overflow and query scope | Seed 1025 transactions of `MAX_SAFE_CENTS` on a valid foreign account; first household dashboard still succeeds. In own household, archived account overflow outside selected month does not poison active balance/selected activity; select that overflowing month and receive 409. Use direct bulk inserts only into fixture-owned DB. |

For error cases, assertions should take this form, not pin prose:

```python
assert response.status_code == 409
assert response.json()["error"]["code"] == "CONFLICT"
assert "summary" not in response.json()
```

- [ ] **5. Run focused backend checks after edits settle.** From `backend`:

```text
python -m pytest tests/test_dashboard.py tests/test_accounts.py tests/test_money.py tests/test_authorization.py -q
```

Do not run migrations against real data: M4 needs none. Review household predicates on each aggregate and joined name lookup; no all-history transaction materialization, per-category queries, financial payload logging or new response fields beyond the declared contract.

## Task 2 — Month Navigation and Accessible Dashboard

**Files:** Frontend files in Task 2 above.

**Consumes:** Task 1 endpoint and existing `formatMoney(cents: number): string`, `localToday(now?: Date): string`, auth shell/interceptor.

**Produces:** `DashboardService.get(year: number, month: number): Observable<DashboardResponse>`; the existing `DashboardPage` renders current or selected month with coherent loading/error/ready states.

- [ ] **1. Add frontend interfaces to `core/api/models.ts` and the feature service.** Keep API casing and numeric cents identical:

```typescript
export interface DashboardPeriod { year: number; month: number; }
export interface DashboardSpending {
  categoryId: number;
  categoryName: string;
  spent: number;
}
export interface DashboardTransaction {
  id: number;
  accountId: number;
  accountName: string;
  categoryId: number;
  categoryName: string;
  amount: number;
  description: string | null;
  transactionDate: string;
}
export interface DashboardResponse {
  period: DashboardPeriod;
  summary: { balance: number; income: number; expenses: number; net: number };
  budgets: never[];
  spendingByCategory: DashboardSpending[];
  recentTransactions: DashboardTransaction[];
}
```

`dashboard.service.ts`:

```typescript
import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable } from "rxjs";
import { DashboardResponse } from "../../core/api/models";

@Injectable({ providedIn: "root" })
export class DashboardService {
  private readonly http = inject(HttpClient);
  get(year: number, month: number): Observable<DashboardResponse> {
    return this.http.get<DashboardResponse>("/api/dashboard", { params: { year, month } });
  }
}
```

- [ ] **2. Add a failing state-transition test using existing TestBed/HttpTestingController conventions.** In `dashboard.page.spec.ts`, configure `imports: [DashboardPage]`, `providers: [provideHttpClient(), provideHttpClientTesting()]`, create the fixture, call `detectChanges`, and verify HTTP requests in `afterEach`. Import those symbols from the same Angular modules as `transactions.page.spec.ts`. Core regression:

```typescript
it("does not show old totals under a new month or treat failure as empty", () => {
  const first = http.expectOne((request) => request.url === "/api/dashboard");
  const year = Number(first.request.params.get("year"));
  const month = Number(first.request.params.get("month"));
  first.flush({
    period: { year, month },
    summary: { balance: 10000, income: 12345, expenses: 0, net: 12345 },
    budgets: [], spendingByCategory: [], recentTransactions: [],
  });
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain("123,45");

  fixture.componentInstance.selectMonth("2026-10");
  const october = http.expectOne((request) => request.params.get("month") === "10");
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).not.toContain("123,45");
  october.flush({ error: { message: "Unavailable" } }, { status: 503, statusText: "Unavailable" });
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
  expect(fixture.nativeElement.textContent).not.toContain("No transactions this month.");

  fixture.componentInstance.retry();
  http.expectOne((request) => request.params.get("year") === "2026" && request.params.get("month") === "10").flush({
    period: { year: 2026, month: 10 },
    summary: { balance: 10000, income: 0, expenses: 0, net: 0 },
    budgets: [], spendingByCategory: [], recentTransactions: [],
  });
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  expect(fixture.nativeElement.textContent).toContain("No transactions this month.");
});
```

From `frontend`: `npm test -- --watch=false --include=src/app/features/dashboard/dashboard.page.spec.ts`. Expect failure before the page consumes the service; record the actual failing behavior.

- [ ] **3. Replace the identity-only component body with page-local period/request state.** Retain its class/selector. Use these imports and class members with the template in the next step:

```typescript
import { HttpErrorResponse } from "@angular/common/http";
import { Component, DestroyRef, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { Subject, catchError, map, of, startWith, switchMap } from "rxjs";
import { DashboardPeriod, DashboardResponse } from "../../core/api/models";
import { formatMoney, localToday } from "../../shared/utilities/money";
import { DashboardService } from "./dashboard.service";

type DashboardState =
  | { kind: "loading" }
  | { kind: "ready"; data: DashboardResponse }
  | { kind: "error"; message: string };

// Keep @Component with the template/styles specified below.
export class DashboardPage {
  private readonly service = inject(DashboardService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly requests = new Subject<DashboardPeriod>();
  readonly selectedMonth = signal(localToday().slice(0, 7));
  readonly monthError = signal<string | null>(null);
  readonly state = signal<DashboardState>({ kind: "loading" });
  readonly formatMoney = formatMoney;

  constructor() {
    this.requests.pipe(
      switchMap(({ year, month }) => this.service.get(year, month).pipe(
        map((data): DashboardState => ({ kind: "ready", data })),
        catchError((error: unknown) => of<DashboardState>({
          kind: "error",
          message: error instanceof HttpErrorResponse && error.status === 0
            ? "Could not connect. Check your connection and try again."
            : error instanceof HttpErrorResponse && typeof error.error?.error?.message === "string"
              ? error.error.error.message : "Could not load dashboard.",
        })),
        startWith<DashboardState>({ kind: "loading" }),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((state) => this.state.set(state));
    this.retry();
  }

  selectMonth(value: string): void {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match || Number(match[1]) < 1 || Number(match[2]) < 1 || Number(match[2]) > 12) {
      this.monthError.set("Choose a month between January 0001 and December 9999.");
      return;
    }
    this.monthError.set(null);
    this.selectedMonth.set(value);
    this.retry();
  }

  moveMonth(delta: -1 | 1): void {
    const [year, month] = this.selectedMonth().split("-").map(Number);
    const index = (year - 1) * 12 + month - 1 + delta;
    if (index < 0 || index >= 9999 * 12) return;
    this.selectMonth(`${String(Math.floor(index / 12) + 1).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}`);
  }

  retry(): void {
    const [year, month] = this.selectedMonth().split("-").map(Number);
    this.requests.next({ year, month });
  }
}
```

Integer month arithmetic avoids timezone shifts, December rollover mistakes and JavaScript's special handling of years 0–99 in multi-argument Date construction. Invalid native input is an unsubmitted value: retain the last valid selected month/data, show its selected-period caption, associate the error with the input and issue no request. Previous/next replaces invalid input with a valid selection. Keep controls available during loading so `switchMap` can cancel stale requests. No automatic network retry or periodic refresh.

- [ ] **4. Render all seven milestone deliverables in the existing component.** Keep inline template/styles like neighboring features; no design-system extraction. Template structure:

```html
<section class="page" aria-labelledby="dashboard-title">
  <h2 id="dashboard-title">Dashboard</h2>
  <div class="period-controls">
    <button type="button" (click)="moveMonth(-1)" [disabled]="selectedMonth() === '0001-01'">Previous month</button>
    <div class="field">
      <label for="dashboard-month">Month</label>
      <input #monthInput id="dashboard-month" type="month" required min="0001-01" max="9999-12"
        [value]="selectedMonth()" (change)="selectMonth(monthInput.value)"
        [attr.aria-invalid]="monthError() ? 'true' : null"
        [attr.aria-describedby]="monthError() ? 'dashboard-month-error' : null" />
      @if (monthError(); as error) { <p id="dashboard-month-error" class="error">{{ error }}</p> }
    </div>
    <button type="button" (click)="moveMonth(1)" [disabled]="selectedMonth() === '9999-12'">Next month</button>
  </div>
  <p>Selected month: {{ selectedMonth() }}</p>
  @let view = state();
  @switch (view.kind) {
    @case ('loading') { <p role="status" aria-live="polite">Loading dashboard…</p> }
    @case ('error') {
      <p class="error" role="alert">{{ view.message }} <button type="button" (click)="retry()">Retry</button></p>
    }
    @case ('ready') {
      <dl class="summary" aria-label="Financial summary">
        <div><dt>Current account balance</dt><dd>{{ formatMoney(view.data.summary.balance) }}</dd></div>
        <div><dt>Income this month</dt><dd>{{ formatMoney(view.data.summary.income) }}</dd></div>
        <div><dt>Expenses this month</dt><dd>{{ formatMoney(view.data.summary.expenses) }}</dd></div>
        <div><dt>Net this month</dt><dd>{{ formatMoney(view.data.summary.net) }}</dd></div>
      </dl>
      <p>Current balance includes all dates for non-archived accounts. Monthly activity includes archived accounts and categories.</p>
      <section aria-labelledby="spending-title">
        <h3 id="spending-title">Spending by category</h3>
        @if (view.data.spendingByCategory.length === 0) { <p>No spending this month.</p> }
        @else {
          <ul class="cards" aria-label="Spending by category">
            @for (row of view.data.spendingByCategory; track row.categoryId) {
              <li><span>{{ row.categoryName }}</span><strong>{{ formatMoney(row.spent) }}</strong></li>
            }
          </ul>
        }
      </section>
      <section aria-labelledby="recent-title">
        <h3 id="recent-title">Recent transactions</h3>
        @if (view.data.recentTransactions.length === 0) { <p>No transactions this month.</p> }
        @else {
          <ul class="cards" aria-label="Recent transactions">
            @for (row of view.data.recentTransactions; track row.id) {
              <li>
                <time [attr.datetime]="row.transactionDate">{{ row.transactionDate }}</time>
                <p>{{ row.description || 'No description' }}</p>
                <p>{{ row.categoryName }} · {{ row.accountName }}</p>
                <p>{{ row.amount < 0 ? 'Expense' : 'Income' }}: <strong>{{ formatMoney(row.amount) }}</strong></p>
              </li>
            }
          </ul>
        }
      </section>
    }
  }
</section>
```

Use the existing palette and readable cards, not a chart. Starting styles:

```css
:host { display: block; }
.page { max-width: 52rem; margin: auto; }
.period-controls { display: flex; flex-wrap: wrap; align-items: start; gap: .75rem; }
.field { min-width: 0; }
label { display: block; font-weight: 700; }
button, input { box-sizing: border-box; min-height: 2.75rem; padding: .5rem .75rem; font: inherit; }
input { max-width: 100%; }
button { border: 0; border-radius: .375rem; background: #1b4d8f; color: #fff; cursor: pointer; font-weight: 700; }
button:disabled { opacity: .65; cursor: default; }
button:focus-visible, input:focus-visible { outline: 3px solid #f0a500; outline-offset: 2px; }
.summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; }
.summary > div, .cards > li { min-width: 0; padding: 1rem; border: 1px solid #d7deeb; border-radius: .75rem; background: #fff; overflow-wrap: anywhere; }
dt { color: #52617a; }
dd { margin: .5rem 0 0; font-size: 1.25rem; font-weight: 700; }
.cards { display: grid; gap: .75rem; padding: 0; list-style: none; }
.cards li > span { margin-right: 1rem; }
.error { padding: .75rem; background: #fff0f0; color: #7c1717; border-radius: .375rem; }
@media (max-width: 30rem) { .summary { grid-template-columns: 1fr; } .period-controls { flex-direction: column; align-items: stretch; } }
```

Adjust only after inspecting the actual 390px and desktop surface. Dates remain literal calendar dates. Negative amounts retain their minus sign and income/expense text; expenses summary/category totals are positive. Do not calculate or reduce financial totals in the template.

- [ ] **5. Preserve authenticated identity and update obsolete test expectations without keeping the old landing card.** Inside the existing shell header, below the title, render:

```html
@if (auth.authState(); as state) {
  <p class="identity">{{ state.user.displayName }} · {{ state.household.name }}</p>
}
```

Add `.identity { overflow-wrap: anywhere; }` to shell styles. No extra auth request or new settings route. Remove the two `Welcome, E2E User` heading assertions from `frontend/e2e/auth.spec.ts`. Retain URL, reload, logout and protected-route assertions, and assert the authenticated header contains both user and household after login and after reload. This tests restored identity, not the wording of a disposable heading:

```typescript
await expect(page.locator("header")).toContainText("E2E User");
await expect(page.locator("header")).toContainText("E2E Household");
```

- [ ] **6. Complete the small page behavior suite.** Besides the failure/retry regression, exercise via native month input/buttons: December→January and back; `0001-01`/`9999-12` disabled boundaries; invalid/cleared input has associated error and no new request; rapid selections cancel the earlier request and show only the winning period's DOM values; destruction cancels work. Assert visible period/data, not just component signals. Include exact negative/near-limit formatting and literal HTML-looking descriptions in the rendered rows without any created script element. Reuse the existing money tests rather than another parsing suite. Run from `frontend` after edits settle:

```text
npm test -- --watch=false --include=src/app/features/dashboard/dashboard.page.spec.ts
npm run build
```

Use the real production build to catch strict Angular template union narrowing and import/type errors; do not assume code examples compile unchanged if the installed compiler has different diagnostics.

## Task 3 — Real Browser Acceptance and Completion Gate

**Files:** Task 3 files in the map. This task verifies the implementation, not a replacement mock dashboard.

**Consumes:** Tasks 1–2, existing M1–M3 UI and real browser/server harness.

**Produces:** Repeatable isolated dashboard acceptance at `1280×900` and `390×844`, regression results and accurate M4 handoff. No M5 feature.

- [ ] **1. Give each dashboard browser scenario its own household.** Existing E2E files leave accounts/transactions in the shared E2E household; unique record names alone do not isolate dashboard totals. Read `backend/scripts/seed_e2e.py` before editing and reuse its existing user/household/password creation pattern. Extend its current seed operation with two additional identities, one per dashboard viewport; do not alter original E2E identity or expired-session behavior. In `frontend/playwright.config.ts`, generate one additional random password (not committed credentials) and pass it to both test runner and seed process:

```typescript
const dashboardPassword = process.env["BUDGET_E2E_DASHBOARD_PASSWORD"] ?? randomBytes(24).toString("base64url");
process.env["BUDGET_E2E_DASHBOARD_PASSWORD"] = dashboardPassword;
// Add to the existing backend webServer env object:
// E2E_DASHBOARD_PASSWORD: dashboardPassword,
```

Seed usernames `e2e-dashboard-1280` and `e2e-dashboard-390`, with separate household rows and `owner` memberships. The inspected seed script has one `SessionLocal` block ending in `db.commit()`; insert the following before that commit. Its temporary database is supplied by Playwright configuration, not enforced by checks inside the seed script. Run only through that owned test configuration, with no real-database override.

```python
for width in (1280, 390):
    dashboard_household = Household(name=f"Dashboard Household {width}")
    db.add(dashboard_household)
    db.flush()
    dashboard_user = User(
        username=f"e2e-dashboard-{width}",
        display_name=f"Dashboard User {width}",
        password_hash=hash_password(os.environ["E2E_DASHBOARD_PASSWORD"]),
        is_active=True,
    )
    db.add(dashboard_user)
    db.flush()
    db.add(HouseholdMember(
        household_id=dashboard_household.id,
        user_id=dashboard_user.id,
        role="owner",
    ))
```

Do not create a browser-accessible bootstrap endpoint or a second seeding framework. On CI retries, log in to the same isolated household and remove its existing transactions through the real DELETE API, then archive its active accounts through the real archive API before building the scenario; require successful responses with fresh CSRF headers, and use unique new account/category names. This resets only disposable test-owned financial activity, not identities or other tests. Never reset through production SQL or reuse the M1 user's password-reset path. Preserve the generated password through inherited environment variables when Playwright re-evaluates its configuration in workers.

- [ ] **2. Write `frontend/e2e/dashboard.spec.ts` using real UI/API behavior.** For each viewport, log in with that viewport's isolated identity and `BUDGET_E2E_DASHBOARD_PASSWORD`. Use `timezoneId: 'Pacific/Kiritimati'` and freeze browser time at `2026-08-31T12:30:00Z`: local month is September while UTC is still August. The first rendered selection must be `2026-09`. Create through existing UI: Checking initial `1000.00`, Salary income `3500.00` on September 7, Groceries expense `84.72` on September 7, and Netflix expense `17.99` on October 1. Reuse the existing form selectors/patterns from `transactions.spec.ts`, without importing its test file or building generic fixture abstractions.

The exact browser oracle is:

| Selection / state | Current balance | Income | Expenses | Net | Lists |
|---|---:|---:|---:|---:|---|
| September 2026 | `4.397,29 €` | `3.500,00 €` | `84,72 €` | `3.415,28 €` | Groceries `84,72 €`; Salary and Groceries rows; no Netflix |
| October 2026 | `4.397,29 €` | `0,00 €` | `17,99 €` | `-17,99 €` | Netflix only, exact `2026-10-01` date |
| November 2026 | `4.397,29 €` | `0,00 €` | `0,00 €` | `0,00 €` | Both explicit empty-list messages |
| September after Checking archive | `0,00 €` | `3.500,00 €` | `84,72 €` | `3.415,28 €` | Same history and category names remain visible |

Expected strings use the existing formatter's nonbreaking space before `€`; assertions must compare exact output, not rounded/substring amounts. Scope each card by its term rather than ambiguous page-wide money text:

```typescript
const balanceCard = page.locator("dl.summary > div").filter({ has: page.getByText("Current account balance", { exact: true }) });
await expect(balanceCard.locator("dd")).toHaveText("4.397,29\u00a0€");
await page.getByRole("button", { name: "Next month", exact: true }).click();
await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-10");
await expect(page.getByRole("list", { name: "Recent transactions", exact: true })).toContainText("2026-10-01");
```

Wait for the matching dashboard response and ready DOM after every selection; do not assert that a row is absent while its request is still loading. Verify Previous/Next rollover with December/January selections, a real reload defaults to local current month, and returning from Accounts/Transactions fetches fresh data rather than showing a cached previous visit. Use keyboard activation for month navigation. Include an HTML-looking category/description and assert literal text with no script/dialog execution.

- [ ] **3. Exercise loading and failure on the actual surface.** Capture desktop and phone screenshots and inspect them, not just DOM assertions. Check readable four-card layout, wrapped long names/amounts, visible focus and no document overflow:

```typescript
expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
await page.screenshot({ path: testInfo.outputPath("dashboard-ready.png"), fullPage: true });
```

Use the test callback's `testInfo` argument for output paths. For a real connection failure, set the browser context offline, change month, observe the connection alert and absence of zero/empty/old financial data, restore online and click Retry; verify that same selected month succeeds. For deterministic loading-state visual inspection, temporarily pause only an idempotent dashboard GET with a one-shot route handler until the loading screenshot has been taken, then `route.continue()` to the real backend and unregister the handler. Do not fulfill a synthetic response or intercept/replay a financial write. Record this loading check as delayed real-GET rendering, not an unmodified network-timing claim.

Also replace the session cookie with the harness's real expired valid token while on Dashboard, trigger a month request, and verify interceptor-driven navigation to login and removal of financial DOM. Restore authentication only through the real login form. No dashboard payload appears on unauthenticated API responses.

- [ ] **4. Run integration checks centrally once edits settle.** Commands from the indicated directory:

```text
# backend
python -m pytest

# frontend
npm test -- --watch=false
npm run build
npx playwright test
```

During focused iteration use `npx playwright test e2e/dashboard.spec.ts e2e/auth.spec.ts`. Keep servers under the existing Playwright webServer ownership, or use the harness process supervisor for manual browsing. Never point test environment overrides at the user's DB. Record actual pass counts and warnings; no assumed counts, no claim that browser assertions equal visual inspection. No separate migration cycle is needed because there is no M4 migration.

- [ ] **5. Perform a focused security/correctness pass before completion.** Inspect every dashboard household predicate and join; prove foreign household data and overflow cannot influence the authenticated household. Check safe-integer serialization, required month bounds, archived monthly activity versus active-only balance, literal text rendering, request cancellation, 401 cleanup and absence of financial logging. Fix only in-scope findings and retain a behavioral regression for each concrete bug. Do not turn this into unrequested deployment/header/rate-limiter work.

- [ ] **6. After runtime proof, update documentation and remove throwaway artifacts.** Update README's M1–M3 introduction and identity-only dashboard description with M4 selected-month behavior, `GET /api/dashboard`, archive/balance distinction, bounds, overflow behavior, sorted spending, ten recent rows and current verification commands. Update `state.md` and the active `docs/LUNA_HANDOFF.md` with actual results and M4 completion only when gates pass; retain historical M3 evidence and its separately unverified visual gate. Next boundary is user review before M5 monthly budgets. Preserve older plans and `docs/LUNA_M3_HANDOFF.md`. Remove temporary screenshots/scripts outside normal ignored test output; do not commit credentials or financial fixtures from real data.

## 3. Acceptance Checklist and Source Coverage

| Requirement | Task / evidence |
|---|---|
| §44 M4 month selector | Task 2 native month input/previous/next; Task 3 local-month, rollover and keyboard browser checks |
| §14.1 total active account balance | Task 1 existing account aggregation plus combined bound; Task 3 balance unchanged across periods and changes on archive |
| §14.1 income, expenses, net | Task 1 signed integer SQL aggregates / exact oracle; Task 3 exact rendered cards |
| §14.3 spending by category | Task 1 grouping/order/archive regressions; Task 2 sorted readable list |
| §14.4 recent transactions, all five displayed values | Task 1 stable latest-ten order and named joins; Task 3 exact dates/descriptions/categories/accounts/amounts |
| §§7.7, 21, 42 household isolation/auth | Task 1 two-household/anonymous/member cases; Task 3 live session expiry and preserved auth suite |
| §§9, 35–37 cents, validation, calendar dates | Task 1 safe and SQLite overflow, month/year/leap boundaries; Task 2 exact existing formatter and integer month navigation |
| §§38–39 responsive/accessibility | Task 3 actual desktop/phone screenshots, keyboard/focus/wrapping/error/loading/empty states |
| §22.2 response shape | Task 1 Pydantic schema and exact JSON oracle, Task 2 matching TypeScript types |
| §14.2 budgets / §44 M5 boundary | Empty API array only in M4; populated budget overview remains M5, not silently claimed complete |
| M3 regression preservation | Unchanged storage/routes/form/filter semantics; Task 3 integrated suites and auth identity cutover |
| Accurate delivery | Task 3 actual evidence in README/state/active handoff; stop before M5 and production-readiness claims |

## 4. Planning Verification and Execution Handoff

This document is a plan, not an implementation or runtime-verification report. Source paths, existing APIs, reporting rules, test isolation, response-field consistency and arithmetic examples were checked while planning. Application code, milestone status and deployment are intentionally unchanged. The proposed dashboard endpoint, browser scenarios and production build must be exercised during implementation.

Execution can proceed inline or with concurrent backend/frontend workers using the fixed JSON contract above, followed by centrally owned integration. Do not execute M5 or use the M4 plan as evidence that the full MVP is ready.
