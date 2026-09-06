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
    # The same seven days, counted as sessions. The export lands one.
    assert body["week_workouts"] == 1


def test_the_week_count_holds_a_workout_kept_out_of_the_feed(
    client, db_session, make_user
):
    day = yesterday()
    user = signed_in_with_export(client, db_session, make_user, day)
    session = db_session.scalar(
        select(models.Workout).where(models.Workout.user_id == user.id)
    )
    session.hidden_from_feed = True
    db_session.commit()

    body = client.get(f"/api/fitness/summary?date={day.isoformat()}").json()

    # It is still one the member did, whoever else can see it.
    assert body["week_workouts"] == 1
    # A window it does not fall in counts none of it.
    assert client.get("/api/fitness/summary?date=2020-01-01").json()["week_workouts"] == 0


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


# Trends
# ------

# One fixed day to measure the two windows from, so a test never depends on
# what today happens to be. The week just gone is the 9th to the 15th, and the
# four weeks before it are the 9th of February to the 8th of March.
ANCHOR = dt.date(2026, 3, 15)


def write_day(db_session, user, day, metric, value):
    db_session.add(
        models.FitnessDaily(
            user_id=user.id, date_for=day, metric=metric, value=value, unit=""
        )
    )
    db_session.commit()


def write_hour(db_session, user, day, hour, metres):
    db_session.add(
        models.FitnessIntraday(
            user_id=user.id,
            date_for=day,
            metric="distance",
            hour=hour,
            value=metres,
            unit="m",
        )
    )
    db_session.commit()


def trends(client):
    body = client.get(f"/api/fitness/trends?date={ANCHOR}").json()
    return {row["key"]: row for row in body["rows"]}


def test_trends_answer_four_rows_averaged_over_the_days_that_have_data(
    client, db_session, signed_in
):
    write_day(db_session, signed_in, ANCHOR, "step_count", 10000)
    write_day(db_session, signed_in, ANCHOR - dt.timedelta(days=3), "step_count", 8000)
    write_day(db_session, signed_in, ANCHOR - dt.timedelta(days=20), "step_count", 6000)

    body = client.get(f"/api/fitness/trends?date={ANCHOR}").json()

    assert [row["key"] for row in body["rows"]] == [
        "steps",
        "exercise_minutes",
        "distance",
        "workouts",
    ]
    assert [row["unit"] for row in body["rows"]] == [
        "steps/day",
        "min/day",
        "m/day",
        "workouts/week",
    ]
    steps = body["rows"][0]
    # The five days nothing arrived for are not five days of standing still.
    assert steps["recent"] == 9000
    assert steps["prior"] == 6000
    assert steps["direction"] == "up"


def test_a_trend_needs_both_windows_before_it_says_a_direction(
    client, db_session, signed_in
):
    empty = trends(client)
    assert empty["steps"] == {
        "key": "steps",
        "recent": None,
        "prior": None,
        "unit": "steps/day",
        "direction": None,
    }

    write_day(db_session, signed_in, ANCHOR, "step_count", 9000)

    only_recent = trends(client)["steps"]
    assert only_recent["recent"] == 9000
    assert only_recent["prior"] is None
    assert only_recent["direction"] is None


def test_a_trend_is_flat_until_it_leaves_the_band(client, db_session, signed_in):
    write_day(db_session, signed_in, ANCHOR - dt.timedelta(days=20), "step_count", 100)
    write_day(db_session, signed_in, ANCHOR, "step_count", 105)

    # Exactly at the edge is still the same week said again.
    assert trends(client)["steps"]["direction"] == "flat"

    recent = db_session.scalar(
        select(models.FitnessDaily).where(models.FitnessDaily.date_for == ANCHOR)
    )
    recent.value = 106
    db_session.commit()
    assert trends(client)["steps"]["direction"] == "up"

    recent.value = 95
    db_session.commit()
    assert trends(client)["steps"]["direction"] == "flat"

    recent.value = 94
    db_session.commit()
    assert trends(client)["steps"]["direction"] == "down"


