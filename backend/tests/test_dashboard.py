import os
from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import sessionmaker

from app.auth.passwords import hash_password
from app.models import Account, Category, Household, HouseholdMember, Transaction, User
from app.money import MAX_SAFE_CENTS


def create_record(client, csrf_headers, route, payload):
    response = client.post(route, json=payload, headers=csrf_headers())
    assert response.status_code == 201, response.text
    return response.json()


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


def dashboard(client, year=2026, month=9):
    return client.get("/api/dashboard", params={"year": year, "month": month})


def seed_household(db_session, name, username):
    household = Household(name=name)
    user = User(
        username=username,
        display_name=username,
        password_hash="x",
        is_active=True,
    )
    db_session.add_all([household, user])
    db_session.flush()
    db_session.add(
        HouseholdMember(household_id=household.id, user_id=user.id, role="owner")
    )
    db_session.commit()
    return household.id, user.id


def test_selected_month_keeps_all_time_balance(authenticated_client, csrf_headers):
    client = authenticated_client

    account = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 100000,
    })
    salary = create_record(client, csrf_headers, "/api/categories", {"name": "Salary", "type": "income"})
    groceries = create_record(client, csrf_headers, "/api/categories", {"name": "Groceries", "type": "expense"})
    subscriptions = create_record(client, csrf_headers, "/api/categories", {"name": "Subscriptions", "type": "expense"})
    for amount, category, day, description in [
        (350000, salary, "2026-09-07", "Salary"),
        (-8472, groceries, "2026-09-07", "REWE"),
        (-1799, subscriptions, "2026-10-01", "Netflix"),
    ]:
        create_record(client, csrf_headers, "/api/transactions", {
            "accountId": account["id"], "categoryId": category["id"],
            "amount": amount, "transactionDate": day, "description": description,
        })

    response = dashboard(client, 2026, 9)
    assert response.status_code == 200, response.text
    september = response.json()
    assert september["summary"] == {
        "balance": 439729, "income": 350000, "expenses": 8472, "net": 341528,
    }
    assert september["period"] == {"year": 2026, "month": 9}
    assert september["spendingByCategory"] == [{
        "categoryId": groceries["id"], "categoryName": "Groceries", "spent": 8472,
    }]
    assert {row["description"] for row in september["recentTransactions"]} == {"Salary", "REWE"}
    assert all(row["accountName"] == "Checking" for row in september["recentTransactions"])
    assert september["budgets"] == []

    october = dashboard(client, 2026, 10).json()
    assert october["summary"] == {
        "balance": 439729, "income": 0, "expenses": 1799, "net": -1799,
    }
    assert [row["description"] for row in october["recentTransactions"]] == ["Netflix"]

    november = dashboard(client, 2026, 11).json()
    assert november["summary"] == {
        "balance": 439729, "income": 0, "expenses": 0, "net": 0,
    }
    assert november["spendingByCategory"] == []
    assert november["recentTransactions"] == []


def test_empty_household_and_initial_only_balance(authenticated_client, csrf_headers):
    client = authenticated_client
    empty = dashboard(client).json()
    assert empty["summary"] == {"balance": 0, "income": 0, "expenses": 0, "net": 0}
    assert empty["spendingByCategory"] == []
    assert empty["recentTransactions"] == []

    create_record(client, csrf_headers, "/api/accounts", {
        "name": "Overdraft", "type": "checking", "initialBalance": -500,
    })
    initial_only = dashboard(client).json()
    assert initial_only["summary"]["balance"] == -500
    assert initial_only["summary"]["income"] == 0
    assert initial_only["recentTransactions"] == []


def test_income_only_month(authenticated_client, csrf_headers):
    client = authenticated_client
    account = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 0,
    })
    salary = create_record(client, csrf_headers, "/api/categories", {"name": "Salary", "type": "income"})
    create_record(client, csrf_headers, "/api/transactions", {
        "accountId": account["id"], "categoryId": salary["id"],
        "amount": 250000, "description": "Payday", "transactionDate": "2026-09-07",
    })

    body = dashboard(client, 2026, 9).json()
    assert body["summary"] == {
        "balance": 250000, "income": 250000, "expenses": 0, "net": 250000,
    }
    assert body["spendingByCategory"] == []
    assert [row["description"] for row in body["recentTransactions"]] == ["Payday"]
    assert body["recentTransactions"][0]["amount"] == 250000


