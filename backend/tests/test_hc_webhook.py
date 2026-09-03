import datetime as dt
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app import models
from tests.test_ingest import post, token_for

# The zone the accounts in this file live in, which is seven hours behind UTC
# and therefore the one that makes a late evening reading arrive stamped
# tomorrow.
ZONE = ZoneInfo("America/Phoenix")


def utc_stamp(day: dt.date, hour: int, minute: int = 0) -> str:
    """One local moment written the way the bridge writes it: in UTC."""
    local = dt.datetime.combine(day, dt.time(hour, minute), tzinfo=ZONE)
    return local.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def android(day: dt.date) -> dict:
    return {
        "app_version": "1.4.0",
        "timestamp": utc_stamp(day, 23),
        "steps": [
            {"start_time": utc_stamp(day, 8), "count": 2200},
            {"start_time": utc_stamp(day, 19), "count": 3100},
        ],
        "active_calories": [
            {"start_time": utc_stamp(day, 8), "calories": 120},
            {"start_time": utc_stamp(day, 19, 5), "calories": 45},
        ],
        "distance": [{"start_time": utc_stamp(day, 19), "meters": 1400}],
        "heart_rate": [
            {"time": utc_stamp(day, 19, minute), "bpm": 128 + minute} for minute in range(5)
        ],
        "resting_heart_rate": [{"time": utc_stamp(day, 6), "bpm": 57}],
        "exercise_sessions": [
            {
                "type": "running",
                "start_time": utc_stamp(day, 19),
                "end_time": utc_stamp(day, 19, 30),
                "duration_seconds": 1800,
                "distance_meters": 5000,
                "avg_heart_rate": 142,
            }
        ],
        "weight": [{"time": utc_stamp(day, 7), "kilograms": 88.2}],
        "body_fat": [{"time": utc_stamp(day, 7), "percentage": 24.5}],
    }


def phoenix(make_user, name):
    return make_user(name, timezone="America/Phoenix")


def yesterday():
    return dt.datetime.now(ZONE).date() - dt.timedelta(days=1)


def test_a_bridge_export_lands_the_same_way_a_phones_does(client, db_session, make_user):
    user = phoenix(make_user, "android")
    token = token_for(db_session, user)
    day = yesterday()

    body = post(client, token, android(day)).json()

    assert body["workouts"] == 1
    assert body["skipped"] == 0
    steps = db_session.scalar(
        select(models.FitnessDaily).where(models.FitnessDaily.metric == "step_count")
    )
    assert steps.value == 5300
    assert steps.date_for == day
    workout = db_session.scalar(select(models.Workout))
    assert workout.activity == "Running"
    assert workout.source == "hc"
    assert workout.duration_s == 1800
    assert workout.distance_m == 5000


def test_an_evening_reading_belongs_to_the_evening_it_happened_in(
    client, db_session, make_user
):
    user = phoenix(make_user, "evening")
    token = token_for(db_session, user)
    day = yesterday()

    # Seven in the evening in Phoenix is two in the morning of the next day in
    # UTC, and the reading belongs to the day the member lived through.
    post(
        client,
        token,
        {"app_version": "1.4.0", "steps": [{"start_time": utc_stamp(day, 19), "count": 500}]},
    )

    row = db_session.scalar(select(models.FitnessDaily))
    assert row.date_for == day
    assert utc_stamp(day, 19).startswith((day + dt.timedelta(days=1)).isoformat())


def test_the_sessions_own_minutes_stand_in_for_a_daily_exercise_total(
    client, db_session, make_user
):
    user = phoenix(make_user, "minutes")
    token = token_for(db_session, user)
    day = yesterday()

    post(client, token, android(day))

    row = db_session.scalar(
        select(models.FitnessDaily).where(
            models.FitnessDaily.metric == "apple_exercise_time"
        )
    )
    assert row.value == 30


def test_a_bridge_session_carries_its_minutes_but_no_line(client, db_session, make_user):
    user = phoenix(make_user, "detail")
    token = token_for(db_session, user)
    day = yesterday()

    post(client, token, android(day))

    workout = db_session.scalar(select(models.Workout))
    samples = list(
        db_session.execute(
            select(models.WorkoutSample).where(models.WorkoutSample.workout_id == workout.id)
        ).scalars()
    )
    # Health Connect exports no route at all, so there is nothing to draw.
    assert db_session.get(models.WorkoutRoute, workout.id) is None
    # Five minutes of heart rate, and a sixth minute that carries only the
    # calories the bridge reported inside the session's window.
    assert len(samples) == 6
    assert samples[0].hr_avg == 128
    assert samples[0].distance_m == 1400
    assert samples[5].kcal == 45
    assert workout.avg_hr == 130


def test_a_bridge_weigh_in_lands_on_an_empty_day(client, db_session, make_user):
    user = phoenix(make_user, "androidscale")
    token = token_for(db_session, user)
    day = yesterday()

    post(client, token, android(day))

    row = db_session.scalar(select(models.WeightEntry))
    assert row.date_for == day
    assert row.weight_kg == 88.2
    assert row.body_fat_pct == 24.5
    assert row.source == "ingest"


def test_a_bridge_export_is_recorded_under_its_own_dialect(client, db_session, make_user):
    user = phoenix(make_user, "dialect")
    token = token_for(db_session, user)

    post(client, token, android(yesterday()))

    assert db_session.scalar(select(models.IngestLog)).dialect == "hc"


def test_a_bridge_export_sent_twice_changes_nothing(client, db_session, make_user):
    user = phoenix(make_user, "twice")
    token = token_for(db_session, user)
    day = yesterday()
    post(client, token, android(day))

    again = post(client, token, android(day)).json()

    assert again["workouts"] == 0
    assert again["skipped"] == 1
    assert len(list(db_session.execute(select(models.Workout)).scalars())) == 1
