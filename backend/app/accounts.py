import sqlite3

from fastapi import APIRouter, Depends, Path, Query, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from .auth.dependencies import HouseholdContext, require_household
from .db import get_db
from .errors import APIError
from .models import Account, Transaction
from .money import checked_cents
from .schemas import AccountResponse, AccountWrite

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


def get_account(db: Session, account_id: int, household_id: int) -> Account:
    account = db.scalar(
        select(Account).where(
            Account.id == account_id, Account.household_id == household_id
        )
    )
    if account is None:
        raise APIError(404, "NOT_FOUND", "Resource not found.")
    return account


def _balance_query(
    household_id: int,
    account_id: int | None = None,
    include_archived: bool = True,
):
    account_filter = [Account.household_id == household_id]
    if account_id is not None:
        account_filter.append(Account.id == account_id)
    if not include_archived:
        account_filter.append(Account.is_archived.is_(False))
    matching_accounts = select(Account.id).where(*account_filter)
    activity = (
        select(Transaction.account_id, func.sum(Transaction.amount).label("total"))
        .where(
            Transaction.household_id == household_id,
            Transaction.account_id.in_(matching_accounts),
        )
        .group_by(Transaction.account_id)
        .subquery()
    )
    return (
        select(Account, func.coalesce(activity.c.total, 0).label("activity_total"))
        .outerjoin(activity, activity.c.account_id == Account.id)
        .where(*account_filter)
    )


def _execute_balance_query(db: Session, statement):
    try:
        return db.execute(statement)
    except OperationalError as exc:
        if isinstance(exc.orig, sqlite3.OperationalError) and str(exc.orig) == "integer overflow":
            db.rollback()
            raise APIError(
                409,
                "CONFLICT",
                "The calculated balance exceeds the supported range.",
            ) from None
        raise


def account_response(account: Account, activity_total: int = 0) -> AccountResponse:
    return AccountResponse(
        id=account.id,
        name=account.name,
        type=account.type,
        initial_balance=account.initial_balance,
        balance=checked_cents(account.initial_balance + activity_total),
        is_archived=account.is_archived,
    )


def _account_row(db: Session, account_id: int, household_id: int):
    row = _execute_balance_query(
        db, _balance_query(household_id, account_id)
    ).one_or_none()
    if row is None:
        raise APIError(404, "NOT_FOUND", "Resource not found.")
    return row


@router.get("", response_model=list[AccountResponse])
def list_accounts(
    include_archived: bool = Query(False, alias="includeArchived"),
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> list[AccountResponse]:
    statement = _balance_query(
        context.household_id, include_archived=include_archived
    )
    rows = _execute_balance_query(
        db, statement.order_by(Account.name, Account.id)
    ).all()
    return [account_response(account, total) for account, total in rows]


@router.get("/{account_id}", response_model=AccountResponse)
def get_account_route(
    account_id: int = Path(gt=0),
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> AccountResponse:
    account, activity_total = _account_row(db, account_id, context.household_id)
    return account_response(account, activity_total)


@router.post("", status_code=201, response_model=AccountResponse)
def create_account(
    payload: AccountWrite,
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> AccountResponse:
    account = Account(
        household_id=context.household_id,
        name=payload.name,
        type=payload.type,
        initial_balance=payload.initial_balance,
    )
    db.add(account)
    try:
        db.flush()
        account, activity_total = _account_row(
            db, account.id, context.household_id
        )
        response = account_response(account, activity_total)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if getattr(exc.orig, "sqlite_errorname", None) == "SQLITE_CONSTRAINT_UNIQUE":
            raise APIError(
                409,
                "CONFLICT",
                "An account with this name already exists.",
                {"name": "Choose a different name."},
            ) from None
        raise
    except Exception:
        db.rollback()
        raise
    db.refresh(account)
    return response


@router.put("/{account_id}", response_model=AccountResponse)
def update_account(
    payload: AccountWrite,
    account_id: int = Path(gt=0),
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> AccountResponse:
    account = get_account(db, account_id, context.household_id)
    if account.is_archived:
        raise APIError(409, "CONFLICT", "Archived accounts are read-only.")
    account.name = payload.name
    account.type = payload.type
    account.initial_balance = payload.initial_balance
    try:
        with db.no_autoflush:
            _, activity_total = _account_row(
                db, account.id, context.household_id
            )
        response = account_response(account, activity_total)
    except Exception:
        db.rollback()
        raise
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if getattr(exc.orig, "sqlite_errorname", None) == "SQLITE_CONSTRAINT_UNIQUE":
            raise APIError(
                409,
                "CONFLICT",
                "An account with this name already exists.",
                {"name": "Choose a different name."},
            ) from None
        raise
    except Exception:
        db.rollback()
        raise
    db.refresh(account)
    return response


@router.post("/{account_id}/archive", status_code=204)
def archive_account(
    account_id: int = Path(gt=0),
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> Response:
    account = get_account(db, account_id, context.household_id)
    if not account.is_archived:
        account.is_archived = True
        try:
            db.commit()
        except Exception:
            db.rollback()
            raise
    return Response(status_code=204)
