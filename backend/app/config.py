from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: Literal["development", "test", "production"] = "development"
    database_url: str = "sqlite:///../data/budget.db"
    session_secret: str = "development-only-secret"
    session_max_age_days: int = 30
    allowed_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:4200", "http://127.0.0.1:4200"]
    )
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
        if value < 1 or value > 30:
            raise ValueError("session_max_age_days must be between 1 and 30")
        return value

    @model_validator(mode="after")
    def validate_environment(self) -> "Settings":
        if not self.database_url.startswith("sqlite:"):
            raise ValueError("DATABASE_URL must use SQLite")

        if self.app_env != "production":
            return self
        if (
            len(self.session_secret) < 32
            or len(set(self.session_secret)) < 8
            or any(
                len(self.session_secret) % width == 0
                and self.session_secret
                == self.session_secret[:width]
                * (len(self.session_secret) // width)
                for width in range(1, len(self.session_secret) // 2 + 1)
            )
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
        self.validate_production_origins()
        self.validate_production_trusted_hosts()
        if not self.database_url.startswith("sqlite:////"):
            raise ValueError("production DATABASE_URL must use an absolute SQLite path")
        return self

    def validate_production_origins(self) -> None:
        if not self.allowed_origins or any(
            not _is_exact_https_origin(origin) for origin in self.allowed_origins
        ):
            raise ValueError("production ALLOWED_ORIGINS must contain only exact HTTPS origins")
        trusted = set(self.trusted_hosts)
        for origin in self.allowed_origins:
            if _origin_hostname(origin) not in trusted:
                raise ValueError(
                    "every production ALLOWED_ORIGINS hostname must appear in TRUSTED_HOSTS"
                )

    def validate_production_trusted_hosts(self) -> None:
        if not self.trusted_hosts or any(
            not _is_exact_trusted_host(host) for host in self.trusted_hosts
        ):
            raise ValueError(
                "production TRUSTED_HOSTS must be exact hostnames without wildcards, URLs or loopback"
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()


def _is_exact_https_origin(origin: str) -> bool:
    if origin != origin.strip() or not origin.startswith("https://"):
        return False
    return _origin_hostname(origin) is not None


def _origin_hostname(origin: str) -> str | None:
    try:
        parts = urlsplit(origin)
        hostname = parts.hostname
        port = parts.port
    except ValueError:
        return None
    if parts.scheme != "https":
        return None
    if parts.username is not None or parts.password is not None:
        return None
    if parts.path != "" or parts.query or parts.fragment:
        return None
    if hostname is None or "*" in hostname or ":" in hostname or not hostname.isascii():
        return None
    if not _is_exact_trusted_host(hostname):
        return None
    body = origin[len("https://"):]
    if ":" in body:
        if body != f"{hostname}:{port}":
            return None
    elif port is not None:
        return None
    return hostname


def _is_exact_trusted_host(host: str) -> bool:
    if (
        not host
        or host != host.strip()
        or not host.isascii()
        or any(char in host for char in "/:?@#")
    ):
        return False
    if host in {"*", "localhost", "127.0.0.1", "[::1]"}:
        return False
    if host.endswith(".localhost"):
        return False
    try:
        parsed = urlsplit(f"https://{host}")
    except ValueError:
        return False
    if parsed.hostname != host.lower() or parsed.port is not None:
        return False
    if parsed.username is not None or parsed.password is not None:
        return False
    return True
