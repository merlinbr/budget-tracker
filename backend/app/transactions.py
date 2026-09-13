from calendar import monthrange
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Path, Query, Response
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .accounts import get_account
from .auth.dependencies import HouseholdContext, require_household
from .categories import get_category
from .db import get_db
from .errors import APIError
from .models import Account, Category, Transaction, utc_now
from .schemas import TransactionResponse, TransactionWrite


router = APIRouter(prefix="/api/transactions", tags=["transactions"])


class TransactionFilters:
    def __init__(
        self,
        year: int | None = Query(None, ge=1, le=9999),
        month: int | None = Query(None, ge=1, le=12),
        account_id: int | None = Query(None, alias="accountId", gt=0),
        category_id: int | None = Query(None, alias="categoryId", gt=0),
        type: Literal["income", "expense"] | None = Query(None),
        search: str | None = Query(None, max_length=500),
    ) -> None:
        self.year = year
        self.month = month
        self.account_id = account_id
        self.category_id = category_id
        self.type = type
        self.search = search


def get_transaction(db: Session, transaction_id: int, household_id: int) -> Transaction:
    transaction = db.scalar(
        select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.household_id == household_id,
        )
    )
    if transaction is None:
        raise APIError(404, "NOT_FOUND", "The requested resource was not found.")
    return transaction




def validate_references(
    payload: TransactionWrite,
    account: Account,
    category: Category,
    retained_account_id: int | None = None,
    retained_category_id: int | None = None,
) -> None:
    if account.is_archived and account.id != retained_account_id:
        raise APIError(
            422,
            "VALIDATION_ERROR",
            "The request could not be processed.",
            {"accountId": "Select an active account."},
        )
    if category.is_archived and category.id != retained_category_id:
        raise APIError(
            422,
            "VALIDATION_ERROR",
            "The request could not be processed.",
            {"categoryId": "Select an active category."},
        )
    expected_type = "income" if payload.amount > 0 else "expense"
    if category.type != expected_type:
        raise APIError(
            422,
            "VALIDATION_ERROR",
            "The request could not be processed.",
            {"categoryId": "Category type must match the transaction amount sign."},
        )


def commit_or_rollback(db: Session) -> None:
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

@router.get("", response_model=list[TransactionResponse])
def list_transactions(
    filters: TransactionFilters = Depends(),
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> list[Transaction]:
    if (filters.year is None) != (filters.month is None):
        raise APIError(
            422,
            "VALIDATION_ERROR",
            "The request could not be processed.",
            {
                "year": "Year and month must be provided together.",
                "month": "Year and month must be provided together.",
            },
        )
    if filters.account_id is not None:
        get_account(db, filters.account_id, context.household_id)
    if filters.category_id is not None:
        get_category(db, filters.category_id, context.household_id)

    statement = select(Transaction).where(
        Transaction.household_id == context.household_id,
    )
    if filters.year is not None and filters.month is not None:
        first = date(filters.year, filters.month, 1)
        last = date(filters.year, filters.month, monthrange(filters.year, filters.month)[1])
        statement = statement.where(Transaction.transaction_date.between(first, last))
    if filters.account_id is not None:
        statement = statement.where(Transaction.account_id == filters.account_id)
    if filters.category_id is not None:
        statement = statement.where(Transaction.category_id == filters.category_id)
    if filters.type == "income":
        statement = statement.where(Transaction.amount > 0)
    elif filters.type == "expense":
        statement = statement.where(Transaction.amount < 0)
    if filters.search is not None and filters.search.strip():
        statement = statement.where(
            Transaction.description.icontains(filters.search.strip(), autoescape=True)
        )
    statement = statement.order_by(
        Transaction.transaction_date.desc(),
        Transaction.created_at.desc(),
        Transaction.id.desc(),
    )
    return db.scalars(statement).all()


@router.post("", status_code=201, response_model=TransactionResponse)
def create_transaction(
    payload: TransactionWrite,
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> TransactionResponse:
    account = get_account(db, payload.account_id, context.household_id)
    category = get_category(db, payload.category_id, context.household_id)
    validate_references(payload, account, category)

    transaction = Transaction(
        household_id=context.household_id,
        account_id=payload.account_id,
        category_id=payload.category_id,
        amount=payload.amount,
        description=payload.description,
        transaction_date=payload.transaction_date,
        created_by_user_id=context.user_id,
    )
    db.add(transaction)
    commit_or_rollback(db)
    db.refresh(transaction)
    return transaction


@router.get("/{transaction_id}", response_model=TransactionResponse)
def get_transaction_route(
    transaction_id: int = Path(gt=0),
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> TransactionResponse:
    return get_transaction(db, transaction_id, context.household_id)


@router.put("/{transaction_id}", response_model=TransactionResponse)
def update_transaction(
    payload: TransactionWrite,
    transaction_id: int = Path(gt=0),
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> TransactionResponse:
    transaction = get_transaction(db, transaction_id, context.household_id)
    account = get_account(db, payload.account_id, context.household_id)
    category = get_category(db, payload.category_id, context.household_id)
    validate_references(
        payload,
        account,
        category,
        retained_account_id=transaction.account_id,
        retained_category_id=transaction.category_id,
    )

    db.execute(
        update(Transaction)
        .where(
            Transaction.id == transaction.id,
            Transaction.household_id == context.household_id,
        )
        .values(
            account_id=payload.account_id,
            category_id=payload.category_id,
            amount=payload.amount,
            description=payload.description,
            transaction_date=payload.transaction_date,
            updated_at=utc_now(),
        )
    )
    commit_or_rollback(db)
    db.refresh(transaction)
    return transaction


@router.delete("/{transaction_id}", status_code=204)
def delete_transaction(
    transaction_id: int = Path(gt=0),
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> Response:
    transaction = get_transaction(db, transaction_id, context.household_id)
    db.delete(transaction)
    commit_or_rollback(db)
    return Response(status_code=204)
