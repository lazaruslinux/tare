"""The health routes: the profile, the targets they produce, the measurements
they read, and the workouts credited against them.

The day is frozen wherever an answer depends on which day it is, so nothing
here is a different case tomorrow. Everything is private without qualification,
which the last cases hold to by asking as somebody else.
"""

import datetime as dt

import pytest

from app import health

from app import clock, models
from app.routers import health as health_routes
from app.routers.health import (
    BAD_MINUTES_GOAL,
    BAD_RATE,
    BAD_STEP_GOAL,
    NO_GRAMS,
    NOTE_TEXT,
    NUDGE_TEXT,
    PCT_RANGE,
    PCT_SUM,
)
from tests.conftest import PASSWORD

TODAY = dt.date(2026, 9, 2)


@pytest.fixture(autouse=True)
def frozen(monkeypatch):
    """Every case runs on the day the worked figures were worked on."""
    monkeypatch.setattr(
        clock, "now_utc", lambda: dt.datetime(2026, 9, 2, 12, 0, tzinfo=dt.timezone.utc)
    )


@pytest.fixture()
def member(client, db_session, make_user):
    """Signed in, born on a day that makes the worked cases' age come out."""
    user = make_user("member", birthdate=dt.date(1996, 3, 15))
    assert (
        client.post("/api/auth/login", json={"username": "member", "password": PASSWORD}).status_code
        == 200
    )
    return user


def weigh(client, kg, day=None, **extra):
    return client.put(
        f"/api/health/measurements/{(day or TODAY).isoformat()}",
        json={"weight_kg": kg, **extra},
    )


def log_fat(client, pct, day=None):
    """A body fat on its own, which is a day with no weight on it."""
    return client.put(
        f"/api/health/measurements/{(day or TODAY).isoformat()}", json={"body_fat_pct": pct}
    )


def profile(client, **fields):
    return client.put("/api/health/profile", json=fields)


@pytest.fixture()
def case_a(client, member):
    """The worked case: female, 165 cm, 70 kg, 30, Not much, losing to 65 kg.

    The weigh-in comes first, because the direction is read off it and the
    goal weight together.
    """
    assert weigh(client, 70).status_code == 200
    assert profile(client, sex="female", height_cm=165, goal_weight_kg=65).status_code == 200
    return member


def test_a_profile_starts_empty_and_says_so(client, member):
    answer = client.get("/api/health/profile")
    assert answer.status_code == 200
    body = answer.json()
    assert body["sex"] is None
    assert body["height_cm"] is None
    assert body["activity_level"] == "not_much"
    assert body["goal"] == "maintain"
    assert body["complete"] is False
    assert body["latest_weight_kg"] is None


def test_without_details_the_targets_are_the_published_ones(client, member):
    body = client.get("/api/health/targets").json()
    assert body["complete"] is False
    assert body["budget"] == {
        "calories": 2000,
        "protein_g": 100,
        "carbs_g": 250,
        "fat_g": 67,
        "fiber_g": 28,
        "saturated_fat_g_max": 20,
        "sugar_g_max": 36,
        "sodium_mg_max": 2300,
        "cholesterol_mg_max": 300,
    }
    assert body["notes"] == [NOTE_TEXT["defaults"]]
    assert body["projection"] is None
    assert body["trend_kg"] is None


def test_the_worked_case_comes_out_of_the_route(client, case_a):
    body = client.get("/api/health/targets").json()
    assert body["complete"] is True
    # 1,704 a day less the 500 a pound a week asks for is 1,204, shown as 1,200.
    assert body["budget"]["calories"] == 1200
    # The losing split is 35 / 35 / 30 of that day.
    assert body["budget"]["protein_g"] == 105
    assert body["budget"]["carbs_g"] == 105
    assert body["budget"]["fat_g"] == 40
    assert body["budget"]["fiber_g"] == 17
    assert body["budget"]["saturated_fat_g_max"] == 13
    # The heart association's figure for a woman, not a share of the budget.
    assert body["budget"]["sugar_g_max"] == 25
    assert body["weekly_rate"] == 0.45
    # The cap and the carbs sentence, and no clinician sentence at this weight.
    assert set(body["notes"]) == {NOTE_TEXT["carbs_low"]}
    assert body["nudges"] == []
    # The goal weight sits under the weigh-in, so the direction is losing and
    # the three steps are on offer.
    assert body["goal"] == "lose"
    assert body["rate_steps"] == list(health.LOSE_STEPS)
    assert body["rate_kg_per_week"] == health.LOSE_STEPS[0]
    assert body["trend_kg"] == 70.0


