from app import throttle


def test_a_limiter_refuses_in_the_same_shape_as_everything_else(client):
    limit = throttle.welcome_limiter.max_attempts
    for _ in range(limit):
        assert client.get("/api/invites/never-minted").status_code == 404

    refused = client.get("/api/invites/never-minted")
    assert refused.status_code == 429
    assert list(refused.json()) == ["detail"]
    assert refused.json()["detail"] == throttle.TOO_MANY


def test_registration_has_its_own_allowance(client, invite):
    limit = throttle.register_limiter.max_attempts
    for _ in range(limit):
        # Refused for the code rather than for the rate, which is what makes
        # the next one's refusal about the limiter.
        assert (
            client.post(
                "/api/auth/register",
                json={
                    "invite_code": "never-minted",
                    "username": "newcomer",
                    "password": "correct-horse-9",
                    "birthdate": "1990-04-02",
                    "timezone": "UTC",
                },
            ).status_code
            == 404
        )

    refused = client.post(
        "/api/auth/register",
        json={
            "invite_code": invite.code,
            "username": "newcomer",
            "password": "correct-horse-9",
            "birthdate": "1990-04-02",
            "timezone": "UTC",
        },
    )
    assert refused.status_code == 429
    assert refused.json() == {"detail": throttle.TOO_MANY}


def test_a_path_that_is_not_served_answers_in_the_one_shape(client):
    response = client.get("/api/nothing-here")
    assert response.status_code == 404
    assert response.json() == {"detail": "There is nothing at this address."}


def test_a_method_that_is_not_accepted_answers_in_the_one_shape(client):
    response = client.delete("/api/version")
    assert response.status_code == 405
    assert list(response.json()) == ["detail"]
    assert response.json()["detail"].endswith(".")


def test_reading_the_account_without_a_cookie_is_a_401(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 401
    assert response.json() == {"detail": "You are not signed in."}


def test_a_malformed_body_answers_in_the_one_shape(client):
    response = client.post("/api/auth/login", json={"username": "member"})
    assert response.status_code == 400
    assert response.json() == {"detail": "Request body is missing or malformed."}


def test_an_oversized_body_is_refused_before_it_is_parsed(client):
    response = client.post(
        "/api/auth/login",
        json={"username": "member", "password": "x" * (64 * 1024)},
    )
    assert response.status_code == 413
    assert response.json() == {"detail": "Request body is too large."}
