from __future__ import annotations

import csv
import io
from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import Account, Category, Household, Transaction





def _create_household_objects(db_session) -> dict:
    from app.models import Household, User

    household = db_session.scalar(select(Household))
    owner = db_session.scalar(select(User).order_by(User.id.asc()))
    other = Household(name="Poison Household")
    db_session.add(other)
    db_session.flush()
    poison_account = Account(
        household_id=other.id, name="Poison Checking", type="checking",
        initial_balance=0,
    )
    poison_category = Category(household_id=other.id, name="Poison Food", type="expense")
    db_session.add_all([poison_account, poison_category])
    db_session.flush()

    account = Account(
        household_id=household.id, name="Checking", type="checking",
        initial_balance=0,
    )
    category = Category(household_id=household.id, name="Food", type="expense")
    income_category = Category(household_id=household.id, name="Salary", type="income")
    db_session.add_all([account, category, income_category])
    db_session.flush()
    return {
        "household": household,
        "other": other,
        "owner": owner,
        "poison_account": poison_account,
        "poison_category": poison_category,
        "account": account,
        "category": category,
        "income_category": income_category,
    }


def test_export_requires_authentication(client):
    assert client.get("/api/export/transactions.csv").status_code == 401


def test_export_headers_and_empty_history(authenticated_client):
    response = authenticated_client.get("/api/export/transactions.csv")
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/csv; charset=utf-8"
    assert (
        response.headers["content-disposition"]
        == 'attachment; filename="transactions.csv"'
    )
    assert "no-store" in response.headers["cache-control"]
    assert response.headers["x-content-type-options"] == "nosniff"
    reader = csv.reader(io.StringIO(response.text))
    assert list(reader) == [
        ["date", "description", "account", "category", "type", "amount", "currency"]
    ]


def test_export_transaction_rows_and_filtering(
    authenticated_client, db_session
):
    objects = _create_household_objects(db_session)
    db_session.add_all(
        [
            Transaction(
                household_id=objects["household"].id,
                account_id=objects["account"].id,
                category_id=objects["category"].id,
                amount=-8472,
                description="Groceries",
                transaction_date=date(2026, 9, 7),
                created_by_user_id=objects["owner"].id,
            ),
            Transaction(
                household_id=objects["household"].id,
                account_id=objects["account"].id,
                category_id=objects["income_category"].id,
                amount=250000,
                description="Salary",
                transaction_date=date(2026, 9, 1),
                created_by_user_id=objects["owner"].id,
            ),
            Transaction(
                household_id=objects["household"].id,
                account_id=objects["account"].id,
                category_id=objects["category"].id,
                amount=-100,
                description="Bought with 'quoted', comma and\nnewline",
                transaction_date=date(2026, 1, 2),
                created_by_user_id=objects["owner"].id,
            ),
        ]
    )
    db_session.commit()

    rows = csv.reader(io.StringIO(authenticated_client.get(
        "/api/export/transactions.csv"
    ).text))
    data = list(rows)
    assert data[0] == [
        "date", "description", "account", "category", "type", "amount", "currency"
    ]
    amounts = [row[5] for row in data[1:]]
    types = [row[4] for row in data[1:]]
    assert amounts == ["-84.72", "2500.00", "-1.00"]  # date descending
    assert types == ["expense", "income", "expense"]
    dates = [row[0] for row in data[1:]]
    assert dates == ["2026-09-07", "2026-09-01", "2026-01-02"]
    descriptions = [row[1] for row in data[1:]]
    assert descriptions == [
        "Groceries", "Salary", "Bought with 'quoted', comma and\nnewline"
    ]

    # Filter by inclusive date bounds
    ranged = csv.reader(io.StringIO(
        authenticated_client.get(
            "/api/export/transactions.csv?from=2026-09-01&to=2026-09-07"
        ).text
    ))
    body = list(ranged)[1:]
    assert [row[0] for row in body] == ["2026-09-07", "2026-09-01"]
    assert [row[5] for row in body] == ["-84.72", "2500.00"]
    assert [row[4] for row in body] == ["expense", "income"]

    # Account and category filter with a foreign ID
    foreign = authenticated_client.get(
        f"/api/export/transactions.csv?accountId={objects['poison_account'].id}"
    )
    assert foreign.status_code == 404
    foreign_category = authenticated_client.get(
        f"/api/export/transactions.csv?categoryId={objects['poison_category'].id}"
    )
    assert foreign_category.status_code == 404

    own_account = authenticated_client.get(
        f"/api/export/transactions.csv?accountId={objects['account'].id}"
    )
    assert own_account.status_code == 200
    assert "Groceries" in own_account.text


