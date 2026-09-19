import sqlite3
from calendar import monthrange
from datetime import date

from fastapi import APIRouter, Depends, Path, Query, Response
from sqlalchemy import and_, delete, func, select, text
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from .auth.dependencies import HouseholdContext, require_household
from .categories import get_category
from .db import get_db
from .errors import APIError
from .models import Budget, Category, Transaction, utc_now
from .money import checked_cents
from .schemas import BudgetCopyRequest, BudgetResponse, BudgetWrite

router = APIRouter(prefix="/api/budgets", tags=["budgets"])


def budget_rows(
    db: Session, household_id: int, year: int, month: int,
    *, category_id: int | None = None,
) -> list[BudgetResponse]:
    first = date(year, month, 1)
    last = date(year, month, monthrange(year, month)[1])
    statement = (
        select(
            Budget.category_id, Category.name, Category.is_archived,
            Budget.limit_amount, func.coalesce(func.sum(Transaction.amount), 0),
        )
        .select_from(Budget)
        .join(Category, and_(
            Category.id == Budget.category_id,
            Category.household_id == Budget.household_id,
        ))
        .outerjoin(Transaction, and_(
            Transaction.household_id == Budget.household_id,
            Transaction.category_id == Budget.category_id,
            Transaction.transaction_date.between(first, last),
            Transaction.amount < 0,
        ))
        .where(
            Budget.household_id == household_id, Budget.year == year,
            Budget.month == month, Category.type == "expense",
        )
        .group_by(Budget.id, Budget.category_id, Category.name, Category.is_archived, Budget.limit_amount)
        .order_by(Category.name, Budget.category_id)
    )
    if category_id is not None:
        statement = statement.where(Budget.category_id == category_id)
    try:
        rows = db.execute(statement).all()
    except OperationalError as exc:
        if isinstance(exc.orig, sqlite3.OperationalError) and str(exc.orig) == "integer overflow":
            raise APIError(
                409, "CONFLICT", "The calculated amount exceeds the supported range."
            ) from None
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


@router.get("", response_model=list[BudgetResponse])
def list_budgets(
    year: int = Query(..., ge=1, le=9999),
    month: int = Query(..., ge=1, le=12),
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> list[BudgetResponse]:
    return budget_rows(db, context.household_id, year, month)


@router.put("/{category_id}", response_model=BudgetResponse)
def upsert_budget(
    payload: BudgetWrite,
    category_id: int = Path(gt=0, le=9223372036854775807),
    year: int = Query(..., ge=1, le=9999),
    month: int = Query(..., ge=1, le=12),
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> BudgetResponse:
    try:
        db.execute(text("BEGIN IMMEDIATE"))
        household_id = context.household_id
        category = get_category(db, category_id, household_id)
        existing_id = db.scalar(select(Budget.id).where(
            Budget.household_id == household_id, Budget.category_id == category_id,
            Budget.year == year, Budget.month == month,
        ))
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
        db.commit()
    except Exception:
        db.rollback()
        raise
    return response


@router.delete("/{category_id}", status_code=204)
def delete_budget(
    category_id: int = Path(gt=0, le=9223372036854775807),
    year: int = Query(..., ge=1, le=9999),
    month: int = Query(..., ge=1, le=12),
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> Response:
    try:
        db.execute(text("BEGIN IMMEDIATE"))
        result = db.execute(delete(Budget).where(
            Budget.household_id == context.household_id, Budget.category_id == category_id,
            Budget.year == year, Budget.month == month,
        ))
        if result.rowcount == 0:
            raise APIError(404, "NOT_FOUND", "Resource not found.")
        db.commit()
    except Exception:
        db.rollback()
        raise
    return Response(status_code=204)


@router.post("/copy-previous", response_model=list[BudgetResponse])
def copy_previous_budgets(
    payload: BudgetCopyRequest,
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> list[BudgetResponse]:
    if (payload.year, payload.month) == (1, 1):
        raise APIError(
            422, "VALIDATION_ERROR", "There is no previous month.",
            {"year": "There is no previous month before January 0001."},
        )
    source_year = payload.year - (1 if payload.month == 1 else 0)
    source_month = 12 if payload.month == 1 else payload.month - 1
    try:
        db.execute(text("BEGIN IMMEDIATE"))
        source = db.execute(
            select(Budget.category_id, Budget.limit_amount)
            .join(Category, and_(
                Category.id == Budget.category_id,
                Category.household_id == Budget.household_id,
            ))
            .where(
                Budget.household_id == context.household_id,
                Budget.year == source_year, Budget.month == source_month,
                Category.type == "expense", Category.is_archived.is_(False),
            )
        ).all()
        source_ids = {category_id for category_id, _ in source}
        target_ids = set(db.scalars(select(Budget.category_id).where(
            Budget.household_id == context.household_id,
            Budget.year == payload.year, Budget.month == payload.month,
        )))
        if not payload.overwrite and source_ids & target_ids:
            raise APIError(
                409, "CONFLICT", "Some target-month budgets already exist.",
                {"overwrite": "Confirm replacement of existing limits."},
            )
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
        db.commit()
    except Exception:
        db.rollback()
        raise
    return response
