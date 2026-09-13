import logging
import os
import sqlite3
import traceback
from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.engine import make_url

from app.auth.passwords import hash_password
from app.models import Household, HouseholdMember, Transaction, User
from app.money import MAX_SAFE_CENTS


def login(client, seeded_user, csrf_headers):
    response = client.post(
        "/api/auth/login",
        json={"username": seeded_user.username, "password": seeded_user.password},
        headers=csrf_headers(),
    )
    assert response.status_code == 200, response.text



def login_client(client, username, password):
    response = client.get("/api/auth/csrf")
    assert response.status_code == 204
    token = client.cookies.get("XSRF-TOKEN")
    assert token
    response = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
        headers={"Origin": "http://127.0.0.1:4200", "X-XSRF-TOKEN": token},
    )
    assert response.status_code == 200, response.text


def csrf_for(client):
    response = client.get("/api/auth/csrf")
    assert response.status_code == 204
    return {
        "Origin": "http://127.0.0.1:4200",
        "X-XSRF-TOKEN": client.cookies.get("XSRF-TOKEN"),
    }

def create_record(client, csrf_headers, route, payload):
    response = client.post(route, json=payload, headers=csrf_headers())
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def transaction_setup(client, seeded_user, csrf_headers):
    login(client, seeded_user, csrf_headers)
    account = create_record(
        client,
        csrf_headers,
        "/api/accounts",
        {"name": "Checking", "type": "checking", "initialBalance": 100000},
    )
    category = create_record(
        client,
        csrf_headers,
        "/api/categories",
        {"name": "Groceries", "type": "expense"},
    )
    payload = {
        "accountId": account["id"],
        "categoryId": category["id"],
        "amount": -8472,
        "description": "REWE",
        "transactionDate": "2026-09-07",
    }
    return client, csrf_headers, payload


