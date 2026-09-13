def test_account_lifecycle(authenticated_client, csrf_headers):
    client = authenticated_client
    payload = {"name": " Checking ", "type": "checking", "initialBalance": -8472}
    created = client.post("/api/accounts", json=payload, headers=csrf_headers())
    assert created.status_code == 201, created.text
    account = created.json()
    url = f"/api/accounts/{account['id']}"
    assert account == {
        "id": account["id"],
        "name": "Checking",
        "type": "checking",
        "initialBalance": -8472,
        "balance": -8472,
        "isArchived": False,
    }
    assert client.get(url).json() == account
    assert client.get("/api/accounts").json() == [account]
    changed = client.put(
        url,
        json={"name": "Main", "type": "savings", "initialBalance": 1},
        headers=csrf_headers(),
    )
    assert changed.status_code == 200
    assert changed.json()["balance"] == 1
    for _ in range(2):
        archived = client.post(url + "/archive", headers=csrf_headers())
        assert archived.status_code == 204 and archived.content == b""
    assert client.get("/api/accounts").json() == []
    assert client.get(url).json()["isArchived"] is True
    assert client.get("/api/accounts?includeArchived=true").json() == [
        client.get(url).json()
    ]
    assert (
        client.put(
            url,
            json={"name": "Changed archive", "type": "cash", "initialBalance": 0},
            headers=csrf_headers(),
        ).status_code
        == 409
    )
    assert client.get(url).json()["name"] == "Main"



def test_balance_moves_with_transaction_and_initial_balance(
    authenticated_client, csrf_headers
):
    client = authenticated_client
    checking = client.post(
        "/api/accounts",
        json={"name": "Checking", "type": "checking", "initialBalance": 1000},
        headers=csrf_headers(),
    ).json()
    savings = client.post(
        "/api/accounts",
        json={"name": "Savings", "type": "savings", "initialBalance": 2000},
        headers=csrf_headers(),
    ).json()
    category = client.post(
        "/api/categories",
        json={"name": "Groceries", "type": "expense"},
        headers=csrf_headers(),
    ).json()
    transaction_payload = {
        "accountId": checking["id"],
        "categoryId": category["id"],
        "amount": -300,
        "description": "Groceries",
        "transactionDate": "2026-09-07",
    }
    transaction = client.post(
        "/api/transactions",
        json=transaction_payload,
        headers=csrf_headers(),
    ).json()
    assert client.get(f"/api/accounts/{checking['id']}").json()["balance"] == 700
    assert client.get(f"/api/accounts/{savings['id']}").json()["balance"] == 2000

    moved = client.put(
        f"/api/transactions/{transaction['id']}",
        json={**transaction_payload, "accountId": savings["id"]},
        headers=csrf_headers(),
    )
    assert moved.status_code == 200
    balances = {
        row["id"]: row["balance"] for row in client.get("/api/accounts").json()
    }
    assert balances == {checking["id"]: 1000, savings["id"]: 1700}

    changed = client.put(
        f"/api/accounts/{savings['id']}",
        json={"name": "Savings", "type": "savings", "initialBalance": 2500},
        headers=csrf_headers(),
    )
    assert changed.status_code == 200
    assert changed.json()["initialBalance"] == 2500
    assert changed.json()["balance"] == 2200

    assert (
        client.post(
            f"/api/accounts/{savings['id']}/archive", headers=csrf_headers()
        ).status_code
        == 204
    )
    assert client.get(f"/api/accounts/{savings['id']}").json()["balance"] == 2200
    assert [row["id"] for row in client.get("/api/accounts").json()] == [checking["id"]]
    assert [
        row["id"]
        for row in client.get("/api/accounts?includeArchived=true").json()
    ] == [checking["id"], savings["id"]]


