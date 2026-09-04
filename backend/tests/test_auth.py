import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app import mail, models, security
from app.config import settings
from app.routers.auth import (
    BAD_CREDENTIALS,
    EMAIL_REQUIRED,
    FUTURE_BIRTHDATE,
    IMPOSSIBLE_BIRTHDATE,
    UNDER_AGE,
    UNVERIFIED,
)
from app.routers.invites import DEAD_INVITE
from tests.conftest import BIRTHDATE, PASSWORD


@pytest.fixture()
def with_mail(monkeypatch):
    """An instance that has a mail server, without one being there."""
    monkeypatch.setattr(mail, "configured", lambda: True)
    monkeypatch.setattr(mail, "send_verification", lambda address, token: None)


def signup(client, invite, **overrides):
    body = {
        "invite_code": invite.code,
        "username": "newcomer",
        "password": PASSWORD,
        "birthdate": BIRTHDATE.isoformat(),
        "timezone": "America/Phoenix",
    }
    body.update(overrides)
    return client.post("/api/auth/register", json=body)


def test_register_without_mail_signs_the_account_straight_in(client, db_session, invite):
    response = signup(client, invite)
    assert response.status_code == 200
    assert response.json() == {"state": "ready"}
    assert security.COOKIE_NAME in response.cookies

    user = db_session.query(models.User).filter_by(username="newcomer").one()
    assert user.email_verified is True
    assert user.timezone == "America/Phoenix"
    # The invite is spent, and spent by the account it made.
    db_session.refresh(invite)
    assert invite.used_by == user.id

    assert client.get("/api/auth/me").status_code == 200


def test_register_with_mail_waits_for_the_link(client, db_session, invite, with_mail):
    response = signup(client, invite, email="Newcomer@Example.com")
    assert response.status_code == 200
    assert response.json() == {"state": "check_email"}
    # No cookie: an account that has not answered its mail cannot sign in, so
    # handing it a session here would make the whole check decorative.
    assert security.COOKIE_NAME not in response.cookies

    user = db_session.query(models.User).filter_by(username="newcomer").one()
    assert user.email_verified is False
    assert user.email == "newcomer@example.com"
    assert db_session.query(models.EmailToken).filter_by(user_id=user.id).count() == 1


def test_an_instance_with_mail_will_not_make_an_account_with_nowhere_to_write(
    client, invite, with_mail
):
    refused = signup(client, invite)
    assert refused.status_code == 400
    assert refused.json() == {"detail": EMAIL_REQUIRED}


def test_an_instance_without_mail_leaves_the_address_optional(client, db_session, invite):
    assert signup(client, invite).status_code == 200
    user = db_session.query(models.User).filter_by(username="newcomer").one()
    assert user.email is None


def test_a_zone_off_the_list_falls_back_rather_than_refusing(client, db_session, invite):
    # The instance's own zone stands in, and the Display screen can change it.
    assert signup(client, invite, timezone="Europe/Paris").status_code == 200
    user = db_session.query(models.User).filter_by(username="newcomer").one()
    assert user.timezone == settings.tz


def test_a_taken_username_is_answered_plainly_when_the_invite_is_good(
    client, invite, make_user
):
    make_user("newcomer")
    response = signup(client, invite)
    assert response.status_code == 400
    assert response.json()["detail"] == "That username or email is already taken."


def test_a_dead_invite_answers_before_the_username_is_looked_at(client, invite, make_user):
    # The same taken username as above, so the only difference is the code.
    make_user("newcomer")
    response = signup(client, invite, invite_code="never-minted")
    assert response.status_code == 404
    assert response.json() == {"detail": DEAD_INVITE}


def test_a_short_password_is_refused_with_the_rule(client, invite):
    response = signup(client, invite, password="short")
    assert response.status_code == 400
    assert "at least" in response.json()["detail"]


def test_login_with_the_wrong_password_says_nothing_useful(client, signed_in):
    response = client.post("/api/auth/login", json={"username": "member", "password": "nope-nope-nope"})
    assert response.status_code == 401
    assert response.json() == {"detail": BAD_CREDENTIALS}


def test_login_as_nobody_reads_the_same_as_a_wrong_password(client):
    response = client.post("/api/auth/login", json={"username": "ghost", "password": PASSWORD})
    assert response.status_code == 401
    assert response.json() == {"detail": BAD_CREDENTIALS}


def test_an_unverified_account_is_told_so_only_once_the_password_is_right(client, make_user):
    make_user("pending", verified=False)

    wrong = client.post("/api/auth/login", json={"username": "pending", "password": "not-it-at-all"})
    # Reads as a wrong password, not as an unverified account: the other order
    # would tell anyone holding a username whether a guess was correct.
    assert wrong.status_code == 401
    assert wrong.json() == {"detail": BAD_CREDENTIALS}

    right = client.post("/api/auth/login", json={"username": "pending", "password": PASSWORD})
    assert right.status_code == 403
    assert right.json() == {"detail": UNVERIFIED}