def test_transaction_write_lifecycle(client, seeded_user, csrf_headers):
    login(client, seeded_user, csrf_headers)
    account = create_record(
        client,
        csrf_headers,
        "/api/accounts",
        {"name": "Checking", "type": "checking", "initialBalance": 100000},
    )
    category = create_record(
        client,
        csrf_headers,
        "/api/categories",
        {"name": "Groceries", "type": "expense"},
    )
    payload = {
        "accountId": account["id"],
        "categoryId": category["id"],
        "amount": -8472,
        "description": "REWE",
        "transactionDate": "2026-09-07",
    }

    saved = create_record(client, csrf_headers, "/api/transactions", payload)
    assert set(saved) == {
        "id",
        "accountId",
        "categoryId",
        "amount",
        "description",
        "transactionDate",
        "createdAt",
        "updatedAt",
    }
    assert saved["transactionDate"] == "2026-09-07"
    assert saved["createdAt"].endswith("Z")
    url = f"/api/transactions/{saved['id']}"
    assert client.get(url).json()["amount"] == -8472

    changed = client.put(
        url, json={**payload, "amount": -9000}, headers=csrf_headers()
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["amount"] == -9000
    assert changed.json()["createdAt"] == saved["createdAt"]

    removed = client.delete(url, headers=csrf_headers())
    assert removed.status_code == 204 and removed.content == b""
    assert client.get(url).status_code == 404
    assert client.delete(url, headers=csrf_headers()).status_code == 404


def test_balance_tracks_transaction_corrections(transaction_setup):
    client, csrf_headers, groceries_body = transaction_setup
    checking_id = groceries_body["accountId"]
    salary = create_record(
        client,
        csrf_headers,
        "/api/categories",
        {"name": "Salary", "type": "income"},
    )
    netflix = create_record(
        client,
        csrf_headers,
        "/api/categories",
        {"name": "Netflix", "type": "expense"},
    )
    create_record(
        client,
        csrf_headers,
        "/api/transactions",
        {
            **groceries_body,
            "categoryId": salary["id"],
            "amount": 350000,
            "description": "Salary",
        },
    )
    groceries = create_record(
        client, csrf_headers, "/api/transactions", groceries_body
    )
    subscription = create_record(
        client,
        csrf_headers,
        "/api/transactions",
        {
            **groceries_body,
            "categoryId": netflix["id"],
            "amount": -1799,
            "description": "Netflix",
        },
    )
    account_url = f"/api/accounts/{checking_id}"
    assert client.get(account_url).json()["balance"] == 439729

    changed = client.put(
        f"/api/transactions/{groceries['id']}",
        json={**groceries_body, "amount": -9000},
        headers=csrf_headers(),
    )
    assert changed.status_code == 200
    assert client.get(account_url).json()["balance"] == 439201

    removed = client.delete(
        f"/api/transactions/{subscription['id']}", headers=csrf_headers()
    )
    assert removed.status_code == 204
    assert client.get(account_url).json()["balance"] == 441000



def test_balance_sql_sum_overflow_is_conflict_and_recovers(
    transaction_setup, db_session, seeded_user
):
    client, csrf_headers, _ = transaction_setup
    account = create_record(
        client,
        csrf_headers,
        "/api/accounts",
        {"name": "Overflow", "type": "cash", "initialBalance": 0},
    )
    income = create_record(
        client,
        csrf_headers,
        "/api/categories",
        {"name": "Overflow income", "type": "income"},
    )
    expense = create_record(
        client,
        csrf_headers,
        "/api/categories",
        {"name": "Overflow expense", "type": "expense"},
    )
    records = [
        Transaction(
            household_id=seeded_user.household_id,
            account_id=account["id"],
            category_id=income["id"],
            amount=MAX_SAFE_CENTS,
            description=f"entry {index}",
            transaction_date=date(2026, 9, 7),
            created_by_user_id=seeded_user.id,
        )
        for index in range(1025)
    ]
    db_session.add_all(records)
    db_session.commit()

    account_url = f"/api/accounts/{account['id']}"
    overflow = client.get(account_url)
    assert overflow.status_code == 409
    assert overflow.json() == {
        "error": {
            "code": "CONFLICT",
            "message": "The calculated balance exceeds the supported range.",
        }
    }
    assert client.get("/api/transactions").status_code == 200
    unrelated_create = client.post(
        "/api/accounts",
        json={"name": "Created during overflow", "type": "cash", "initialBalance": 0},
        headers=csrf_headers(),
    )
    assert unrelated_create.status_code == 201
    assert unrelated_create.json()["balance"] == 0

    changed = client.put(
        f"/api/transactions/{records[0].id}",
        json={
            "accountId": account["id"],
            "categoryId": income["id"],
            "amount": MAX_SAFE_CENTS,
            "description": "corrected while overflowing",
            "transactionDate": "2026-09-07",
        },
        headers=csrf_headers(),
    )
    assert changed.status_code == 200
    removed_while_overflowing = client.delete(
        f"/api/transactions/{records[1].id}", headers=csrf_headers()
    )
    assert removed_while_overflowing.status_code == 204

    for record in records[2:]:
        db_session.delete(record)
    db_session.commit()
    recovered = client.get(account_url)
    assert recovered.status_code == 200
    assert recovered.json()["balance"] == MAX_SAFE_CENTS

    changed = client.put(
        f"/api/transactions/{records[0].id}",
        json={
            "accountId": account["id"],
            "categoryId": expense["id"],
            "amount": -1,
            "description": "corrected",
            "transactionDate": "2026-09-07",
        },
        headers=csrf_headers(),
    )
    assert changed.status_code == 200
    assert client.get(account_url).json()["balance"] == -1
    assert (
        client.delete(
            f"/api/transactions/{records[0].id}", headers=csrf_headers()
        ).status_code
        == 204
    )
    assert client.get(account_url).json()["balance"] == 0
    assert (
        client.post(
            "/api/accounts",
            json={
                "name": "Created after recovery",
                "type": "cash",
                "initialBalance": 0,
            },
            headers=csrf_headers(),
        ).status_code
        == 201
    )


def test_balance_overflow_is_isolated_to_affected_account(
    transaction_setup, db_session, seeded_user
):
    client, csrf_headers, _ = transaction_setup
    healthy = create_record(
        client,
        csrf_headers,
        "/api/accounts",
        {"name": "Healthy", "type": "cash", "initialBalance": 500},
    )
    overflow = create_record(
        client,
        csrf_headers,
        "/api/accounts",
        {"name": "Overflow isolated", "type": "cash", "initialBalance": 0},
    )
    income = create_record(
        client,
        csrf_headers,
        "/api/categories",
        {"name": "Overflow isolated income", "type": "income"},
    )
    db_session.add_all(
        [
            Transaction(
                household_id=seeded_user.household_id,
                account_id=overflow["id"],
                category_id=income["id"],
                amount=MAX_SAFE_CENTS,
                description=f"isolated {index}",
                transaction_date=date(2026, 9, 7),
                created_by_user_id=seeded_user.id,
            )
            for index in range(1025)
        ]
    )
    db_session.commit()

    assert client.get(f"/api/accounts/{overflow['id']}").status_code == 409
    assert (
        client.post(
            f"/api/accounts/{overflow['id']}/archive", headers=csrf_headers()
        ).status_code
        == 204
    )
    listed = client.get("/api/accounts")
    assert listed.status_code == 200
    assert {row["name"]: row["balance"] for row in listed.json()} == {
        "Checking": 100000,
        "Healthy": 500,
    }
    assert client.get(f"/api/accounts/{healthy['id']}").json()["balance"] == 500
    assert (
        client.put(
            f"/api/accounts/{healthy['id']}",
            json={"name": "Healthy", "type": "cash", "initialBalance": 600},
            headers=csrf_headers(),
        ).status_code
        == 200
    )


def test_transaction_history_filters_and_scope(
    transaction_setup, test_app, db_session
):
    client, csrf_headers, payload = transaction_setup
    checking_id = payload["accountId"]
    groceries_id = payload["categoryId"]
    salary = create_record(
        client,
        csrf_headers,
        "/api/categories",
        {"name": "Salary", "type": "income"},
    )
    cash = create_record(
        client,
        csrf_headers,
        "/api/accounts",
        {"name": "Cash", "type": "cash", "initialBalance": 0},
    )

    weekly = create_record(
        client,
        csrf_headers,
        "/api/transactions",
        {
            **payload,
            "description": "REWE weekly \\'",
            "transactionDate": "2026-09-07",
        },
    )
    salary_row = create_record(
        client,
        csrf_headers,
        "/api/transactions",
        {
            **payload,
            "categoryId": salary["id"],
            "amount": 350000,
            "description": "Salary",
            "transactionDate": "2026-09-01",
        },
    )
    cash_row = create_record(
        client,
        csrf_headers,
        "/api/transactions",
        {
            **payload,
            "accountId": cash["id"],
            "description": "REWE cash",
            "amount": -101,
            "transactionDate": "2026-09-08",
        },
    )
    august = create_record(
        client,
        csrf_headers,
        "/api/transactions",
        {
            **payload,
            "description": "REWE August",
            "amount": -201,
            "transactionDate": "2026-08-31",
        },
    )
    literal = create_record(
        client,
        csrf_headers,
        "/api/transactions",
        {
            **payload,
            "description": "100%_literal",
            "amount": -301,
            "transactionDate": "2026-09-07",
        },
    )
    null_description = create_record(
        client,
        csrf_headers,
        "/api/transactions",
        {
            **payload,
            "description": None,
            "amount": -401,
            "transactionDate": "2026-09-02",
        },
    )
    leap = create_record(
        client,
        csrf_headers,
        "/api/transactions",
        {
            **payload,
            "description": "Leap",
            "amount": -501,
            "transactionDate": "2028-02-29",
        },
    )
    december = create_record(
        client,
        csrf_headers,
        "/api/transactions",
        {
            **payload,
            "description": "Future",
            "amount": -601,
            "transactionDate": "9999-12-31",
        },
    )
    fixed_created_at = datetime(2026, 9, 7, tzinfo=timezone.utc)
    for row_id in (weekly["id"], literal["id"]):
        row = db_session.get(Transaction, row_id)
        assert row is not None
        row.created_at = fixed_created_at
    db_session.commit()

    def ids(params=None):
        response = client.get("/api/transactions", params=params or {})
        assert response.status_code == 200, response.text
        return [row["id"] for row in response.json()]

    assert ids() == [
        december["id"],
        leap["id"],
        cash_row["id"],
        literal["id"],
        weekly["id"],
        null_description["id"],
        salary_row["id"],
        august["id"],
    ]
    assert ids({"year": 2026, "month": 9}) == [
        cash_row["id"],
        literal["id"],
        weekly["id"],
        null_description["id"],
        salary_row["id"],
    ]
    assert ids({"year": 2026, "month": 8}) == [august["id"]]
    assert ids({"year": 2028, "month": 2}) == [leap["id"]]
    assert ids({"year": 9999, "month": 12}) == [december["id"]]
    assert ids({"accountId": cash["id"]}) == [cash_row["id"]]
    assert ids({"categoryId": salary["id"]}) == [salary_row["id"]]
    assert ids({"type": "income"}) == [salary_row["id"]]
    assert ids({"type": "expense"}) == [
        december["id"],
        leap["id"],
        cash_row["id"],
        literal["id"],
        weekly["id"],
        null_description["id"],
        august["id"],
    ]
    assert ids({"search": "rewe"}) == [
        cash_row["id"],
        weekly["id"],
        august["id"],
    ]
    assert ids(
        {
            "year": 2026,
            "month": 9,
            "accountId": checking_id,
            "categoryId": groceries_id,
            "type": "expense",
            "search": "rewe",
        }
    ) == [weekly["id"]]
    assert ids({"search": "%_"}) == [literal["id"]]
    assert ids({"search": r"\'"}) == [weekly["id"]]
    assert ids({"search": "   "}) == ids()
    assert ids({"search": "missing"}) == []
    assert ids({"year": 2025, "month": 1, "accountId": checking_id}) == []

    for params, field in (
        ({"year": 2026}, "month"),
        ({"month": 9}, "year"),
        ({"year": 0}, "year"),
        ({"year": 10000}, "year"),
        ({"month": 0}, "month"),
        ({"month": 13}, "month"),
        ({"accountId": 0}, "accountId"),
        ({"categoryId": 0}, "categoryId"),
        ({"type": "transfer"}, "type"),
        ({"search": "x" * 501}, "search"),
    ):
        response = client.get("/api/transactions", params=params)
        assert response.status_code == 422
        assert field in response.json()["error"]["fields"]

    assert (
        client.post(
            f"/api/accounts/{checking_id}/archive", headers=csrf_headers()
        ).status_code
        == 204
    )
    assert (
        client.post(
            f"/api/categories/{groceries_id}/archive", headers=csrf_headers()
        ).status_code
        == 204
    )
    assert ids({"accountId": checking_id}) == [
        december["id"],
        leap["id"],
        literal["id"],
        weekly["id"],
        null_description["id"],
        salary_row["id"],
        august["id"],
    ]
    assert ids({"categoryId": groceries_id}) == [
        december["id"],
        leap["id"],
        cash_row["id"],
        literal["id"],
        weekly["id"],
        null_description["id"],
        august["id"],
    ]

    own_balance_before_foreign = client.get(
        f"/api/accounts/{checking_id}"
    ).json()["balance"]
    household_b = Household(name="Transaction History B")
    user_b = User(
        username="transaction-history-b",
        display_name="Transaction History B",
        password_hash=hash_password("transaction history b password"),
        is_active=True,
    )
    db_session.add_all([household_b, user_b])
    db_session.flush()
    db_session.add(
        HouseholdMember(
            household_id=household_b.id, user_id=user_b.id, role="owner"
        )
    )
    db_session.commit()
    with TestClient(test_app) as foreign_client:
        login_client(
            foreign_client, user_b.username, "transaction history b password"
        )
        foreign_headers = lambda: csrf_for(foreign_client)
        foreign_account = create_record(
            foreign_client,
            foreign_headers,
            "/api/accounts",
            {"name": "B Checking", "type": "checking", "initialBalance": 0},
        )
        foreign_category = create_record(
            foreign_client,
            foreign_headers,
            "/api/categories",
            {"name": "B Groceries", "type": "expense"},
        )
        foreign = create_record(
            foreign_client,
            foreign_headers,
            "/api/transactions",
            {
                "accountId": foreign_account["id"],
                "categoryId": foreign_category["id"],
                "amount": -8472,
                "description": "REWE weekly \\'",
                "transactionDate": "2026-09-07",
            },
        )
        assert ids({"search": "REWE weekly"}) == [weekly["id"]]
        assert [
            row["id"] for row in foreign_client.get("/api/transactions").json()
        ] == [foreign["id"]]
        assert (
            foreign_client.get(f"/api/accounts/{foreign_account['id']}").json()["balance"]
            == -8472
        )

    for params in (
        {"accountId": foreign_account["id"]},
        {"categoryId": foreign_category["id"]},
    ):
        response = client.get("/api/transactions", params=params)
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "NOT_FOUND"
    assert (
        client.get(f"/api/accounts/{checking_id}").json()["balance"]
        == own_balance_before_foreign
    )


@pytest.mark.parametrize("amount", [0, True, -1.5, -8472.0, "-8472", -(2**53), 2**53])
def test_rejects_invalid_amount_without_creating_record(
    transaction_setup, amount, db_session, seeded_user
):
    client, csrf_headers, payload = transaction_setup
    response = client.post(
        "/api/transactions",
        json={**payload, "amount": amount},
        headers=csrf_headers(),
    )
    assert response.status_code == 422
    assert "amount" in response.json()["error"]["fields"]
    count = db_session.scalar(
        select(func.count())
        .select_from(Transaction)
        .where(Transaction.household_id == seeded_user.household_id)
    )
    assert count == 0
    assert client.get("/api/transactions").json() == []


def test_strict_fields_dates_and_category_sign(transaction_setup):
    client, csrf_headers, payload = transaction_setup
    for field, value in (
        ("householdId", 1),
        ("createdByUserId", 1),
        ("id", 1),
        ("createdAt", "2026-09-07T00:00:00Z"),
    ):
        response = client.post(
            "/api/transactions",
            json={**payload, field: value},
            headers=csrf_headers(),
        )
        assert response.status_code == 422
        assert field in response.json()["error"]["fields"]

    for value in ("2026-02-29", "2026-09-07T00:00:00Z", 1_757_203_200):
        response = client.post(
            "/api/transactions",
            json={**payload, "transactionDate": value},
            headers=csrf_headers(),
        )
        assert response.status_code == 422
        assert "transactionDate" in response.json()["error"]["fields"]

    income = create_record(
        client,
        csrf_headers,
        "/api/categories",
        {"name": "Salary", "type": "income"},
    )
    response = client.post(
        "/api/transactions",
        json={**payload, "categoryId": income["id"]},
        headers=csrf_headers(),
    )
    assert response.status_code == 422
    assert "categoryId" in response.json()["error"]["fields"]


def test_archive_retention_and_active_replacement(transaction_setup):
    client, csrf_headers, payload = transaction_setup
    saved = create_record(client, csrf_headers, "/api/transactions", payload)
    url = f"/api/transactions/{saved['id']}"

    assert (
        client.post(
            f"/api/accounts/{payload['accountId']}/archive", headers=csrf_headers()
        ).status_code
        == 204
    )
    assert (
        client.post(
            f"/api/categories/{payload['categoryId']}/archive", headers=csrf_headers()
        ).status_code
        == 204
    )
    assert client.get(url).status_code == 200
    retained = client.put(
        url,
        json={**payload, "amount": -9000, "description": "corrected"},
        headers=csrf_headers(),
    )
    assert retained.status_code == 200, retained.text

    active_account = create_record(
        client,
        csrf_headers,
        "/api/accounts",
        {"name": "Savings", "type": "savings", "initialBalance": 0},
    )
    active_category = create_record(
        client,
        csrf_headers,
        "/api/categories",
        {"name": "Dining", "type": "expense"},
    )
    replaced = client.put(
        url,
        json={
            **payload,
            "accountId": active_account["id"],
            "categoryId": active_category["id"],
            "amount": -100,
        },
        headers=csrf_headers(),
    )
    assert replaced.status_code == 200, replaced.text

    replacement_attempt = client.put(
        url,
        json={**payload, "accountId": payload["accountId"]},
        headers=csrf_headers(),
    )
    assert replacement_attempt.status_code == 422
    assert "accountId" in replacement_attempt.json()["error"]["fields"]


def test_anonymous_reads_and_unsafe_writes_require_authentication(client, csrf_headers):
    assert client.get("/api/transactions/1").status_code == 401
    payload = {
        "accountId": 1,
        "categoryId": 1,
        "amount": -1,
        "transactionDate": "2026-09-07",
    }
    assert client.post("/api/transactions", json=payload).status_code == 403
    assert client.put("/api/transactions/1", json=payload).status_code == 403
    assert client.delete("/api/transactions/1").status_code == 403


def test_leap_day_and_description_boundaries(transaction_setup):
    client, csrf_headers, payload = transaction_setup
    description = "😀" * 500
    response = client.post(
        "/api/transactions",
        json={**payload, "description": description, "transactionDate": "2028-02-29"},
        headers=csrf_headers(),
    )
    assert response.status_code == 201, response.text
    assert response.json()["description"] == description
    too_long = client.post(
        "/api/transactions",
        json={**payload, "description": "x" * 501},
        headers=csrf_headers(),
    )
    assert too_long.status_code == 422
    assert "description" in too_long.json()["error"]["fields"]


def test_response_date_is_date_not_timestamp(transaction_setup, db_session):
    client, csrf_headers, payload = transaction_setup
    saved = create_record(client, csrf_headers, "/api/transactions", payload)
    transaction = db_session.get(Transaction, saved["id"])
    assert transaction is not None
    assert transaction.transaction_date == date(2026, 9, 7)


def test_foreign_transaction_and_references_are_denied(
    transaction_setup, test_app, db_session, seeded_user
):
    client, csrf_headers, payload = transaction_setup
    own = create_record(client, csrf_headers, "/api/transactions", payload)

    household_b = Household(name="Household B")
    user_b = User(
        username="transaction-b",
        display_name="Transaction B",
        password_hash=hash_password("transaction b password"),
        is_active=True,
    )
    db_session.add_all([household_b, user_b])
    db_session.flush()
    db_session.add(
        HouseholdMember(
            household_id=household_b.id, user_id=user_b.id, role="owner"
        )
    )
    db_session.commit()

    with TestClient(test_app) as foreign_client:
        login_client(foreign_client, user_b.username, "transaction b password")
        foreign_headers = csrf_for(foreign_client)
        account = create_record(
            foreign_client,
            lambda: csrf_for(foreign_client),
            "/api/accounts",
            {"name": "B Checking", "type": "checking", "initialBalance": 0},
        )
        category = create_record(
            foreign_client,
            lambda: csrf_for(foreign_client),
            "/api/categories",
            {"name": "B Groceries", "type": "expense"},
        )
        foreign = create_record(
            foreign_client,
            lambda: csrf_for(foreign_client),
            "/api/transactions",
            {
                "accountId": account["id"],
                "categoryId": category["id"],
                "amount": -10,
                "transactionDate": "2026-09-07",
            },
        )
        foreign_url = f"/api/transactions/{foreign['id']}"
        before = foreign_client.get(foreign_url).json()

        assert client.get(foreign_url).status_code == 404
        assert (
            client.put(
                foreign_url,
                json=payload,
                headers=csrf_headers(),
            ).status_code
            == 404
        )
        assert (
            client.delete(foreign_url, headers=csrf_headers()).status_code == 404
        )
        baseline_count = db_session.scalar(
            select(func.count())
            .select_from(Transaction)
            .where(Transaction.household_id == seeded_user.household_id)
        )
        for field, value in (
            ("accountId", account["id"]),
            ("categoryId", category["id"]),
        ):
            rejected = client.post(
                "/api/transactions",
                json={**payload, field: value},
                headers=csrf_headers(),
            )
            assert rejected.status_code == 404
            assert (
                db_session.scalar(
                    select(func.count())
                    .select_from(Transaction)
                    .where(Transaction.household_id == seeded_user.household_id)
                )
                == baseline_count
            )
        assert foreign_client.get(foreign_url).json() == before
        assert client.get(f"/api/transactions/{own['id']}").status_code == 200


def test_household_member_can_edit_and_delete_without_changing_creator(
    transaction_setup, test_app, db_session, seeded_user
):
    client, csrf_headers, payload = transaction_setup
    saved = create_record(client, csrf_headers, "/api/transactions", payload)
    member = User(
        username="transaction-member",
        display_name="Transaction Member",
        password_hash=hash_password("transaction member password"),
        is_active=True,
    )
    db_session.add(member)
    db_session.flush()
    db_session.add(
        HouseholdMember(
            household_id=seeded_user.household_id,
            user_id=member.id,
            role="member",
        )
    )
    db_session.commit()

    with TestClient(test_app) as member_client:
        login_client(
            member_client, member.username, "transaction member password"
        )
        member_headers = csrf_for(member_client)
        url = f"/api/transactions/{saved['id']}"
        changed = member_client.put(
            url,
            json={**payload, "amount": -9000},
            headers=member_headers,
        )
        assert changed.status_code == 200, changed.text
        db_session.expire_all()
        transaction = db_session.get(Transaction, saved["id"])
        assert transaction is not None
        assert transaction.created_by_user_id == seeded_user.id
        assert (
            member_client.delete(url, headers=csrf_for(member_client)).status_code
            == 204
        )


def test_authenticated_invalid_csrf_and_origin_do_not_write(transaction_setup, db_session):
    client, csrf_headers, payload = transaction_setup
    assert client.post("/api/transactions", json=payload).status_code == 403
    bad_token = csrf_headers()
    bad_token["X-XSRF-TOKEN"] = "invalid"
    assert client.post("/api/transactions", json=payload, headers=bad_token).status_code == 403
    disallowed = csrf_headers("https://evil.example")
    assert client.post("/api/transactions", json=payload, headers=disallowed).status_code == 403
    assert db_session.scalar(select(func.count()).select_from(Transaction)) == 0
    assert client.get("/api/transactions").json() == []


def test_put_foreign_account_or_category_is_404_and_preserves_transaction(
    transaction_setup, test_app, db_session
):
    client, csrf_headers, payload = transaction_setup
    saved = create_record(client, csrf_headers, "/api/transactions", payload)
    before = client.get(f"/api/transactions/{saved['id']}").json()

    household_b = Household(name="Reference Household B")
    user_b = User(
        username="reference-b",
        display_name="Reference B",
        password_hash=hash_password("reference b password"),
        is_active=True,
    )
    db_session.add_all([household_b, user_b])
    db_session.flush()
    db_session.add(
        HouseholdMember(
            household_id=household_b.id, user_id=user_b.id, role="owner"
        )
    )
    db_session.commit()
    with TestClient(test_app) as foreign_client:
        login_client(foreign_client, user_b.username, "reference b password")
        b_account = create_record(
            foreign_client,
            lambda: csrf_for(foreign_client),
            "/api/accounts",
            {"name": "Foreign Checking", "type": "checking", "initialBalance": 0},
        )
        b_category = create_record(
            foreign_client,
            lambda: csrf_for(foreign_client),
            "/api/categories",
            {"name": "Foreign Groceries", "type": "expense"},
        )

    url = f"/api/transactions/{saved['id']}"
    for field, value in (
        ("accountId", b_account["id"]),
        ("categoryId", b_category["id"]),
    ):
        response = client.put(
            url,
            json={**payload, field: value},
            headers=csrf_headers(),
        )
        assert response.status_code == 404
        assert client.get(url).json() == before


def test_new_transaction_rejects_archived_account_and_category(
    transaction_setup, db_session, seeded_user
):
    client, csrf_headers, payload = transaction_setup
    baseline_count = db_session.scalar(
        select(func.count())
        .select_from(Transaction)
        .where(Transaction.household_id == seeded_user.household_id)
    )
    assert (
        client.post(
            f"/api/accounts/{payload['accountId']}/archive",
            headers=csrf_headers(),
        ).status_code
        == 204
    )
    rejected_account = client.post(
        "/api/transactions",
        json=payload,
        headers=csrf_headers(),
    )
    assert rejected_account.status_code == 422
    assert "accountId" in rejected_account.json()["error"]["fields"]
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(Transaction)
            .where(Transaction.household_id == seeded_user.household_id)
        )
        == baseline_count
    )

    active_account = create_record(
        client,
        csrf_headers,
        "/api/accounts",
        {"name": "Active Account", "type": "cash", "initialBalance": 0},
    )
    assert (
        client.post(
            f"/api/categories/{payload['categoryId']}/archive",
            headers=csrf_headers(),
        ).status_code
        == 204
    )
    rejected_category = client.post(
        "/api/transactions",
        json={**payload, "accountId": active_account["id"]},
        headers=csrf_headers(),
    )
    assert rejected_category.status_code == 422
    assert "categoryId" in rejected_category.json()["error"]["fields"]
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(Transaction)
            .where(Transaction.household_id == seeded_user.household_id)
        )
        == baseline_count
    )


