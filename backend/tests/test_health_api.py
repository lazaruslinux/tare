"""The health routes: the profile, the targets they produce, the measurements
they read, and the workouts credited against them.

The day is frozen wherever an answer depends on which day it is, so nothing
here is a different case tomorrow. Everything is private without qualification,
which the last cases hold to by asking as somebody else.
"""

import datetime as dt

import pytest

from app import clock, models
from app.routers.health import BAD_RATE, NO_GRAMS, NOTE_TEXT, NUDGE_TEXT, PCT_RANGE, PCT_SUM
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
    assert body["budget"]["calories"] == 1280
    assert body["budget"]["protein_g"] == 112
    assert body["budget"]["carbs_g"] == 112
    assert body["budget"]["fat_g"] == 43
    assert body["budget"]["fiber_g"] == 18
    assert body["budget"]["saturated_fat_g_max"] == 14
    # The heart association's figure for a woman, not a share of the budget.
    assert body["budget"]["sugar_g_max"] == 25
    assert body["weekly_rate"] == 0.43
    # The cap and the carbs sentence, and no clinician sentence at this weight.
    assert set(body["notes"]) == {NOTE_TEXT["cap"], NOTE_TEXT["carbs_low"]}
    assert body["nudges"] == []
    # The goal weight sits under the weigh-in, so the direction is losing and
    # the three steps are on offer.
    assert body["goal"] == "lose"
    assert body["rate_steps"] == [0.45, 0.7, 0.9]
    assert body["rate_kg_per_week"] == 0.45
    assert body["trend_kg"] == 70.0


def test_the_working_out_behind_the_budget_is_three_figures(client, case_a):
    body = client.get("/api/health/targets").json()
    # About what you use, eating a bit less, and what is left.
    assert body["breakdown"] == {"use": 1700, "adjustment": -430, "budget": 1280}
    # And the sentences carry their keys, so a screen can place each one.
    assert set(body["note_keys"]) == {"cap", "carbs_low"}
    assert len(body["note_keys"]) == len(body["notes"])


def test_a_man_gets_the_higher_added_sugars_ceiling(client, member):
    assert profile(client, sex="male", height_cm=180).status_code == 200
    assert weigh(client, 95).status_code == 200
    assert client.get("/api/health/targets").json()["budget"]["sugar_g_max"] == 36


def test_a_goal_weight_gives_a_month_and_never_a_day(client, case_a):
    assert client.get("/api/health/targets").json()["projection"] == {"month": "2026-11"}


def test_a_rate_off_the_steps_is_refused_with_the_reason(client, case_a):
    refused = profile(client, rate_kg_per_week=1.2)
    assert refused.status_code == 400
    assert refused.json() == {"detail": BAD_RATE}
    # And one of the three is taken.
    assert profile(client, rate_kg_per_week=0.9).status_code == 200
    assert client.get("/api/health/profile").json()["rate_kg_per_week"] == 0.9


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
    assert body["breakdown"] == {"use": 1700, "adjustment": -430, "budget": 1280}

    back = client.put("/api/health/targets", json={"mode": "auto"})
    assert back.json()["budget"]["calories"] == 1280
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
    assert body["budget"]["calories"] == 1280
    assert body["budget"]["protein_g"] == 96
    assert body["budget"]["carbs_g"] == 128
    assert body["budget"]["fat_g"] == 43
    assert body["percentages"] == {"protein_pct": 30, "carbs_pct": 40, "fat_pct": 30}
    # And the working out still stands behind the calories.
    assert body["breakdown"] == {"use": 1700, "adjustment": -430, "budget": 1280}


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

    # The same day again replaces it rather than adding a second reading.
    assert weigh(client, 81).status_code == 200
    listed = client.get("/api/health/measurements").json()
    assert len(listed["measurements"]) == 1
    assert listed["measurements"][0]["weight_kg"] == 81.0
    assert listed["measurements"][0]["lean_kg"] is None


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
        ("visceral_fat", 0),
        ("visceral_fat", 60),
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
    assert profile(client, rate_kg_per_week=0.9).status_code == 200
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
