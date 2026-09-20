from datetime import timedelta
import hashlib

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth.passwords import hash_password
from app.auth.sessions import SESSION_COOKIE_NAME
from app.models import HouseholdMember, User, UserSession, utc_now


def login(client: TestClient, csrf_headers, username: str, password: str):
    return client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
        headers=csrf_headers(),
    )


def test_valid_login_me_and_hashed_session(client, seeded_user, csrf_headers, db_session):
    response = login(client, csrf_headers, seeded_user.username, seeded_user.password)
    assert response.status_code == 200
    assert response.json() == {
        "user": {
            "id": seeded_user.id,
            "username": seeded_user.username,
            "displayName": "Test User",
        },
        "household": {"id": seeded_user.household_id, "name": "Test Household"},
    }
    raw_token = client.cookies.get(SESSION_COOKIE_NAME)
    assert raw_token
    session = db_session.scalar(select(UserSession))
    assert session is not None
    assert session.token_hash == hashlib.sha256(raw_token.encode()).hexdigest()
    assert session.token_hash != raw_token
    assert "password" not in response.text.lower()
    assert client.get("/api/auth/me").status_code == 200


def test_unknown_and_wrong_password_are_same_public_error(client, seeded_user, csrf_headers):
    wrong = login(client, csrf_headers, seeded_user.username, "wrong password!")
    unknown = login(client, csrf_headers, "missing-user", "wrong password!")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {
        "error": {
            "code": "INVALID_CREDENTIALS",
            "message": "Invalid username or password.",
        }
    }


def test_logout_revokes_copied_session(client, seeded_user, csrf_headers):
    assert login(client, csrf_headers, seeded_user.username, seeded_user.password).status_code == 200
    token = client.cookies.get(SESSION_COOKIE_NAME)
    assert token
    assert client.post("/api/auth/logout", headers=csrf_headers()).status_code == 204
    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, token)
    assert client.get("/api/auth/me").status_code == 401

def test_login_invalidates_presented_session_even_when_switching_users(
    client, seeded_user, csrf_headers, db_session
):
    second_user = User(
        username="second-user",
        display_name="Second User",
        password_hash=hash_password("second correct password"),
        is_active=True,
    )
    db_session.add(second_user)
    db_session.flush()
    db_session.add(
        HouseholdMember(
            household_id=seeded_user.household_id,
            user_id=second_user.id,
            role="member",
        )
    )
    db_session.commit()

    assert login(client, csrf_headers, seeded_user.username, seeded_user.password).status_code == 200
    first_token = client.cookies.get(SESSION_COOKIE_NAME)
    assert first_token
    assert login(client, csrf_headers, "second-user", "second correct password").status_code == 200

    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, first_token)
    assert client.get("/api/auth/me").status_code == 401


def test_expired_session_is_rejected_and_cookie_cleared(client, seeded_user, csrf_headers, db_session):
    assert login(client, csrf_headers, seeded_user.username, seeded_user.password).status_code == 200
    token = client.cookies.get(SESSION_COOKIE_NAME)
    assert token
    session = db_session.scalar(
        select(UserSession).where(
            UserSession.token_hash == hashlib.sha256(token.encode()).hexdigest()
        )
    )
    assert session is not None
    session.expires_at = utc_now() - timedelta(seconds=1)
    db_session.commit()

    response = client.get("/api/auth/me")
    assert response.status_code == 401
    assert client.cookies.get(SESSION_COOKIE_NAME) is None


def test_password_change_revokes_all_devices(client, test_app, seeded_user, csrf_headers):
    second = TestClient(test_app)
    try:
        assert login(
            client, csrf_headers, seeded_user.username, seeded_user.password
        ).status_code == 200
        second.get("/api/auth/csrf")
        second_headers = {
            "Origin": "http://127.0.0.1:4200",
            "X-XSRF-TOKEN": second.cookies.get("XSRF-TOKEN"),
        }
        assert login(
            second,
            lambda: second_headers,
            seeded_user.username,
            seeded_user.password,
        ).status_code == 200

        wrong = client.post(
            "/api/auth/change-password",
            json={
                "currentPassword": "wrong password!",
                "newPassword": "new correct password",
            },
            headers=csrf_headers(),
        )
        assert wrong.status_code == 422
        assert wrong.json()["error"]["code"] == "VALIDATION_ERROR"
        assert wrong.json()["error"]["fields"] == {
            "currentPassword": "Current password is incorrect."
        }
        # Password unchanged: old password still authenticates.
        retry = client.post(
            "/api/auth/login",
            json={"username": seeded_user.username, "password": seeded_user.password},
            headers=csrf_headers(),
        )
        assert retry.status_code == 200
        assert client.get("/api/auth/me").status_code == 200
        assert second.get("/api/auth/me").status_code == 200

        changed = client.post(
            "/api/auth/change-password",
            json={
                "currentPassword": seeded_user.password,
                "newPassword": "new correct password",
            },
            headers=csrf_headers(),
        )
        assert changed.status_code == 204
        assert client.get("/api/auth/me").status_code == 401
        assert second.get("/api/auth/me").status_code == 401
    finally:
        second.close()