def test_the_working_out_behind_the_budget_is_three_figures(client, case_a):
    body = client.get("/api/health/targets").json()
    # About what you use, eating a bit less, and what is left.
    assert body["breakdown"] == {"use": 1700, "adjustment": -500, "budget": 1200}
    # And the sentences carry their keys, so a screen can place each one.
    assert set(body["note_keys"]) == {"carbs_low"}
    assert len(body["note_keys"]) == len(body["notes"])


def test_every_goal_rate_says_what_it_costs(client, case_a):
    body = client.get("/api/health/targets").json()
    options = body["rate_options"]
    assert [row["rate_kg_per_week"] for row in options] == list(health.LOSE_STEPS)
    # A pound a week is 500 kcal a day, and each step asks for exactly its own.
    assert [row["asked"] for row in options] == [500, 625, 750, 875, 1000]
    assert options[0]["calories"] == body["budget"]["calories"]
    assert abs(options[0]["change"] + body["breakdown"]["adjustment"]) <= 10
    # The worked case uses 1,700 a day: every step past the first would go under
    # the 1,200 floor, and says so, rather than being capped short.
    assert all("floor" in row["notes"] for row in options[1:])
    assert all("cap" not in row["notes"] for row in options)


@pytest.fixture()
def case_floor(client, member):
    """A man of 99 kg and 180 cm losing to 85 kg, so there is 2,364 a day to
    spend: the three slowest steps stand and the two fastest sit on the floor.
    """
    assert weigh(client, 99).status_code == 200
    assert profile(client, sex="male", height_cm=180, goal_weight_kg=85).status_code == 200
    return member


def test_every_goal_rate_carries_the_day_it_reaches_the_goal(client, case_floor):
    options = client.get("/api/health/targets").json()["rate_options"]
    dates = [row["projection"]["date"] for row in options]
    # 14 kg to go from 2 September, at the pace each step really achieves.
    # A pound a week is 0.4536 kg: 14 / 0.4536 * 7 is 216 days. The last two
    # are held at (2,364 - 1,500) / 1,102.31, which is 0.7838 a week, or 125.
    assert dates == [
        "2027-04-06",  # 216 days
        "2027-02-22",  # 173 days
        "2027-01-24",  # 144 days
        "2027-01-05",  # 125 days
        "2027-01-05",  # the floor holds the pace, so the same day
    ]
    # Earlier with every step, and level once the floor is holding the pace.
    assert dates == sorted(dates, reverse=True)
    assert "floor" in options[3]["notes"]
    assert options[3]["projection"] == options[4]["projection"]


def test_a_goal_under_the_range_puts_no_day_on_any_step(client, member):
    """Decision 22: the goal stands and no step says when it arrives."""
    assert weigh(client, 99).status_code == 200
    assert profile(client, sex="male", height_cm=180, goal_weight_kg=55).status_code == 200
    body = client.get("/api/health/targets").json()
    assert body["projection"] is None
    assert len(body["rate_options"]) == len(health.LOSE_STEPS)
    assert all(row["projection"] is None for row in body["rate_options"])


def test_without_a_trend_no_step_offers_a_day(client, member):
    """Nothing weighed, so there is no pace to work a date from and no step to
    put one on."""
    body = client.get("/api/health/targets").json()
    assert body["trend_kg"] is None
    assert body["rate_options"] == []
    assert body["projection"] is None


