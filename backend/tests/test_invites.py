import datetime as dt

from app import models
from app.models import now_utc
from app.routers import auth, invites
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
            # Required on every instance, and one per name so three seats are
            # three accounts rather than three tries at the same address.
            "email": f"{username}@example.com",
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

    # Every seat spent.
    invite.used = invite.seats
    db_session.commit()
    answers.append(client.get(f"/api/invites/{invite.code}"))

    # Run out.
    invite.used = 0
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
    assert invite.used == 1
    first = db_session.query(models.User).filter_by(username="first").one()
    assert first.invite_id == invite.id


def test_a_three_seat_link_makes_exactly_three_accounts(client, db_session, admin):
    """One link in a group chat, three people through it, and the fourth is
    told what everybody holding a dead link is told."""
    row = invites.mint(db_session, admin, 0, 3)
    db_session.commit()

    for name in ("first", "second", "third"):
        assert signup(client, row.code, name).status_code == 200

    fourth = signup(client, row.code, "fourth")
    assert fourth.status_code == 404
    assert fourth.json() == {"detail": DEAD_INVITE}
    assert db_session.query(models.User).filter_by(username="fourth").count() == 0

    db_session.refresh(row)
    assert row.used == 3
    came_in = (
        db_session.query(models.User)
        .filter_by(invite_id=row.id)
        .order_by(models.User.id)
        .all()
    )
    assert [user.username for user in came_in] == ["first", "second", "third"]


def test_two_people_spending_the_last_seat_at_once_leave_one_of_them_out(
    client, db_session, admin, monkeypatch
):
    """The claim is one conditional UPDATE, so the loser is the registration
    whose UPDATE touched nothing, and the count never passes the seats."""
    row = invites.mint(db_session, admin, 0, 2)
    db_session.commit()
    assert signup(client, row.code, "first").status_code == 200
    assert signup(client, row.code, "second").status_code == 200
    db_session.refresh(row)
    assert row.used == 2

    # Somebody else took the last seat between this registration's read and its
    # write. The read still hands back a live row; the UPDATE finds none.
    monkeypatch.setattr(auth, "live_invite", lambda db, code: row)
    loser = signup(client, row.code, "third")
    assert loser.status_code == 404
    assert loser.json() == {"detail": DEAD_INVITE}

    assert db_session.query(models.User).filter_by(username="third").count() == 0
    db_session.refresh(row)
    assert row.used == 2
