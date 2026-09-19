from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.auth.passwords import hash_password
from app.models import Account, Budget, Category, Household, HouseholdMember, Transaction, User
from app.money import MAX_SAFE_CENTS


PERIOD = {"year": 2026, "month": 9}


def create_record(client, csrf_headers, route, payload):
    response = client.post(route, json=payload, headers=csrf_headers())
    assert response.status_code == 201, response.text
    return response.json()


def save_budget(client, csrf_headers, category_id, limit, *, year=2026, month=9):
    response = client.put(
        f"/api/budgets/{category_id}", params={"year": year, "month": month},
        json={"limitAmount": limit}, headers=csrf_headers(),
    )
    assert response.status_code == 200, response.text
    return response.json()


def csrf_for(client):
    response = client.get("/api/auth/csrf")
    assert response.status_code == 204
    return {
        "Origin": "http://127.0.0.1:4200",
        "X-XSRF-TOKEN": client.cookies.get("XSRF-TOKEN"),
    }


def login_client(client, username, password):
    response = client.post(
        "/api/auth/login", json={"username": username, "password": password},
        headers=csrf_for(client),
    )
    assert response.status_code == 200, response.text


def seed_actor(db, username, *, household_id=None, role="owner"):
    if household_id is None:
        household = Household(name=username)
        db.add(household)
        db.flush()
        household_id = household.id
    password = "another household password"
    user = User(
        username=username, display_name=username,
        password_hash=hash_password(password), is_active=True,
    )
    db.add(user)
    db.flush()
    db.add(HouseholdMember(household_id=household_id, user_id=user.id, role=role))
    db.commit()
    return household_id, user.id, password


def assert_error(response, status, code):
    assert response.status_code == status, response.text
    assert set(response.json()) == {"error"}
    assert response.json()["error"]["code"] == code


def test_budget_usage_zero_and_removal(authenticated_client, csrf_headers):
    client = authenticated_client

    def create(route, payload):
        result = client.post(route, json=payload, headers=csrf_headers())
        assert result.status_code == 201, result.text
        return result.json()

    account = create("/api/accounts", {"name": "Checking", "type": "checking", "initialBalance": 0})
    category = create("/api/categories", {"name": "Groceries", "type": "expense"})
    create("/api/transactions", {
        "accountId": account["id"], "categoryId": category["id"],
        "amount": -8472, "transactionDate": "2026-09-07",
    })
    params = {"year": 2026, "month": 9}
    route = f"/api/budgets/{category['id']}"
    assert client.get("/api/budgets", params=params).json() == []
    for limit, remaining, progress in [(60000, 51528, 0.1412), (8000, -472, 1.059), (0, -8472, None)]:
        response = client.put(route, params=params, json={"limitAmount": limit}, headers=csrf_headers())
        assert response.status_code == 200, response.text
        expected = {
            "categoryId": category["id"], "categoryName": "Groceries", "isArchived": False,
            "year": 2026, "month": 9, "limitAmount": limit,
            "spent": 8472, "remaining": remaining, "progress": progress,
        }
        assert response.json() == expected
        assert client.get("/api/budgets", params=params).json() == [expected]
        assert client.get("/api/dashboard", params=params).json()["budgets"] == [expected]
    assert client.delete(route, params=params, headers=csrf_headers()).status_code == 204
    assert client.get("/api/budgets", params=params).json() == []
    assert client.get("/api/dashboard", params=params).json()["summary"]["expenses"] == 8472


