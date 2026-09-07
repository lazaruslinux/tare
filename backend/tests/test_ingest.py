import datetime as dt
import json
import threading

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import models, security
from app.config import settings
from app.db import Base, get_db
from app.deps import BAD_INGEST_TOKEN
from app.main import create_app
from app.models import now_utc
from app.throttle import TOO_MANY

PATH = "/api/ingest/health"
UPLOAD = "/api/ingest/upload"


def stamp(day: dt.date, hour: int, minute: int = 0) -> str:
    """One moment written the way a phone's export writes it: the wall clock
    where the phone was, with the offset it was at."""
    return f"{day.isoformat()} {hour:02d}:{minute:02d}:00 -0700"


def metric(name, unit, points):
    return {"name": name, "units": unit, "data": points}


def point(day, hour, qty, minute=0):
    return {"date": stamp(day, hour, minute), "qty": qty}


def line():
    """A straight run of fixes about two kilometres long, which is long enough
    that trimming both ends still leaves a shape."""
    return [
        {"latitude": round(33.4 + step * 0.0003, 6), "longitude": -111.9}
        for step in range(60)
    ]


def beats(day, hour, count=6):
    return [
        {
            "date": stamp(day, hour, minute),
            "Min": 130 + minute,
            "Avg": 142 + minute,
            "Max": 158 + minute,
        }
        for minute in range(count)
    ]


def run(day):
    return {
        "name": "Outdoor Run",
        "id": "run-one",
        "start": stamp(day, 17, 12),
        "end": stamp(day, 17, 54),
        "duration": 2520,
        "activeEnergyBurned": {"qty": 431, "units": "kcal"},
        "distance": {"qty": 4.02, "units": "mi"},
        "heartRate": {"min": 98, "avg": 146, "max": 171},
        "maxHeartRate": {"qty": 171, "units": "count/min"},
        "elevationUp": {"qty": 38, "units": "m"},
        "isIndoor": False,
        "route": line(),
        "heartRateData": beats(day, 17),
        "stepCount": [
            {"date": stamp(day, 17, minute), "qty": 160 + minute} for minute in range(6)
        ],
        "activeEnergy": [
            {"date": stamp(day, 17, minute), "qty": 10.2, "units": "kcal"}
            for minute in range(6)
        ],
        "walkingAndRunningDistance": [
            {"date": stamp(day, 17, minute), "qty": 0.16, "units": "mi"}
            for minute in range(6)
        ],
    }


def export(day):
    """One export carrying the four the screen draws, four it only stores, a
    weigh-in, a body fat reading and one run."""
    return {
        "data": {
            "metrics": [
                metric("step_count", "count", [point(day, 8, 4000), point(day, 18, 4500)]),
                metric("active_energy", "kcal", [point(day, 8, 250), point(day, 18, 180)]),
                metric("apple_exercise_time", "min", [point(day, 18, 42)]),
                metric("resting_heart_rate", "count/min", [point(day, 6, 58)]),
                metric("heart_rate_variability", "ms", [point(day, 6, 54)]),
                metric("vo2_max", "mL/min·kg", [point(day, 6, 41.2)]),
                metric(
                    "sleep_analysis",
                    "hr",
                    [
                        {
                            "date": stamp(day, 6, 30),
                            "asleep": 6.9,
                            "core": 4.1,
                            "deep": 1.1,
                            "rem": 1.7,
                            "awake": 0.4,
                            "inBed": 7.5,
                        }
                    ],
                ),
                metric("weight_body_mass", "lb", [point(day, 7, 219.4)]),
                metric("body_fat_percentage", "%", [point(day, 7, 0.281)]),
            ],
            "workouts": [run(day)],
        }
    }


def token_for(db_session, user) -> str:
    plain = security.generate_token()
    db_session.add(
        models.IngestToken(
            user_id=user.id, token_hash=security.hash_token(plain), created_at=now_utc()
        )
    )
    db_session.commit()
    return plain


def post(client, token, payload):
    return client.post(PATH, json=payload, headers={"Authorization": f"Bearer {token}"})


def yesterday():
    return dt.date.today() - dt.timedelta(days=1)


def pick(client, raw, name="export.json", kind="application/json", **headers):
    """One file, chosen on the Sync a device screen."""
    return client.post(UPLOAD, files={"file": (name, raw, kind)}, headers=headers)


