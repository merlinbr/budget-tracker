import sqlite3
from calendar import monthrange
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from .accounts import _balance_query, _execute_balance_query, account_response
from .auth.dependencies import HouseholdContext, require_household
from .db import get_db
from .errors import APIError
from .models import Account, Category, Transaction
from .money import checked_cents
from .schemas import (
    DashboardPeriod,
    DashboardResponse,
    DashboardSpending,
    DashboardSummary,
    DashboardTransaction,
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
    # pysqlite opens no transaction for plain SELECTs, so four independent reads
    # could observe different committed states. One explicit read transaction gives
    # all four a single WAL snapshot.
    db.execute(text("BEGIN"))
    first = date(year, month, 1)
    last = date(year, month, monthrange(year, month)[1])
    monthly = (
        Transaction.household_id == household_id,
        Transaction.transaction_date.between(first, last),
    )
    balances = _execute_balance_query(
        db, _balance_query(household_id, include_archived=False)
    )
    balance = checked_cents(
        sum(account_response(account, activity).balance for account, activity in balances)
    )

    try:
        income, signed_expenses = db.execute(
            select(
                func.coalesce(
                    func.sum(case((Transaction.amount > 0, Transaction.amount), else_=0)), 0
                ),
                func.coalesce(
                    func.sum(case((Transaction.amount < 0, Transaction.amount), else_=0)), 0
                ),
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
                *monthly,
                Category.household_id == household_id,
                Category.type == "expense",
                Transaction.amount < 0,
            )
            .group_by(Category.id, Category.name)
            .order_by(spent.desc(), Category.id)
        ).all()
    except OperationalError as exc:
        if isinstance(exc.orig, sqlite3.OperationalError) and str(exc.orig) == "integer overflow":
            db.rollback()
            raise APIError(
                409, "CONFLICT", "The calculated amount exceeds the supported range."
            ) from None
        raise

    recent_rows = db.execute(
        select(Transaction, Account.name, Category.name)
        .join(Account, Account.id == Transaction.account_id)
        .join(Category, Category.id == Transaction.category_id)
        .where(
            *monthly,
            Account.household_id == household_id,
            Category.household_id == household_id,
        )
        .order_by(
            Transaction.transaction_date.desc(),
            Transaction.created_at.desc(),
            Transaction.id.desc(),
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
                id=transaction.id,
                account_id=transaction.account_id,
                account_name=account_name,
                category_id=transaction.category_id,
                category_name=category_name,
                amount=transaction.amount,
                description=transaction.description,
                transaction_date=transaction.transaction_date,
            )
            for transaction, account_name, category_name in recent_rows
        ],
    )