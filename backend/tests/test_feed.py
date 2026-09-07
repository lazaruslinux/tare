"""The community feed, and what one member is allowed to learn about another.

Three rules are worth more than the rest here: nothing about a body reaches
anybody who is not a friend, a workout somebody hid is gone for everybody but
its owner, and a number somebody held back is absent from the answer rather
than sent as null.
"""

import datetime as dt
import json

from sqlalchemy import select

from app import models
from app.health import age_on
from app.models import now_utc
from tests.conftest import PASSWORD
from tests.test_ingest import export, pick, post, token_for, yesterday


def sign_in(client, username):
    response = client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200


def befriend(db_session, one, other):
    """Two accounts who have already agreed, without the two calls it takes."""
    db_session.add(
        models.Friendship(requester_id=one.id, addressee_id=other.id, accepted_at=now_utc())
    )
    db_session.commit()


def synced(client, db_session, user, day=None):
    """One export landed for an account, and the workout it wrote."""
    token = token_for(db_session, user)
    post(client, token, export(day or yesterday()))
    return db_session.scalar(
        select(models.Workout).where(models.Workout.user_id == user.id)
    )


def put_workout(db_session, user, minutes_ago, **fields):
    """A session straight into the database, for the cases that need a run of
    them rather than one that came through the door."""
    started = now_utc() - dt.timedelta(minutes=minutes_ago)
    workout = models.Workout(
        user_id=user.id,
        activity="Outdoor Walk",
        started_at=started,
        date_for=started.date(),
        duration_s=1800,
        distance_m=2000.0,
        indoor=False,
        source="apple",
        flags={},
        created_at=now_utc(),
        **fields,
    )
    db_session.add(workout)
    db_session.commit()
    return workout


# What the feed carries
# ---------------------


def test_a_shared_workout_reaches_the_other_member(client, db_session, make_user):
    runner = make_user("runner")
    synced(client, db_session, runner)
    befriend(db_session, runner, make_user("member"))
    sign_in(client, "member")

    body = client.get("/api/feed").json()

    assert [row["activity"] for row in body["items"]] == ["Outdoor Run"]
    row = body["items"][0]
    assert row["display_name"] == "runner"
    assert row["mine"] is False
    assert "hidden" not in row
    assert row["has_route"] is True
    assert body["next_cursor"] is None


def test_a_feed_row_never_carries_the_line_itself(client, db_session, make_user):
    runner = make_user("runner")
    synced(client, db_session, runner)
    befriend(db_session, runner, make_user("member"))
    sign_in(client, "member")

    row = client.get("/api/feed").json()["items"][0]

    assert "route" not in row
    assert "kcal" not in row and "avg_hr" not in row and "flags" not in row


def test_a_hidden_workout_is_the_owners_alone(client, db_session, make_user):
    runner = make_user("runner")
    workout = synced(client, db_session, runner)
    workout.hidden_from_feed = True
    befriend(db_session, runner, make_user("member"))

    sign_in(client, "member")
    assert client.get("/api/feed").json()["items"] == []

    sign_in(client, "runner")
    mine = client.get("/api/feed").json()["items"]
    assert len(mine) == 1
    assert mine[0]["mine"] is True and mine[0]["hidden"] is True


def test_a_workout_out_of_a_file_starts_hidden(client, db_session, make_user):
    uploader = make_user("uploader")
    sign_in(client, "uploader")
    raw = json.dumps(export(yesterday())).encode()
    assert pick(client, raw).status_code == 200

    mine = client.get("/api/feed").json()["items"]
    assert len(mine) == 1
    assert mine[0]["hidden"] is True

    befriend(db_session, uploader, make_user("member"))
    sign_in(client, "member")
    assert client.get("/api/feed").json()["items"] == []


def test_the_owner_alone_may_hide_a_workout(client, db_session, make_user):
    runner = make_user("runner")
    workout = synced(client, db_session, runner)

    befriend(db_session, runner, make_user("member"))
    sign_in(client, "member")
    refused = client.patch(f"/api/workouts/{workout.id}", json={"hidden_from_feed": True})
    assert refused.status_code == 404
    assert refused.json() == {"detail": "There is no such workout."}

    sign_in(client, "runner")
    answered = client.patch(f"/api/workouts/{workout.id}", json={"hidden_from_feed": True})
    assert answered.status_code == 200
    assert answered.json()["hidden_from_feed"] is True

    sign_in(client, "member")
    assert client.get("/api/feed").json()["items"] == []

    sign_in(client, "runner")
    client.patch(f"/api/workouts/{workout.id}", json={"hidden_from_feed": False})
    sign_in(client, "member")
    assert len(client.get("/api/feed").json()["items"]) == 1