def test_an_export_lands_as_days_and_a_workout(client, db_session, make_user):
    user = make_user("runner")
    token = token_for(db_session, user)
    day = yesterday()

    response = post(client, token, export(day))

    assert response.status_code == 200
    body = response.json()
    assert body["workouts"] == 1
    assert body["skipped"] == 0
    assert body["flagged"] == 0
    assert body["days"] == 9

    steps = db_session.scalar(
        select(models.FitnessDaily).where(models.FitnessDaily.metric == "step_count")
    )
    assert steps.value == 8500
    assert steps.unit == "count"
    workout = db_session.scalar(select(models.Workout))
    assert workout.activity == "Outdoor Run"
    assert workout.date_for == day
    assert workout.avg_hr == 146
    assert workout.max_hr == 171
    assert round(workout.distance_m) == 6470


def test_every_metric_is_kept_not_only_the_ones_a_screen_draws(client, db_session, make_user):
    user = make_user("keeper")
    token = token_for(db_session, user)
    post(client, token, export(yesterday()))

    kept = {
        row.metric
        for row in db_session.execute(select(models.FitnessDaily)).scalars()
    }
    assert {"heart_rate_variability", "vo2_max", "sleep_analysis"} <= kept


def test_a_reading_that_is_not_one_number_keeps_its_fields(client, db_session, make_user):
    user = make_user("sleeper")
    token = token_for(db_session, user)
    post(client, token, export(yesterday()))

    row = db_session.scalar(
        select(models.FitnessDaily).where(models.FitnessDaily.metric == "sleep_analysis")
    )
    assert row.fields["deep"] == 1.1
    assert row.fields["rem"] == 1.7
    # The headline of a night's sleep is the hours asleep.
    assert row.value == 6.9


def test_the_same_export_sent_twice_changes_nothing(client, db_session, make_user):
    user = make_user("repeater")
    token = token_for(db_session, user)
    day = yesterday()
    post(client, token, export(day))

    again = post(client, token, export(day)).json()

    assert again["days"] == 0
    assert again["workouts"] == 0
    assert again["skipped"] == 1
    assert len(list(db_session.execute(select(models.Workout)).scalars())) == 1


def test_a_workout_the_route_was_drawn_for_keeps_its_minutes(client, db_session, make_user):
    user = make_user("mapped")
    token = token_for(db_session, user)
    post(client, token, export(yesterday()))

    workout = db_session.scalar(select(models.Workout))
    route = db_session.get(models.WorkoutRoute, workout.id)
    samples = list(
        db_session.execute(
            select(models.WorkoutSample).where(models.WorkoutSample.workout_id == workout.id)
        ).scalars()
    )
    # Both ends of the trace are gone, and what is left is still a line.
    assert 10 <= len(route.points) < 60
    assert route.points[0] != [33.4, -111.9]
    assert len(samples) == 6
    assert samples[0].hr_avg == 142


def test_a_weigh_in_somebody_typed_in_wins_its_day(client, db_session, make_user):
    user = make_user("weigher")
    token = token_for(db_session, user)
    day = yesterday()
    db_session.add(
        models.WeightEntry(user_id=user.id, date_for=day, weight_kg=100.0, source="manual")
    )
    db_session.commit()

    post(client, token, export(day))

    rows = list(db_session.execute(select(models.WeightEntry)).scalars())
    assert len(rows) == 1
    assert rows[0].weight_kg == 100.0
    assert rows[0].source == "manual"
    # Body fat fills a blank on the day that was already there.
    assert rows[0].body_fat_pct == 28.1


def test_a_day_with_no_weigh_in_takes_the_scales_reading(client, db_session, make_user):
    user = make_user("scaled")
    token = token_for(db_session, user)
    post(client, token, export(yesterday()))

    row = db_session.scalar(select(models.WeightEntry))
    assert row.source == "ingest"
    assert round(row.weight_kg, 1) == 99.5
    assert row.body_fat_pct == 28.1


