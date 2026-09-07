from pydantic import BaseModel, ConfigDict, Field


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


class HouseholdResponse(BaseModel):
    id: int
    name: str


class AuthState(BaseModel):
    user: UserResponse
    household: HouseholdResponse

    model_config = ConfigDict(populate_by_name=True)