def test_a_member_who_shares_no_workouts_is_absent_from_the_feed(
    client, db_session, make_user
):
    runner = make_user("runner")
    befriend(db_session, runner, make_user("reader"))
    workout = put_workout(db_session, runner, 30)
    runner.share_workouts = False
    db_session.commit()

    sign_in(client, "reader")
    assert client.get("/api/feed").json()["items"] == []
    detail = client.get(f"/api/workouts/{workout.id}")
    assert detail.status_code == 404
    assert detail.json() == {"detail": "There is no such workout."}

    # The owner still finds it in their own feed, marked as theirs alone.
    sign_in(client, "runner")
    rows = client.get("/api/feed").json()["items"]
    assert [row["hidden"] for row in rows] == [True]
    assert client.get(f"/api/workouts/{workout.id}").status_code == 200


def test_the_feed_pages_without_repeating_itself(client, db_session, make_user):
    runner = make_user("runner")
    for step in range(35):
        put_workout(db_session, runner, minutes_ago=step)
    befriend(db_session, runner, make_user("member"))
    sign_in(client, "member")

    first = client.get("/api/feed").json()
    assert len(first["items"]) == 30
    assert first["next_cursor"] is not None

    second = client.get(f"/api/feed?cursor={first['next_cursor']}").json()
    assert len(second["items"]) == 5
    assert second["next_cursor"] is None

    seen = [row["id"] for row in first["items"] + second["items"]]
    assert len(set(seen)) == 35


def test_a_page_marker_nobody_minted_is_refused(client, make_user):
    make_user("member")
    sign_in(client, "member")

    refused = client.get("/api/feed?cursor=not-one-of-ours")

    assert refused.status_code == 400
    assert refused.json() == {"detail": "That page marker is not one of ours."}


# What is held back on a shared workout
# -------------------------------------


def test_a_held_back_heart_rate_is_absent_rather_than_empty(client, db_session, make_user):
    runner = make_user("runner")
    runner.feed_hidden = ["avg_hr"]
    db_session.commit()
    workout = synced(client, db_session, runner)

    befriend(db_session, runner, make_user("member"))
    sign_in(client, "member")
    body = client.get(f"/api/workouts/{workout.id}").json()

    assert "avg_hr" not in body and "max_hr" not in body
    assert "hr_avg" not in body["samples"][0]
    assert body["kcal"] is not None


def test_held_back_calories_leave_the_workout_and_its_minutes(
    client, db_session, make_user
):
    runner = make_user("runner")
    runner.feed_hidden = ["kcal"]
    db_session.commit()
    workout = synced(client, db_session, runner)

    befriend(db_session, runner, make_user("member"))
    sign_in(client, "member")
    body = client.get(f"/api/workouts/{workout.id}").json()

    assert "kcal" not in body
    assert all("kcal" not in sample for sample in body["samples"])
    assert body["avg_hr"] is not None


def test_a_held_back_route_takes_the_climb_with_it(client, db_session, make_user):
    runner = make_user("runner")
    runner.feed_hidden = ["route"]
    db_session.commit()
    workout = synced(client, db_session, runner)

    befriend(db_session, runner, make_user("member"))
    sign_in(client, "member")
    body = client.get(f"/api/workouts/{workout.id}").json()
    row = client.get("/api/feed").json()["items"][0]

    assert "route" not in body
    assert "elevation_gain_m" not in body
    assert row["has_route"] is False


def test_the_owner_still_reads_everything_they_held_back(client, db_session, make_user):
    runner = make_user("runner")
    runner.feed_hidden = ["avg_hr", "kcal", "route"]
    db_session.commit()
    workout = synced(client, db_session, runner)

    sign_in(client, "runner")
    body = client.get(f"/api/workouts/{workout.id}").json()

    assert body["mine"] is True
    assert body["avg_hr"] is not None and body["kcal"] is not None
    assert body["route"] is not None
    assert body["flags"] == []