def test_account_balance_money_edges_and_archived_category(
    authenticated_client, csrf_headers
):
    client = authenticated_client
    account = client.post(
        "/api/accounts",
        json={"name": "Edges", "type": "credit_card", "initialBalance": -2},
        headers=csrf_headers(),
    ).json()
    expense = client.post(
        "/api/categories",
        json={"name": "Archived expense", "type": "expense"},
        headers=csrf_headers(),
    ).json()
    income = client.post(
        "/api/categories",
        json={"name": "Repeated cents", "type": "income"},
        headers=csrf_headers(),
    ).json()
    transaction_payload = {
        "accountId": account["id"],
        "categoryId": expense["id"],
        "amount": -1,
        "description": "Archived expense",
        "transactionDate": "2026-09-07",
    }
    assert (
        client.post(
            "/api/transactions",
            json=transaction_payload,
            headers=csrf_headers(),
        ).status_code
        == 201
    )
    assert (
        client.post(
            f"/api/categories/{expense['id']}/archive", headers=csrf_headers()
        ).status_code
        == 204
    )
    for index in range(100):
        repeated = client.post(
            "/api/transactions",
            json={
                **transaction_payload,
                "categoryId": income["id"],
                "amount": 1,
                "description": f"Cent {index}",
            },
            headers=csrf_headers(),
        )
        assert repeated.status_code == 201, repeated.text
    assert client.get(f"/api/accounts/{account['id']}").json()["balance"] == 97

    maximum = 9007199254740991
    limit_account = client.post(
        "/api/accounts",
        json={"name": "Limit", "type": "cash", "initialBalance": maximum},
        headers=csrf_headers(),
    ).json()
    assert limit_account["balance"] == maximum
    one_cent = client.post(
        "/api/transactions",
        json={
            **transaction_payload,
            "accountId": limit_account["id"],
            "categoryId": income["id"],
            "amount": 1,
            "description": "Over limit",
        },
        headers=csrf_headers(),
    )
    assert one_cent.status_code == 201
    overflow = client.get(f"/api/accounts/{limit_account['id']}")
    assert overflow.status_code == 409
    assert overflow.json()["error"]["code"] == "CONFLICT"
    failed_update = client.put(
        f"/api/accounts/{limit_account['id']}",
        json={"name": "Limit changed", "type": "cash", "initialBalance": maximum},
        headers=csrf_headers(),
    )
    assert failed_update.status_code == 409
    old_name_reuse = client.post(
        "/api/accounts",
        json={"name": "Limit", "type": "cash", "initialBalance": 0},
        headers=csrf_headers(),
    )
    assert old_name_reuse.status_code == 409