def test_export_rejects_reversed_and_malformed_ranges(
    authenticated_client,
):
    reversed_bounds = authenticated_client.get(
        "/api/export/transactions.csv?from=2026-09-10&to=2026-09-01"
    )
    assert reversed_bounds.status_code == 422
    malformed = authenticated_client.get(
        "/api/export/transactions.csv?from=2026-9-1"
    )
    assert malformed.status_code == 422
    bad_id = authenticated_client.get("/api/export/transactions.csv?accountId=abc")
    assert bad_id.status_code == 422


def test_export_amounts_avoid_floating_point(authenticated_client, db_session):
    objects = _create_household_objects(db_session)
    for amount in (-1, 9007199254740991):
        db_session.add(
            Transaction(
                household_id=objects["household"].id,
                account_id=objects["account"].id,
                category_id=objects["category"].id,
                amount=amount,
                description=None,
                transaction_date=date(2026, 1, 1),
                created_by_user_id=objects["owner"].id,
            )
        )
    db_session.commit()

    text = authenticated_client.get("/api/export/transactions.csv").text
    assert "-0.01" in text
    assert "90071992547409.91" in text


def test_export_crlf_and_no_bom(authenticated_client):
    response = authenticated_client.get("/api/export/transactions.csv")
    assert response.content.startswith(b"date,"), response.content[:10]
    assert b"\xef\xbb\xbf" not in response.content
    assert b"\r\n" in response.content


def test_export_formula_neutralization_and_safe_text(
    authenticated_client, db_session
):
    objects = _create_household_objects(db_session)
    txns = [
        ("=cmd()", "=", None),
        ("+SUM(A1)", "+", None),
        ("-not-a-paragraph", "-", None),
        ("@import evil", "@", None),
        ("  =whitespace then formula", "\n", None),
        ('\ufeffbom then text', "\n", None),
        ("\x00null-control char", "\n", None),
        ("'already quoted, keeps quote", None, None),
        ("ordinary text, safe", None, None),
    ]
    for index, (description, _, _) in enumerate(txns):
        db_session.add(
            Transaction(
                household_id=objects["household"].id,
                account_id=objects["account"].id,
                category_id=objects["category"].id,
                amount=-123456,
                description=description,
                transaction_date=date(2026, 5, 1 + index),
                created_by_user_id=objects["owner"].id,
            )
        )
    db_session.commit()

    response = authenticated_client.get(
        "/api/export/transactions.csv?from=2026-05-01&to=2026-05-31"
    )
    assert response.status_code == 200
    rows = list(csv.reader(io.StringIO(response.text)))[1:]
    got = {row[0]: row[1] for row in rows}
    assert got["2026-05-01"] == "'=cmd()"
    assert got["2026-05-02"] == "'+SUM(A1)"
    assert got["2026-05-03"] == "'-not-a-paragraph"
    assert got["2026-05-04"] == "'@import evil"
    assert got["2026-05-05"] == "'  =whitespace then formula"
    assert got["2026-05-06"] == "'\ufeffbom then text"
    assert got["2026-05-07"] == "'\x00null-control char"
    assert got["2026-05-08"] == "'already quoted, keeps quote"  # no double-prefix
    assert got["2026-05-09"] == "ordinary text, safe"
    # Amounts are never neutralized.
    for row in rows:
        assert row[5] == "-1234.56"
        assert row[6] == "EUR"