def test_empty_zero_and_exact_limit_are_configured_budgets(authenticated_client, csrf_headers):
    client = authenticated_client
    food = create_record(client, csrf_headers, "/api/categories", {"name": "Food", "type": "expense"})
    bills = create_record(client, csrf_headers, "/api/categories", {"name": "Bills", "type": "expense"})
    food_budget = save_budget(client, csrf_headers, food["id"], 1000)
    bills_budget = save_budget(client, csrf_headers, bills["id"], 0)
    assert (food_budget["spent"], food_budget["remaining"], food_budget["progress"]) == (0, 1000, 0)
    assert (bills_budget["spent"], bills_budget["remaining"], bills_budget["progress"]) == (0, 0, None)
    expected = [bills_budget, food_budget]
    assert client.get("/api/budgets", params=PERIOD).json() == expected
    assert client.get("/api/dashboard", params=PERIOD).json()["budgets"] == expected

    account = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 0,
    })
    create_record(client, csrf_headers, "/api/transactions", {
        "accountId": account["id"], "categoryId": food["id"],
        "amount": -1000, "transactionDate": "2026-09-30",
    })
    at_limit = client.get("/api/budgets", params=PERIOD).json()[1]
    assert (at_limit["spent"], at_limit["remaining"], at_limit["progress"]) == (1000, 0, 1)


def test_spending_scopes_calendar_signs_accounts_and_household(
    authenticated_client, csrf_headers, db_session, seeded_user,
):
    client = authenticated_client
    account = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 0,
    })
    cash = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Cash", "type": "cash", "initialBalance": 0,
    })
    food = create_record(client, csrf_headers, "/api/categories", {"name": "Food", "type": "expense"})
    salary = create_record(client, csrf_headers, "/api/categories", {"name": "Salary", "type": "income"})
    save_budget(client, csrf_headers, food["id"], 1000)
    for account_id, category_id, amount, day in [
        (account["id"], food["id"], -100, "2026-09-01"),
        (cash["id"], food["id"], -200, "2026-09-30"),
        (account["id"], food["id"], -700, "2026-08-31"),
        (cash["id"], food["id"], -800, "2026-10-01"),
        (account["id"], salary["id"], 5000, "2026-09-07"),
    ]:
        create_record(client, csrf_headers, "/api/transactions", {
            "accountId": account_id, "categoryId": category_id,
            "amount": amount, "transactionDate": day,
        })
    foreign_household, foreign_user, _ = seed_actor(db_session, "budget-foreign-spending")
    # Imported/adversarial rows must not turn income or foreign spending into usage.
    db_session.add_all([
        Transaction(
            household_id=household_id, account_id=account["id"], category_id=category_id,
            amount=amount, transaction_date=date(2026, 9, 7), created_by_user_id=user_id,
        )
        for household_id, user_id, category_id, amount in [
            (seeded_user.household_id, seeded_user.id, food["id"], 400),
            (seeded_user.household_id, seeded_user.id, salary["id"], -500),
            (foreign_household, foreign_user, food["id"], -900),
        ]
    ])
    db_session.commit()
    budget = client.get("/api/budgets", params=PERIOD).json()[0]
    assert (budget["spent"], budget["remaining"], budget["progress"]) == (300, 700, 0.3)
    rejected = client.put(
        f"/api/budgets/{salary['id']}", params=PERIOD,
        json={"limitAmount": 1000}, headers=csrf_headers(),
    )
    assert_error(rejected, 422, "VALIDATION_ERROR")


@pytest.mark.parametrize("year,month,day", [
    (1, 1, "0001-01-31"),
    (2028, 2, "2028-02-29"),
    (9999, 12, "9999-12-31"),
])
def test_calendar_endpoints(authenticated_client, csrf_headers, year, month, day):
    client = authenticated_client
    account = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 0,
    })
    category = create_record(client, csrf_headers, "/api/categories", {"name": "Food", "type": "expense"})
    create_record(client, csrf_headers, "/api/transactions", {
        "accountId": account["id"], "categoryId": category["id"],
        "amount": -123, "transactionDate": day,
    })
    budget = save_budget(client, csrf_headers, category["id"], 1000, year=year, month=month)
    assert (budget["year"], budget["month"], budget["spent"], budget["remaining"]) == (year, month, 123, 877)
    assert client.get("/api/budgets", params={"year": year, "month": month}).json() == [budget]


