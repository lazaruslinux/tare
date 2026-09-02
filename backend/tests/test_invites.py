import datetime as dt

from app import models
from app.models import now_utc
from app.routers.invites import DEAD_INVITE
from tests.conftest import BIRTHDATE, PASSWORD


def signup(client, code, username="newcomer"):
    return client.post(
        "/api/auth/register",
        json={
            "invite_code": code,
            "username": username,
            "password": PASSWORD,
            "birthdate": BIRTHDATE.isoformat(),
            "timezone": "UTC",
        },
    )


def test_a_live_invite_names_who_sent_it(client, db_session, admin, invite):
    admin.display_name = "The Cook"
    db_session.commit()
    response = client.get(f"/api/invites/{invite.code}")
    assert response.status_code == 200
    assert response.json() == {"inviter_display_name": "The Cook"}


def test_an_inviter_with_no_display_name_is_named_by_username(client, invite):
    assert client.get(f"/api/invites/{invite.code}").json() == {"inviter_display_name": "admin"}


def test_every_dead_ending_reads_the_same(client, db_session, admin, invite):
    answers = []

    # Never minted.
    answers.append(client.get("/api/invites/never-minted"))

    # Claimed.
    invite.used_by = admin.id
    db_session.commit()
    answers.append(client.get(f"/api/invites/{invite.code}"))

    # Revoked.
    invite.used_by = None
    invite.revoked_at = now_utc()
    db_session.commit()
    answers.append(client.get(f"/api/invites/{invite.code}"))

    # Run out.
    invite.revoked_at = None
    invite.expires_at = now_utc() - dt.timedelta(seconds=1)
    db_session.commit()
    answers.append(client.get(f"/api/invites/{invite.code}"))

    for answer in answers:
        assert answer.status_code == 404
        assert answer.json() == {"detail": DEAD_INVITE}


def test_a_deleted_invite_reads_as_one_that_never_existed(client, db_session, invite):
    code = invite.code
    db_session.delete(invite)
    db_session.commit()
    response = client.get(f"/api/invites/{code}")
    assert response.status_code == 404
    assert response.json() == {"detail": DEAD_INVITE}


def test_an_expired_invite_cannot_be_spent(client, db_session, invite):
    invite.expires_at = now_utc() - dt.timedelta(days=1)
    db_session.commit()
    response = signup(client, invite.code)
    assert response.status_code == 404
    assert response.json() == {"detail": DEAD_INVITE}


def test_one_invite_makes_exactly_one_account(client, db_session, invite):
    assert signup(client, invite.code, "first").status_code == 200

    second = signup(client, invite.code, "second")
    assert second.status_code == 404
    assert second.json() == {"detail": DEAD_INVITE}

    assert db_session.query(models.User).filter_by(username="second").count() == 0
    db_session.refresh(invite)
    assert invite.used_by == db_session.query(models.User).filter_by(username="first").one().id