def test_export_archived_renamed_resources_current_names(
    authenticated_client, db_session
):
    objects = _create_household_objects(db_session)
    db_session.add(
        Transaction(
            household_id=objects["household"].id,
            account_id=objects["account"].id,
            category_id=objects["category"].id,
            amount=-50000,
            description="Before archive",
            transaction_date=date(2026, 3, 1),
            created_by_user_id=objects["owner"].id,
        )
    )
    db_session.commit()
    db_session.refresh(objects["account"])
    db_session.refresh(objects["category"])
    objects["account"].is_archived = True
    objects["account"].name = "Checking Renamed"
    objects["category"].name = "Food Renamed"
    db_session.commit()

    rows = list(csv.reader(io.StringIO(
        authenticated_client.get("/api/export/transactions.csv").text
    )))[1:]
    rows = [row for row in rows if row[1] == "Before archive"]
    assert len(rows) == 1
    row = rows[0]
    assert row[2] == "Checking Renamed"  # current account label
    assert row[3] == "Food Renamed"  # current category label


def test_export_date_bounds_and_leap(authenticated_client, db_session):
    objects = _create_household_objects(db_session)
    for day in (date(2028, 2, 28), date(2028, 2, 29), date(1, 1, 1), date(9999, 12, 31)):
        db_session.add(
            Transaction(
                household_id=objects["household"].id,
                account_id=objects["account"].id,
                category_id=objects["category"].id,
                amount=-100,
                description=None,
                transaction_date=day,
                created_by_user_id=objects["owner"].id,
            )
        )
    db_session.commit()

    leap_only = authenticated_client.get(
        "/api/export/transactions.csv?from=2028-02-01&to=2028-02-29"
    )
    assert leap_only.status_code == 200
    leap_rows = list(csv.reader(io.StringIO(leap_only.text)))[1:]
    assert [row[0] for row in leap_rows] == ["2028-02-29", "2028-02-28"]

    earliest = authenticated_client.get(
        "/api/export/transactions.csv?from=0001-01-01&to=0001-12-31"
    )
    assert earliest.status_code == 200
    assert any(row[0] == "0001-01-01" for row in csv.reader(io.StringIO(earliest.text)))

    latest = authenticated_client.get(
        "/api/export/transactions.csv?to=9999-12-31"
    )
    assert latest.status_code == 200
    endings = [row[0] for row in list(csv.reader(io.StringIO(latest.text)))[1:]]
    assert "9999-12-31" in endings


def test_export_stable_ties_descending(authenticated_client, db_session):
    objects = _create_household_objects(db_session)
    first = Transaction(
        household_id=objects["household"].id,
        account_id=objects["account"].id,
        category_id=objects["category"].id,
        amount=-100,
        description="tie low id first inserted",
        transaction_date=date(2026, 4, 1),
        created_by_user_id=objects["owner"].id,
    )
    second = Transaction(
        household_id=objects["household"].id,
        account_id=objects["account"].id,
        category_id=objects["category"].id,
        amount=-200,
        description="tie higher id",
        transaction_date=date(2026, 4, 1),
        created_by_user_id=objects["owner"].id,
    )
    db_session.add_all([first, second])
    db_session.commit()
    # Same created_at (same commit second), so ordering shows the id tie-break.
    rows = [row for row in csv.reader(io.StringIO(
        authenticated_client.get(
            "/api/export/transactions.csv?from=2026-04-01&to=2026-04-01"
        ).text
    ))][1:]
    ids_expected = [second.id, first.id]
    assert ids_expected[0] == ids_expected[1] + 1
    assert [row[5] for row in rows] == ["-2.00", "-1.00"]


def test_export_amount_minus_never_prefixes_amount_cell(
    authenticated_client, db_session
):
    # Negative amounts in the CSV are numeric, not formula-neutralized.
    objects = _create_household_objects(db_session)
    db_session.add(
        Transaction(
            household_id=objects["household"].id,
            account_id=objects["account"].id,
            category_id=objects["category"].id,
            amount=-8472,
            description=None,
            transaction_date=date(2026, 6, 1),
            created_by_user_id=objects["owner"].id,
        )
    )
    db_session.commit()
    response = authenticated_client.get(
        "/api/export/transactions.csv?from=2026-06-01&to=2026-06-01"
    )
    body = response.text.split("\r\n")[1]
    assert body.endswith(",-84.72,EUR")