@pytest.mark.parametrize("payload", [
    {}, {"limitAmount": -1}, {"limitAmount": 1.5}, {"limitAmount": 1.0},
    {"limitAmount": True}, {"limitAmount": "100"}, {"limitAmount": None},
    {"limitAmount": MAX_SAFE_CENTS + 1}, {"limitAmount": 100, "householdId": 1},
])
def test_limit_validation(authenticated_client, csrf_headers, payload):
    client = authenticated_client
    category = create_record(client, csrf_headers, "/api/categories", {"name": "Food", "type": "expense"})
    response = client.put(
        f"/api/budgets/{category['id']}", params=PERIOD,
        json=payload, headers=csrf_headers(),
    )
    assert_error(response, 422, "VALIDATION_ERROR")
    assert response.json()["error"]["fields"]
    assert client.get("/api/budgets", params=PERIOD).json() == []


@pytest.mark.parametrize("method", ["GET", "PUT", "DELETE"])
@pytest.mark.parametrize("params", [
    {}, {"year": 2026}, {"month": 9},
    {"year": 0, "month": 9}, {"year": 10000, "month": 9},
    {"year": 2026, "month": 0}, {"year": 2026, "month": 13},
    {"year": "no", "month": 9}, {"year": 2026, "month": "1.5"},
])
def test_required_bounded_period(authenticated_client, csrf_headers, method, params):
    response = authenticated_client.request(
        method, "/api/budgets" if method == "GET" else "/api/budgets/1",
        params=params, json={"limitAmount": 100} if method == "PUT" else None,
        headers=csrf_headers(),
    )
    assert_error(response, 422, "VALIDATION_ERROR")


@pytest.mark.parametrize("method", ["PUT", "DELETE"])
@pytest.mark.parametrize("category_id", [0, -1, "invalid", 9223372036854775808])
def test_invalid_category_identifiers(authenticated_client, csrf_headers, method, category_id):
    response = authenticated_client.request(
        method, f"/api/budgets/{category_id}", params=PERIOD,
        json={"limitAmount": 100} if method == "PUT" else None, headers=csrf_headers(),
    )
    assert_error(response, 422, "VALIDATION_ERROR")


@pytest.mark.parametrize("payload", [
    {}, {"year": 2026}, {"month": 9},
    {"year": 0, "month": 9}, {"year": 10000, "month": 9},
    {"year": 2026, "month": 0}, {"year": 2026, "month": 13},
    {"year": "2026", "month": 9}, {"year": 2026.0, "month": 9},
    {"year": True, "month": 9}, {"year": 2026, "month": False},
    {"year": 2026, "month": "9"}, {"year": 2026, "month": 9.0},
    {"year": 2026, "month": 9, "overwrite": "true"},
    {"year": 2026, "month": 9, "overwrite": 1},
    {"year": 2026, "month": 9, "overwrite": None},
    {"year": 2026, "month": 9, "householdId": 1},
])
def test_copy_body_is_strict(authenticated_client, csrf_headers, payload):
    response = authenticated_client.post("/api/budgets/copy-previous", json=payload, headers=csrf_headers())
    assert_error(response, 422, "VALIDATION_ERROR")
    assert response.json()["error"]["fields"]


@pytest.mark.parametrize("method,path,payload", [
    ("GET", "/api/budgets", None),
    ("PUT", "/api/budgets/1", {"limitAmount": 100}),
    ("DELETE", "/api/budgets/1", None),
    ("POST", "/api/budgets/copy-previous", PERIOD),
])
def test_anonymous_budget_requests_are_denied(client, csrf_headers, method, path, payload):
    response = client.request(method, path, params=PERIOD, json=payload, headers=csrf_headers())
    assert_error(response, 401, "AUTH_REQUIRED")


@pytest.mark.parametrize("method,path,payload", [
    ("PUT", "/api/budgets/1", {"limitAmount": 100}),
    ("DELETE", "/api/budgets/1", None),
    ("POST", "/api/budgets/copy-previous", PERIOD),
])
def test_budget_writes_require_csrf(authenticated_client, method, path, payload):
    response = authenticated_client.request(
        method, path, params=PERIOD, json=payload, headers={"Origin": "http://127.0.0.1:4200"},
    )
    assert_error(response, 403, "FORBIDDEN")