def test_a_man_gets_the_higher_added_sugars_ceiling(client, member):
    assert profile(client, sex="male", height_cm=180).status_code == 200
    assert weigh(client, 95).status_code == 200
    assert client.get("/api/health/targets").json()["budget"]["sugar_g_max"] == 36


def test_a_goal_weight_gives_a_date(client, case_a):
    projection = client.get("/api/health/targets").json()["projection"]
    assert projection["date"].startswith("2026-11")


def test_a_rate_off_the_steps_is_refused_with_the_reason(client, case_a):
    refused = profile(client, rate_kg_per_week=1.2)
    assert refused.status_code == 400
    assert refused.json() == {"detail": BAD_RATE}
    # And one of the three is taken.
    assert profile(client, rate_kg_per_week=health.LOSE_STEPS[-1]).status_code == 200
    assert client.get("/api/health/profile").json()["rate_kg_per_week"] == health.LOSE_STEPS[-1]


def test_pregnancy_leaves_the_budget_at_the_day(client, case_a):
    assert profile(client, pregnant_or_breastfeeding=True).status_code == 200
    body = client.get("/api/health/targets").json()
    assert body["budget"]["calories"] == 1700
    assert NOTE_TEXT["pregnancy"] in body["notes"]


def test_a_recent_body_fat_reading_changes_which_estimate_is_used(client, member):
    # The second worked case: male, 180 cm, 95 kg, 45 on the frozen day.
    assert client.patch("/api/account", json={"birthdate": "1981-03-15"}).status_code == 200
    assert profile(client, sex="male", height_cm=180).status_code == 200
    assert weigh(client, 95).status_code == 200
    assert client.get("/api/health/targets").json()["budget"]["calories"] == 2230

    # The same day, with a quarter of it recorded as fat.
    assert weigh(client, 95, body_fat_pct=25).status_code == 200
    assert client.get("/api/health/targets").json()["budget"]["calories"] == 2290


def test_a_stale_body_fat_reading_is_not_used(client, member):
    assert client.patch("/api/account", json={"birthdate": "1981-03-15"}).status_code == 200
    assert profile(client, sex="male", height_cm=180).status_code == 200
    # Ninety-one days old, and the weight-based estimate takes back over.
    assert weigh(client, 95, TODAY - dt.timedelta(days=91), body_fat_pct=25).status_code == 200
    assert weigh(client, 95).status_code == 200
    assert client.get("/api/health/targets").json()["budget"]["calories"] == 2230


def test_the_clinician_sentence_appears_and_can_be_waved_away(client, member):
    # 40 kg at 175 cm is well under the healthy range, with a lower goal.
    assert weigh(client, 40).status_code == 200
    assert profile(client, sex="female", height_cm=175, goal_weight_kg=38).status_code == 200
    body = client.get("/api/health/targets").json()
    # A goal under a weight that is already under the range is under it too,
    # so both sentences are waiting.
    assert [row["key"] for row in body["nudges"]] == ["below_range", "goal_below_range"]
    assert body["nudges"][0]["text"] == NUDGE_TEXT["below_range"]

    assert client.post("/api/health/nudges/below_range/dismiss").status_code == 204
    assert client.post("/api/health/nudges/goal_below_range/dismiss").status_code == 204
    assert client.get("/api/health/targets").json()["nudges"] == []
    # And a key nobody publishes is not a nudge to dismiss.
    assert client.post("/api/health/nudges/made-up/dismiss").status_code == 404


def test_the_disclaimer_is_recorded_once(client, member):
    assert client.get("/api/health/targets").json()["disclaimer_seen"] is False
    assert client.post("/api/health/disclaimer").status_code == 204
    assert client.get("/api/health/targets").json()["disclaimer_seen"] is True
    # Twice is not an error and does not move the moment.
    assert client.post("/api/health/disclaimer").status_code == 204


