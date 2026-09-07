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