def test_household_members_share_budgets_and_foreign_requests_are_isolated(
    authenticated_client, csrf_headers, test_app, db_session, seeded_user,
):
    owner = authenticated_client
    own_category = create_record(owner, csrf_headers, "/api/categories", {"name": "Food", "type": "expense"})
    own_budget = save_budget(owner, csrf_headers, own_category["id"], 1000)
    _, _, member_password = seed_actor(
        db_session, "budget-member", household_id=seeded_user.household_id, role="member",
    )
    _, _, foreign_password = seed_actor(db_session, "budget-foreign")
    with TestClient(test_app) as member, TestClient(test_app) as foreign:
        login_client(member, "budget-member", member_password)
        login_client(foreign, "budget-foreign", foreign_password)
        assert member.get("/api/budgets", params=PERIOD).json() == [own_budget]
        assert foreign.get("/api/budgets", params=PERIOD).json() == []
        foreign_category = create_record(foreign, lambda: csrf_for(foreign), "/api/categories", {
            "name": "Foreign Food", "type": "expense",
        })
        foreign_budget = save_budget(foreign, lambda: csrf_for(foreign), foreign_category["id"], 9000)
        for client, other_category in [(owner, foreign_category), (foreign, own_category)]:
            for method in ["PUT", "DELETE"]:
                responses = [
                    client.request(
                        method, f"/api/budgets/{category_id}", params=PERIOD,
                        json={"limitAmount": 77} if method == "PUT" else None,
                        headers=csrf_for(client),
                    )
                    for category_id in [other_category["id"], 999999]
                ]
                for response in responses:
                    assert_error(response, 404, "NOT_FOUND")
                assert responses[0].json() == responses[1].json()
        assert foreign.get("/api/budgets", params=PERIOD).json() == [foreign_budget]
        member_budget = save_budget(member, lambda: csrf_for(member), own_category["id"], 2000)
        assert owner.get("/api/budgets", params=PERIOD).json() == [member_budget]
        for client, expected in [(member, member_budget), (foreign, foreign_budget)]:
            response = client.post(
                "/api/budgets/copy-previous", json={"year": 2026, "month": 10},
                headers=csrf_for(client),
            )
            assert response.status_code == 200, response.text
            assert response.json() == [{**expected, "month": 10}]
        assert owner.get("/api/budgets", params={"year": 2026, "month": 10}).json() == [
            {**member_budget, "month": 10},
        ]
        removed = member.delete(
            f"/api/budgets/{own_category['id']}", params=PERIOD, headers=csrf_for(member),
        )
        assert removed.status_code == 204
        assert owner.get("/api/budgets", params=PERIOD).json() == []
        assert foreign.get("/api/budgets", params=PERIOD).json() == [foreign_budget]


def test_archive_history_can_be_corrected_but_not_created(authenticated_client, csrf_headers):
    client = authenticated_client
    account = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 0,
    })
    category = create_record(client, csrf_headers, "/api/categories", {"name": "Food", "type": "expense"})
    create_record(client, csrf_headers, "/api/transactions", {
        "accountId": account["id"], "categoryId": category["id"],
        "amount": -300, "transactionDate": "2026-09-07",
    })
    original = save_budget(client, csrf_headers, category["id"], 1000)
    renamed = client.put(
        f"/api/categories/{category['id']}", json={"name": "Groceries"}, headers=csrf_headers(),
    )
    assert renamed.status_code == 200, renamed.text
    assert client.get("/api/budgets", params=PERIOD).json() == [
        {**original, "categoryName": "Groceries"},
    ]
    for route, id_ in [("accounts", account["id"]), ("categories", category["id"])]:
        assert client.post(f"/api/{route}/{id_}/archive", headers=csrf_headers()).status_code == 204
    archived = {**original, "categoryName": "Groceries", "isArchived": True}
    assert client.get("/api/budgets", params=PERIOD).json() == [archived]
    assert client.get("/api/dashboard", params=PERIOD).json()["budgets"] == [archived]
    corrected = save_budget(client, csrf_headers, category["id"], 200)
    assert corrected == {**archived, "limitAmount": 200, "remaining": -100, "progress": 1.5}
    route = f"/api/budgets/{category['id']}"
    rejected = client.put(
        route, params={"year": 2026, "month": 10}, json={"limitAmount": 100},
        headers=csrf_headers(),
    )
    assert_error(rejected, 409, "CONFLICT")
    assert "overwrite" not in rejected.json()["error"].get("fields", {})
    assert client.delete(route, params=PERIOD, headers=csrf_headers()).status_code == 204
    assert client.get("/api/budgets", params=PERIOD).json() == []
    rejected = client.put(route, params=PERIOD, json={"limitAmount": 100}, headers=csrf_headers())
    assert_error(rejected, 409, "CONFLICT")
    assert client.get("/api/dashboard", params=PERIOD).json()["summary"]["expenses"] == 300


