import datetime as dt

import pytest

from app import mail, models, security
from app.routers.auth import RESET_SENT, STALE_RESET
from app.throttle import TOO_MANY
from tests.conftest import PASSWORD

NEW_PASSWORD = "a-whole-new-passphrase"


@pytest.fixture()
def with_mail(monkeypatch):
    """An instance that has a mail server, and the reset links it sends."""
    sent: list[tuple[str, str]] = []
    monkeypatch.setattr(mail, "configured", lambda: True)
    monkeypatch.setattr(mail, "send_reset", lambda address, token: sent.append((address, token)))
    return sent


def forgot(client, email):
    return client.post("/api/auth/forgot", json={"email": email})


def reset_token(db_session, user):
    token = security.create_email_token(
        db_session, user.id, "reset", security.RESET_TOKEN_HOURS
    )
    db_session.commit()
    return token


def test_a_known_address_is_sent_one_link(client, make_user, with_mail):
    make_user("member", email="member@example.com")
    response = forgot(client, "Member@Example.com")
    assert response.status_code == 200
    assert response.json() == {"detail": RESET_SENT}
    assert len(with_mail) == 1
    assert with_mail[0][0] == "member@example.com"


def test_an_address_nobody_has_reads_exactly_the_same(client, make_user, with_mail):
    make_user("member", email="member@example.com")
    response = forgot(client, "stranger@example.com")
    assert response.status_code == 200
    assert response.json() == {"detail": RESET_SENT}
    assert with_mail == []


def test_an_address_that_is_not_one_reads_the_same_too(client, with_mail):
    assert forgot(client, "not-an-address").json() == {"detail": RESET_SENT}
    assert with_mail == []


def test_an_unverified_account_is_not_sent_a_link(client, make_user, with_mail):
    make_user("pending", verified=False, email="pending@example.com")
    assert forgot(client, "pending@example.com").json() == {"detail": RESET_SENT}
    assert with_mail == []


def test_an_instance_with_no_mail_answers_the_sentence_and_sends_nothing(
    client, db_session, make_user
):
    make_user("member", email="member@example.com")
    response = forgot(client, "member@example.com")
    assert response.status_code == 200
    assert response.json() == {"detail": RESET_SENT}
    # Nothing was minted either, so there is no link to be found in a log.
    assert db_session.query(models.EmailToken).count() == 0


def test_asking_too_often_runs_out(client, make_user, with_mail):
    make_user("member", email="member@example.com")
    for _ in range(5):
        assert forgot(client, "member@example.com").status_code == 200
    refused = forgot(client, "member@example.com")
    assert refused.status_code == 429
    assert refused.json() == {"detail": TOO_MANY}


def test_a_reset_signs_in_changes_the_password_and_drops_the_other_sessions(
    client, db_session, make_user
):
    user = make_user("member", email="member@example.com")
    # A session somewhere else, of the kind a stolen password would be holding.
    security.create_session(db_session, user.id)
    db_session.commit()
    token = reset_token(db_session, user)

    response = client.post("/api/auth/reset", json={"token": token, "password": NEW_PASSWORD})
    assert response.status_code == 200
    assert response.json()["username"] == "member"
    assert security.COOKIE_NAME in response.cookies
    # Signed in on this browser, and the only session left is that one.
    assert client.get("/api/auth/me").status_code == 200
    assert db_session.query(models.Session).filter_by(user_id=user.id).count() == 1
    # The token is spent and the old password is gone.
    assert db_session.query(models.EmailToken).count() == 0
    db_session.refresh(user)
    assert security.verify_password(NEW_PASSWORD, user.password_hash) is True
    assert security.verify_password(PASSWORD, user.password_hash) is False


def test_the_same_link_cannot_be_spent_twice(client, db_session, make_user):
    user = make_user("member", email="member@example.com")
    token = reset_token(db_session, user)
    assert client.post(
        "/api/auth/reset", json={"token": token, "password": NEW_PASSWORD}
    ).status_code == 200

    again = client.post("/api/auth/reset", json={"token": token, "password": NEW_PASSWORD})
    assert again.status_code == 400
    assert again.json() == {"detail": STALE_RESET}


def test_an_expired_link_is_refused_and_swept(client, db_session, make_user, monkeypatch):
    from app.routers import auth

    user = make_user("member", email="member@example.com")
    token = reset_token(db_session, user)
    # An hour and a minute later, which is past the hour a reset link lasts.
    monkeypatch.setattr(
        auth, "now_utc", lambda: models.now_utc() + dt.timedelta(hours=1, minutes=1)
    )

    refused = client.post("/api/auth/reset", json={"token": token, "password": NEW_PASSWORD})
    assert refused.status_code == 400
    assert refused.json() == {"detail": STALE_RESET}
    assert db_session.query(models.EmailToken).count() == 0
    db_session.refresh(user)
    assert security.verify_password(PASSWORD, user.password_hash) is True


def test_a_verification_link_is_not_a_reset_link(client, db_session, make_user):
    user = make_user("member", email="member@example.com")
    token = security.create_email_token(db_session, user.id, "verify")
    db_session.commit()

    refused = client.post("/api/auth/reset", json={"token": token, "password": NEW_PASSWORD})
    assert refused.status_code == 400
    assert refused.json() == {"detail": STALE_RESET}


def test_a_password_the_rule_refuses_leaves_the_link_usable(client, db_session, make_user):
    user = make_user("member", email="member@example.com")
    token = reset_token(db_session, user)

    refused = client.post("/api/auth/reset", json={"token": token, "password": "short"})
    assert refused.status_code == 400
    assert refused.json()["detail"].startswith("Password must be at least")
    assert client.post(
        "/api/auth/reset", json={"token": token, "password": NEW_PASSWORD}
    ).status_code == 200


def test_a_reset_takes_the_sync_key_with_it(client, db_session, make_user):
    user = make_user("member", email="member@example.com")
    db_session.add(
        models.IngestToken(
            user_id=user.id,
            token_hash=security.hash_token(security.generate_token()),
            created_at=models.now_utc(),
        )
    )
    db_session.commit()
    token = reset_token(db_session, user)

    assert client.post(
        "/api/auth/reset", json={"token": token, "password": NEW_PASSWORD}
    ).status_code == 200
    assert db_session.query(models.IngestToken).count() == 0


def test_spending_links_over_and_over_runs_out(client):
    for _ in range(10):
        refused = client.post(
            "/api/auth/reset", json={"token": "not-a-link", "password": NEW_PASSWORD}
        )
        assert refused.status_code == 400
    refused = client.post(
        "/api/auth/reset", json={"token": "not-a-link", "password": NEW_PASSWORD}
    )
    assert refused.status_code == 429
    assert refused.json() == {"detail": TOO_MANY}
