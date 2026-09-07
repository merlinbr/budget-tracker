from dataclasses import dataclass
import os
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["TRUSTED_HOSTS"] = "testserver,localhost,127.0.0.1"

from app.auth.passwords import hash_password
from app.auth.sessions import CSRF_COOKIE_NAME
from app.config import Settings, get_settings
from app.db import create_engine_for, get_db
from app.main import create_app
from app.models import Household, HouseholdMember, User


@dataclass(frozen=True)
class SeededUser:
    id: int
    username: str
    password: str
    household_id: int


@pytest.fixture
def test_app(tmp_path: Path):
    database_url = f"sqlite:///{(tmp_path / 'budget.db').as_posix()}"
    settings = Settings(
        app_env="test",
        database_url=database_url,
        session_secret="test-session-secret-" + "a" * 48,
        allowed_origins=["http://localhost:4200", "http://127.0.0.1:4200"],
        trusted_hosts=["testserver", "localhost", "127.0.0.1"],
        secure_cookies=False,
    )

    previous_environment = {
        name: os.environ.get(name)
        for name in (
            "APP_ENV",
            "DATABASE_URL",
            "SESSION_SECRET",
            "ALLOWED_ORIGINS",
            "TRUSTED_HOSTS",
            "SECURE_COOKIES",
        )
    }
    os.environ.update(
        {
            "APP_ENV": "test",
            "DATABASE_URL": database_url,
            "SESSION_SECRET": settings.session_secret,
            "ALLOWED_ORIGINS": ",".join(settings.allowed_origins),
            "TRUSTED_HOSTS": ",".join(settings.trusted_hosts),
            "SECURE_COOKIES": "false",
        }
    )
    get_settings.cache_clear()
    alembic_config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    alembic_config.set_main_option(
        "script_location", str(Path(__file__).parents[1] / "migrations")
    )
    command.upgrade(alembic_config, "head")

    engine = create_engine_for(settings)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    app = create_app(settings)

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    app.state.session_factory = session_factory
    yield app

    app.dependency_overrides.clear()
    engine.dispose()
    for name, value in previous_environment.items():
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value
    get_settings.cache_clear()


@pytest.fixture
def client(test_app) -> TestClient:
    with TestClient(test_app) as test_client:
        yield test_client


@pytest.fixture
def db_session(test_app) -> Session:
    db = test_app.state.session_factory()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def seeded_user(db_session: Session) -> SeededUser:
    household = Household(name="Test Household")
    db_session.add(household)
    db_session.flush()
    password = "correct horse battery staple"
    user = User(
        username="test-user",
        display_name="Test User",
        password_hash=hash_password(password),
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    db_session.add(
        HouseholdMember(
            household_id=household.id,
            user_id=user.id,
            role="owner",
        )
    )
    db_session.commit()
    return SeededUser(user.id, user.username, password, household.id)


@pytest.fixture
def csrf_headers(client: TestClient):
    def make(origin: str = "http://127.0.0.1:4200") -> dict[str, str]:
        response = client.get("/api/auth/csrf")
        assert response.status_code == 204
        token = client.cookies.get(CSRF_COOKIE_NAME)
        assert token is not None
        return {"Origin": origin, "X-XSRF-TOKEN": token}

    return make