def test_concurrent_same_key_upserts_keep_one_complete_limit(
    authenticated_client, csrf_headers, test_app, db_session, seeded_user,
):
    client = authenticated_client
    category = create_record(client, csrf_headers, "/api/categories", {"name": "Food", "type": "expense"})
    headers = csrf_headers()
    barrier = Barrier(2)

    def submit(writer, limit):
        barrier.wait(timeout=10)
        return writer.put(
            f"/api/budgets/{category['id']}", params=PERIOD,
            json={"limitAmount": limit}, headers=headers,
        )

    with TestClient(test_app) as first, TestClient(test_app) as second:
        first.cookies.update(client.cookies)
        second.cookies.update(client.cookies)
        with ThreadPoolExecutor(max_workers=2) as executor:
            pending = [
                executor.submit(submit, first, 12345),
                executor.submit(submit, second, 67890),
            ]
            for future, limit in zip(pending, [12345, 67890]):
                response = future.result(timeout=15)
                assert response.status_code == 200, response.text
                assert response.json()["limitAmount"] == limit
    rows = client.get("/api/budgets", params=PERIOD).json()
    assert len(rows) == 1
    assert rows[0]["limitAmount"] in {12345, 67890}
    assert db_session.scalar(select(func.count()).select_from(Budget).where(
        Budget.household_id == seeded_user.household_id, Budget.category_id == category["id"],
        Budget.year == 2026, Budget.month == 9,
    )) == 1


@pytest.mark.parametrize("year,month,limit", [
    (0, 9, 100), (10000, 9, 100), (2026.5, 9, 100),
    (2026, 0, 100), (2026, 13, 100), (2026, 1.5, 100),
    (2026, 9, -1), (2026, 9, 1.5), (2026, 9, "invalid"),
    (2026, 9, MAX_SAFE_CENTS + 1),
])
def test_migrated_budget_constraints_reject_raw_invalid_values(
    authenticated_client, csrf_headers, db_session, seeded_user, year, month, limit,
):
    category = create_record(
        authenticated_client, csrf_headers, "/api/categories", {"name": "Food", "type": "expense"},
    )
    with pytest.raises(IntegrityError):
        db_session.execute(text(
            "INSERT INTO budgets (household_id, category_id, year, month, limit_amount, created_at, updated_at) "
            "VALUES (:household, :category, :year, :month, :limit, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ), {
            "household": seeded_user.household_id, "category": category["id"],
            "year": year, "month": month, "limit": limit,
        })
        db_session.commit()
    db_session.rollback()
    assert authenticated_client.get("/api/budgets", params=PERIOD).json() == []