def test_a_name_tare_cannot_hide_is_refused(client, make_user):
    make_user("member")
    sign_in(client, "member")

    refused = client.patch("/api/account", json={"feed_hidden": ["route", "weight"]})

    assert refused.status_code == 400
    assert refused.json() == {"detail": "That is not something Tare can hide."}


def test_what_is_hidden_is_said_back_with_the_account(client, make_user):
    make_user("member")
    sign_in(client, "member")

    saved = client.patch(
        "/api/account",
        json={"feed_hidden": ["kcal"], "share_age": True, "share_location": True},
    ).json()

    assert saved["feed_hidden"] == ["kcal"]
    assert saved["share_age"] is True
    assert saved["share_sex"] is False
    assert saved["share_location"] is True
    assert saved["share_workouts"] is True
    # Off until it is asked for, and saved beside the rest when it is.
    assert saved["share_journal"] is False
    assert client.get("/api/auth/me").json() == saved
    assert client.patch("/api/account", json={"share_journal": True}).json()[
        "share_journal"
    ] is True


# What one member may learn about another
# --------------------------------------


def test_a_member_shows_nothing_until_they_say_so(client, db_session, make_user):
    runner = make_user("runner", email="runner@example.com")
    make_user("member")
    sign_in(client, "member")

    body = client.get(f"/api/feed/members/{runner.id}").json()

    assert body["display_name"] == "runner"
    assert body["member_since"] == runner.created_at.strftime("%Y-%m")
    assert "age" not in body and "sex" not in body and "location" not in body
    assert "birthdate" not in body and "email" not in body and "username" not in body


def test_each_switch_shows_its_own_fact(client, db_session, make_user):
    runner = make_user("runner")
    runner.location = "Mesa, AZ"
    runner.share_age = True
    runner.share_sex = True
    runner.share_location = True
    db_session.add(models.HealthProfile(user_id=runner.id, sex="male"))
    db_session.commit()
    befriend(db_session, runner, make_user("member"))

    sign_in(client, "member")
    body = client.get(f"/api/feed/members/{runner.id}").json()

    assert body["age"] == age_on(runner.birthdate, dt.date.today())
    assert body["sex"] == "male"
    assert body["location"] == "Mesa, AZ"


def test_a_shared_sex_nobody_recorded_stays_absent(client, db_session, make_user):
    runner = make_user("runner")
    runner.share_sex = True
    db_session.commit()
    befriend(db_session, runner, make_user("member"))

    sign_in(client, "member")

    assert "sex" not in client.get(f"/api/feed/members/{runner.id}").json()


def test_a_member_who_is_not_there(client, make_user):
    make_user("member")
    sign_in(client, "member")

    refused = client.get("/api/feed/members/9999")

    assert refused.status_code == 404
    assert refused.json() == {"detail": "There is no such member."}


# Finished days
# -------------


def put_journal(db_session, user, minutes_ago, day=None):
    """A day marked complete, straight into the database, at a known moment."""
    at = now_utc() - dt.timedelta(minutes=minutes_ago)
    row = models.JournalDay(
        user_id=user.id, date=day or at.date(), completed_at=at
    )
    db_session.add(row)
    db_session.commit()
    return row


def profile_for(db_session, user, sex):
    db_session.add(models.HealthProfile(user_id=user.id, sex=sex))
    db_session.commit()


def test_a_finished_day_reaches_the_others_only_once_it_is_shared(
    client, db_session, make_user
):
    keeper = make_user("keeper")
    put_journal(db_session, keeper, minutes_ago=5)
    befriend(db_session, keeper, make_user("member"))
    sign_in(client, "member")

    assert client.get("/api/feed").json()["items"] == []

    keeper.share_journal = True
    db_session.commit()

    rows = client.get("/api/feed").json()["items"]
    assert [row["kind"] for row in rows] == ["journal"]
    assert rows[0]["display_name"] == "keeper"
    # Nothing about the day but that it was finished.
    assert set(rows[0]) == {
        "kind",
        "id",
        "user_id",
        "display_name",
        "role",
        "mine",
        "date",
        "at",
        "pronoun",
    }


