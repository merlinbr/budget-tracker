import re
from datetime import date, datetime, timezone
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    field_serializer,
    field_validator,
)

from .money import Cents


def clean_resource_name(value: str) -> str:
    value = value.strip()
    if not 1 <= len(value) <= 100:
        raise ValueError("Name must contain 1–100 characters.")
    return value


ResourceName = Annotated[str, AfterValidator(clean_resource_name)]
AccountType = Literal["checking", "savings", "cash", "credit_card", "other"]
CategoryType = Literal["income", "expense"]


class AuthRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class LoginRequest(AuthRequest):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=12, max_length=1024)


class ChangePasswordRequest(AuthRequest):
    current_password: str = Field(
        alias="currentPassword", min_length=12, max_length=1024
    )
    new_password: str = Field(alias="newPassword", min_length=12, max_length=1024)

    model_config = ConfigDict(
        extra="forbid", strict=True, populate_by_name=True
    )


class UserResponse(BaseModel):
    id: int
    username: str
    display_name: str = Field(alias="displayName")

    model_config = ConfigDict(populate_by_name=True)



class AccountWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    name: ResourceName
    type: AccountType
    initial_balance: Cents = Field(alias="initialBalance")


class CategoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    name: ResourceName
    type: CategoryType


class CategoryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    name: ResourceName


class AccountResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: int
    name: str
    type: AccountType
    initial_balance: Cents = Field(alias="initialBalance")
    balance: Cents
    is_archived: bool = Field(alias="isArchived")


class TransactionWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    account_id: Annotated[int, Field(alias="accountId", gt=0)]
    category_id: Annotated[int, Field(alias="categoryId", gt=0)]
    amount: Cents
    description: Annotated[str | None, Field(max_length=500)] = None
    transaction_date: date = Field(alias="transactionDate")

    @field_validator("amount")
    @classmethod
    def nonzero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("Amount must not be zero.")
        return value

    @field_validator("transaction_date", mode="before")
    @classmethod
    def calendar_date(cls, value: object) -> date:
        if not isinstance(value, str) or not re.fullmatch(
            r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value
        ):
            raise ValueError("Use a valid YYYY-MM-DD date.")
        try:
            return date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("Use a valid YYYY-MM-DD date.") from exc

    @field_validator("description")
    @classmethod
    def empty_description(cls, value: str | None) -> str | None:
        return None if value == "" else value


class TransactionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    account_id: int = Field(alias="accountId")
    category_id: int = Field(alias="categoryId")
    amount: Cents
    description: str | None
    transaction_date: date = Field(alias="transactionDate")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    @field_serializer("created_at", "updated_at")
    def serialize_timestamp(self, value: datetime) -> str:
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class CategoryResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: int
    name: str
    type: CategoryType
    is_archived: bool = Field(alias="isArchived")


class HouseholdResponse(BaseModel):
    id: int
    name: str


class AuthState(BaseModel):
    user: UserResponse
    household: HouseholdResponse

    model_config = ConfigDict(populate_by_name=True)