def test_multiple_accounts_and_shared_category_do_not_multiply(authenticated_client, csrf_headers):
    client = authenticated_client
    checking = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 100000,
    })
    savings = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Savings", "type": "savings", "initialBalance": 20000,
    })
    salary = create_record(client, csrf_headers, "/api/categories", {"name": "Salary", "type": "income"})
    groceries = create_record(client, csrf_headers, "/api/categories", {"name": "Groceries", "type": "expense"})
    subscriptions = create_record(client, csrf_headers, "/api/categories", {"name": "Subscriptions", "type": "expense"})
    for account_id, amount, category_id, day in [
        (checking["id"], 350000, salary["id"], "2026-09-07"),
        (checking["id"], -8472, groceries["id"], "2026-09-07"),
        (checking["id"], -1799, subscriptions["id"], "2026-10-01"),
        (savings["id"], -100, groceries["id"], "2026-09-20"),
    ]:
        create_record(client, csrf_headers, "/api/transactions", {
            "accountId": account_id, "categoryId": category_id,
            "amount": amount, "transactionDate": day,
        })

    september = dashboard(client).json()
    assert september["summary"] == {
        "balance": 459629, "income": 350000, "expenses": 8572, "net": 341428,
    }
    assert september["spendingByCategory"] == [{
        "categoryId": groceries["id"], "categoryName": "Groceries", "spent": 8572,
    }]


def test_archive_preserves_monthly_history_and_names(authenticated_client, csrf_headers):
    client = authenticated_client
    checking = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 100000,
    })
    salary = create_record(client, csrf_headers, "/api/categories", {"name": "Salary", "type": "income"})
    groceries = create_record(client, csrf_headers, "/api/categories", {"name": "Groceries", "type": "expense"})
    for amount, category, day in [
        (350000, salary, "2026-09-07"),
        (-8472, groceries, "2026-09-07"),
    ]:
        create_record(client, csrf_headers, "/api/transactions", {
            "accountId": checking["id"], "categoryId": category["id"],
            "amount": amount, "transactionDate": day,
        })

    client.put(f"/api/accounts/{checking['id']}", json={
        "name": "Everyday Checking", "type": "checking", "initialBalance": 100000,
    }, headers=csrf_headers())
    client.put(f"/api/categories/{groceries['id']}", json={"name": "Food"}, headers=csrf_headers())
    assert client.post(f"/api/accounts/{checking['id']}/archive", headers=csrf_headers()).status_code == 204
    assert client.post(f"/api/categories/{groceries['id']}/archive", headers=csrf_headers()).status_code == 204

    september = dashboard(client).json()
    assert september["summary"] == {
        "balance": 0, "income": 350000, "expenses": 8472, "net": 341528,
    }
    assert september["spendingByCategory"] == [{
        "categoryId": groceries["id"], "categoryName": "Food", "spent": 8472,
    }]
    assert {row["accountName"] for row in september["recentTransactions"]} == {"Everyday Checking"}
    assert {row["categoryName"] for row in september["recentTransactions"]} == {"Salary", "Food"}


