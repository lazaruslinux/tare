import datetime as dt

from sqlalchemy import select

from app import models
from app.models import now_utc
from tests.test_ingest import export, post, run, token_for, yesterday


def signed_in_with_export(client, db_session, make_user, day=None):
    """An account with the client holding its cookie and one export landed."""
    user = make_user("member")
    assert (
        client.post(
            "/api/auth/login", json={"username": "member", "password": "correct-horse-9"}
        ).status_code
        == 200
    )
    token = token_for(db_session, user)
    post(client, token, export(day or yesterday()))
    return user


def test_the_summary_carries_the_four_tiles_and_the_week(client, db_session, make_user):
    day = yesterday()
    signed_in_with_export(client, db_session, make_user, day)

    body = client.get(f"/api/fitness/summary?date={day.isoformat()}").json()

    assert body["connected"] is True
    assert body["last_sync"] is not None
    assert body["today"] == {
        "steps": 8500,
        "active_kcal": 430,
        "exercise_minutes": 42,
        "resting_hr": 58,
    }
    assert len(body["week"]) == 7
    assert body["week"][-1]["steps"] == 8500
    assert body["goals"] == {"exercise_minutes": 30, "steps": 8000}
    assert [row["activity"] for row in body["workouts"]] == ["Outdoor Run"]


def test_a_day_nothing_arrived_for_reads_as_nothing(client, db_session, make_user):
    signed_in_with_export(client, db_session, make_user)

    body = client.get("/api/fitness/summary?date=2020-01-01").json()

    assert body["today"] == {
        "steps": None,
        "active_kcal": None,
        "exercise_minutes": None,
        "resting_hr": None,
    }
    assert body["workouts"] == []


def test_a_tiles_history_has_a_row_for_every_day(client, db_session, make_user):
    day = yesterday()
    signed_in_with_export(client, db_session, make_user, day)

    body = client.get(f"/api/fitness/daily?metric=steps&days=5&date={day}").json()

    assert body["metric"] == "steps"
    assert body["unit"] == "count"
    assert len(body["days"]) == 5
    assert body["days"][-1] == {"date": day.isoformat(), "value": 8500}
    assert body["days"][0]["value"] is None


def test_a_metric_tare_does_not_keep_is_refused(client, db_session, make_user):
    signed_in_with_export(client, db_session, make_user)

    response = client.get("/api/fitness/daily?metric=vo2_max")

    assert response.status_code == 400
    assert response.json() == {"detail": "That is not something Tare keeps."}


def test_a_day_by_the_hour_is_twenty_four_slots(client, db_session, make_user):
    day = yesterday()
    signed_in_with_export(client, db_session, make_user, day)

    body = client.get(f"/api/fitness/intraday?metric=steps&date={day}").json()

    assert len(body["hours"]) == 24
    assert body["hours"][8] == 4000
    assert body["hours"][18] == 4500
    assert body["hours"][0] is None


def test_the_workouts_list_answers_newest_first(client, db_session, make_user):
    day = yesterday()
    user = signed_in_with_export(client, db_session, make_user, day)
    token = db_session.scalar(select(models.IngestToken))
    assert token.user_id == user.id

    body = client.get("/api/fitness/workouts").json()

    assert len(body["workouts"]) == 1
    assert body["cursor"] is None
    assert body["workouts"][0]["source"] == "apple"


def test_one_workout_carries_its_minutes_and_its_line(client, db_session, make_user):
    day = yesterday()
    signed_in_with_export(client, db_session, make_user, day)
    workout = db_session.scalar(select(models.Workout))

    body = client.get(f"/api/workouts/{workout.id}").json()

    assert body["activity"] == "Outdoor Run"
    assert len(body["samples"]) == 6
    assert body["samples"][0]["hr_avg"] == 142
    assert len(body["route"]) >= 10


def test_a_workout_kept_out_of_the_feed_answers_what_a_missing_one_answers(
    client, db_session, make_user
):
    stranger = make_user("stranger")
    day = yesterday()
    token = token_for(db_session, stranger)
    post(client, token, {"data": {"workouts": [run(day)]}})
    workout = db_session.scalar(select(models.Workout))
    workout.hidden_from_feed = True
    db_session.commit()

    make_user("member")
    client.post("/api/auth/login", json={"username": "member", "password": "correct-horse-9"})

    hidden = client.get(f"/api/workouts/{workout.id}")
    theirs = client.get("/api/workouts/99999")

    assert hidden.status_code == theirs.status_code == 404
    assert hidden.json() == theirs.json() == {"detail": "There is no such workout."}


def test_a_shared_workout_reads_for_another_member_without_what_was_held_back(
    client, db_session, make_user
):
    stranger = make_user("stranger")
    stranger.feed_hidden = ["avg_hr", "kcal"]
    db_session.commit()
    token = token_for(db_session, stranger)
    post(client, token, {"data": {"workouts": [run(yesterday())]}})
    workout = db_session.scalar(select(models.Workout))

    make_user("member")
    client.post("/api/auth/login", json={"username": "member", "password": "correct-horse-9"})

    body = client.get(f"/api/workouts/{workout.id}").json()

    assert body["mine"] is False
    assert body["display_name"] == "stranger"
    assert "avg_hr" not in body and "max_hr" not in body and "kcal" not in body
    assert "flags" not in body
    assert body["route"] is not None
    assert "hr_avg" not in body["samples"][0] and "kcal" not in body["samples"][0]