def test_grams_replace_the_four_numbers_and_can_be_handed_back(client, case_a):
    answer = client.put(
        "/api/health/targets",
        json={"mode": "grams", "calories": 2100, "protein_g": 150, "carbs_g": 200, "fat_g": 70},
    )
    assert answer.status_code == 200
    body = answer.json()
    assert body["mode"] == "grams"
    assert body["budget"]["calories"] == 2100
    assert body["budget"]["protein_g"] == 150
    # The ceilings stay worked out, because they are limits rather than a
    # target anybody sets.
    assert body["budget"]["fiber_g"] == 29
    assert body["notes"] == [NOTE_TEXT["manual"]]
    # The working out still describes the day tare would have set, which is
    # what the percentages screen divides. The screen showing a typed-in
    # budget hides it.
    assert body["breakdown"] == {"use": 1700, "adjustment": -500, "budget": 1200}

    back = client.put("/api/health/targets", json={"mode": "auto"})
    assert back.json()["budget"]["calories"] == 1200
    # What was typed is kept, so switching back does not lose it.
    assert back.json()["manual"]["calories"] == 2100


def test_grams_need_all_four(client, case_a):
    refused = client.put("/api/health/targets", json={"mode": "grams", "calories": 2100})
    assert refused.status_code == 400
    assert refused.json()["detail"] == NO_GRAMS


def test_percentages_divide_the_worked_out_day(client, case_a):
    answer = client.put(
        "/api/health/targets",
        json={"mode": "pct", "protein_pct": 30, "carbs_pct": 40, "fat_pct": 30},
    )
    assert answer.status_code == 200
    body = answer.json()
    assert body["mode"] == "pct"
    # The size of the day is still tare's; only the way it is divided changed.
    assert body["budget"]["calories"] == 1200
    assert body["budget"]["protein_g"] == 90
    assert body["budget"]["carbs_g"] == 120
    assert body["budget"]["fat_g"] == 40
    assert body["percentages"] == {"protein_pct": 30, "carbs_pct": 40, "fat_pct": 30}
    # And the working out still stands behind the calories.
    assert body["breakdown"] == {"use": 1700, "adjustment": -500, "budget": 1200}


def test_a_starting_point_fills_the_percentages(client, case_a):
    body = client.put("/api/health/targets", json={"mode": "pct", "preset": "lose"}).json()
    assert body["percentages"] == {"protein_pct": 35, "carbs_pct": 35, "fat_pct": 30}
    assert body["presets"]["maintain"] == {"protein_pct": 30, "carbs_pct": 40, "fat_pct": 30}
    # The one thing a starting point says about itself.
    assert body["preset_notes"]["lose"] == "Protein is held at the top of the recommended range."

    refused = client.put("/api/health/targets", json={"mode": "pct", "preset": "keto"})
    assert refused.status_code == 400
    assert refused.json() == {"detail": "That is not a starting point Tare offers."}


@pytest.mark.parametrize(
    ("body", "sentence"),
    [
        ({"mode": "pct", "protein_pct": 30, "carbs_pct": 40, "fat_pct": 20}, PCT_SUM),
        ({"mode": "pct", "protein_pct": 2, "carbs_pct": 58, "fat_pct": 40}, PCT_RANGE),
        ({"mode": "pct", "protein_pct": 80, "carbs_pct": 15, "fat_pct": 5}, PCT_RANGE),
    ],
)
def test_a_split_that_does_not_work_is_refused_in_plain_words(client, case_a, body, sentence):
    refused = client.put("/api/health/targets", json=body)
    assert refused.status_code == 400
    assert refused.json() == {"detail": sentence}


def test_a_way_of_setting_targets_that_does_not_exist_is_refused(client, case_a):
    refused = client.put("/api/health/targets", json={"mode": "vibes"})
    assert refused.status_code == 400
    assert refused.json() == {"detail": "That is not a way to set targets."}