def test_expense_ordering_and_recent_limit(
    authenticated_client, csrf_headers, db_session, seeded_user
):
    client = authenticated_client
    account = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 0,
    })
    food = create_record(client, csrf_headers, "/api/categories", {"name": "Food", "type": "expense"})
    rent = create_record(client, csrf_headers, "/api/categories", {"name": "Rent", "type": "expense"})
    salary = create_record(client, csrf_headers, "/api/categories", {"name": "Salary", "type": "income"})
    fixed = datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)
    rows = [
        Transaction(
            household_id=seeded_user.household_id, account_id=account["id"],
            category_id=food["id"], amount=-100, description=f"row {index}",
            transaction_date=date(2026, 9, 7), created_by_user_id=seeded_user.id,
            created_at=fixed,
        )
        for index in range(12)
    ]
    db_session.add_all(rows)
    db_session.commit()
    for row in rows:
        db_session.refresh(row)
    expected_ids = sorted((row.id for row in rows), reverse=True)[:10]

    september = dashboard(client).json()
    assert [row["id"] for row in september["recentTransactions"]] == expected_ids

    # Same date, later created_at wins; then a later date beats every same-date row.
    newer = Transaction(
        household_id=seeded_user.household_id, account_id=account["id"],
        category_id=food["id"], amount=-200, description="newer",
        transaction_date=date(2026, 9, 7), created_by_user_id=seeded_user.id,
        created_at=datetime(2026, 9, 7, 13, 0, tzinfo=timezone.utc),
    )
    next_day = Transaction(
        household_id=seeded_user.household_id, account_id=account["id"],
        category_id=food["id"], amount=-300, description="next day",
        transaction_date=date(2026, 9, 8), created_by_user_id=seeded_user.id,
        created_at=datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc),
    )
    db_session.add_all([newer, next_day])
    db_session.commit()
    db_session.refresh(newer)
    db_session.refresh(next_day)

    ordered = dashboard(client).json()["recentTransactions"]
    assert ordered[0]["id"] == next_day.id
    assert ordered[1]["id"] == newer.id

    # Descending totals sort Food (1700) before Rent (500); income categories never appear.
    create_record(client, csrf_headers, "/api/transactions", {
        "accountId": account["id"], "categoryId": rent["id"],
        "amount": -500, "transactionDate": "2026-09-15",
    })
    create_record(client, csrf_headers, "/api/transactions", {
        "accountId": account["id"], "categoryId": salary["id"],
        "amount": 900, "transactionDate": "2026-09-15",
    })
    spending = dashboard(client).json()["spendingByCategory"]
    assert [row["categoryId"] for row in spending] == [food["id"], rent["id"]]
    assert [row["spent"] for row in spending] == [1700, 500]
    assert all(row["categoryName"] != "Salary" for row in spending)


def test_equal_spending_sorts_by_category_id(authenticated_client, csrf_headers):
    client = authenticated_client
    account = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 0,
    })
    first = create_record(client, csrf_headers, "/api/categories", {"name": "Alpha", "type": "expense"})
    second = create_record(client, csrf_headers, "/api/categories", {"name": "Beta", "type": "expense"})
    create_record(client, csrf_headers, "/api/transactions", {
        "accountId": account["id"], "categoryId": first["id"],
        "amount": -500, "transactionDate": "2026-09-10",
    })
    create_record(client, csrf_headers, "/api/transactions", {
        "accountId": account["id"], "categoryId": second["id"],
        "amount": -500, "transactionDate": "2026-09-11",
    })
    spending = dashboard(client).json()["spendingByCategory"]
    assert [row["spent"] for row in spending] == [500, 500]
    assert [row["categoryId"] for row in spending] == [first["id"], second["id"]]
    assert first["id"] < second["id"]


@pytest.mark.parametrize(
    "year, month, day",
    [
        (2024, 2, "2024-02-29"),
        (2024, 3, "2024-03-01"),
        (2025, 12, "2025-12-31"),
        (2026, 1, "2026-01-01"),
        (1, 1, "0001-01-01"),
        (9999, 12, "9999-12-31"),
    ],
)
def test_calendar_boundaries(authenticated_client, csrf_headers, year, month, day):
    client = authenticated_client
    account = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 0,
    })
    category = create_record(client, csrf_headers, "/api/categories", {"name": "Food", "type": "expense"})
    create_record(client, csrf_headers, "/api/transactions", {
        "accountId": account["id"], "categoryId": category["id"],
        "amount": -100, "transactionDate": day,
    })

    assert dashboard(client, year, month).json()["summary"]["expenses"] == 100
    assert dashboard(client, year, month).json()["recentTransactions"][0]["transactionDate"] == day


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"year": 2026},
        {"month": 9},
        {"year": 0, "month": 9},
        {"year": 10000, "month": 9},
        {"year": 2026, "month": 0},
        {"year": 2026, "month": 13},
        {"year": "abc", "month": 9},
    ],
)
def test_validation_errors(authenticated_client, params):
    response = authenticated_client.get("/api/dashboard", params=params)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_anonymous_denied_without_financial_fields(client):
    response = client.get("/api/dashboard", params={"year": 2026, "month": 9})
    assert response.status_code == 401
    assert "summary" not in response.json()