def test_distance_a_day_is_added_up_from_the_hour_rows(client, db_session, signed_in):
    write_hour(db_session, signed_in, ANCHOR, 8, 1000)
    write_hour(db_session, signed_in, ANCHOR, 18, 1500)
    write_hour(db_session, signed_in, ANCHOR - dt.timedelta(days=2), 9, 500)

    distance = trends(client)["distance"]

    # Two days carry a reading: 2,500 m and 500 m.
    assert distance["recent"] == 1500
    assert distance["prior"] is None
    assert distance["direction"] is None

    history = client.get(
        f"/api/fitness/daily?metric=distance&days=3&date={ANCHOR}"
    ).json()
    assert history["unit"] == "m"
    assert [row["value"] for row in history["days"]] == [500, None, 2500]


def test_workouts_are_counted_per_week_over_the_whole_window(
    client, db_session, signed_in
):
    for day in (ANCHOR, ANCHOR - dt.timedelta(days=4)):
        db_session.add(
            models.Workout(
                user_id=signed_in.id,
                activity="Outdoor Run",
                started_at=now_utc(),
                date_for=day,
                duration_s=1800,
                source="apple",
                flags={},
            )
        )
    db_session.commit()

    workouts = trends(client)["workouts"]

    assert workouts["recent"] == 2
    assert workouts["prior"] == 0
    assert workouts["direction"] == "up"


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


# ---- A run of whole days, which the Dashboard's Exercise card reads.


def utc_yesterday() -> dt.date:
    """The day before today in the account's own zone, which every fixture
    account reads in UTC. The route takes no date, so a case has to line its
    export up with the run the server will answer with."""
    return dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=1)


def test_a_run_of_days_lists_the_workouts_on_a_day(client, db_session, make_user):
    day = utc_yesterday()
    signed_in_with_export(client, db_session, make_user, day)

    rows = client.get("/api/fitness/days?days=2").json()["days"]

    assert [row["date"] for row in rows] == [
        day.isoformat(),
        (day + dt.timedelta(days=1)).isoformat(),
    ]
    landed = rows[0]
    assert landed["steps"] == 8500
    assert landed["exercise_minutes"] == 42
    assert landed["active_kcal"] == 430
    assert [one["activity"] for one in landed["workouts"]] == ["Outdoor Run"]
    assert landed["workouts"][0]["duration_s"] == 2520
    assert round(landed["workouts"][0]["distance_m"]) == 6470


def test_a_day_nothing_arrived_for_has_no_workouts_and_no_figures(
    client, db_session, make_user
):
    signed_in_with_export(client, db_session, make_user, utc_yesterday())

    rows = client.get("/api/fitness/days?days=2").json()["days"]

    quiet = rows[-1]
    assert quiet["workouts"] == []
    assert quiet["steps"] is None
    assert quiet["exercise_minutes"] is None
    assert quiet["active_kcal"] is None


def test_a_run_of_days_can_be_one_day(client, db_session, make_user):
    signed_in_with_export(client, db_session, make_user, utc_yesterday())

    rows = client.get("/api/fitness/days?days=1").json()["days"]

    assert len(rows) == 1
    # The one day is the last of a longer run: today in the account's own zone
    # rather than on whatever machine the process runs on.
    assert rows[0]["date"] == client.get("/api/fitness/days?days=3").json()["days"][-1]["date"]


def test_a_span_tare_will_not_answer_is_refused(client, db_session, make_user):
    signed_in_with_export(client, db_session, make_user, utc_yesterday())

    response = client.get("/api/fitness/days?days=0")

    assert response.status_code == 400
    assert response.json() == {"detail": "Ask for between 1 and 190 days."}
    assert client.get("/api/fitness/days?days=191").status_code == 400


# ---- A day of its own goals, when the usual pair is not what was meant.


def utc_today() -> dt.date:
    """Today in the account's own zone, which every fixture account reads in
    UTC. The same reason utc_yesterday exists."""
    return dt.datetime.now(dt.timezone.utc).date()


def test_a_days_goals_are_the_usual_ones_until_they_are_changed(client, signed_in):
    body = client.get("/api/fitness/goals").json()

    assert body["date"] == utc_today().isoformat()
    assert body["steps"] == 8000
    assert body["exercise_minutes"] == 30
    assert body["defaults"] == {"steps": 8000, "exercise_minutes": 30}
    assert body["overridden"] is False


