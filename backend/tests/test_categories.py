def test_category_type_and_archive(authenticated_client, csrf_headers):
    client = authenticated_client
    created = client.post(
        "/api/categories",
        json={"name": " Groceries ", "type": "expense"},
        headers=csrf_headers(),
    )
    assert created.status_code == 201, created.text
    category = created.json()
    url = f"/api/categories/{category['id']}"
    assert category["name"] == "Groceries"
    changed = client.put(url, json={"name": "Food"}, headers=csrf_headers())
    assert changed.status_code == 200 and changed.json()["name"] == "Food"
    rejected = client.put(
        url, json={"name": "Invalid", "type": "income"}, headers=csrf_headers()
    )
    assert rejected.status_code == 422
    assert client.get(url).json() == changed.json()
    for _ in range(2):
        response = client.post(url + "/archive", headers=csrf_headers())
        assert response.status_code == 204 and response.content == b""
    assert client.get("/api/categories").json() == []
    assert client.get("/api/categories?includeArchived=true").json() == [
        client.get(url).json()
    ]
    assert (
        client.put(
            url, json={"name": "Changed archive"}, headers=csrf_headers()
        ).status_code
        == 409
    )


def test_category_validation_and_uniqueness(authenticated_client, csrf_headers):
    client = authenticated_client
    valid = {"name": "Bills", "type": "expense"}
    assert client.post(
        "/api/categories", json=valid, headers=csrf_headers()
    ).status_code == 201
    duplicate = client.post(
        "/api/categories", json={**valid, "name": " Bills "}, headers=csrf_headers()
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["fields"] == {"name": "Choose a different name."}
    assert client.post(
        "/api/categories",
        json={"name": "Bills", "type": "income"},
        headers=csrf_headers(),
    ).status_code == 201
    for payload in [
        {"name": "", "type": "expense"},
        {"name": "   ", "type": "expense"},
        {"name": "x" * 101, "type": "expense"},
        {"name": "Unknown", "type": "other"},
        {"name": "Unknown", "type": "expense", "id": 4},
    ]:
        response = client.post("/api/categories", json=payload, headers=csrf_headers())
        assert response.status_code == 422, response.text


def test_category_query_and_ordering(authenticated_client, csrf_headers):
    client = authenticated_client
    for kind, name in [("income", "Salary"), ("expense", "Alpha"), ("income", "Bonus")]:
        assert client.post(
            "/api/categories",
            json={"name": name, "type": kind},
            headers=csrf_headers(),
        ).status_code == 201
    archived = client.post(
        "/api/categories",
        json={"name": "Archived", "type": "expense"},
        headers=csrf_headers(),
    ).json()
    assert client.post(
        f"/api/categories/{archived['id']}/archive", headers=csrf_headers()
    ).status_code == 204
    assert [
        (row["type"], row["name"])
        for row in client.get("/api/categories").json()
    ] == [("expense", "Alpha"), ("income", "Bonus"), ("income", "Salary")]
    assert client.get("/api/categories?includeArchived=false").status_code == 200
    assert client.get("/api/categories?includeArchived=bad").status_code == 422
    assert [
        (row["type"], row["name"])
        for row in client.get("/api/categories?includeArchived=true").json()
    ] == [
        ("expense", "Alpha"),
        ("expense", "Archived"),
        ("income", "Bonus"),
        ("income", "Salary"),
    ]


def test_category_strict_writes_and_failed_rename_preserve_data(
    authenticated_client, csrf_headers
):
    client = authenticated_client
    name = "<script>alert(1)</script>"
    created = client.post(
        "/api/categories",
        json={"name": name, "type": "expense"},
        headers=csrf_headers(),
    )
    assert created.status_code == 201, created.text
    category = created.json()
    unicode_name = " " + ("界" * 100) + " "
    unicode_response = client.post(
        "/api/categories",
        json={"name": unicode_name, "type": "income"},
        headers=csrf_headers(),
    )
    assert unicode_response.status_code == 201, unicode_response.text
    assert unicode_response.json()["name"] == "界" * 100
    assert len(unicode_response.json()["name"]) == 100
    url = f"/api/categories/{category['id']}"
    forged = {
        "name": "Forged",
        "type": "income",
        "id": category["id"],
        "householdId": 999,
        "household_id": 999,
        "isArchived": True,
    }
    before_rows = client.get("/api/categories").json()
    rejected = client.post("/api/categories", json=forged, headers=csrf_headers())
    assert rejected.status_code == 422
    assert client.get("/api/categories").json() == before_rows
    before = client.get(url).json()
    rejected_update = client.put(url, json=forged, headers=csrf_headers())
    assert rejected_update.status_code == 422
    assert client.get(url).json() == before
    target = client.post(
        "/api/categories",
        json={"name": "Rename Target", "type": "expense"},
        headers=csrf_headers(),
    ).json()
    failed_rename = client.put(
        url, json={"name": target["name"]}, headers=csrf_headers()
    )
    assert failed_rename.status_code == 409
    assert client.get(url).json() == before


def test_category_archive_reserves_name_and_has_no_delete_route(
    authenticated_client, csrf_headers
):
    client = authenticated_client
    created = client.post(
        "/api/categories",
        json={"name": "Retained", "type": "expense"},
        headers=csrf_headers(),
    ).json()
    url = f"/api/categories/{created['id']}"
    assert client.post(url + "/archive", headers=csrf_headers()).status_code == 204
    duplicate = client.post(
        "/api/categories",
        json={"name": " Retained ", "type": "expense"},
        headers=csrf_headers(),
    )
    assert duplicate.status_code == 409
    assert client.delete(url, headers=csrf_headers()).status_code == 405
    assert client.get(url).json()["isArchived"] is True
