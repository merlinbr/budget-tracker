from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth.dependencies import HouseholdContext, require_household
from app.auth.passwords import hash_password
from app.models import Household, HouseholdMember, User


def test_two_households_resolve_both_memberships_and_ignore_client_scope(
    client, test_app, db_session
):
    first_household = Household(name="First")
    second_household = Household(name="Second")
    db_session.add_all([first_household, second_household])
    db_session.flush()
    first_user = User(
        username="first",
        display_name="First",
        password_hash=hash_password("first correct password"),
        is_active=True,
    )
    second_user = User(
        username="second",
        display_name="Second",
        password_hash=hash_password("second correct password"),
        is_active=True,
    )
    db_session.add_all([first_user, second_user])
    db_session.flush()
    db_session.add_all(
        [
            HouseholdMember(
                household_id=first_household.id, user_id=first_user.id, role="owner"
            ),
            HouseholdMember(
                household_id=second_household.id, user_id=second_user.id, role="member"
            ),
        ]
    )
    db_session.commit()

    @test_app.get("/api/test-household")
    def household(
        household_id: int | None = None,
        context: HouseholdContext = Depends(require_household),
    ):
        return {"householdId": context.household_id, "userId": context.user_id}

    def login_as(test_client: TestClient, username: str, password: str):
        test_client.get("/api/auth/csrf")
        return test_client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
            headers={
                "Origin": "http://127.0.0.1:4200",
                "X-XSRF-TOKEN": test_client.cookies.get("XSRF-TOKEN"),
            },
        )

    assert login_as(client, "first", "first correct password").status_code == 200
    assert client.get("/api/auth/me").json()["household"]["id"] == first_household.id
    assert client.get(
        "/api/test-household", params={"household_id": second_household.id}
    ).json() == {"householdId": first_household.id, "userId": first_user.id}

    with TestClient(test_app) as second_client:
        assert login_as(second_client, "second", "second correct password").status_code == 200
        assert (
            second_client.get("/api/auth/me").json()["household"]["id"]
            == second_household.id
        )
        assert second_client.get(
            "/api/test-household", params={"household_id": first_household.id}
        ).json() == {"householdId": second_household.id, "userId": second_user.id}


def test_membership_removal_denies_existing_session(client, db_session, seeded_user, csrf_headers):
    assert client.post(
        "/api/auth/login",
        json={"username": seeded_user.username, "password": seeded_user.password},
        headers=csrf_headers(),
    ).status_code == 200

    membership = db_session.execute(
        select(HouseholdMember).where(
            HouseholdMember.user_id == seeded_user.id,
            HouseholdMember.household_id == seeded_user.household_id,
        )
    ).scalar_one()
    db_session.delete(membership)
    db_session.commit()

    assert client.get("/api/auth/me").status_code == 401


def test_inactive_user_denies_existing_session(client, db_session, seeded_user, csrf_headers):
    assert client.post(
        "/api/auth/login",
        json={"username": seeded_user.username, "password": seeded_user.password},
        headers=csrf_headers(),
    ).status_code == 200

    user = db_session.get(User, seeded_user.id)
    assert user is not None
    user.is_active = False
    db_session.commit()

    assert client.get("/api/auth/me").status_code == 401
