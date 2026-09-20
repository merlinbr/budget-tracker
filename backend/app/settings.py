from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth.dependencies import HouseholdContext, require_household
from .db import get_db
from .models import Household, HouseholdMember, User
from .schemas import ResourceName, UserResponse

router = APIRouter(prefix="/api", tags=["settings"])


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    display_name: ResourceName = Field(alias="displayName")


class HouseholdMemberResponse(BaseModel):
    id: int
    display_name: str = Field(alias="displayName")
    role: str
    is_active: bool = Field(alias="isActive")

    model_config = ConfigDict(populate_by_name=True)


class HouseholdDetailsResponse(BaseModel):
    id: int
    name: str
    members: list[HouseholdMemberResponse]


@router.patch("/users/me", response_model=UserResponse)
def update_my_profile(
    payload: ProfileUpdate,
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> UserResponse:
    user = db.get(User, context.user_id)
    if user is None:
        from .errors import APIError

        raise APIError(401, "AUTH_REQUIRED", "Authentication is required.")
    user.display_name = payload.display_name
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(user)
    return user


@router.get("/household", response_model=HouseholdDetailsResponse)
def get_my_household(
    context: HouseholdContext = Depends(require_household),
    db: Session = Depends(get_db),
) -> HouseholdDetailsResponse:
    household = db.get(Household, context.household_id)
    if household is None:
        from .errors import APIError

        raise APIError(401, "AUTH_REQUIRED", "Authentication is required.")
    rows = db.execute(
        select(User, HouseholdMember)
        .join(HouseholdMember, HouseholdMember.user_id == User.id)
        .where(HouseholdMember.household_id == context.household_id)
        .order_by(User.display_name.asc(), User.id.asc())
    ).all()
    members = [
        HouseholdMemberResponse(
            id=user.id,
            display_name=user.display_name,
            role=membership.role,
            is_active=user.is_active,
        )
        for user, membership in rows
    ]
    return HouseholdDetailsResponse(
        id=household.id, name=household.name, members=members
    )
