import pytest
from pydantic import ValidationError

from app.config import Settings


def test_production_rejects_insecure_defaults() -> None:
    with pytest.raises(ValidationError):
        Settings(
            app_env="production",
            database_url="sqlite:////app/data/budget.db",
            allowed_origins=["http://localhost"],
            trusted_hosts=["localhost"],
            secure_cookies=False,
        )


def test_production_accepts_explicit_secure_configuration() -> None:
    settings = Settings(
        app_env="production",
        database_url="sqlite:////app/data/budget.db",
        session_secret="a" * 64,
        allowed_origins=["https://budget.example.internal"],
        trusted_hosts=["budget.example.internal"],
        secure_cookies=True,
    )

    assert settings.app_env == "production"
