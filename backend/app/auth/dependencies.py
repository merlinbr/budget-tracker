from dataclasses import dataclass
from typing import Literal

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import get_db
from ..errors import APIError
from ..models import Household, HouseholdMember, User
from .sessions import find_session


@dataclass(frozen=True)
class HouseholdContext:
    user_id: int
    household_id: int
    role: Literal["owner", "member"]


def _reject_authentication(request: Request) -> None:
    if request.cookies.get("budget_session"):
        request.state.clear_auth_cookies = True
    raise APIError(401, "AUTH_REQUIRED", "Authentication is required.")


def require_household(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> HouseholdContext:
    session = find_session(request, db)
    if session is None:
        _reject_authentication(request)

    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        _reject_authentication(request)

    membership = db.scalar(
        select(HouseholdMember).where(HouseholdMember.user_id == user.id)
    )
    if membership is None or db.get(Household, membership.household_id) is None:
        _reject_authentication(request)

    role: Literal["owner", "member"]
    if membership.role not in {"owner", "member"}:
        _reject_authentication(request)
    role = membership.role  # type: ignore[assignment]
    return HouseholdContext(
        user_id=user.id,
        household_id=membership.household_id,
        role=role,
    )