def test_put_cannot_replace_with_different_archived_references(
    transaction_setup, db_session, seeded_user
):
    client, csrf_headers, payload = transaction_setup
    saved = create_record(client, csrf_headers, "/api/transactions", payload)
    url = f"/api/transactions/{saved['id']}"
    second_account = create_record(
        client,
        csrf_headers,
        "/api/accounts",
        {"name": "Second Account", "type": "cash", "initialBalance": 0},
    )
    second_category = create_record(
        client,
        csrf_headers,
        "/api/categories",
        {"name": "Second Category", "type": "expense"},
    )
    assert (
        client.post(
            f"/api/accounts/{second_account['id']}/archive",
            headers=csrf_headers(),
        ).status_code
        == 204
    )
    assert (
        client.post(
            f"/api/categories/{second_category['id']}/archive",
            headers=csrf_headers(),
        ).status_code
        == 204
    )
    baseline_count = db_session.scalar(
        select(func.count())
        .select_from(Transaction)
        .where(Transaction.household_id == seeded_user.household_id)
    )
    rejected_account = client.put(
        url,
        json={**payload, "accountId": second_account["id"]},
        headers=csrf_headers(),
    )
    assert rejected_account.status_code == 422
    assert "accountId" in rejected_account.json()["error"]["fields"]
    rejected_category = client.put(
        url,
        json={**payload, "categoryId": second_category["id"]},
        headers=csrf_headers(),
    )
    assert rejected_category.status_code == 422
    assert "categoryId" in rejected_category.json()["error"]["fields"]
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(Transaction)
            .where(Transaction.household_id == seeded_user.household_id)
        )
        == baseline_count
    )
    assert client.get(url).json() == saved