def test_account_validation_and_duplicate_name(authenticated_client, csrf_headers):
    client = authenticated_client
    valid = {"name": "Cash", "type": "cash", "initialBalance": 0}
    assert client.post("/api/accounts", json=valid, headers=csrf_headers()).status_code == 201
    duplicate = client.post(
        "/api/accounts", json={**valid, "name": " Cash "}, headers=csrf_headers()
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["fields"] == {"name": "Choose a different name."}
    for value in [True, 1.0, "1", None, 9007199254740992, -9007199254740992]:
        response = client.post(
            "/api/accounts",
            json={"name": "Invalid", "type": "cash", "initialBalance": value},
            headers=csrf_headers(),
        )
        assert response.status_code == 422, response.text
    assert client.get("/api/accounts").json()[0]["name"] == "Cash"


def test_account_query_and_ordering(authenticated_client, csrf_headers):
    client = authenticated_client
    for name in ["Zulu", "Alpha", "Same"]:
        assert client.post(
            "/api/accounts",
            json={"name": name, "type": "other", "initialBalance": 0},
            headers=csrf_headers(),
        ).status_code == 201
    archived = client.post(
        "/api/accounts",
        json={"name": "Archived", "type": "other", "initialBalance": 0},
        headers=csrf_headers(),
    ).json()
    assert client.post(
        f"/api/accounts/{archived['id']}/archive", headers=csrf_headers()
    ).status_code == 204
    assert [row["name"] for row in client.get("/api/accounts").json()] == [
        "Alpha",
        "Same",
        "Zulu",
    ]
    assert client.get("/api/accounts?includeArchived=false").status_code == 200
    assert client.get("/api/accounts?includeArchived=bad").status_code == 422
    assert [row["name"] for row in client.get("/api/accounts?includeArchived=true").json()] == [
        "Alpha",
        "Archived",
        "Same",
        "Zulu",
    ]


def test_account_strict_writes_and_failed_rename_preserve_data(
    authenticated_client, csrf_headers
):
    client = authenticated_client
    max_cents = 9007199254740991
    min_cents = -9007199254740991
    created_rows = []
    for name, amount, account_type in [
        ("<script>alert(1)</script>", 0, "credit_card"),
        ("Positive Limit", max_cents, "checking"),
        ("Negative One", -1, "other"),
        ("Negative Limit", min_cents, "savings"),
    ]:
        response = client.post(
            "/api/accounts",
            json={"name": name, "type": account_type, "initialBalance": amount},
            headers=csrf_headers(),
        )
        assert response.status_code == 201, response.text
        created_rows.append(response.json())
    assert created_rows[0]["name"] == "<script>alert(1)</script>"
    assert created_rows[1]["initialBalance"] == max_cents
    assert created_rows[2]["initialBalance"] == -1
    assert created_rows[3]["initialBalance"] == min_cents

    unicode_name = " " + ("界" * 100) + " "
    unicode_response = client.post(
        "/api/accounts",
        json={"name": unicode_name, "type": "other", "initialBalance": 0},
        headers=csrf_headers(),
    )
    assert unicode_response.status_code == 201, unicode_response.text
    assert unicode_response.json()["name"] == "界" * 100
    assert len(unicode_response.json()["name"]) == 100

    rejected_type = client.post(
        "/api/accounts",
        json={"name": "Unknown Type", "type": "unknown", "initialBalance": 0},
        headers=csrf_headers(),
    )
    assert rejected_type.status_code == 422
    forged = {
        "name": "Forged",
        "type": "cash",
        "initialBalance": 0,
        "id": created_rows[0]["id"],
        "householdId": 999,
        "household_id": 999,
        "balance": 100,
        "isArchived": True,
    }
    before_rows = client.get("/api/accounts").json()
    rejected_forged = client.post(
        "/api/accounts", json=forged, headers=csrf_headers()
    )
    assert rejected_forged.status_code == 422
    assert client.get("/api/accounts").json() == before_rows
    detail_url = f"/api/accounts/{created_rows[0]['id']}"
    before = client.get(detail_url).json()
    rejected_update = client.put(detail_url, json=forged, headers=csrf_headers())
    assert rejected_update.status_code == 422
    assert client.get(detail_url).json() == before

    rename_target = client.post(
        "/api/accounts",
        json={"name": "Rename Target", "type": "cash", "initialBalance": 0},
        headers=csrf_headers(),
    ).json()
    failed_rename = client.put(
        detail_url,
        json={
            "name": rename_target["name"],
            "type": "credit_card",
            "initialBalance": 1,
        },
        headers=csrf_headers(),
    )
    assert failed_rename.status_code == 409
    assert client.get(detail_url).json() == before


def test_account_archive_reserves_name_and_has_no_delete_route(
    authenticated_client, csrf_headers
):
    client = authenticated_client
    created = client.post(
        "/api/accounts",
        json={"name": "Retained", "type": "cash", "initialBalance": 0},
        headers=csrf_headers(),
    ).json()
    url = f"/api/accounts/{created['id']}"
    assert client.post(url + "/archive", headers=csrf_headers()).status_code == 204
    duplicate = client.post(
        "/api/accounts",
        json={"name": " Retained ", "type": "checking", "initialBalance": 0},
        headers=csrf_headers(),
    )
    assert duplicate.status_code == 409
    assert client.delete(url, headers=csrf_headers()).status_code == 405
    assert client.get(url).json()["isArchived"] is True