def test_each_level_carries_what_it_would_add(client, member):
    # The second worked case: male, 180 cm, 95 kg, 45, resting 1855.
    assert client.patch("/api/account", json={"birthdate": "1981-03-15"}).status_code == 200
    assert profile(client, sex="male", height_cm=180).status_code == 200
    assert weigh(client, 95).status_code == 200

    body = client.get("/api/health/targets").json()
    assert body["resting"] == 1860
    assert body["uses_body_fat"] is False
    adds = {row["level"]: row["adds"] for row in body["activity_options"]}
    assert adds == {"not_much": 370, "light": 700, "moderate": 1020, "heavy": 1340}
    totals = {row["level"]: row["total"] for row in body["activity_options"]}
    assert totals["moderate"] == 2880
    assert body["breakdown"] == {"use": 2230, "adjustment": 0, "budget": 2230}
    assert body["exercise_today"] == 0


def test_without_a_profile_no_level_carries_a_number(client, member):
    body = client.get("/api/health/targets").json()
    assert body["resting"] is None
    assert [row["adds"] for row in body["activity_options"]] == [None, None, None, None]
    assert body["breakdown"] is None


def test_a_measurement_is_one_row_a_day_and_carries_its_lean_figure(client, member):
    first = weigh(client, 80, body_fat_pct=20)
    assert first.status_code == 200
    assert first.json()["lean_kg"] == 64.0

    # The same day again corrects the weight rather than adding a second
    # reading, and the body fat read that morning is left where it is.
    assert weigh(client, 81).status_code == 200
    listed = client.get("/api/health/measurements").json()
    assert len(listed["measurements"]) == 1
    assert listed["measurements"][0]["weight_kg"] == 81.0
    assert listed["measurements"][0]["body_fat_pct"] == 20.0


def test_a_day_takes_a_body_fat_without_a_weight(client, member):
    made = log_fat(client, 24)
    assert made.status_code == 200
    assert made.json()["weight_kg"] is None
    assert made.json()["lean_kg"] is None

    # And the weight can be added to it later without disturbing the reading.
    assert weigh(client, 80).status_code == 200
    row = client.get("/api/health/measurements").json()["measurements"][0]
    assert (row["weight_kg"], row["body_fat_pct"]) == (80.0, 24.0)


def test_a_field_sent_as_null_is_cleared_and_an_empty_day_is_refused(client, member):
    assert weigh(client, 80, body_fat_pct=24).status_code == 200
    cleared = client.put(
        f"/api/health/measurements/{TODAY.isoformat()}", json={"body_fat_pct": None}
    )
    assert cleared.status_code == 200
    assert cleared.json()["body_fat_pct"] is None

    emptied = client.put(
        f"/api/health/measurements/{TODAY.isoformat()}", json={"weight_kg": None}
    )
    assert emptied.json() == {"detail": "Nothing to record."}
    assert emptied.status_code == 400
    # And a day nothing was ever recorded on is not made by an empty body.
    fresh = (TODAY - dt.timedelta(days=1)).isoformat()
    assert client.put(f"/api/health/measurements/{fresh}", json={}).status_code == 400
    # The day it refused to empty is still standing.
    assert client.get("/api/health/measurements").json()["measurements"][0]["weight_kg"] == 80.0


def test_the_visceral_rating_is_gone(client, member):
    saved = client.put(
        f"/api/health/measurements/{TODAY.isoformat()}",
        json={"weight_kg": 80, "visceral_fat": 12},
    )
    # Nothing reads it, so it is dropped rather than refused.
    assert saved.status_code == 200
    assert "visceral_fat" not in saved.json()
    listed = client.get("/api/health/measurements").json()
    assert "visceral_fat" not in listed["latest"]


def test_the_body_fat_line_carries_its_gaps_like_the_weight(client, member):
    assert log_fat(client, 25, TODAY - dt.timedelta(days=2)).status_code == 200
    assert log_fat(client, 24).status_code == 200

    line = client.get("/api/health/measurements").json()["trends"]["fat"]
    # Three days for two readings: the day nobody measured keeps the one before.
    assert [row["date"] for row in line] == [
        (TODAY - dt.timedelta(days=2)).isoformat(),
        (TODAY - dt.timedelta(days=1)).isoformat(),
        TODAY.isoformat(),
    ]
    assert [row["pct"] for row in line] == [25.0, 25.0, 24.9]


