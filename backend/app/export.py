import csv
import io
import re
import unicodedata
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .accounts import get_account
from .auth.dependencies import HouseholdContext, require_household
from .categories import get_category
from .db import get_db
from .errors import APIError
from .models import Account, Category, Transaction
from .money import checked_cents

router = APIRouter(prefix="/api/export", tags=["export"])

_CSV_HEADER = ["date", "description", "account", "category", "type", "amount", "currency"]
_DATE_PATTERN = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
_MAX_SAFE_ID = 9007199254740991


def csv_amount(cents: int) -> str:
    cents = checked_cents(cents)
    whole, fraction = divmod(abs(cents), 100)
    return f"{'-' if cents < 0 else ''}{whole}.{fraction:02d}"


def csv_text(value: str | None) -> str:
    value = value or ""
    index = 0
    while index < len(value) and (
        value[index].isspace() or unicodedata.category(value[index]) in {"Cc", "Cf"}
    ):
        index += 1
    begins_control = bool(value) and unicodedata.category(value[0]) in {"Cc", "Cf"}
    begins_formula = index < len(value) and value[index] in "=+-@"
    return "'" + value if begins_control or begins_formula else value


def _csv_date(name: str, value: str) -> date:
    if not _DATE_PATTERN.fullmatch(value):
        raise APIError(
            422,
            "VALIDATION_ERROR",
            "The request could not be processed.",
            {name: "Use a valid YYYY-MM-DD date."},
        )
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise APIError(
            422,
            "VALIDATION_ERROR",
            "The request could not be processed.",
            {name: "Use a valid YYYY-MM-DD date."},
        ) from exc


@router.get("/transactions.csv")
def export_transactions_csv(
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
    from_date: str | None = Query(None, alias="from", max_length=10),
    to_date: str | None = Query(None, alias="to", max_length=10),
    account_id: Annotated[int | None, Query(alias="accountId", ge=1, le=_MAX_SAFE_ID)] = None,
    category_id: Annotated[int | None, Query(alias="categoryId", ge=1, le=_MAX_SAFE_ID)] = None,
) -> Response:
    from_bound = _csv_date("from", from_date) if from_date is not None else None
    to_bound = _csv_date("to", to_date) if to_date is not None else None
    if from_bound is not None and to_bound is not None and from_bound > to_bound:
        raise APIError(
            422,
            "VALIDATION_ERROR",
            "The request could not be processed.",
            {"from": "From date must be on or before the to date."},
        )
    if account_id is not None:
        get_account(db, account_id, context.household_id)
    if category_id is not None:
        get_category(db, category_id, context.household_id)

    statement = (
        select(Transaction, Account.name, Category.name)
        .join(
            Account,
            (Account.id == Transaction.account_id)
            & (Account.household_id == context.household_id),
        )
        .join(
            Category,
            (Category.id == Transaction.category_id)
            & (Category.household_id == context.household_id),
        )
        .where(Transaction.household_id == context.household_id)
        .order_by(
            Transaction.transaction_date.desc(),
            Transaction.created_at.desc(),
            Transaction.id.desc(),
        )
    )
    if from_bound is not None:
        statement = statement.where(Transaction.transaction_date >= from_bound)
    if to_bound is not None:
        statement = statement.where(Transaction.transaction_date <= to_bound)
    if account_id is not None:
        statement = statement.where(Transaction.account_id == account_id)
    if category_id is not None:
        statement = statement.where(Transaction.category_id == category_id)

    rows = db.execute(statement).all()

    # ponytail: whole export buffers in memory before responding; revisit only if a
    # measured household export outgrows RAM, and switch to a bounded spool then.
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(_CSV_HEADER)
    for transaction, account_name, category_name in rows:
        writer.writerow(
            [
                transaction.transaction_date.isoformat(),
                csv_text(transaction.description),
                csv_text(account_name),
                csv_text(category_name),
                "income" if transaction.amount > 0 else "expense",
                csv_amount(transaction.amount),
                "EUR",
            ]
        )

    payload = buffer.getvalue().encode("utf-8")
    return Response(
        content=payload,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="transactions.csv"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