def test_migrated_budget_key_is_unique(authenticated_client, csrf_headers, db_session, seeded_user):
    category = create_record(
        authenticated_client, csrf_headers, "/api/categories", {"name": "Food", "type": "expense"},
    )
    saved = save_budget(authenticated_client, csrf_headers, category["id"], 100)
    with pytest.raises(IntegrityError):
        db_session.execute(text(
            "INSERT INTO budgets (household_id, category_id, year, month, limit_amount, created_at, updated_at) "
            "VALUES (:household, :category, 2026, 9, 200, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ), {"household": seeded_user.household_id, "category": category["id"]})
        db_session.commit()
    db_session.rollback()
    assert authenticated_client.get("/api/budgets", params=PERIOD).json() == [saved]


def test_copy_collision_is_atomic_and_confirmation_replaces_only_matching_limits(
    authenticated_client, csrf_headers,
):
    client = authenticated_client
    categories = [
        create_record(client, csrf_headers, "/api/categories", {"name": name, "type": "expense"})
        for name in ["A", "B", "C"]
    ]
    a, b, c = [category["id"] for category in categories]
    save_budget(client, csrf_headers, a, 60000, month=8)
    save_budget(client, csrf_headers, b, 20000, month=8)
    save_budget(client, csrf_headers, a, 8000)
    save_budget(client, csrf_headers, c, 30000)
    account = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 0,
    })
    for category_id, amount, day in [
        (a, -500, "2026-08-07"), (a, -100, "2026-09-07"), (b, -200, "2026-09-08"),
    ]:
        create_record(client, csrf_headers, "/api/transactions", {
            "accountId": account["id"], "categoryId": category_id,
            "amount": amount, "transactionDate": day,
        })
    before = client.get("/api/budgets", params=PERIOD).json()
    conflict = client.post("/api/budgets/copy-previous", json=PERIOD, headers=csrf_headers())
    assert_error(conflict, 409, "CONFLICT")
    assert set(conflict.json()["error"]["fields"]) == {"overwrite"}
    assert client.get("/api/budgets", params=PERIOD).json() == before
    confirmed = client.post(
        "/api/budgets/copy-previous", json={**PERIOD, "overwrite": True}, headers=csrf_headers(),
    )
    assert confirmed.status_code == 200, confirmed.text
    assert [
        (row["categoryId"], row["limitAmount"], row["spent"], row["remaining"])
        for row in confirmed.json()
    ] == [(a, 60000, 100, 59900), (b, 20000, 200, 19800), (c, 30000, 0, 30000)]
    assert client.get("/api/budgets", params=PERIOD).json() == confirmed.json()
    assert client.get("/api/dashboard", params=PERIOD).json()["budgets"] == confirmed.json()
    repeated = client.post(
        "/api/budgets/copy-previous", json={**PERIOD, "overwrite": True}, headers=csrf_headers(),
    )
    assert repeated.status_code == 200, repeated.text
    assert repeated.json() == confirmed.json()


def test_copy_january_zero_archives_empty_source_and_lower_calendar_boundary(
    authenticated_client, csrf_headers,
):
    client = authenticated_client
    categories = [
        create_record(client, csrf_headers, "/api/categories", {"name": name, "type": "expense"})
        for name in ["Zero", "Archived source", "Archived target", "Target only"]
    ]
    zero, archived_source, archived_target, target_only = [row["id"] for row in categories]
    for category_id, limit in [(zero, 0), (archived_source, 100), (archived_target, 200)]:
        save_budget(client, csrf_headers, category_id, limit, year=2026, month=12)
    for category_id, limit in [(archived_target, 300), (target_only, 400)]:
        save_budget(client, csrf_headers, category_id, limit, year=2027, month=1)
    for category_id in [archived_source, archived_target]:
        assert client.post(f"/api/categories/{category_id}/archive", headers=csrf_headers()).status_code == 204
    response = client.post(
        "/api/budgets/copy-previous", json={"year": 2027, "month": 1}, headers=csrf_headers(),
    )
    assert response.status_code == 200, response.text
    assert {
        row["categoryId"]: (row["limitAmount"], row["isArchived"]) for row in response.json()
    } == {zero: (0, False), archived_target: (300, True), target_only: (400, False)}
    # Confirmation is a new operation and reads the latest source limits.
    save_budget(client, csrf_headers, zero, 50, year=2026, month=12)
    confirmed = client.post(
        "/api/budgets/copy-previous", json={"year": 2027, "month": 1, "overwrite": True},
        headers=csrf_headers(),
    )
    assert confirmed.status_code == 200, confirmed.text
    assert {row["categoryId"]: row["limitAmount"] for row in confirmed.json()} == {
        zero: 50, archived_target: 300, target_only: 400,
    }
    untouched = save_budget(client, csrf_headers, target_only, 700, year=2028, month=1)
    empty = client.post(
        "/api/budgets/copy-previous", json={"year": 2028, "month": 1}, headers=csrf_headers(),
    )
    assert empty.status_code == 200, empty.text
    assert empty.json() == [untouched]
    earliest = client.post(
        "/api/budgets/copy-previous", json={"year": 1, "month": 1}, headers=csrf_headers(),
    )
    assert_error(earliest, 422, "VALIDATION_ERROR")
    assert "year" in earliest.json()["error"]["fields"]