def test_the_fitness_screen_needs_an_account(client):
    assert client.get("/api/fitness/summary").status_code == 401


# The sync key
# ------------


def test_a_key_is_shown_once_and_then_only_described(client, signed_in):
    minted = client.post("/api/account/ingest-token")

    assert minted.status_code == 200
    body = minted.json()
    assert len(body["token"]) > 30
    assert body["connected"] is True
    assert body["path"] == "/api/ingest/health"
    assert body["last_used_at"] is None

    described = client.get("/api/account/ingest-token").json()
    assert "token" not in described
    assert described["connected"] is True


def test_a_new_key_stops_the_old_one_working(client, db_session, signed_in):
    first = client.post("/api/account/ingest-token").json()["token"]
    second = client.post("/api/account/ingest-token").json()["token"]

    assert post(client, first, {"data": {}}).status_code == 401
    assert post(client, second, {"data": {}}).status_code == 200
    assert len(list(db_session.execute(select(models.IngestToken)).scalars())) == 1


def test_a_revoked_key_opens_nothing(client, signed_in):
    token = client.post("/api/account/ingest-token").json()["token"]

    assert client.delete("/api/account/ingest-token").status_code == 204
    assert post(client, token, {"data": {}}).status_code == 401
    assert client.get("/api/account/ingest-token").json()["connected"] is False


def test_making_keys_over_and_over_is_refused(client, signed_in):
    for _ in range(5):
        assert client.post("/api/account/ingest-token").status_code == 200

    refused = client.post("/api/account/ingest-token")
    assert refused.status_code == 429
    assert refused.json()["detail"].endswith(".")


# The seam into the diary
# -----------------------


def log_walk(client, day, minutes):
    return client.post(
        "/api/health/exercise",
        json={
            "activity": "walking",
            "effort": "moderate",
            "minutes": minutes,
            "date_for": day.isoformat(),
        },
    )


def test_a_day_carries_its_steps_once_a_phone_has_sent_them(client, db_session, make_user):
    day = yesterday()
    signed_in_with_export(client, db_session, make_user, day)

    with_steps = client.get(f"/api/diary/day?date={day.isoformat()}").json()
    without = client.get("/api/diary/day?date=2020-01-01").json()

    assert with_steps["steps"] == 8500
    assert without["steps"] is None
    run_of_days = client.get("/api/diary/days?days=3").json()["days"]
    assert any(row["steps"] == 8500 for row in run_of_days)


def test_an_imported_session_shows_in_the_days_exercise(client, db_session, make_user):
    day = yesterday()
    signed_in_with_export(client, db_session, make_user, day)

    body = client.get(f"/api/diary/day?date={day.isoformat()}").json()

    imported = [row for row in body["exercise"] if row["source"] == "apple"]
    assert len(imported) == 1
    # Nothing to delete: what arrived from a phone is corrected on the phone.
    assert imported[0]["id"] is None
    assert imported[0]["workout_id"] is not None
    assert imported[0]["name"] == "Outdoor Run"
    assert body["exercise_kcal"] == 430
    assert body["exercise_minutes"] == 42


def test_a_day_counts_its_exercise_once(client, db_session, make_user):
    day = yesterday()
    signed_in_with_export(client, db_session, make_user, day)
    assert log_walk(client, day, 30).status_code == 201

    body = client.get(f"/api/diary/day?date={day.isoformat()}").json()

    # Both are shown, and the day's credit is the larger of the two rather than
    # the sum: the imported run is 431 calories and the walk is far less.
    assert len(body["exercise"]) == 2
    assert body["exercise_kcal"] == 430
    targets = client.get("/api/health/targets").json()
    assert targets["exercise_today"] in (0, 430)


def test_a_manual_entry_the_phone_never_saw_still_counts(client, db_session, make_user):
    day = yesterday()
    signed_in_with_export(client, db_session, make_user, day)
    db_session.execute(
        models.Workout.__table__.update().values(kcal=5.0, duration_s=60)
    )
    db_session.commit()
    log_walk(client, day, 90)

    body = client.get(f"/api/diary/day?date={day.isoformat()}").json()

    assert body["exercise_kcal"] > 5
    assert body["exercise_minutes"] == 90


def test_a_workout_belongs_to_the_account_it_arrived_for(client, db_session, make_user):
    stranger = make_user("stranger")
    token = token_for(db_session, stranger)
    post(client, token, {"data": {"workouts": [run(yesterday())]}})

    make_user("member")
    client.post("/api/auth/login", json={"username": "member", "password": "correct-horse-9"})

    assert client.get("/api/fitness/workouts").json()["workouts"] == []
    assert client.get("/api/fitness/summary").json()["connected"] is False


def test_a_key_that_has_never_synced_says_so(client, db_session, signed_in):
    db_session.add(
        models.IngestToken(
            user_id=signed_in.id, token_hash="a" * 64, created_at=now_utc()
        )
    )
    db_session.commit()

    body = client.get(f"/api/fitness/summary?date={dt.date.today()}").json()

    assert body["connected"] is True
    assert body["last_sync"] is None