def test_every_share_gets_its_own_line_and_an_unread_one_is_empty(client, member):
    assert client.put(
        f"/api/health/measurements/{(TODAY - dt.timedelta(days=1)).isoformat()}",
        json={"weight_kg": 80, "body_fat_pct": 25, "body_water_pct": 55, "muscle_pct": 40},
    ).status_code == 200
    assert client.put(
        f"/api/health/measurements/{TODAY.isoformat()}",
        json={"body_fat_pct": 24, "body_water_pct": 56, "muscle_pct": 41},
    ).status_code == 200

    trends = client.get("/api/health/measurements").json()["trends"]
    assert sorted(trends) == ["bone", "fat", "muscle", "water"]
    assert [row["pct"] for row in trends["fat"]] == [25.0, 24.9]
    assert [row["pct"] for row in trends["water"]] == [55.0, 55.1]
    assert [row["pct"] for row in trends["muscle"]] == [40.0, 40.1]
    # Nobody has read a bone share, so that line has nothing to draw.
    assert trends["bone"] == []


def test_a_day_without_a_weight_is_not_the_latest_weight(client, member):
    earlier = TODAY - dt.timedelta(days=2)
    assert weigh(client, 80, earlier).status_code == 200
    assert log_fat(client, 24).status_code == 200

    latest = client.get("/api/health/measurements").json()["latest"]
    assert latest["weight_kg"] == {"value": 80.0, "date": earlier.isoformat()}
    assert latest["body_fat_pct"] == {"value": 24.0, "date": TODAY.isoformat()}
    assert client.get("/api/health/profile").json()["latest_weight_kg"] == 80.0


def test_the_measurement_list_is_newest_first_with_a_trend_under_it(client, member):
    assert weigh(client, 80, TODAY - dt.timedelta(days=2)).status_code == 200
    assert weigh(client, 81, TODAY - dt.timedelta(days=1)).status_code == 200
    assert weigh(client, 79, TODAY).status_code == 200

    body = client.get("/api/health/measurements").json()
    assert [row["date"] for row in body["measurements"]] == [
        TODAY.isoformat(),
        (TODAY - dt.timedelta(days=1)).isoformat(),
        (TODAY - dt.timedelta(days=2)).isoformat(),
    ]
    assert [row["kg"] for row in body["trend"]] == [80.0, 80.1, 79.99]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("weight_kg", 4),
        ("weight_kg", 900),
        ("body_fat_pct", 1),
        ("body_fat_pct", 95),
        ("body_water_pct", 5),
    ],
)
def test_a_measurement_outside_the_bounds_is_refused(client, member, field, value):
    body = {"weight_kg": 80, field: value}
    answer = client.put(f"/api/health/measurements/{TODAY.isoformat()}", json=body)
    assert answer.status_code == 400
    assert list(answer.json()) == ["detail"]


def test_muscle_and_bone_are_shares_of_the_weight(client, member):
    refused = client.put(
        f"/api/health/measurements/{TODAY.isoformat()}",
        json={"weight_kg": 80, "muscle_pct": 95},
    )
    assert refused.status_code == 400
    assert refused.json() == {"detail": "That is not a muscle percentage Tare can use."}
    saved = weigh(client, 101.6, muscle_pct=67.7, bone_pct=3.5).json()
    assert saved["muscle_pct"] == 67.7
    assert saved["muscle_kg"] == 68.78
    assert saved["bone_kg"] == 3.56


def test_the_latest_of_each_number_carries_its_own_day(client, member):
    earlier = TODAY - dt.timedelta(days=3)
    assert weigh(client, 82, earlier, body_fat_pct=30, muscle_pct=60).status_code == 200
    assert weigh(client, 81).status_code == 200
    latest = client.get("/api/health/measurements").json()["latest"]
    assert latest["weight_kg"] == {"value": 81.0, "date": TODAY.isoformat()}
    assert latest["body_fat_pct"] == {"value": 30.0, "date": earlier.isoformat()}
    assert latest["muscle_pct"] == {"value": 60.0, "date": earlier.isoformat(), "mass_kg": 49.2}
    assert latest["bone_pct"] is None


