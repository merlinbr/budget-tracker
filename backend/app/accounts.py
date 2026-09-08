from fastapi import APIRouter, Depends, Path, Query, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth.dependencies import HouseholdContext, require_household
from .db import get_db
from .errors import APIError
from .models import Account
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


def account_response(account: Account) -> AccountResponse:
    return AccountResponse(
        id=account.id,
        name=account.name,
        type=account.type,
        initial_balance=account.initial_balance,
        balance=account.initial_balance,
        is_archived=account.is_archived,
    )


@router.get("", response_model=list[AccountResponse])
def list_accounts(
    include_archived: bool = Query(False, alias="includeArchived"),
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> list[AccountResponse]:
    query = select(Account).where(Account.household_id == context.household_id)
    if not include_archived:
        query = query.where(Account.is_archived.is_(False))
    accounts = db.scalars(query.order_by(Account.name, Account.id)).all()
    return [account_response(account) for account in accounts]


@router.get("/{account_id}", response_model=AccountResponse)
def get_account_route(
    account_id: int = Path(gt=0),
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> AccountResponse:
    return account_response(get_account(db, account_id, context.household_id))


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
    return account_response(account)


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
    return account_response(account)


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
