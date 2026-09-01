import datetime as dt

import pytest

from app import mail, models, security
from app.models import now_utc


@pytest.fixture()
def with_mail(monkeypatch):
    sent: list[tuple[str, str]] = []
    monkeypatch.setattr(mail, "configured", lambda: True)
    monkeypatch.setattr(mail, "send_verification", lambda address, token: sent.append((address, token)))
    return sent


def test_a_link_verifies_the_account_once_and_then_never_again(client, db_session, make_user):
    user = make_user("pending", verified=False, email="pending@example.com")
    token = security.create_email_token(db_session, user.id, "verify")
    db_session.commit()

    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 204
    db_session.refresh(user)
    assert user.email_verified is True

    again = client.post("/api/auth/verify-email", json={"token": token})
    assert again.status_code == 400
    assert again.json()["detail"].endswith("Ask for a new one.")


def test_an_expired_link_is_refused_and_swept(client, db_session, make_user):
    user = make_user("pending", verified=False, email="pending@example.com")
    token = security.create_email_token(db_session, user.id, "verify")
    db_session.commit()
    row = db_session.query(models.EmailToken).one()
    row.expires_at = now_utc() - dt.timedelta(seconds=1)
    db_session.commit()

    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 400
    assert db_session.query(models.EmailToken).count() == 0
    db_session.refresh(user)
    assert user.email_verified is False


def test_a_token_minted_for_something_else_is_not_a_verification_link(
    client, db_session, make_user
):
    user = make_user("pending", verified=False, email="pending@example.com")
    token = security.create_email_token(db_session, user.id, "change-email")
    db_session.commit()

    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 400
    db_session.refresh(user)
    assert user.email_verified is False


def test_a_resend_replaces_the_link_rather_than_adding_one(
    client, db_session, make_user, with_mail
):
    # Signed in first and unverified after: an account that has not answered
    # its mail cannot sign in, so this is the shape a real one is in when the
    # button is on screen, holding a session from the registration itself.
    user = make_user("member", email="member@example.com")
    client.post("/api/auth/login", json={"username": "member", "password": "correct-horse-9"})
    user.email_verified = False
    db_session.commit()

    assert client.post("/api/auth/resend-verification").status_code == 204
    assert client.post("/api/auth/resend-verification").status_code == 204
    # The older link stops working rather than sitting in the inbox as good as
    # the newest one for a day.
    assert db_session.query(models.EmailToken).filter_by(user_id=user.id).count() == 1
    assert len(with_mail) == 2


def test_resends_run_out(client, db_session, make_user, with_mail):
    user = make_user("member", email="member@example.com")
    client.post("/api/auth/login", json={"username": "member", "password": "correct-horse-9"})
    user.email_verified = False
    db_session.commit()

    for _ in range(3):
        assert client.post("/api/auth/resend-verification").status_code == 204
    refused = client.post("/api/auth/resend-verification")
    assert refused.status_code == 429
    assert refused.json()["detail"].startswith("Too many attempts")


def test_a_verified_account_asking_again_sends_nothing(client, signed_in, with_mail):
    assert client.post("/api/auth/resend-verification").status_code == 204
    assert with_mail == []


def test_resending_needs_a_session(client):
    assert client.post("/api/auth/resend-verification").status_code == 401