def test_a_measurement_cannot_be_in_the_future(client, member):
    assert weigh(client, 80, TODAY + dt.timedelta(days=1)).status_code == 400


def test_a_measurement_can_be_taken_back(client, member):
    assert weigh(client, 80).status_code == 200
    assert client.delete(f"/api/health/measurements/{TODAY.isoformat()}").status_code == 204
    assert client.delete(f"/api/health/measurements/{TODAY.isoformat()}").status_code == 404
    assert client.get("/api/health/measurements").json()["measurements"] == []


def test_the_catalogue_is_plain_words_with_only_the_efforts_it_has(client, member):
    rows = client.get("/api/health/activities").json()
    assert len(rows) == 17
    walking = next(row for row in rows if row["key"] == "walking")
    assert walking["name"] == "Walking"
    assert [row["effort"] for row in walking["efforts"]] == ["light", "moderate", "vigorous"]
    swimming = next(row for row in rows if row["key"] == "swimming")
    assert [row["effort"] for row in swimming["efforts"]] == ["moderate", "vigorous"]


def test_a_workout_is_credited_at_the_weight_that_day_was_carried_at(client, case_a):
    answer = client.post(
        "/api/health/exercise",
        json={"date_for": TODAY.isoformat(), "activity": "walking", "effort": "moderate", "minutes": 30},
    )
    assert answer.status_code == 201
    body = answer.json()
    assert body["name"] == "Walking"
    assert body["kcal"] == 100
    assert body["estimated"] is False


def test_without_a_weigh_in_the_credit_says_it_is_an_estimate(client, member):
    answer = client.post(
        "/api/health/exercise",
        json={"activity": "walking", "effort": "moderate", "minutes": 30},
    )
    assert answer.status_code == 201
    assert answer.json()["estimated"] is True
    assert answer.json()["kcal"] == 100


def test_an_effort_the_activity_does_not_offer_is_refused(client, member):
    refused = client.post(
        "/api/health/exercise",
        json={"activity": "swimming", "effort": "light", "minutes": 30},
    )
    assert refused.status_code == 400
    assert refused.json()["detail"] == "That effort is not offered for this activity."

    unknown = client.post(
        "/api/health/exercise",
        json={"activity": "quidditch", "effort": "light", "minutes": 30},
    )
    assert unknown.status_code == 400


def test_a_workout_can_be_taken_back(client, member):
    made = client.post(
        "/api/health/exercise",
        json={"activity": "yoga", "effort": "light", "minutes": 45},
    ).json()
    assert client.delete(f"/api/health/exercise/{made['id']}").status_code == 204
    assert client.delete(f"/api/health/exercise/{made['id']}").status_code == 404


def test_a_goal_weight_that_turns_the_direction_around_drops_the_goal_rate(client, case_a):
    assert profile(client, rate_kg_per_week=health.LOSE_STEPS[-1]).status_code == 200
    # 75 kg is above the 70 on the scale, so this is a gaining plan now and
    # the losing rate it was picked under does not come with it.
    assert profile(client, goal_weight_kg=75).status_code == 200
    who = client.get("/api/health/profile").json()
    assert who["goal"] == "gain"
    assert who["rate_kg_per_week"] is None
    assert who["rate_steps"] == [0.25, 0.45]
    assert client.get("/api/health/targets").json()["rate_kg_per_week"] == 0.25


def test_the_location_can_be_set_from_the_profile_screen(client, member, db_session):
    assert profile(client, location="  Flagstaff, AZ  ").json()["location"] == "Flagstaff, AZ"
    db_session.refresh(member)
    assert member.location == "Flagstaff, AZ"