def test_safe_cent_boundary_overflow_rolls_back_upsert_and_allows_removal(
    authenticated_client, csrf_headers, db_session, seeded_user,
):
    client = authenticated_client
    account = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 0,
    })
    category = create_record(client, csrf_headers, "/api/categories", {"name": "Food", "type": "expense"})
    accepted = save_budget(client, csrf_headers, category["id"], MAX_SAFE_CENTS)
    assert (accepted["limitAmount"], accepted["remaining"]) == (MAX_SAFE_CENTS, MAX_SAFE_CENTS)
    create_record(client, csrf_headers, "/api/transactions", {
        "accountId": account["id"], "categoryId": category["id"],
        "amount": -MAX_SAFE_CENTS, "transactionDate": "2026-09-07",
    })
    at_limit = client.get("/api/budgets", params=PERIOD).json()[0]
    assert (at_limit["spent"], at_limit["remaining"], at_limit["progress"]) == (MAX_SAFE_CENTS, 0, 1)
    db_session.add(Transaction(
        household_id=seeded_user.household_id, account_id=account["id"],
        category_id=category["id"], amount=-1, transaction_date=date(2026, 9, 8),
        created_by_user_id=seeded_user.id,
    ))
    db_session.commit()
    route = f"/api/budgets/{category['id']}"
    overflow = client.get("/api/budgets", params=PERIOD)
    assert_error(overflow, 409, "CONFLICT")
    assert "overwrite" not in overflow.json()["error"].get("fields", {})
    failed_update = client.put(route, params=PERIOD, json={"limitAmount": 100}, headers=csrf_headers())
    assert_error(failed_update, 409, "CONFLICT")
    assert db_session.scalar(select(Budget.limit_amount).where(
        Budget.household_id == seeded_user.household_id, Budget.category_id == category["id"],
        Budget.year == 2026, Budget.month == 9,
    )) == MAX_SAFE_CENTS
    assert client.delete(route, params=PERIOD, headers=csrf_headers()).status_code == 204
    failed_create = client.put(route, params=PERIOD, json={"limitAmount": 100}, headers=csrf_headers())
    assert_error(failed_create, 409, "CONFLICT")
    assert client.get("/api/budgets", params=PERIOD).json() == []
    assert_error(client.delete(route, params=PERIOD, headers=csrf_headers()), 404, "NOT_FOUND")