def test_retained_archived_category_must_still_match_amount_sign(transaction_setup):
    client, csrf_headers, payload = transaction_setup
    saved = create_record(client, csrf_headers, "/api/transactions", payload)
    url = f"/api/transactions/{saved['id']}"
    assert (
        client.post(
            f"/api/categories/{payload['categoryId']}/archive",
            headers=csrf_headers(),
        ).status_code
        == 204
    )
    changed = client.put(
        url,
        json={**payload, "amount": 1},
        headers=csrf_headers(),
    )
    assert changed.status_code == 422
    assert "categoryId" in changed.json()["error"]["fields"]
    assert client.get(url).json()["amount"] == payload["amount"]


def test_amount_sign_and_safe_integer_boundaries(transaction_setup):
    client, csrf_headers, payload = transaction_setup
    maximum = 2**53 - 1
    for amount in (-1, -maximum):
        response = client.post(
            "/api/transactions",
            json={**payload, "amount": amount, "description": str(amount)},
            headers=csrf_headers(),
        )
        assert response.status_code == 201, response.text

    income = create_record(
        client,
        csrf_headers,
        "/api/categories",
        {"name": "Income", "type": "income"},
    )
    for amount in (1, maximum):
        response = client.post(
            "/api/transactions",
            json={
                **payload,
                "categoryId": income["id"],
                "amount": amount,
                "description": str(amount),
            },
            headers=csrf_headers(),
        )
        assert response.status_code == 201, response.text