def test_household_isolation_and_member_visibility(
    authenticated_client, csrf_headers, test_app, db_session, seeded_user
):
    client = authenticated_client
    account = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 100000,
    })
    category = create_record(client, csrf_headers, "/api/categories", {"name": "Food", "type": "expense"})
    create_record(client, csrf_headers, "/api/transactions", {
        "accountId": account["id"], "categoryId": category["id"],
        "amount": -8472, "transactionDate": "2026-09-07",
    })
    baseline = dashboard(client).json()

    foreign_household_id, foreign_user_id = seed_household(
        db_session, "Foreign Household", "dashboard-foreign"
    )
    foreign_account = Account(
        household_id=foreign_household_id, name="Foreign Checking",
        type="checking", initial_balance=777777,
    )
    foreign_category = Category(
        household_id=foreign_household_id, name="Foreign Food", type="expense",
    )
    db_session.add_all([foreign_account, foreign_category])
    db_session.flush()
    db_session.add(Transaction(
        household_id=foreign_household_id, account_id=foreign_account.id,
        category_id=foreign_category.id, amount=-999999,
        transaction_date=date(2026, 9, 7), created_by_user_id=foreign_user_id,
    ))
    db_session.commit()

    assert dashboard(client).json() == baseline

    member_password = "member password value"
    member = User(
        username="dashboard-member", display_name="Member",
        password_hash=hash_password(member_password), is_active=True,
    )
    db_session.add(member)
    db_session.flush()
    db_session.add(HouseholdMember(
        household_id=seeded_user.household_id, user_id=member.id, role="member",
    ))
    db_session.commit()
    with TestClient(test_app) as member_client:
        login_client(member_client, member.username, member_password)
        assert dashboard(member_client).json() == baseline


def test_safe_integer_limits(authenticated_client, csrf_headers):
    client = authenticated_client
    maximum = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Maximum", "type": "checking", "initialBalance": MAX_SAFE_CENTS,
    })
    assert maximum["balance"] == MAX_SAFE_CENTS
    assert dashboard(client).json()["summary"]["balance"] == MAX_SAFE_CENTS

    create_record(client, csrf_headers, "/api/accounts", {
        "name": "Extra", "type": "savings", "initialBalance": 1,
    })
    overflow = dashboard(client)
    assert overflow.status_code == 409
    assert overflow.json()["error"]["code"] == "CONFLICT"
    assert "summary" not in overflow.json()


def test_monthly_overflow_is_conflict_even_when_net_fits(authenticated_client, csrf_headers):
    client = authenticated_client
    account = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 0,
    })
    salary = create_record(client, csrf_headers, "/api/categories", {"name": "Salary", "type": "income"})
    expense = create_record(client, csrf_headers, "/api/categories", {"name": "Big", "type": "expense"})
    for category, amount in ((salary, MAX_SAFE_CENTS), (salary, MAX_SAFE_CENTS), (expense, -MAX_SAFE_CENTS)):
        create_record(client, csrf_headers, "/api/transactions", {
            "accountId": account["id"], "categoryId": category["id"],
            "amount": amount, "transactionDate": "2026-09-07",
        })
    monthly = dashboard(client)
    assert monthly.status_code == 409
    assert monthly.json()["error"]["code"] == "CONFLICT"