def test_none_of_this_needs_a_session(client):
    for path in ("/api/health/profile", "/api/health/targets", "/api/health/measurements"):
        assert client.get(path).status_code == 401
    assert client.get("/api/health/activities").status_code == 401


def test_one_member_cannot_read_or_reach_another(client, db_session, member, make_user):
    assert weigh(client, 80).status_code == 200
    mine = client.post(
        "/api/health/exercise",
        json={"activity": "yoga", "effort": "light", "minutes": 45},
    ).json()
    assert profile(client, sex="female", height_cm=165).status_code == 200

    # An administrator is nobody special here.
    make_user("nosey", admin=True)
    assert client.post("/api/auth/logout").status_code == 204
    assert (
        client.post("/api/auth/login", json={"username": "nosey", "password": PASSWORD}).status_code
        == 200
    )

    # Their own profile, not the other member's, and their own empty history.
    assert client.get("/api/health/profile").json()["sex"] is None
    assert client.get("/api/health/measurements").json()["measurements"] == []
    assert client.get("/api/health/targets").json()["complete"] is False
    # And the one address with an id in it answers as if it were never used.
    assert client.delete(f"/api/health/exercise/{mine['id']}").status_code == 404
    # Which leaves the other member's row where it was.
    assert db_session.get(models.ExerciseEntry, mine["id"]) is not None


def test_too_many_minutes_is_refused_in_plain_words(client, case_a):
    answer = client.post(
        "/api/health/exercise",
        json={"activity": "walking", "effort": "moderate", "minutes": 3030},
    )
    assert answer.status_code == 400
    assert answer.json() == {"detail": "Minutes must be between 1 and 720."}


def test_a_day_of_movement_has_two_goals_with_defaults(client, member):
    read = client.get("/api/health/profile").json()
    assert read["exercise_minutes_goal"] == 30
    assert read["step_goal"] == 8000
    targets = client.get("/api/health/targets").json()
    assert targets["exercise_minutes_goal"] == 30
    assert targets["step_goal"] == 8000


def test_the_two_goals_can_be_set(client, member):
    answer = profile(client, exercise_minutes_goal=45, step_goal=12000)
    assert answer.status_code == 200
    assert answer.json()["exercise_minutes_goal"] == 45
    assert answer.json()["step_goal"] == 12000


@pytest.mark.parametrize("minutes", [4, 601])
def test_a_minutes_goal_outside_the_offered_range_is_refused(client, member, minutes):
    answer = profile(client, exercise_minutes_goal=minutes)
    assert answer.status_code == 400
    assert answer.json()["detail"] == BAD_MINUTES_GOAL
    assert client.get("/api/health/profile").json()["exercise_minutes_goal"] == 30


@pytest.mark.parametrize("steps", [999, 50001])
def test_a_step_goal_outside_the_offered_range_is_refused(client, member, steps):
    answer = profile(client, step_goal=steps)
    assert answer.status_code == 400
    assert answer.json()["detail"] == BAD_STEP_GOAL
    assert client.get("/api/health/profile").json()["step_goal"] == 8000


def test_two_readings_for_one_day_leave_one_row(client, db_session, member, monkeypatch):
    """The request that loses the race merges into the row the other one made,
    keeping what it holds rather than writing over it."""
    db_session.add(
        models.WeightEntry(
            user_id=member.id,
            date_for=TODAY,
            weight_kg=81.0,
            source="manual",
            created_at=clock.now_utc(),
        )
    )
    db_session.commit()
    real = health_routes.measurement_on
    missed = []

    def once(db, user, day):
        if not missed:
            missed.append(True)
            return None
        return real(db, user, day)

    monkeypatch.setattr(health_routes, "measurement_on", once)

    response = client.put(
        f"/api/health/measurements/{TODAY.isoformat()}", json={"body_fat_pct": 20.0}
    )

    assert response.status_code == 200
    assert db_session.query(models.WeightEntry).count() == 1
    assert response.json()["weight_kg"] == 81.0
    assert response.json()["body_fat_pct"] == 20.0
