import datetime as dt
import smtplib

import pytest

from app import mail, models, security, throttle
from app.config import settings
from app.deps import UNVERIFIED_ACCOUNT
from app.models import now_utc
from app.routers.auth import EMAIL_TAKEN
from tests.conftest import PASSWORD


@pytest.fixture()
def with_mail(monkeypatch):
    sent: list[tuple[str, str]] = []
    monkeypatch.setattr(mail, "configured", lambda: True)
    monkeypatch.setattr(mail, "send_verification", lambda address, token: sent.append((address, token)))
    return sent


def sign_in(client, username="member"):
    response = client.post(
        "/api/auth/login", json={"username": username, "password": PASSWORD}
    )
    assert response.status_code == 200
    return response


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


def test_spending_links_over_and_over_runs_out(client):
    for _ in range(10):
        assert client.post(
            "/api/auth/verify-email", json={"token": "not-a-link"}
        ).status_code == 400
    refused = client.post("/api/auth/verify-email", json={"token": "not-a-link"})
    assert refused.status_code == 429
    assert refused.json() == {"detail": throttle.TOO_MANY}


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


# ---- The wall: what an account that has not answered its mail may do ----


@pytest.fixture()
def walled(client, db_session, make_user, with_mail):
    """Signed in, unverified, on an instance that sends mail."""
    make_user("member", verified=False, email="member@example.com")
    sign_in(client)
    return with_mail


def test_an_unverified_account_is_turned_away_from_the_app(client, walled):
    refused = client.get("/api/diary/day")
    assert refused.status_code == 403
    assert refused.json() == {"detail": UNVERIFIED_ACCOUNT}


def test_the_wall_still_lets_the_account_get_out_of_it(client, walled):
    # The four addresses the verify screen itself needs: who am I, send it
    # again, write to somewhere else, and sign out.
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/resend-verification").status_code == 204
    assert (
        client.post("/api/account/email", json={"email": "elsewhere@example.com"}).status_code
        == 200
    )
    assert client.post("/api/auth/logout").status_code == 204


def test_the_wall_comes_before_the_first_run_screen(client, walled):
    # A fresh account meets both questions. The address is the one that has to
    # be settled first, so the screen behind it is refused like everything else.
    refused = client.post("/api/account/first-run")
    assert refused.status_code == 403
    assert refused.json() == {"detail": UNVERIFIED_ACCOUNT}
    assert client.get("/api/auth/me").json()["first_run_pending"] is True


def test_an_instance_without_mail_walls_nobody(client, db_session, make_user):
    # The same account, on an instance with nowhere to send a link. Nothing
    # gates it: there would be no way through.
    make_user("member", verified=False, email="member@example.com")
    sign_in(client)
    assert client.get("/api/diary/day").status_code == 200


def test_an_account_with_no_address_at_all_is_walled(client, db_session, make_user, with_mail):
    make_user("member", verified=True, email=None)
    sign_in(client)
    refused = client.get("/api/diary/day")
    assert refused.status_code == 403
    assert refused.json() == {"detail": UNVERIFIED_ACCOUNT}


def test_a_sync_key_belonging_to_an_unverified_account_is_turned_away(
    client, db_session, make_user, with_mail
):
    user = make_user("member", verified=False, email="member@example.com")
    plain = security.generate_token()
    db_session.add(
        models.IngestToken(
            user_id=user.id, token_hash=security.hash_token(plain), created_at=now_utc()
        )
    )
    db_session.commit()

    refused = client.post(
        "/api/ingest/health", json={"data": {}}, headers={"Authorization": f"Bearer {plain}"}
    )
    assert refused.status_code == 403
    assert refused.json() == {"detail": UNVERIFIED_ACCOUNT}


# ---- Putting an address on an account, and moving it ----


def test_an_account_with_no_address_takes_one_and_is_sent_a_link(
    client, db_session, make_user, with_mail
):
    user = make_user("member", verified=True, email=None)
    sign_in(client)

    answer = client.post("/api/account/email", json={"email": "Newly@Example.com"})
    assert answer.status_code == 200
    assert answer.json()["email"] == "newly@example.com"
    assert answer.json()["email_verified"] is False
    assert answer.json()["pending_email"] is None

    db_session.refresh(user)
    assert user.email == "newly@example.com"
    row = db_session.query(models.EmailToken).filter_by(user_id=user.id).one()
    assert row.purpose == "verify"
    assert with_mail == [("newly@example.com", with_mail[0][1])]


