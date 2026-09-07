"""Who a member shares with, and what stops at somebody who is not a friend.

A friendship is two agreements and one row. The cases below hold that row to
it: one pair however the asking went, nothing shared until both sides said so,
and nothing left behind when either of them walks away.
"""

import datetime as dt

from sqlalchemy import select

from app import models
from app.models import now_utc
from tests.test_feed import befriend, put_journal, put_weigh_in, put_workout, sign_in


def rows(db_session):
    return list(db_session.execute(select(models.Friendship)).scalars())


# Asking, agreeing and walking away
# ---------------------------------


def test_a_request_is_accepted_and_then_removed(client, db_session, make_user):
    asker = make_user("asker")
    asked = make_user("asked")

    sign_in(client, "asker")
    sent = client.post(f"/api/feed/friends/{asked.id}")
    assert sent.status_code == 200
    assert sent.json() == {"friendship": "requested"}
    assert client.get(f"/api/feed/members/{asked.id}").json()["friendship"] == "requested"

    sign_in(client, "asked")
    assert client.get(f"/api/feed/members/{asker.id}").json()["friendship"] == "incoming"
    agreed = client.post(f"/api/feed/friends/{asker.id}/accept")
    assert agreed.status_code == 200
    assert agreed.json() == {"friendship": "friends"}
    assert client.get(f"/api/feed/members/{asker.id}").json()["friendship"] == "friends"

    gone = client.delete(f"/api/feed/friends/{asker.id}")
    assert gone.status_code == 204
    assert rows(db_session) == []
    assert client.get(f"/api/feed/members/{asker.id}").json()["friendship"] == "none"


def test_asking_somebody_who_asked_first_is_agreeing_with_them(client, db_session, make_user):
    asker = make_user("asker")
    asked = make_user("asked")

    sign_in(client, "asker")
    client.post(f"/api/feed/friends/{asked.id}")

    sign_in(client, "asked")
    answered = client.post(f"/api/feed/friends/{asker.id}")

    assert answered.json() == {"friendship": "friends"}
    # The row they wrote, accepted, rather than a second one the other way.
    assert len(rows(db_session)) == 1
    assert rows(db_session)[0].requester_id == asker.id


def test_asking_twice_says_what_already_stands(client, db_session, make_user):
    asked = make_user("asked")
    make_user("asker")
    sign_in(client, "asker")

    assert client.post(f"/api/feed/friends/{asked.id}").json() == {"friendship": "requested"}
    again = client.post(f"/api/feed/friends/{asked.id}")

    assert again.status_code == 200
    assert again.json() == {"friendship": "requested"}
    assert len(rows(db_session)) == 1


def test_asking_an_existing_friend_says_so(client, db_session, make_user):
    friend = make_user("friend")
    befriend(db_session, friend, make_user("member"))
    sign_in(client, "member")

    assert client.post(f"/api/feed/friends/{friend.id}").json() == {"friendship": "friends"}
    assert len(rows(db_session)) == 1


def test_nobody_is_their_own_friend(client, make_user):
    member = make_user("member")
    sign_in(client, "member")

    refused = client.post(f"/api/feed/friends/{member.id}")

    assert refused.status_code == 400
    assert refused.json() == {"detail": "You cannot add yourself."}
    assert client.get(f"/api/feed/members/{member.id}").json()["friendship"] == "self"


def test_asking_a_member_who_is_not_there(client, make_user):
    make_user("member")
    sign_in(client, "member")

    refused = client.post("/api/feed/friends/9999")

    assert refused.status_code == 404
    assert refused.json() == {"detail": "There is no such member."}


def test_agreeing_to_a_request_nobody_sent(client, make_user):
    other = make_user("other")
    make_user("member")
    sign_in(client, "member")

    refused = client.post(f"/api/feed/friends/{other.id}/accept")

    assert refused.status_code == 404
    assert refused.json() == {"detail": "There is no request from this member."}


def test_the_side_that_asked_may_not_accept_its_own_request(client, make_user):
    asked = make_user("asked")
    make_user("asker")
    sign_in(client, "asker")
    client.post(f"/api/feed/friends/{asked.id}")

    refused = client.post(f"/api/feed/friends/{asked.id}/accept")

    assert refused.status_code == 404


def test_a_request_is_withdrawn_by_the_side_that_sent_it(client, db_session, make_user):
    asked = make_user("asked")
    make_user("asker")
    sign_in(client, "asker")
    client.post(f"/api/feed/friends/{asked.id}")

    assert client.delete(f"/api/feed/friends/{asked.id}").status_code == 204
    assert rows(db_session) == []


def test_a_request_is_declined_by_the_side_that_was_asked(client, db_session, make_user):
    asker = make_user("asker")
    asked = make_user("asked")
    sign_in(client, "asker")
    client.post(f"/api/feed/friends/{asked.id}")

    sign_in(client, "asked")
    assert client.delete(f"/api/feed/friends/{asker.id}").status_code == 204
    assert rows(db_session) == []


def test_removing_a_friendship_that_is_not_there(client, make_user):
    other = make_user("other")
    make_user("member")
    sign_in(client, "member")

    refused = client.delete(f"/api/feed/friends/{other.id}")

    assert refused.status_code == 404
    assert refused.json() == {"detail": "There is no friendship with this member."}


# The three lists
# ---------------