def test_invalid_transaction_ids_are_validation_or_not_found(transaction_setup):
    client, csrf_headers, payload = transaction_setup
    assert (
        client.get("/api/transactions/0", headers=csrf_headers()).status_code == 422
    )
    assert (
        client.put(
            "/api/transactions/0",
            json=payload,
            headers=csrf_headers(),
        ).status_code
        == 422
    )
    assert (
        client.delete(
            "/api/transactions/0",
            headers=csrf_headers(),
        ).status_code
        == 422
    )

    unknown = "/api/transactions/999999"
    assert client.get(unknown, headers=csrf_headers()).status_code == 404
    assert (
        client.put(unknown, json=payload, headers=csrf_headers()).status_code == 404
    )
    assert client.delete(unknown, headers=csrf_headers()).status_code == 404


def test_forged_server_fields_are_rejected_on_put(transaction_setup):
    client, csrf_headers, payload = transaction_setup
    saved = create_record(client, csrf_headers, "/api/transactions", payload)
    url = f"/api/transactions/{saved['id']}"
    for field, value in (
        ("householdId", 1),
        ("createdByUserId", 1),
        ("id", 1),
        ("createdAt", saved["createdAt"]),
    ):
        response = client.put(
            url,
            json={**payload, field: value},
            headers=csrf_headers(),
        )
        assert response.status_code == 422
        assert field in response.json()["error"]["fields"]
    assert client.get(url).json() == saved


