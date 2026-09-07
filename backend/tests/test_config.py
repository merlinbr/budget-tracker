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
        session_secret="Ab3!Cd5@Ef7#Gh9$Ij1%Kl3^Mn5&Op7*Qr9(Stu1)Vw3_Xy5-Zz7",
        allowed_origins=["https://budget.example.internal"],
        trusted_hosts=["budget.example.internal"],
        secure_cookies=True,
    )

    assert settings.app_env == "production"


def test_session_age_is_limited_to_thirty_days() -> None:
    assert Settings(session_max_age_days=30).session_max_age_days == 30
    with pytest.raises(ValidationError):
        Settings(session_max_age_days=31)

def test_production_rejects_repeated_session_secret() -> None:
    with pytest.raises(ValidationError):
        Settings(
            app_env="production",
            database_url="sqlite:////app/data/budget.db",
            session_secret="a" * 64,
            allowed_origins=["https://budget.example.internal"],
            trusted_hosts=["budget.example.internal"],
            secure_cookies=True,
        )

def test_production_rejects_repeating_session_pattern() -> None:
    with pytest.raises(ValidationError):
        Settings(
            app_env="production",
            database_url="sqlite:////app/data/budget.db",
            session_secret="abcdefgh" * 4,
            allowed_origins=["https://budget.example.internal"],
            trusted_hosts=["budget.example.internal"],
            secure_cookies=True,
        )
