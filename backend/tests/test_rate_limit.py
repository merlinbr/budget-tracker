from app.auth.rate_limit import LoginRateLimiter, RateLimitExceeded


def test_limiter_blocks_sixth_failure_and_recovers_with_clock():
    now = [100.0]
    limiter = LoginRateLimiter(clock=lambda: now[0])
    for _ in range(5):
        ticket = limiter.reserve("user", "ip")
        limiter.finish(ticket, success=False)

    try:
        limiter.reserve("user", "ip")
    except RateLimitExceeded as exc:
        assert exc.retry_after == 900
    else:
        raise AssertionError("sixth attempt was not limited")

    now[0] += 901
    ticket = limiter.reserve("user", "ip")
    limiter.finish(ticket, success=True)


def test_username_success_does_not_clear_ip_failures():
    now = [0.0]
    limiter = LoginRateLimiter(clock=lambda: now[0])
    for username in ("one", "two", "three", "four", "five"):
        ticket = limiter.reserve(username, "same-ip")
        limiter.finish(ticket, success=False)

    ticket = limiter.reserve("one", "different-ip")
    limiter.finish(ticket, success=True)
    try:
        limiter.reserve("six", "same-ip")
    except RateLimitExceeded:
        pass
    else:
        raise AssertionError("IP limiter was cleared by username success")

def test_login_endpoint_limits_failures_and_recovers(client, seeded_user):
    for _ in range(5):
        client.get("/api/auth/csrf")
        token = client.cookies.get("XSRF-TOKEN")
        response = client.post(
            "/api/auth/login",
            json={"username": seeded_user.username, "password": "wrong password!"},
            headers={
                "Origin": "http://127.0.0.1:4200",
                "X-XSRF-TOKEN": token,
            },
        )
        assert response.status_code == 401

    client.get("/api/auth/csrf")
    token = client.cookies.get("XSRF-TOKEN")
    limited = client.post(
        "/api/auth/login",
        json={"username": seeded_user.username, "password": "wrong password!"},
        headers={
            "Origin": "http://127.0.0.1:4200",
            "X-XSRF-TOKEN": token,
            "X-Forwarded-For": "198.51.100.20",
        },
    )
    assert limited.status_code == 429
    assert limited.headers.get("Retry-After")