def test_failed_put_and_delete_csrf_writes_preserve_transaction(transaction_setup):
    client, csrf_headers, payload = transaction_setup
    saved = create_record(client, csrf_headers, "/api/transactions", payload)
    url = f"/api/transactions/{saved['id']}"
    assert client.put(url, json={**payload, "amount": -1}).status_code == 403
    assert client.delete(url).status_code == 403
    invalid = csrf_headers()
    invalid["X-XSRF-TOKEN"] = "invalid"
    assert client.put(url, json={**payload, "amount": -1}, headers=invalid).status_code == 403
    assert client.delete(url, headers=invalid).status_code == 403
    assert client.get(url).json() == saved


def test_put_writes_every_field_despite_an_interleaved_committed_edit(
    transaction_setup, test_app, monkeypatch
):
    client, csrf_headers, payload = transaction_setup
    income = create_record(
        client,
        csrf_headers,
        "/api/categories",
        {"name": "Interleaved income", "type": "income"},
    )
    saved = create_record(client, csrf_headers, "/api/transactions", payload)
    url = f"/api/transactions/{saved['id']}"

    import app.transactions as routes

    original = routes.validate_references

    def interleave(write, *args, **kwargs):
        original(write, *args, **kwargs)
        with test_app.state.session_factory() as other:
            other.execute(
                update(Transaction)
                .where(Transaction.id == saved["id"])
                .values(amount=100, category_id=income["id"])
            )
            other.commit()

    monkeypatch.setattr(routes, "validate_references", interleave)

    response = client.put(
        url, json={**payload, "amount": -200}, headers=csrf_headers()
    )
    assert response.status_code == 200, response.text
    assert response.json()["amount"] == -200
    assert response.json()["categoryId"] == payload["categoryId"]
    assert client.get(url).json() == response.json()