def test_a_body_fat_with_no_weigh_in_makes_the_day(client, db_session, make_user):
    """The reading is the day's own, and a weight it was not taken beside is
    not a reason to throw it away."""
    user = make_user("fatonly")
    token = token_for(db_session, user)
    day = yesterday()
    post(
        client,
        token,
        {
            "data": {
                "metrics": [metric("body_fat_percentage", "%", [point(day, 7, 0.281)])],
                "workouts": [],
            }
        },
    )

    row = db_session.scalar(select(models.WeightEntry))
    assert row.date_for == day
    assert row.weight_kg is None
    assert row.body_fat_pct == 28.1
    assert row.source == "ingest"


def test_a_weigh_in_fills_a_day_that_held_only_a_body_fat(client, db_session, make_user):
    user = make_user("blank")
    token = token_for(db_session, user)
    day = yesterday()
    db_session.add(
        models.WeightEntry(user_id=user.id, date_for=day, body_fat_pct=22.0, source="manual")
    )
    db_session.commit()

    post(client, token, export(day))

    row = db_session.scalar(select(models.WeightEntry))
    assert round(row.weight_kg, 1) == 99.5
    # The body fat that was already there is still the one that stands.
    assert row.body_fat_pct == 22.0


def test_a_body_fat_reading_never_overwrites_one_already_there(client, db_session, make_user):
    user = make_user("measured")
    token = token_for(db_session, user)
    day = yesterday()
    db_session.add(
        models.WeightEntry(
            user_id=user.id, date_for=day, weight_kg=99.0, body_fat_pct=22.0, source="manual"
        )
    )
    db_session.commit()

    post(client, token, export(day))

    assert db_session.scalar(select(models.WeightEntry)).body_fat_pct == 22.0


def test_a_reading_older_than_the_window_is_counted_not_stored(client, db_session, make_user):
    user = make_user("historian")
    token = token_for(db_session, user)
    long_ago = dt.date.today() - dt.timedelta(days=800)

    body = post(
        client,
        token,
        {"data": {"metrics": [metric("step_count", "count", [point(long_ago, 8, 3000)])]}},
    ).json()

    assert body["days"] == 0
    assert body["skipped"] == 1
    assert db_session.scalar(select(models.FitnessDaily)) is None


def test_a_figure_past_what_a_body_does_is_flagged_and_still_stored(
    client, db_session, make_user
):
    user = make_user("striding")
    token = token_for(db_session, user)
    day = yesterday()

    body = post(
        client,
        token,
        {"data": {"metrics": [metric("step_count", "count", [point(day, 8, 250000)])]}},
    ).json()

    assert body["flagged"] == 1
    assert body["skipped"] == 0
    assert db_session.scalar(select(models.FitnessDaily)).value == 250000


def test_a_workout_nobody_could_have_run_is_flagged_not_refused(client, db_session, make_user):
    user = make_user("flying")
    token = token_for(db_session, user)
    day = yesterday()
    impossible = {
        **run(day),
        "id": "too-fast",
        "duration": 600,
        "distance": {"qty": 12.0, "units": "mi"},
    }

    body = post(client, token, {"data": {"workouts": [impossible]}}).json()

    assert body["workouts"] == 1
    assert body["flagged"] == 1
    assert db_session.scalar(select(models.Workout)).flags == {"impossible_pace": True}


def test_one_unreadable_entry_does_not_cost_the_rest(client, db_session, make_user):
    user = make_user("mixed")
    token = token_for(db_session, user)
    day = yesterday()
    payload = export(day)
    payload["data"]["workouts"] = [
        "not a workout",
        {"name": "Walk", "start": "the morning"},
        run(day),
    ]

    body = post(client, token, payload).json()

    assert body["workouts"] == 1
    assert body["skipped"] == 2
    assert body["days"] == 9