def test_a_day_set_apart_reads_back_the_way_it_was_written(client, signed_in):
    day = utc_today()

    saved = client.put(
        f"/api/fitness/goals/{day}", json={"steps": 12000, "exercise_minutes": 45}
    )

    assert saved.status_code == 200
    assert saved.json() == {
        "date": day.isoformat(),
        "steps": 12000,
        "exercise_minutes": 45,
        "defaults": {"steps": 8000, "exercise_minutes": 30},
        "overridden": True,
    }
    assert client.get(f"/api/fitness/goals?date={day}").json() == saved.json()


def test_every_screen_reads_the_override_for_that_day_and_the_usual_pair_before_it(
    client, signed_in
):
    day = utc_today()
    before = day - dt.timedelta(days=1)
    assert (
        client.put(
            f"/api/fitness/goals/{day}", json={"steps": 12000, "exercise_minutes": 45}
        ).status_code
        == 200
    )

    summary = client.get(f"/api/fitness/summary?date={day}").json()
    earlier = client.get(f"/api/fitness/summary?date={before}").json()
    assert summary["goals"] == {"steps": 12000, "exercise_minutes": 45}
    assert earlier["goals"] == {"steps": 8000, "exercise_minutes": 30}

    assert client.get(f"/api/diary/day?date={day}").json()["exercise_minutes_goal"] == 45
    assert client.get(f"/api/diary/day?date={before}").json()["exercise_minutes_goal"] == 30

    rows = {row["date"]: row for row in client.get("/api/fitness/days?days=2").json()["days"]}
    assert rows[day.isoformat()]["step_goal"] == 12000
    assert rows[day.isoformat()]["exercise_minutes_goal"] == 45
    assert rows[before.isoformat()]["step_goal"] == 8000
    assert rows[before.isoformat()]["exercise_minutes_goal"] == 30


def test_one_figure_goes_back_to_the_usual_while_the_other_stands(client, signed_in):
    day = utc_today()
    client.put(f"/api/fitness/goals/{day}", json={"steps": 12000, "exercise_minutes": 45})

    body = client.put(f"/api/fitness/goals/{day}", json={"steps": None}).json()

    assert body["steps"] == 8000
    assert body["exercise_minutes"] == 45
    assert body["overridden"] is True


def test_a_day_with_neither_figure_left_on_it_keeps_no_row(client, db_session, signed_in):
    day = utc_today()
    client.put(f"/api/fitness/goals/{day}", json={"steps": 12000, "exercise_minutes": 45})

    body = client.put(
        f"/api/fitness/goals/{day}", json={"steps": None, "exercise_minutes": None}
    ).json()

    assert body["steps"] == 8000
    assert body["exercise_minutes"] == 30
    assert body["overridden"] is False
    assert db_session.execute(select(models.DayGoal)).scalars().all() == []


def test_a_day_that_has_not_happened_cannot_be_aimed_at(client, signed_in):
    ahead = utc_today() + dt.timedelta(days=1)

    refused = client.put(f"/api/fitness/goals/{ahead}", json={"steps": 12000})

    assert refused.status_code == 400
    assert refused.json() == {"detail": "That day is in the future."}


def test_a_days_goal_is_held_to_the_bounds_the_usual_one_is(client, signed_in):
    day = utc_today()

    steps = client.put(f"/api/fitness/goals/{day}", json={"steps": 100})
    minutes = client.put(f"/api/fitness/goals/{day}", json={"exercise_minutes": 900})

    assert steps.status_code == 400
    assert steps.json() == {"detail": "Pick a goal between 1,000 and 50,000 steps."}
    assert minutes.status_code == 400
    assert minutes.json() == {"detail": "Pick a goal between 5 and 600 minutes."}


def test_setting_a_day_apart_leaves_the_usual_goals_alone(client, signed_in):
    day = utc_today()
    client.put(f"/api/fitness/goals/{day}", json={"steps": 12000, "exercise_minutes": 45})

    targets = client.get("/api/health/targets").json()
    profile = client.get("/api/health/profile").json()

    assert targets["step_goal"] == 8000
    assert targets["exercise_minutes_goal"] == 30
    assert profile["step_goal"] == 8000
    assert profile["exercise_minutes_goal"] == 30