def test_changing_an_address_keeps_the_old_one_working_until_the_link_is_opened(
    client, db_session, make_user, with_mail
):
    user = make_user("member", verified=True, email="member@example.com")
    sign_in(client)

    answer = client.post("/api/account/email", json={"email": "moved@example.com"})
    assert answer.status_code == 200
    assert answer.json()["email"] == "member@example.com"
    assert answer.json()["pending_email"] == "moved@example.com"

    db_session.refresh(user)
    assert user.email == "member@example.com"
    assert user.email_verified is True
    row = db_session.query(models.EmailToken).filter_by(user_id=user.id).one()
    assert row.purpose == "change"
    # The link went to the new address rather than the one on the account.
    assert with_mail[0][0] == "moved@example.com"
    # And the old address still signs in, which is the point of holding the
    # new one aside: a typo cannot lock anybody out.
    sign_in(client)


def test_a_change_link_moves_the_address_and_clears_what_was_pending(
    client, db_session, make_user, with_mail
):
    user = make_user("member", verified=True, email="member@example.com")
    sign_in(client)
    assert client.post("/api/account/email", json={"email": "moved@example.com"}).status_code == 200
    token = with_mail[0][1]

    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 204
    db_session.refresh(user)
    assert user.email == "moved@example.com"
    assert user.pending_email is None
    assert user.email_verified is True


def test_an_address_somebody_else_holds_is_refused_when_it_is_asked_for(
    client, make_user, with_mail
):
    make_user("other", email="taken@example.com")
    make_user("member", email="member@example.com")
    sign_in(client)

    refused = client.post("/api/account/email", json={"email": "Taken@example.com"})
    assert refused.status_code == 400
    assert refused.json() == {"detail": EMAIL_TAKEN}


def test_an_address_claimed_while_the_link_sat_in_an_inbox_is_refused_at_the_end(
    client, db_session, make_user, with_mail
):
    user = make_user("member", email="member@example.com")
    sign_in(client)
    assert client.post("/api/account/email", json={"email": "moved@example.com"}).status_code == 200
    token = with_mail[0][1]

    # Somebody else takes it in the meantime.
    make_user("other", email="moved@example.com")

    refused = client.post("/api/auth/verify-email", json={"token": token})
    assert refused.status_code == 400
    assert refused.json() == {"detail": EMAIL_TAKEN}
    db_session.refresh(user)
    assert user.email == "member@example.com"
    # The link is not spent, so it still works once the clash is sorted out.
    assert db_session.query(models.EmailToken).filter_by(user_id=user.id).count() == 1


def test_asking_to_write_to_the_same_address_over_and_over_runs_out(
    client, make_user, with_mail
):
    make_user("member", email="member@example.com")
    sign_in(client)

    for _ in range(throttle.resend_limiter.max_attempts):
        assert (
            client.post("/api/account/email", json={"email": "moved@example.com"}).status_code
            == 200
        )
    refused = client.post("/api/account/email", json={"email": "moved@example.com"})
    assert refused.status_code == 429
    assert refused.json() == {"detail": throttle.TOO_MANY}


def test_an_address_that_is_not_one_is_refused(client, make_user, with_mail):
    make_user("member", email="member@example.com")
    sign_in(client)
    refused = client.post("/api/account/email", json={"email": "not-an-address"})
    assert refused.status_code == 400
    assert refused.json()["detail"] == "That does not look like an email address."


def test_writing_an_address_needs_a_session(client):
    assert client.post("/api/account/email", json={"email": "a@example.com"}).status_code == 401


# ---- The one setting that decides how the message goes out ----


class FakeSMTP:
    """Enough of smtplib.SMTP to see whether the connection was upgraded."""

    started = False

    def __init__(self, *args, **kwargs):
        FakeSMTP.started = False

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def starttls(self):
        FakeSMTP.started = True

    def login(self, user, password):
        return None

    def send_message(self, message):
        return None


@pytest.fixture()
def relay(monkeypatch):
    """A configured mail server that is only this class."""
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(settings, "smtp_host", "mailpit")
    monkeypatch.setattr(settings, "smtp_user", "anything")
    monkeypatch.setattr(settings, "smtp_password", "anything")
    monkeypatch.setattr(settings, "smtp_from", "tare@example.com")
    return FakeSMTP


def test_the_connection_is_upgraded_by_default(monkeypatch, relay):
    monkeypatch.setattr(settings, "smtp_starttls", True)
    mail.send("member@example.com", "Subject", "Body")
    assert relay.started is True


def test_turning_starttls_off_leaves_the_connection_alone(monkeypatch, relay):
    # The one reason to: a local mail catcher, which has no certificate.
    monkeypatch.setattr(settings, "smtp_starttls", False)
    mail.send("member@example.com", "Subject", "Body")
    assert relay.started is False