def test_the_three_lists_each_hold_their_own_side(client, db_session, make_user):
    friend = make_user("friend")
    asker = make_user("asker")
    asked = make_user("asked")
    member = make_user("member")
    befriend(db_session, friend, member)
    db_session.add(
        models.Friendship(requester_id=asker.id, addressee_id=member.id, created_at=now_utc())
    )
    db_session.add(
        models.Friendship(requester_id=member.id, addressee_id=asked.id, created_at=now_utc())
    )
    db_session.commit()

    sign_in(client, "member")
    body = client.get("/api/feed/friends").json()

    assert [row["display_name"] for row in body["friends"]] == ["friend"]
    assert [row["display_name"] for row in body["incoming"]] == ["asker"]
    assert [row["display_name"] for row in body["outgoing"]] == ["asked"]
    # The same shape the roster lists a member in.
    assert set(body["friends"][0]) == {
        "id",
        "display_name",
        "role",
        "avatar_url",
        "member_since",
        "contributions",
    }


def test_the_roster_says_which_rows_are_friends(client, db_session, make_user):
    friend = make_user("friend")
    make_user("stranger")
    member = make_user("member")
    befriend(db_session, friend, member)
    sign_in(client, "member")

    roster = client.get("/api/feed/members").json()["items"]
    listed = {row["display_name"]: row["friend"] for row in roster}

    assert listed == {"friend": True, "member": False, "stranger": False}


# What a friendship opens, and what it does not
# ---------------------------------------------


def test_a_stranger_shares_nothing_with_the_feed(client, db_session, make_user):
    stranger = make_user("stranger", timezone="UTC")
    stranger.share_journal = True
    stranger.share_weight_loss = True
    db_session.commit()
    workout = put_workout(db_session, stranger, minutes_ago=5)
    put_journal(db_session, stranger, minutes_ago=6)
    put_weigh_in(db_session, stranger, 82.0, dt.date(2026, 1, 1), minutes_ago=8)
    put_weigh_in(db_session, stranger, 81.0, dt.date(2026, 1, 2), minutes_ago=7)

    make_user("member")
    sign_in(client, "member")
    body = client.get("/api/feed").json()

    assert body["items"] == []
    assert body["friends"] == 0
    assert client.get(f"/api/workouts/{workout.id}").status_code == 404


def test_a_friends_rows_reach_the_feed(client, db_session, make_user):
    friend = make_user("friend", timezone="UTC")
    friend.share_journal = True
    db_session.commit()
    workout = put_workout(db_session, friend, minutes_ago=5)
    put_journal(db_session, friend, minutes_ago=6)
    befriend(db_session, friend, make_user("member"))

    sign_in(client, "member")
    body = client.get("/api/feed").json()

    assert [row["kind"] for row in body["items"]] == ["workout", "journal"]
    assert body["friends"] == 1
    assert client.get(f"/api/workouts/{workout.id}").status_code == 200


def test_removing_a_friend_closes_what_it_opened(client, db_session, make_user):
    friend = make_user("friend")
    workout = put_workout(db_session, friend, minutes_ago=5)
    befriend(db_session, friend, make_user("member"))
    sign_in(client, "member")
    assert len(client.get("/api/feed").json()["items"]) == 1

    assert client.delete(f"/api/feed/friends/{friend.id}").status_code == 204

    assert client.get("/api/feed").json()["items"] == []
    assert client.get(f"/api/workouts/{workout.id}").status_code == 404


def test_own_rows_are_always_there_hidden_ones_marked(client, db_session, make_user):
    member = make_user("member")
    put_workout(db_session, member, minutes_ago=5, hidden_from_feed=True)
    put_workout(db_session, member, minutes_ago=6)
    sign_in(client, "member")

    body = client.get("/api/feed").json()

    assert [row["hidden"] for row in body["items"]] == [True, False]
    assert body["friends"] == 0


def test_arriving_is_said_to_everybody(client, db_session, make_user):
    joiner = make_user("joiner")
    joiner.first_run_at = now_utc()
    db_session.commit()
    make_user("member")
    sign_in(client, "member")

    rows_seen = client.get("/api/feed").json()["items"]

    assert [row["kind"] for row in rows_seen] == ["joined"]
    assert rows_seen[0]["display_name"] == "joiner"


def test_the_three_opt_in_facts_are_for_friends_alone(client, db_session, make_user):
    sharer = make_user("sharer")
    sharer.location = "Mesa, AZ"
    sharer.share_age = True
    sharer.share_sex = True
    sharer.share_location = True
    db_session.add(models.HealthProfile(user_id=sharer.id, sex="male"))
    db_session.commit()
    member = make_user("member")

    sign_in(client, "member")
    shown = client.get(f"/api/feed/members/{sharer.id}").json()
    assert shown["friendship"] == "none"
    assert "age" not in shown and "sex" not in shown and "location" not in shown
    # A name and what they gave the database are not private facts.
    assert shown["display_name"] == "sharer"
    assert "contributions" in shown

    befriend(db_session, sharer, member)
    shown = client.get(f"/api/feed/members/{sharer.id}").json()
    assert shown["friendship"] == "friends"
    assert shown["sex"] == "male"
    assert shown["location"] == "Mesa, AZ"
    assert "age" in shown


def test_an_account_reads_its_own_facts_without_a_friendship(client, db_session, make_user):
    member = make_user("member")
    member.share_age = True
    db_session.commit()
    sign_in(client, "member")

    shown = client.get(f"/api/feed/members/{member.id}").json()

    assert shown["friendship"] == "self"
    assert "age" in shown


def test_nobody_signed_out_reads_or_writes_a_friendship(client, make_user):
    other = make_user("other")

    assert client.get("/api/feed/friends").status_code == 401
    assert client.post(f"/api/feed/friends/{other.id}").status_code == 401
    assert client.delete(f"/api/feed/friends/{other.id}").status_code == 401


def test_a_listed_friend_carries_nothing_their_account_holds(client, db_session, make_user):
    friend = make_user("friend", email="friend@example.com")
    befriend(db_session, friend, make_user("member"))
    sign_in(client, "member")

    row = client.get("/api/feed/friends").json()["friends"][0]

    assert "email" not in row and "username" not in row
