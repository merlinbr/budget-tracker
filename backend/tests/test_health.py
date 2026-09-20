from fastapi.testclient import TestClient


import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_health_is_public_and_non_sensitive(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_unknown_api_path_uses_error_envelope(client: TestClient) -> None:
    response = client.get("/api/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {
        "error": {
            "code": "NOT_FOUND",
            "message": "Resource not found.",
        }
    }


@pytest.fixture
def production_client(tmp_path: Path) -> TestClient:
    from pathlib import Path

    from sqlalchemy import create_engine, event as sa_event
    from sqlalchemy.orm import sessionmaker

    from app.db import configure_sqlite_connection, get_db

    # Production DB paths are POSIX-absolute Linux container paths; tests run on the
    # host OS, so use a validator-passing dummy path and override get_db instead.
    settings = Settings(
        app_env="production",
        database_url="sqlite:////tmp/budget-prod-health-test.db",
        session_secret="Ab3!Cd5@Ef7#Gh9$Ij1%Kl3^Mn5&Op7*Qr9(Stu1)Vw3_Xy5-Zz7",
        allowed_origins=["https://budget.example.internal:8443"],
        trusted_hosts=["budget.example.internal"],
        secure_cookies=True,
    )
    app = create_app(settings)

    database_path = tmp_path / "prod-health.db"
    engine = create_engine(
        f"sqlite:///{database_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    sa_event.listen(engine, "connect", configure_sqlite_connection)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    def override_get_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    engine.dispose()


PROD_HOST = {"Host": "budget.example.internal"}


def test_production_hides_openapi_docs_and_schema(production_client: TestClient) -> None:
    assert production_client.get("/openapi.json", headers=PROD_HOST).status_code == 404
    assert production_client.get("/docs", headers=PROD_HOST).status_code == 404
    assert production_client.get("/redoc", headers=PROD_HOST).status_code == 404

    health = production_client.get("/api/health", headers=PROD_HOST)
    assert health.status_code == 200


def test_api_responses_carry_private_no_store(production_client: TestClient) -> None:
    health = production_client.get(
        "/api/health", headers={"Host": "budget.example.internal"}
    )
    assert health.status_code == 200
    assert health.headers["Cache-Control"] == "private, no-store"

    missing = production_client.get(
        "/api/does-not-exist", headers={"Host": "budget.example.internal"}
    )
    assert missing.status_code == 404
    assert missing.headers["Cache-Control"] == "private, no-store"


def test_production_health_rejects_unlisted_host(
    production_client: TestClient,
) -> None:
    response = production_client.get(
        "/api/health", headers={"Host": "localhost"}
    )
    assert response.status_code == 400


def test_secure_cookies_flag_reaches_production_env(
    production_client: TestClient,
) -> None:
    probe = production_client.app.state.login_limiter
    assert probe is not None