def test_deleted_transaction_ids_are_not_reused(transaction_setup):
    client, csrf_headers, payload = transaction_setup
    first = create_record(client, csrf_headers, "/api/transactions", payload)
    assert (
        client.delete(
            f"/api/transactions/{first['id']}", headers=csrf_headers()
        ).status_code
        == 204
    )
    second = create_record(
        client,
        csrf_headers,
        "/api/transactions",
        {**payload, "description": "replacement"},
    )
    assert second["id"] != first["id"]
    assert (
        client.delete(
            f"/api/transactions/{first['id']}", headers=csrf_headers()
        ).status_code
        == 404
    )
    assert client.get(f"/api/transactions/{second['id']}").status_code == 200


def test_commit_failure_does_not_log_financial_notes(test_app, seeded_user, caplog):
    note = "M3_PRIVATE_NOTE_SENTINEL"
    database = make_url(os.environ["DATABASE_URL"]).database
    with TestClient(test_app, raise_server_exceptions=False) as raw:
        login_client(raw, seeded_user.username, seeded_user.password)
        headers = lambda: csrf_for(raw)
        account = create_record(
            raw,
            headers,
            "/api/accounts",
            {"name": "Log probe", "type": "cash", "initialBalance": 0},
        )
        category = create_record(
            raw,
            headers,
            "/api/categories",
            {"name": "Log probe expense", "type": "expense"},
        )
        lock = sqlite3.connect(database)
        lock.execute("BEGIN IMMEDIATE")
        try:
            with caplog.at_level(logging.ERROR, logger="app.errors"):
                response = raw.post(
                    "/api/transactions",
                    json={
                        "accountId": account["id"],
                        "categoryId": category["id"],
                        "amount": -1,
                        "description": note,
                        "transactionDate": "2026-09-07",
                    },
                    headers=headers(),
                )
        finally:
            lock.rollback()
            lock.close()
    assert response.status_code == 500
    record = next(
        r for r in caplog.records if "Unhandled API error" in r.getMessage()
    )
    rendered = "".join(traceback.format_exception(*record.exc_info))
    assert note not in rendered
