from fastapi.testclient import TestClient


def test_anonymous_login_requires_exact_origin_and_csrf(client, seeded_user):
    client.get("/api/auth/csrf")
    token = client.cookies.get("XSRF-TOKEN")
    assert token
    payload = {"username": seeded_user.username, "password": seeded_user.password}

    assert client.post(
        "/api/auth/login",
        json=payload,
        headers={"Origin": "https://evil.example", "X-XSRF-TOKEN": token},
    ).status_code == 403
    assert client.post(
        "/api/auth/login",
        json=payload,
        headers={"Origin": "http://127.0.0.1:4200"},
    ).status_code == 403


def test_csrf_token_is_bound_to_logged_in_session(client, seeded_user, csrf_headers):
    anonymous_token = client.cookies.get("XSRF-TOKEN")
    assert anonymous_token is None
    assert client.get("/api/auth/csrf").status_code == 204
    anonymous_token = client.cookies.get("XSRF-TOKEN")
    assert anonymous_token
    assert client.post(
        "/api/auth/login",
        json={"username": seeded_user.username, "password": seeded_user.password},
        headers={"Origin": "http://127.0.0.1:4200", "X-XSRF-TOKEN": anonymous_token},
    ).status_code == 200
    client.cookies.set("XSRF-TOKEN", anonymous_token)
    assert client.post(
        "/api/auth/logout",
        headers={"Origin": "http://127.0.0.1:4200", "X-XSRF-TOKEN": anonymous_token},
    ).status_code == 403



def test_authenticated_csrf_token_cannot_cross_sessions(
    client, test_app, seeded_user, csrf_headers
):
    assert client.post(
        "/api/auth/login",
        json={"username": seeded_user.username, "password": seeded_user.password},
        headers=csrf_headers(),
    ).status_code == 200
    first_token = client.cookies.get("XSRF-TOKEN")
    assert first_token

    with TestClient(test_app) as second_client:
        second_client.get("/api/auth/csrf")
        second_token = second_client.cookies.get("XSRF-TOKEN")
        assert second_client.post(
            "/api/auth/login",
            json={"username": seeded_user.username, "password": seeded_user.password},
            headers={
                "Origin": "http://127.0.0.1:4200",
                "X-XSRF-TOKEN": second_token,
            },
        ).status_code == 200
        second_token = second_client.cookies.get("XSRF-TOKEN")
        assert second_token and second_token != first_token

        second_client.cookies.set("XSRF-TOKEN", first_token)
        response = second_client.post(
            "/api/auth/logout",
            headers={
                "Origin": "http://127.0.0.1:4200",
                "X-XSRF-TOKEN": first_token,
            },
        )

    assert response.status_code == 403

def test_csrf_bootstrap_is_private_data_free(client, seeded_user):
    response = client.get("/api/auth/csrf")
    assert response.status_code == 204
    assert response.content == b""
    assert seeded_user.username not in response.text
