from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy import select
import pytest

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


@pytest.mark.parametrize(
    ("resource", "create_payload", "valid_update"),
    [
        (
            "accounts",
            {"name": "Shared", "type": "checking", "initialBalance": 10},
            {"name": "Updated", "type": "savings", "initialBalance": 20},
        ),
        (
            "categories",
            {"name": "Shared", "type": "expense"},
            {"name": "Updated"},
        ),
    ],
)
def test_financial_resources_are_isolated_between_households(
    resource, create_payload, valid_update, client, test_app, db_session, seeded_user
):
    household_b = Household(name="Household B")
    db_session.add(household_b)
    db_session.flush()
    user_b = User(
        username="household-b-user",
        display_name="Household B User",
        password_hash=hash_password("household b password"),
        is_active=True,
    )
    member_a = User(
        username="household-a-member",
        display_name="Household A Member",
        password_hash=hash_password("household a member password"),
        is_active=True,
    )
    db_session.add_all([user_b, member_a])
    db_session.flush()
    db_session.add_all(
        [
            HouseholdMember(
                household_id=household_b.id, user_id=user_b.id, role="owner"
            ),
            HouseholdMember(
                household_id=seeded_user.household_id,
                user_id=member_a.id,
                role="member",
            ),
        ]
    )
    db_session.commit()

    def login_as(test_client: TestClient, username: str, password: str):
        test_client.get("/api/auth/csrf")
        token = test_client.cookies.get("XSRF-TOKEN")
        assert token
        response = test_client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
            headers={"Origin": "http://127.0.0.1:4200", "X-XSRF-TOKEN": token},
        )
        assert response.status_code == 200, response.text

    login_as(client, seeded_user.username, seeded_user.password)
    created = client.post(
        f"/api/{resource}",
        json=create_payload,
        headers=_csrf_headers(client),
    )
    assert created.status_code == 201, created.text
    resource_id = created.json()["id"]
    resource_url = f"/api/{resource}/{resource_id}"
    before = client.get(resource_url).json()

    with TestClient(test_app) as foreign_client:
        login_as(foreign_client, user_b.username, "household b password")
        foreign_headers = _csrf_headers(foreign_client)
        absent_url = f"/api/{resource}/{resource_id + 10000}"
        absent = foreign_client.get(absent_url)
        assert foreign_client.get(resource_url).status_code == absent.status_code == 404
        assert foreign_client.get(resource_url).json() == absent.json()
        assert (
            foreign_client.put(
                resource_url, json=valid_update, headers=foreign_headers
            ).status_code
            == 404
        )
        assert (
            foreign_client.post(
                resource_url + "/archive", headers=foreign_headers
            ).status_code
            == 404
        )
        assert foreign_client.get(f"/api/{resource}").json() == []
        assert foreign_client.get(f"/api/{resource}?includeArchived=true").json() == []
        duplicate = foreign_client.post(
            f"/api/{resource}", json=create_payload, headers=_csrf_headers(foreign_client)
        )
        assert duplicate.status_code == 201, duplicate.text

    assert client.get(resource_url).json() == before

    with TestClient(test_app) as member_client:
        login_as(member_client, member_a.username, "household a member password")
        assert member_client.put(
            resource_url, json=valid_update, headers=_csrf_headers(member_client)
        ).status_code == 200
        assert member_client.post(
            resource_url + "/archive", headers=_csrf_headers(member_client)
        ).status_code == 204
    assert client.get(resource_url).json()["isArchived"] is True


def _csrf_headers(client: TestClient) -> dict[str, str]:
    response = client.get("/api/auth/csrf")
    assert response.status_code == 204
    token = client.cookies.get("XSRF-TOKEN")
    assert token
    return {"Origin": "http://127.0.0.1:4200", "X-XSRF-TOKEN": token}