def test_sqlite_overflow_is_scoped_to_household_and_month(
    authenticated_client, csrf_headers, test_app, db_session, seeded_user
):
    client = authenticated_client
    account = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 0,
    })
    salary = create_record(client, csrf_headers, "/api/categories", {"name": "Salary", "type": "income"})
    create_record(client, csrf_headers, "/api/transactions", {
        "accountId": account["id"], "categoryId": salary["id"],
        "amount": 100, "transactionDate": "2026-09-07",
    })

    # A foreign household's overflowing account must not poison this report.
    foreign_household_id, foreign_user_id = seed_household(
        db_session, "Overflow Household", "dashboard-overflow"
    )
    foreign_account = Account(
        household_id=foreign_household_id, name="Foreign Overflow",
        type="checking", initial_balance=0,
    )
    foreign_category = Category(
        household_id=foreign_household_id, name="Foreign Salary", type="income",
    )
    db_session.add_all([foreign_account, foreign_category])
    db_session.flush()
    db_session.add_all([
        Transaction(
            household_id=foreign_household_id, account_id=foreign_account.id,
            category_id=foreign_category.id, amount=MAX_SAFE_CENTS,
            transaction_date=date(2026, 9, 7), created_by_user_id=foreign_user_id,
        )
        for _ in range(1025)
    ])
    db_session.commit()
    assert dashboard(client).status_code == 200

    # An archived account's overflow outside the selected month is excluded from balance.
    archived = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Archived", "type": "checking", "initialBalance": 0,
    })
    db_session.add_all([
        Transaction(
            household_id=seeded_user.household_id, account_id=archived["id"],
            category_id=salary["id"], amount=MAX_SAFE_CENTS,
            transaction_date=date(2026, 12, 7), created_by_user_id=seeded_user.id,
        )
        for _ in range(1025)
    ])
    db_session.commit()
    assert client.post(f"/api/accounts/{archived['id']}/archive", headers=csrf_headers()).status_code == 204

    assert dashboard(client, 2026, 9).status_code == 200
    assert dashboard(client, 2026, 11).status_code == 200

    overflowing_month = dashboard(client, 2026, 12)
    assert overflowing_month.status_code == 409
    assert overflowing_month.json()["error"]["code"] == "CONFLICT"


def test_no_financial_logging(authenticated_client, csrf_headers, caplog):
    client = authenticated_client
    account = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 100000,
    })
    category = create_record(client, csrf_headers, "/api/categories", {"name": "Food", "type": "expense"})
    create_record(client, csrf_headers, "/api/transactions", {
        "accountId": account["id"], "categoryId": category["id"],
        "amount": -8472, "description": "PRIVATE_SENTINEL", "transactionDate": "2026-09-07",
    })
    with caplog.at_level("DEBUG"):
        assert dashboard(client).status_code == 200
    assert "PRIVATE_SENTINEL" not in caplog.text
    assert "8472" not in caplog.text


def test_queries_share_one_snapshot_despite_concurrent_write(
    authenticated_client, csrf_headers, monkeypatch
):
    client = authenticated_client
    account = create_record(client, csrf_headers, "/api/accounts", {
        "name": "Checking", "type": "checking", "initialBalance": 100000,
    })
    category = create_record(client, csrf_headers, "/api/categories", {"name": "Food", "type": "expense"})
    saved = create_record(client, csrf_headers, "/api/transactions", {
        "accountId": account["id"], "categoryId": category["id"],
        "amount": -100, "description": "REWE", "transactionDate": "2026-09-07",
    })

    writer_engine = create_engine(
        os.environ["DATABASE_URL"], connect_args={"check_same_thread": False}
    )
    writer_factory = sessionmaker(bind=writer_engine)
    import app.dashboard as dashboard_module

    real_execute = dashboard_module._execute_balance_query
    written = False

    def execute_then_commit_elsewhere(db, statement):
        nonlocal written
        result = real_execute(db, statement)
        if not written:
            written = True
            with writer_factory() as writer:
                writer.execute(
                    update(Transaction)
                    .where(Transaction.id == saved["id"])
                    .values(amount=-200)
                )
                writer.commit()
        return result

    monkeypatch.setattr(
        dashboard_module, "_execute_balance_query", execute_then_commit_elsewhere
    )
    try:
        response = dashboard(client, 2026, 9)
    finally:
        writer_engine.dispose()

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["summary"] == {"balance": 99900, "income": 0, "expenses": 100, "net": -100}
    assert body["spendingByCategory"] == [{
        "categoryId": category["id"], "categoryName": "Food", "spent": 100,
    }]
    assert body["recentTransactions"][0]["amount"] == -100

    # The concurrent write really committed; a fresh request observes the new value.
    follow_up = dashboard(client, 2026, 9).json()
    assert follow_up["summary"]["expenses"] == 200
    assert follow_up["spendingByCategory"][0]["spent"] == 200