def test_an_unshared_finished_day_is_the_owners_alone_and_says_so(
    client, db_session, make_user
):
    keeper = make_user("keeper")
    put_journal(db_session, keeper, minutes_ago=5)
    sign_in(client, "keeper")

    rows = client.get("/api/feed").json()["items"]
    assert [row["hidden"] for row in rows] == [True]

    keeper.share_journal = True
    db_session.commit()
    assert client.get("/api/feed").json()["items"][0]["hidden"] is False


def test_unlocking_a_day_takes_its_row_out_of_the_feed(client, db_session, make_user):
    keeper = make_user("keeper", timezone="UTC")
    keeper.share_journal = True
    db_session.commit()
    sign_in(client, "keeper")
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    assert client.put("/api/diary/complete", json={"date": today}).status_code == 200
    assert len(client.get("/api/feed").json()["items"]) == 1

    assert client.delete(f"/api/diary/complete/{today}").status_code == 204
    assert client.get("/api/feed").json()["items"] == []


def test_the_pronoun_follows_what_the_member_shared(client, db_session, make_user):
    """Three accounts, three answers, and the field itself never leaves."""
    for name, sex, shared in (("hers", "female", True), ("his", "male", True), ("theirs", "male", False)):
        member = make_user(name)
        member.share_journal = True
        member.share_sex = shared
        db_session.commit()
        profile_for(db_session, member, sex)
        put_journal(db_session, member, minutes_ago=5, day=dt.date(2026, 1, 1))

    reader = make_user("reader")
    for member in db_session.scalars(select(models.User)).all():
        if member.id != reader.id:
            befriend(db_session, member, reader)
    sign_in(client, "reader")
    rows = client.get("/api/feed").json()["items"]
    said = {row["display_name"]: row["pronoun"] for row in rows}
    assert said == {"hers": "her", "his": "his", "theirs": "their"}
    assert all("sex" not in row for row in rows)


# Weigh-ins
# ---------

# Two days close enough to now that a member may still write to either.
LATER = dt.date(2026, 1, 2)
EARLIER = dt.date(2026, 1, 1)


def put_weigh_in(db_session, user, kg, day, minutes_ago=0):
    """A weigh-in straight into the database, at a known moment. What the feed
    pages by is when a reading arrived, so that is set here rather than left to
    the order the rows happen to be written in."""
    row = models.WeightEntry(
        user_id=user.id,
        date_for=day,
        weight_kg=kg,
        source="manual",
        created_at=now_utc() - dt.timedelta(minutes=minutes_ago),
    )
    db_session.add(row)
    db_session.commit()
    return row


def losing(db_session, make_user, name="loser"):
    """An account whose last weigh-in came in a kilogram under the one before."""
    member = make_user(name, timezone="UTC")
    put_weigh_in(db_session, member, 82.0, EARLIER, minutes_ago=10)
    put_weigh_in(db_session, member, 81.0, LATER, minutes_ago=5)
    return member


def test_a_loss_reaches_the_others_only_once_it_is_shared(client, db_session, make_user):
    loser = losing(db_session, make_user)
    befriend(db_session, loser, make_user("member"))
    sign_in(client, "member")

    assert client.get("/api/feed").json()["items"] == []

    loser.share_weight_loss = True
    db_session.commit()

    rows = client.get("/api/feed").json()["items"]
    assert [row["kind"] for row in rows] == ["weight"]
    assert rows[0]["display_name"] == "loser"
    assert rows[0]["lost_kg"] == 1.0
    assert rows[0]["date"] == LATER.isoformat()
    # How much came off, and neither of the two weights it was worked out from.
    assert set(rows[0]) == {
        "kind",
        "id",
        "user_id",
        "display_name",
        "role",
        "mine",
        "date",
        "at",
        "lost_kg",
        "pronoun",
    }