def test_a_body_that_is_not_json_is_refused(client, db_session, make_user):
    user = make_user("garbled")
    token = token_for(db_session, user)

    response = client.post(
        PATH, content=b"{ not json", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Body must be JSON."}


def test_a_figure_that_is_not_a_number_is_refused(client, db_session, make_user):
    user = make_user("nan")
    token = token_for(db_session, user)
    day = yesterday()
    body = json.dumps(
        {"data": {"metrics": [metric("step_count", "count", [point(day, 8, 1)])]}}
    ).replace('"qty": 1', '"qty": NaN')

    response = client.post(
        PATH,
        content=body.encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Body must be JSON."}


def test_an_export_past_the_caps_is_refused(client, db_session, make_user):
    user = make_user("flooding")
    token = token_for(db_session, user)
    day = yesterday()
    many = [metric(f"metric_{index}", "count", [point(day, 8, 1)]) for index in range(201)]

    response = post(client, token, {"data": {"metrics": many}})

    assert response.status_code == 400
    assert response.json()["detail"].endswith(".")


def test_a_bad_token_is_refused_before_the_body_is_read(client, db_session, make_user):
    make_user("guarded")

    response = client.post(
        PATH, json={"data": {"metrics": []}}, headers={"Authorization": "Bearer nonsense"}
    )

    assert response.status_code == 401
    assert response.json() == {"detail": BAD_INGEST_TOKEN}
    assert db_session.scalar(select(models.IngestLog)) is None


def test_one_key_runs_out_however_many_addresses_it_arrives_from(
    client, db_session, make_user
):
    """The per-account allowance, proved past the per-address one.

    Every request here comes from an address of its own, so the limiter keyed
    by address never counts two of them together and what runs out is the
    account's own allowance.
    """
    user = make_user("busy")
    token = token_for(db_session, user)
    other = make_user("quiet")
    other_token = token_for(db_session, other)
    body = {"data": {"metrics": []}}

    def sync(key, index):
        return client.post(
            PATH,
            json=body,
            headers={
                "Authorization": f"Bearer {key}",
                # Two entries, because one hop is trusted: the left one is what
                # the limiter reads and the right one stands in for the proxy.
                "X-Forwarded-For": f"203.0.113.{index}, 10.0.0.1",
            },
        )

    for index in range(60):
        assert sync(token, index).status_code == 200

    refused = sync(token, 60)
    assert refused.status_code == 429
    assert refused.json() == {"detail": TOO_MANY}
    # Somebody else's key is untouched by it.
    assert sync(other_token, 61).status_code == 200


def test_a_session_cookie_is_never_a_sync_key(client, signed_in):
    response = client.post(PATH, json={"data": {"metrics": []}})
    assert response.status_code == 401
    assert response.json() == {"detail": BAD_INGEST_TOKEN}


def test_an_oversized_export_is_refused_before_it_is_parsed(client, db_session, make_user):
    user = make_user("huge")
    token = token_for(db_session, user)

    response = client.post(
        PATH,
        content=b"x" * (16 * 1024 * 1024),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )

    assert response.status_code == 413
    assert response.json() == {"detail": "Request body is too large."}


def test_a_sync_writes_one_record_and_drops_the_expired_ones(client, db_session, make_user):
    user = make_user("logged")
    token = token_for(db_session, user)
    db_session.add(
        models.IngestLog(
            user_id=user.id,
            received_at=now_utc() - dt.timedelta(days=200),
            dialect="hae",
            items=1,
            accepted=1,
            flagged=0,
            skipped=0,
        )
    )
    db_session.commit()

    post(client, token, export(yesterday()))

    rows = list(db_session.execute(select(models.IngestLog)).scalars())
    assert len(rows) == 1
    assert rows[0].dialect == "hae"
    assert rows[0].accepted == 10
    assert rows[0].error is None


def test_the_record_names_the_first_thing_it_could_not_read(client, db_session, make_user):
    user = make_user("noted")
    token = token_for(db_session, user)

    post(client, token, {"data": {"workouts": [{"name": "Walk", "start": "the morning"}]}})

    row = db_session.scalar(select(models.IngestLog))
    assert row.error.startswith("Walk: ")
    assert row.skipped == 1


def test_a_sync_stamps_the_key_it_arrived_with(client, db_session, make_user):
    user = make_user("stamped")
    token = token_for(db_session, user)

    post(client, token, export(yesterday()))

    row = db_session.get(models.IngestToken, user.id)
    assert row.last_used_at is not None


def test_a_picked_file_lands_the_way_a_sync_does(client, db_session, signed_in):
    day = yesterday()

    response = pick(client, json.dumps(export(day)).encode())

    assert response.status_code == 200
    body = response.json()
    assert body["days"] == 9
    assert body["workouts"] == 1
    assert body["skipped"] == 0
    steps = db_session.scalar(
        select(models.FitnessDaily).where(models.FitnessDaily.metric == "step_count")
    )
    assert steps.value == 8500
    assert db_session.scalar(select(models.Workout)).activity == "Outdoor Run"
    row = db_session.scalar(select(models.IngestLog))
    # An upload says so rather than naming the dialect it happened to speak,
    # and the size of the file is on the record beside it.
    assert row.dialect == "upload"
    assert row.bytes > 0
    assert row.user_id == signed_in.id


def test_an_upload_needs_a_session(client, db_session, make_user):
    make_user("nobody")

    response = pick(client, json.dumps({"data": {"metrics": []}}).encode())

    assert response.status_code == 401
    assert response.json() == {"detail": "You are not signed in."}
    assert db_session.scalar(select(models.IngestLog)) is None


def test_a_picked_file_that_is_not_json_is_refused(client, signed_in):
    response = pick(client, b"not an export at all", name="notes.txt", kind="text/plain")

    assert response.status_code == 400
    assert response.json() == {"detail": "Body must be JSON."}


def test_a_sync_key_does_not_open_the_upload(client, db_session, make_user):
    user = make_user("keyed")
    token = token_for(db_session, user)

    response = pick(
        client,
        json.dumps({"data": {"metrics": []}}).encode(),
        authorization=f"Bearer {token}",
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "You are not signed in."}
    assert db_session.scalar(select(models.IngestLog)) is None


# ---- What a file brought, and taking it back out ----


def nested(levels):
    """One object inside another, that many times over."""
    node = {"end": 1}
    for _ in range(levels - 1):
        node = {"deeper": node}
    return node


def test_an_upload_stamps_every_row_it_writes(client, db_session, signed_in):
    pick(client, json.dumps(export(yesterday())).encode())

    assert {row.source for row in db_session.scalars(select(models.FitnessDaily))} == {"upload"}
    assert {row.source for row in db_session.scalars(select(models.FitnessIntraday))} == {
        "upload"
    }
    workout = db_session.scalar(select(models.Workout))
    assert workout.source == "upload"
    # Nothing out of a file is put in front of anybody until they say so.
    assert workout.hidden_from_feed is True
    weight = db_session.scalar(select(models.WeightEntry))
    assert weight.source == "ingest"
    assert weight.via == "upload"


def test_a_sync_stamps_its_rows_as_a_sync(client, db_session, make_user):
    user = make_user("runner")
    token = token_for(db_session, user)

    post(client, token, export(yesterday()))

    assert {row.source for row in db_session.scalars(select(models.FitnessDaily))} == {"sync"}
    assert {row.source for row in db_session.scalars(select(models.FitnessIntraday))} == {"sync"}
    workout = db_session.scalar(select(models.Workout))
    assert workout.source == "apple"
    assert workout.hidden_from_feed is False
    assert db_session.scalar(select(models.WeightEntry)).via is None


def test_a_wipe_takes_only_what_a_file_brought(client, db_session, signed_in):
    token = token_for(db_session, signed_in)
    uploaded_day = yesterday()
    synced_day = uploaded_day - dt.timedelta(days=1)
    synced = export(synced_day)
    # Its own id, or the second workout lands on the first one's row.
    synced["data"]["workouts"][0]["id"] = "run-two"
    pick(client, json.dumps(export(uploaded_day)).encode())
    post(client, token, synced)
    db_session.add(
        models.WeightEntry(
            user_id=signed_in.id,
            date_for=uploaded_day - dt.timedelta(days=5),
            weight_kg=91.2,
            source="manual",
        )
    )
    db_session.commit()

    response = client.delete("/api/ingest/uploads")

    assert response.status_code == 200
    assert response.json()["removed"] > 0
    db_session.expire_all()
    assert {row.source for row in db_session.scalars(select(models.FitnessDaily))} == {"sync"}
    assert {row.source for row in db_session.scalars(select(models.FitnessIntraday))} == {"sync"}
    workouts = list(db_session.scalars(select(models.Workout)))
    assert [row.source for row in workouts] == ["apple"]
    # The line and the minute rows went with the workout they belonged to.
    assert len(list(db_session.scalars(select(models.WorkoutRoute)))) == 1
    assert {row.workout_id for row in db_session.scalars(select(models.WorkoutSample))} == {
        workouts[0].id
    }
    weights = list(db_session.scalars(select(models.WeightEntry)))
    assert {row.source for row in weights} == {"ingest", "manual"}
    assert all(row.via is None for row in weights)
    assert "wipe" in {row.dialect for row in db_session.scalars(select(models.IngestLog))}


def test_the_screen_is_told_when_a_file_brought_something(client, db_session, signed_in):
    assert client.get("/api/account/ingest-token").json()["uploaded"] is False

    pick(client, json.dumps(export(yesterday())).encode())
    assert client.get("/api/account/ingest-token").json()["uploaded"] is True

    client.delete("/api/ingest/uploads")
    assert client.get("/api/account/ingest-token").json()["uploaded"] is False


def test_a_sixth_upload_in_an_hour_is_refused(client, signed_in):
    body = json.dumps({"data": {"metrics": []}}).encode()
    for _ in range(5):
        assert pick(client, body).status_code == 200

    response = pick(client, body)

    assert response.status_code == 429
    assert response.json() == {"detail": "Too many uploads. Try again in an hour."}


def test_a_body_that_is_not_an_export_is_refused(client, db_session, signed_in):
    response = pick(client, json.dumps({"notes": ["a holiday"]}).encode())

    assert response.status_code == 400
    assert response.json() == {"detail": "This file is not a health export."}
    assert db_session.scalar(select(models.IngestLog)) is None


def test_a_body_nested_past_the_ceiling_is_refused(client, db_session, signed_in):
    response = pick(client, json.dumps({"data": nested(12)}).encode())

    assert response.status_code == 400
    assert response.json() == {"detail": "This file is not a health export."}
    assert db_session.scalar(select(models.IngestLog)) is None


def test_a_body_inside_the_ceiling_is_read(client, signed_in):
    assert pick(client, json.dumps({"data": nested(11)}).encode()).status_code == 200


def test_a_body_carrying_too_many_keys_is_refused(client, signed_in):
    crowded = {"data": {"metrics": []}, "extra": {str(number): 1 for number in range(200_001)}}

    response = pick(client, json.dumps(crowded).encode())

    assert response.status_code == 400
    assert response.json() == {"detail": "This file is not a health export."}


def test_uploads_can_be_turned_off_without_closing_the_sync(
    client, db_session, signed_in, monkeypatch
):
    monkeypatch.setattr(settings, "uploads_enabled", False)
    token = token_for(db_session, signed_in)

    response = pick(client, json.dumps({"data": {"metrics": []}}).encode())

    assert response.status_code == 404
    assert response.json() == {"detail": "File uploads are turned off."}
    assert client.get("/api/account/ingest-token").json()["uploads"] is False
    # A phone is unaffected: the switch is about files somebody hands over.
    assert post(client, token, {"data": {"metrics": []}}).status_code == 200


def test_the_upload_list_is_for_administrators_only(client, signed_in):
    assert client.get("/api/admin/uploads").status_code == 403


def test_the_upload_list_names_who_sent_what(admin_client, admin):
    pick(admin_client, json.dumps(export(yesterday())).encode())

    rows = admin_client.get("/api/admin/uploads").json()

    assert len(rows) == 1
    assert rows[0]["username"] == "admin"
    assert rows[0]["bytes"] > 0
    assert rows[0]["accepted"] > 0


def test_two_exports_arriving_together_are_both_taken(tmp_path):
    """One import runs at a time, and the second waits rather than being refused.

    A file database with a connection for each session, because this is the one
    case here that needs two requests genuinely at once.
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'together.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with factory() as setup:
        user = models.User(
            username="runner",
            password_hash="not-signed-in-here",
            email_verified=True,
            birthdate=dt.date(1990, 4, 2),
            units="imperial",
            timezone="UTC",
            feed_hidden=[],
            created_at=now_utc(),
        )
        setup.add(user)
        setup.flush()
        token = token_for(setup, user)

    def per_request_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app = create_app()
    app.dependency_overrides[get_db] = per_request_db
    day = yesterday()
    answers: list[int] = []
    lock = threading.Lock()

    with TestClient(app) as client:

        def send(hour: int) -> None:
            payload = {
                "data": {"metrics": [metric("step_count", "count", [point(day, hour, 500)])]}
            }
            code = post(client, token, payload).status_code
            with lock:
                answers.append(code)

        threads = [threading.Thread(target=send, args=(hour,)) for hour in (8, 9)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

    assert answers == [200, 200]
    engine.dispose()
