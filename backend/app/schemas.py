from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

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
