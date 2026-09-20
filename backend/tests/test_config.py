import pytest
from pydantic import ValidationError

from app.config import Settings

_BASE_TEST_SETTINGS: dict[str, object] = {
    "app_env": "test",
    "database_url": "sqlite:///:memory:",
    "session_secret": "test-session-secret-" + "a" * 48,
    "allowed_origins": ["http://localhost:4200"],
    "trusted_hosts": ["testserver"],
    "secure_cookies": False,
}


def _production(**overrides: object) -> dict[str, object]:
    settings: dict[str, object] = {
        "app_env": "production",
        "database_url": "sqlite:////app/data/budget.db",
        "session_secret": "Ab3!Cd5@Ef7#Gh9$Ij1%Kl3^Mn5&Op7*Qr9(Stu1)Vw3_Xy5-Zz7",
        "allowed_origins": ["https://budget.example.internal"],
        "trusted_hosts": ["budget.example.internal"],
        "secure_cookies": True,
    }
    settings.update(overrides)
    return settings


def test_development_defaults_still_start() -> None:
    settings = Settings(**_BASE_TEST_SETTINGS)

    assert settings.app_env == "test"
    assert settings.allowed_origins == ["http://localhost:4200"]
    assert settings.trusted_hosts == ["testserver"]
    assert settings.secure_cookies is False


def test_production_accepts_exact_origin_with_nondefault_port() -> None:
    settings = Settings(
        **_production(
            allowed_origins=["https://budget.example.internal"],
            trusted_hosts=["budget.example.internal"],
        )
    )
    assert settings.allowed_origins == ["https://budget.example.internal"]

    settings = Settings(
        **_production(
            allowed_origins=["https://budget.example.internal:8443"],
            trusted_hosts=["budget.example.internal"],
        )
    )
    assert settings.allowed_origins == ["https://budget.example.internal:8443"]


@pytest.mark.parametrize(
    ("origin",),
    [
        ("http://budget.example.internal",),
        ("https://user@budget.example.internal",),
        ("https://user:secret@budget.example.internal",),
        ("https://budget.example.internal/",),
        ("https://*.example.internal",),
        ("https://budget.example.internal/private",),
        ("https://budget.example.internal/', 'https://evil.example",),
        ("https://budget.example.internal:hidden\x1b",),
        ("https://budget.example.internal?q=1",),
        ("https://budget.example.internal#frag",),
        ("https://budget.example.internal:not-a-port",),
        ("https://budget.example.internal:99999",),
        ("https://budget.example.internal ",),
        (" https://budget.example.internal",),
        ("https://budget.example.internal:8443 ",),
    ],
)
def test_production_rejects_invalid_origins(origin: str) -> None:
    with pytest.raises(ValidationError):
        Settings(**_production(allowed_origins=[origin]))


def test_production_rejects_origin_hostname_missing_from_trusted_hosts() -> None:
    with pytest.raises(ValidationError):
        Settings(
            **_production(
                allowed_origins=["https://budget.example.internal"],
                trusted_hosts=["other.example.internal"],
            )
        )


def test_production_requires_origin_hostname_equality_not_suffix_match() -> None:
    with pytest.raises(ValidationError):
        Settings(
            **_production(
                allowed_origins=["https://budget.example.internal"],
                trusted_hosts=["example.internal"],
            )
        )


def test_production_accepts_matching_portless_trusted_host_for_port_origin() -> None:
    settings = Settings(
        **_production(
            allowed_origins=["https://budget.example.internal:8443"],
            trusted_hosts=["budget.example.internal"],
        )
    )
    assert settings.trusted_hosts == ["budget.example.internal"]


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


@pytest.mark.parametrize(
    "trusted_hosts",
    [
        ["*"],
        ["budget.example.internal/*"],
        ["*.example.internal"],
        ["https://budget.example.internal"],
        ["budget.example.internal/path"],
        ["localhost"],
        ["127.0.0.1"],
        ["[::1]"],
        ["budget.example.internal ", "budget.example.internal\t"],
        [],
    ],
)
def test_production_rejects_invalid_trusted_hosts(trusted_hosts: list[str]) -> None:
    with pytest.raises(ValidationError):
        Settings(
            **_production(
                allowed_origins=["https://budget.example.internal"],
                trusted_hosts=trusted_hosts,
            )
        )


def test_production_rejects_relative_database_path() -> None:
    with pytest.raises(ValidationError):
        Settings(**_production(database_url="sqlite:///../data/budget.db"))