def test_a_day_with_no_weight_is_not_a_reading_the_window_reads(client, db_session, make_user):
    """A body fat logged between two weigh-ins is neither a row of its own nor
    the reading the weigh-in after it is compared against."""
    member = make_user("halved", timezone="UTC")
    member.share_weight_loss = True
    db_session.commit()
    put_weigh_in(db_session, member, 82.0, dt.date(2026, 1, 10), minutes_ago=10)
    db_session.add(
        models.WeightEntry(
            user_id=member.id,
            date_for=dt.date(2026, 1, 11),
            body_fat_pct=24.0,
            source="manual",
            created_at=now_utc() - dt.timedelta(minutes=7),
        )
    )
    db_session.commit()
    put_weigh_in(db_session, member, 81.0, dt.date(2026, 1, 12), minutes_ago=5)

    befriend(db_session, member, make_user("reader"))
    sign_in(client, "reader")
    rows = client.get("/api/feed").json()["items"]
    assert [row["kind"] for row in rows] == ["weight"]
    assert rows[0]["lost_kg"] == 1.0


def test_a_gain_is_never_a_row(client, db_session, make_user):
    gainer = make_user("gainer", timezone="UTC")
    gainer.share_weight_loss = True
    db_session.commit()
    put_weigh_in(db_session, gainer, 80.0, EARLIER, minutes_ago=10)
    put_weigh_in(db_session, gainer, 81.0, LATER, minutes_ago=5)

    befriend(db_session, gainer, make_user("member"))
    sign_in(client, "member")
    assert client.get("/api/feed").json()["items"] == []


def test_a_loss_too_small_to_read_is_never_a_row(client, db_session, make_user):
    """Under the floor a sentence would say 0.0, which is not worth saying."""
    steady = make_user("steady", timezone="UTC")
    steady.share_weight_loss = True
    db_session.commit()
    put_weigh_in(db_session, steady, 80.0, EARLIER, minutes_ago=10)
    put_weigh_in(db_session, steady, 79.98, LATER, minutes_ago=5)

    befriend(db_session, steady, make_user("member"))
    sign_in(client, "member")
    assert client.get("/api/feed").json()["items"] == []


def test_an_unshared_loss_is_the_owners_alone_and_says_so(client, db_session, make_user):
    loser = losing(db_session, make_user)
    sign_in(client, "loser")

    rows = client.get("/api/feed").json()["items"]
    assert [row["hidden"] for row in rows] == [True]

    loser.share_weight_loss = True
    db_session.commit()
    assert client.get("/api/feed").json()["items"][0]["hidden"] is False


def test_replacing_a_days_weigh_in_moves_the_loss_and_not_the_moment(
    client, db_session, make_user
):
    losing(db_session, make_user)
    sign_in(client, "loser")
    was = client.get("/api/feed").json()["items"][0]

    written = client.put(
        f"/api/health/measurements/{LATER.isoformat()}", json={"weight_kg": 80.0}
    )
    assert written.status_code == 200

    now = client.get("/api/feed").json()["items"][0]
    assert now["lost_kg"] == 2.0
    # The row is the same reading corrected, so it keeps its place in the list.
    assert now["at"] == was["at"]
    assert now["id"] == was["id"]


def test_deleting_the_newer_weigh_in_takes_the_row_out(client, db_session, make_user):
    losing(db_session, make_user)
    sign_in(client, "loser")
    assert len(client.get("/api/feed").json()["items"]) == 1

    gone = client.delete(f"/api/health/measurements/{LATER.isoformat()}")
    assert gone.status_code == 204
    assert client.get("/api/feed").json()["items"] == []


def test_a_page_of_every_kind_reads_through_without_repeating_itself(
    client, db_session, make_user
):
    runner = make_user("runner", timezone="UTC")
    runner.share_journal = True
    runner.share_weight_loss = True
    db_session.commit()
    start = dt.date(2026, 1, 1)
    # One weigh-in more than the rows they make: the first has nothing before
    # it to have come down from.
    put_weigh_in(db_session, runner, 90.0, start, minutes_ago=100)
    for step in range(14):
        put_workout(db_session, runner, minutes_ago=step * 3)
        put_journal(db_session, runner, minutes_ago=step * 3 + 1, day=start + dt.timedelta(days=step))
        put_weigh_in(
            db_session,
            runner,
            89.5 - step * 0.5,
            start + dt.timedelta(days=step + 1),
            minutes_ago=step * 3 + 2,
        )
    befriend(db_session, runner, make_user("member"))
    sign_in(client, "member")

    first = client.get("/api/feed").json()
    assert len(first["items"]) == 30
    assert first["next_cursor"] is not None
    second = client.get(f"/api/feed?cursor={first['next_cursor']}").json()
    assert second["next_cursor"] is None

    seen = [f"{row['kind']}{row['id']}" for row in first["items"] + second["items"]]
    assert len(seen) == 42
    assert len(set(seen)) == 42
    # Newest first, whichever table a row came out of.
    times = [row.get("started_at") or row["at"] for row in first["items"] + second["items"]]
    assert times == sorted(times, reverse=True)