def test_sqlite_overflow_is_scoped_to_configured_category_household_and_month(
    authenticated_client, csrf_headers, db_session, seeded_user,
):
    client = authenticated_client
    account = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 0,
    })
    food = create_record(client, csrf_headers, "/api/categories", {"name": "Food", "type": "expense"})
    unbudgeted = create_record(client, csrf_headers, "/api/categories", {
        "name": "Unbudgeted", "type": "expense",
    })
    baseline = save_budget(client, csrf_headers, food["id"], 100)
    save_budget(client, csrf_headers, food["id"], 200, month=12)
    foreign_household, foreign_user, _ = seed_actor(db_session, "budget-overflow")
    foreign_account = Account(
        household_id=foreign_household, name="Foreign Checking", type="checking", initial_balance=0,
    )
    foreign_category = Category(household_id=foreign_household, name="Foreign Food", type="expense")
    db_session.add_all([foreign_account, foreign_category])
    db_session.flush()
    db_session.add(Budget(
        household_id=foreign_household, category_id=foreign_category.id,
        year=2026, month=9, limit_amount=100,
    ))
    # Each group exceeds signed SQLite 64-bit SUM, despite every row being safe cents.
    for household_id, user_id, account_id, category_id, month in [
        (foreign_household, foreign_user, foreign_account.id, foreign_category.id, 9),
        (seeded_user.household_id, seeded_user.id, account["id"], food["id"], 12),
        (seeded_user.household_id, seeded_user.id, account["id"], unbudgeted["id"], 9),
    ]:
        db_session.add_all([
            Transaction(
                household_id=household_id, account_id=account_id, category_id=category_id,
                amount=-MAX_SAFE_CENTS, transaction_date=date(2026, month, 7),
                created_by_user_id=user_id,
            )
            for _ in range(1025)
        ])
    db_session.commit()
    assert client.get("/api/budgets", params=PERIOD).json() == [baseline]
    overflow = client.get("/api/budgets", params={"year": 2026, "month": 12})
    assert_error(overflow, 409, "CONFLICT")
    assert "overwrite" not in overflow.json()["error"].get("fields", {})
    failed = client.put(
        f"/api/budgets/{food['id']}", params={"year": 2026, "month": 12},
        json={"limitAmount": 300}, headers=csrf_headers(),
    )
    assert_error(failed, 409, "CONFLICT")
    assert db_session.scalar(select(Budget.limit_amount).where(
        Budget.household_id == seeded_user.household_id, Budget.category_id == food["id"],
        Budget.year == 2026, Budget.month == 12,
    )) == 200
    # Even another configured overflowing category cannot break a healthy category's PUT.
    db_session.add(Budget(
        household_id=seeded_user.household_id, category_id=unbudgeted["id"],
        year=2026, month=9, limit_amount=100,
    ))
    db_session.commit()
    assert_error(client.get("/api/budgets", params=PERIOD), 409, "CONFLICT")
    corrected = save_budget(client, csrf_headers, food["id"], 150)
    assert corrected["remaining"] == 150
    assert client.delete(
        f"/api/budgets/{unbudgeted['id']}", params=PERIOD, headers=csrf_headers(),
    ).status_code == 204
    assert client.get("/api/budgets", params=PERIOD).json() == [corrected]
    assert client.delete(
        f"/api/budgets/{food['id']}", params={"year": 2026, "month": 12},
        headers=csrf_headers(),
    ).status_code == 204
    assert client.get("/api/budgets", params={"year": 2026, "month": 12}).json() == []


@pytest.mark.parametrize("transaction_count", [2, 1025], ids=["safe-cent-overflow", "sqlite-overflow"])
def test_copy_response_overflow_rolls_back_replacements_and_insertions(
    authenticated_client, csrf_headers, db_session, seeded_user, transaction_count,
):
    client = authenticated_client
    a = create_record(client, csrf_headers, "/api/categories", {"name": "A", "type": "expense"})
    b = create_record(client, csrf_headers, "/api/categories", {"name": "B", "type": "expense"})
    save_budget(client, csrf_headers, a["id"], 60000, month=8)
    save_budget(client, csrf_headers, b["id"], 20000, month=8)
    existing = save_budget(client, csrf_headers, a["id"], 8000)
    account = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 0,
    })
    db_session.add_all([
        Transaction(
            household_id=seeded_user.household_id, account_id=account["id"],
            category_id=b["id"], amount=-MAX_SAFE_CENTS,
            transaction_date=date(2026, 9, 7), created_by_user_id=seeded_user.id,
        )
        for _ in range(transaction_count)
    ])
    db_session.commit()
    failed = client.post(
        "/api/budgets/copy-previous", json={**PERIOD, "overwrite": True}, headers=csrf_headers(),
    )
    assert_error(failed, 409, "CONFLICT")
    assert "overwrite" not in failed.json()["error"].get("fields", {})
    assert client.get("/api/budgets", params=PERIOD).json() == [existing]
    # A subsequent unrelated write also proves the failed copy released its transaction.
    corrected = save_budget(client, csrf_headers, a["id"], 9000)
    assert client.get("/api/budgets", params=PERIOD).json() == [corrected]