def test_login_answers_with_the_me_payload(client, make_user):
    make_user("member", email="member@example.com")
    response = client.post("/api/auth/login", json={"username": "member", "password": PASSWORD})
    assert response.status_code == 200
    assert response.json() == {
        "id": 1,
        "username": "member",
        "display_name": None,
        "email": "member@example.com",
        "email_verified": True,
        "is_admin": False,
        "units": "imperial",
        "timezone": "UTC",
        "birthdate": BIRTHDATE.isoformat(),
        "location": None,
        "feed_hidden": [],
        "share_age": False,
        "share_sex": False,
        "share_location": False,
        "share_workouts": True,
    }


def test_the_session_cookie_is_set_the_way_a_session_cookie_should_be(client, make_user):
    make_user("member")
    response = client.post("/api/auth/login", json={"username": "member", "password": PASSWORD})
    header = response.headers["set-cookie"]
    assert header.startswith(f"{security.COOKIE_NAME}=")
    assert "HttpOnly" in header
    assert "samesite=lax" in header.lower()
    assert "Path=/" in header
    assert "Max-Age=" in header
    # Development is served over plain http, and a Secure cookie would be
    # dropped on the way there.
    assert "Secure" not in header


def test_logout_kills_the_session_the_cookie_names(client, signed_in):
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_logout_works_when_there_is_nothing_to_sign_out_of(client):
    assert client.post("/api/auth/logout").status_code == 204


def test_changing_the_password_keeps_this_session_and_ends_the_others(client, signed_in):
    elsewhere = TestClient(client.app)
    assert (
        elsewhere.post("/api/auth/login", json={"username": "member", "password": PASSWORD}).status_code
        == 200
    )

    response = client.post(
        "/api/auth/password",
        json={"current_password": PASSWORD, "new_password": "a-whole-new-one"},
    )
    assert response.status_code == 204

    assert client.get("/api/auth/me").status_code == 200
    assert elsewhere.get("/api/auth/me").status_code == 401
    assert (
        client.post("/api/auth/login", json={"username": "member", "password": PASSWORD}).status_code
        == 401
    )


def test_the_current_password_has_to_be_right(client, signed_in):
    response = client.post(
        "/api/auth/password",
        json={"current_password": "not-the-one", "new_password": "a-whole-new-one"},
    )
    assert response.status_code == 403
    assert response.json() == {"detail": "Current password is not correct."}


def test_a_new_password_still_has_to_clear_the_minimum(client, signed_in):
    response = client.post(
        "/api/auth/password", json={"current_password": PASSWORD, "new_password": "short"}
    )
    assert response.status_code == 400
    assert "at least" in response.json()["detail"]


@pytest.fixture()
def frozen_day(monkeypatch):
    """The day the age cases were worked on, so an eighteenth birthday is one
    date rather than whatever today happens to be."""
    from app.routers import auth

    monkeypatch.setattr(
        auth, "now_utc", lambda: dt.datetime(2026, 9, 2, 12, 0, tzinfo=dt.timezone.utc)
    )


def test_seventeen_years_and_364_days_is_refused(client, invite, frozen_day):
    refused = signup(client, invite, birthdate="2008-09-03")
    assert refused.status_code == 400
    assert refused.json() == {"detail": UNDER_AGE}


def test_the_eighteenth_birthday_itself_is_accepted(client, invite, frozen_day):
    assert signup(client, invite, birthdate="2008-09-02").status_code == 200


def test_a_birthdate_in_the_future_is_refused(client, invite, frozen_day):
    refused = signup(client, invite, birthdate="2027-01-01")
    assert refused.status_code == 400
    assert refused.json() == {"detail": FUTURE_BIRTHDATE}


def test_a_birthdate_nobody_could_have_is_refused(client, invite, frozen_day):
    refused = signup(client, invite, birthdate="1880-01-01")
    assert refused.status_code == 400
    assert refused.json() == {"detail": IMPOSSIBLE_BIRTHDATE}


def test_registration_will_not_happen_without_one(client, invite):
    response = client.post(
        "/api/auth/register",
        json={"invite_code": invite.code, "username": "newcomer", "password": PASSWORD},
    )
    assert response.status_code == 400


def test_the_birthdate_is_kept_on_the_account(client, db_session, invite, frozen_day):
    assert signup(client, invite, birthdate="1990-04-02").status_code == 200
    user = db_session.query(models.User).filter_by(username="newcomer").one()
    assert user.birthdate == dt.date(1990, 4, 2)
