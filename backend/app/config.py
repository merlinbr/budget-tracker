from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: Literal["development", "test", "production"] = "development"
    database_url: str = "sqlite:///../data/budget.db"
    session_secret: str = "development-only-secret"
    session_max_age_days: int = 30
    allowed_origins: list[str] = Field(default_factory=lambda: ["http://localhost:4200"])
    trusted_hosts: list[str] = Field(default_factory=lambda: ["localhost", "127.0.0.1"])
    secure_cookies: bool = False

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        enable_decoding=False,
        extra="ignore",
    )

    @field_validator("allowed_origins", "trusted_hosts", mode="before")
    @classmethod
    def parse_csv(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("session_max_age_days")
    @classmethod
    def validate_session_age(cls, value: int) -> int:
        if value < 1 or value > 365:
            raise ValueError("session_max_age_days must be between 1 and 365")
        return value

    @model_validator(mode="after")
    def validate_environment(self) -> "Settings":
        if not self.database_url.startswith("sqlite:"):
            raise ValueError("DATABASE_URL must use SQLite")

        if self.app_env != "production":
            return self

        if (
            len(self.session_secret) < 32
            or self.session_secret.lower() in {
                "change_me",
                "change-me",
                "development-only-secret",
                "development-only-replace-before-production",
            }
        ):
            raise ValueError("SESSION_SECRET must be a high-entropy production secret")
        if not self.secure_cookies:
            raise ValueError("SECURE_COOKIES must be true in production")
        if not self.allowed_origins or any(
            not origin.startswith("https://") for origin in self.allowed_origins
        ):
            raise ValueError("production ALLOWED_ORIGINS must contain only HTTPS origins")
        if not self.trusted_hosts or any(
            host in {"*", "localhost", "127.0.0.1"} for host in self.trusted_hosts
        ):
            raise ValueError("production TRUSTED_HOSTS must contain exact non-local hosts")
        if not self.database_url.startswith("sqlite:////"):
            raise ValueError("production DATABASE_URL must use an absolute SQLite path")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