# Somebody arriving
# -----------------


def test_a_member_who_has_been_through_the_way_in_says_so(client, db_session, make_user):
    joiner = make_user("joiner")
    joiner.first_run_at = now_utc()
    # Nothing here is shared, and the row is there all the same: it says only
    # that they joined.
    joiner.share_workouts = False
    joiner.share_journal = False
    joiner.share_weight_loss = False
    db_session.commit()
    make_user("member")
    sign_in(client, "member")

    rows = client.get("/api/feed").json()["items"]

    assert [row["kind"] for row in rows] == ["joined"]
    assert rows[0]["display_name"] == "joiner"
    assert rows[0]["id"] == joiner.id
    # Nothing to hide, so nothing that says whether it is hidden.
    assert set(rows[0]) == {
        "kind",
        "id",
        "user_id",
        "display_name",
        "role",
        "mine",
        "date",
        "at",
    }


def test_arriving_is_dated_by_the_account_and_not_by_the_walkthrough(
    client, db_session, make_user
):
    # Every account from before the way in existed was given its first-run
    # stamp at one minute; the row must not say they all arrived then.
    early = make_user("early")
    early.created_at = now_utc() - dt.timedelta(days=3)
    early.first_run_at = now_utc()
    db_session.commit()
    make_user("member")
    sign_in(client, "member")

    rows = client.get("/api/feed").json()["items"]

    assert [row["kind"] for row in rows] == ["joined"]
    assert rows[0]["date"] == (now_utc() - dt.timedelta(days=3)).date().isoformat()


def test_an_account_from_before_the_way_in_existed_gets_no_row(client, make_user):
    make_user("older")
    make_user("member")
    sign_in(client, "member")

    assert client.get("/api/feed").json()["items"] == []


def test_arriving_takes_its_place_in_time_beside_the_rest(client, db_session, make_user):
    runner = make_user("runner")
    runner.created_at = now_utc() - dt.timedelta(minutes=10)
    runner.first_run_at = now_utc()
    db_session.commit()
    put_workout(db_session, runner, minutes_ago=1)
    befriend(db_session, runner, make_user("member"))
    sign_in(client, "member")

    rows = client.get("/api/feed").json()["items"]

    assert [row["kind"] for row in rows] == ["workout", "joined"]


def test_a_page_of_arrivals_reads_through_without_repeating_itself(
    client, db_session, make_user
):
    start = now_utc()
    for step in range(35):
        joiner = make_user(f"joiner{step}")
        joiner.created_at = start - dt.timedelta(minutes=step)
        joiner.first_run_at = start
    db_session.commit()
    make_user("member")
    sign_in(client, "member")

    first = client.get("/api/feed").json()
    assert len(first["items"]) == 30
    assert first["next_cursor"] is not None

    second = client.get(f"/api/feed?cursor={first['next_cursor']}").json()
    assert len(second["items"]) == 5
    assert second["next_cursor"] is None

    seen = [row["id"] for row in first["items"] + second["items"]]
    assert len(set(seen)) == 35


# The strip beside the screen
# ---------------------------


def test_the_strip_carries_the_days_figures(client, db_session, make_user):
    member = make_user("member")
    sign_in(client, "member")
    today = dt.date.today()
    db_session.add(
        models.WeightEntry(
            user_id=member.id, date_for=today, weight_kg=80.0, source="manual"
        )
    )
    db_session.commit()

    body = client.get("/api/feed/today").json()

    assert isinstance(body["calories_eaten"], int)
    assert body["steps"] is None
    assert body["exercise_min"] == 0
    assert "calories_left" not in body
    assert body["latest_weight_kg"] == 80.0
    assert body["latest_weight_date"] == today.isoformat()
    assert "waiting" not in body


def test_only_an_administrator_is_told_what_is_waiting(client, admin_client):
    body = client.get("/api/feed/today").json()

    assert body["waiting"] == 0
