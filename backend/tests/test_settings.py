from __future__ import annotations

import csv
import io
from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import Account, Category, Transaction, utc_now


def _csrf(client: TestClient, csrf_headers) -> dict[str, str]:
    return csrf_headers()


# ---------------------------------------------------------------- profile ---


def test_patch_me_updates_display_name_without_revoking_session(
    authenticated_client, csrf_headers
):
    response = authenticated_client.patch(
        "/api/users/me",
        json={"displayName": "  Renamed member  "},
        headers=csrf_headers(),
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "id": response.json()["id"],
        "username": "test-user",
        "displayName": "Renamed member",
    }
    me = authenticated_client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["user"]["displayName"] == "Renamed member"


def test_patch_me_rejects_anonymous_and_forged_origin(client):
    # Stale/absent CSRF token on unsafe method yields 403 even unauthenticated:
    # the plan fixes CSRF > auth precedence on unsafe requests.
    missing_token = client.patch(
        "/api/users/me",
        json={"displayName": "X"},
        headers={"Origin": "http://127.0.0.1:4200"},
    )
    assert missing_token.status_code == 403
    no_origin = client.patch("/api/users/me", json={"displayName": "X"})
    assert no_origin.status_code == 403


def test_get_household_anonymous_is_401(client):
    assert client.get("/api/household").status_code == 401


def test_patch_me_rejects_missing_csrf(authenticated_client):
    response = authenticated_client.patch(
        "/api/users/me", json={"displayName": "X"}
    )
    assert response.status_code == 403


def test_patch_me_rejects_extra_fields(authenticated_client, csrf_headers):
    response = authenticated_client.patch(
        "/api/users/me",
        json={"displayName": "Name", "username": "evil"},
        headers=csrf_headers(),
    )
    assert response.status_code == 422


def test_patch_me_rejects_blank_and_oversized_name(authenticated_client, csrf_headers):
    blank = authenticated_client.patch(
        "/api/users/me", json={"displayName": "   "}, headers=csrf_headers()
    )
    assert blank.status_code == 422
    oversized = authenticated_client.patch(
        "/api/users/me", json={"displayName": "x" * 101}, headers=csrf_headers()
    )
    assert oversized.status_code == 422


def test_patch_me_member_cannot_change_another_user(
    authenticated_client, csrf_headers, db_session
):
    from app.auth.passwords import hash_password
    from app.models import Household, HouseholdMember, User

    household = Household(name="Other Household")
    db_session.add(household)
    db_session.flush()
    other = User(
        username="other-user",
        display_name="Other",
        password_hash=hash_password("correct horse battery staple"),
        is_active=True,
    )
    db_session.add(other)
    db_session.flush()
    membership = HouseholdMember(role="member", household_id=household.id, user_id=other.id)
    db_session.add(membership)
    db_session.commit()

    response = authenticated_client.patch(
        "/api/users/me",
        json={"displayName": "Hijack"},
        headers=csrf_headers(),
    )
    assert response.status_code == 200
    db_session.refresh(other)
    assert other.display_name == "Other"


def _second_membership(db_session) -> tuple[int, str]:
    from app.auth.passwords import hash_password
    from app.models import Household, HouseholdMember, User

    household = db_session.scalar(select(Household).order_by(Household.id.asc()))
    member = User(
        username="member-user",
        display_name="Member User",
        password_hash=hash_password("correct horse battery staple"),
        is_active=True,
    )
    db_session.add(member)
    db_session.flush()
    db_session.add(
        HouseholdMember(
            role="member", household_id=household.id, user_id=member.id
        )
    )
    db_session.commit()
    return member.id, member.display_name


def test_household_details_lists_members_sorted_without_credentials(
    authenticated_client, db_session
):
    member_id, member_name = _second_membership(db_session)
    response = authenticated_client.get("/api/household")
    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "Test Household"
    display_names = [item["displayName"] for item in payload["members"]]
    assert display_names == sorted(display_names)
    ids = {item["id"] for item in payload["members"]}
    assert ids == {1, member_id}
    owner_row = next(row for row in payload["members"] if row["role"] == "owner")
    assert owner_row["isActive"] is True
    user_id_of_owner = owner_row["id"]
    me = authenticated_client.get("/api/auth/me")
    assert me.json()["user"]["id"] == user_id_of_owner
    assert sorted(item["isActive"] for item in payload["members"]) == [True, True]
    text = response.text
    assert "password" not in text.lower()
    assert "token" not in text.lower()


def test_household_details_label_inactive_member(
    authenticated_client, db_session
):
    _second_membership(db_session)
    from app.models import User

    member = db_session.scalar(select(User).where(User.username == "member-user"))
    member.is_active = False
    db_session.commit()

    response = authenticated_client.get("/api/household")
    assert response.status_code == 200
    members = response.json()["members"]
    member_row = next(
        row for row in members if row["displayName"] == "Member User"
    )
    assert member_row["isActive"] is False


def test_household_requires_authentication(client):
    assert client.get("/api/household").status_code == 401


# --------------------------------------------------------------- password ---
# Covered in tests/test_auth.py; wrong-current-password regression on 422.
