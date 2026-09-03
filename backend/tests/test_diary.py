"""The diary: logging, re-measuring, and what survives a food being deleted.

Hand-computed figures throughout, from the two shapes of food that behave
differently: one weighed with a serving that is not a round number, and one
poured, with a density of its own.
"""

import datetime as dt

import pytest

from app import clock
from app.routers.diary import (
    BAD_DATE,
    BAD_SLOT,
    BAD_UNIT,
    LINKED_NUTRIENTS,
    MISSING_ENTRY,
    NO_AMOUNT,
    NO_PORTION,
    NO_QUICK_ADD,
    UNLINKED_UNIT,
)
from app.routers.foods import MISSING_FOOD
from tests.conftest import PASSWORD

# Every case names its day, so nothing here depends on when it is run.
TODAY = "2026-09-01"


def sign_in(client, username):
    response = client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200


@pytest.fixture()
def chicken(client, signed_in):
    """Weighed, no density, and a serving that is not a round hundred."""
    return client.post(
        "/api/foods",
        json={
            "name": "Chicken breast",
            "base_unit": "g",
            "calories": 165,
            "protein_g": 31,
            "carbs_g": 0,
            "fat_g": 3.6,
            "servings": [
                {"name": "1 breast", "amount": 174, "unit": "g", "position": 0},
                {"name": "100 g", "amount": 100, "unit": "g", "position": 1},
            ],
        },
    ).json()


@pytest.fixture()
def oil(client, signed_in):
    """Poured, and it knows what a millilitre of it weighs."""
    return client.post(
        "/api/foods",
        json={
            "name": "Olive oil",
            "brand": "Store brand",
            "base_unit": "ml",
            "density_g_per_ml": 0.91,
            "calories": 800,
            "protein_g": 0,
            "carbs_g": 0,
            "fat_g": 91,
            "servings": [{"name": "1 tbsp", "amount": 15, "unit": "ml", "position": 0}],
        },
    ).json()


def log(client, **body):
    sent = {"date": TODAY, "slot": "breakfast"}
    sent.update(body)
    return client.post("/api/diary", json=sent)


def day(client, date=TODAY):
    return client.get("/api/diary/day", params={"date": date}).json()


def serving_of(food, name):
    return next(row["id"] for row in food["servings"] if row["name"] == name)


def test_a_serving_is_counted_rather_than_converted(client, chicken):
    logged = log(
        client, food_id=chicken["id"], amount=1, unit=f"serving:{serving_of(chicken, '1 breast')}"
    )
    assert logged.status_code == 201
    made = logged.json()
    assert made["name"] == "Chicken breast"
    assert made["serving_label"] == "1 breast"
    assert made["unit"] == "serving"
    assert made["food_id"] == chicken["id"]
    # 174 g of something with 165 calories and 31 g of protein per 100 g.
    assert round(made["calories"], 3) == 287.1
    assert round(made["protein_g"], 3) == 53.94


def test_a_food_entered_by_the_pound_is_logged_by_the_ounce(client, signed_in):
    """The two halves of the same block of cheese: entered as one pound, eaten
    four ounces at a time, both worked out from the one stored panel."""
    block = client.post(
        "/api/foods",
        json={
            "name": "Cheddar block",
            "base_unit": "g",
            # 70 calories a block, which is 15.43 per 100 g of a 453.592 g one.
            "calories": 15.43,
            "protein_g": 0,
            "carbs_g": 0,
            "fat_g": 0,
            "servings": [{"name": "1 block", "amount": 1, "unit": "lb", "position": 0}],
        },
    ).json()
    assert round(block["servings"][0]["base_amount"], 3) == 453.592

    made = log(client, food_id=block["id"], amount=4, unit="oz").json()
    # Four ounces is 113.398 g, and 15.43 per 100 g of that is 17.5 calories.
    assert round(made["calories"], 1) == 17.5


def test_a_unit_goes_through_the_one_conversion(client, chicken):
    made = log(client, food_id=chicken["id"], amount=4, unit="oz").json()
    # Four ounces is 113.398 g.
    assert round(made["calories"], 4) == round(165 * 1.13398, 4)
    assert made["serving_label"] is None
    assert (made["amount"], made["unit"]) == (4, "oz")


def test_a_liquid_measured_by_weight_goes_through_its_density(client, oil):
    made = log(client, food_id=oil["id"], amount=100, unit="g").json()
    # 100 g of oil at 0.91 g per mL takes up 109.8901 mL.
    assert round(made["calories"], 2) == round(800 * (100 / 0.91) / 100, 2)
    assert made["brand"] == "Store brand"


def test_the_oil_reads_the_same_by_the_spoon_and_by_its_own_serving(client, oil):
    by_serving = log(
        client, food_id=oil["id"], amount=1, unit=f"serving:{serving_of(oil, '1 tbsp')}"
    ).json()
    by_spoon = log(client, food_id=oil["id"], amount=2, unit="tbsp").json()
    # The label's own tablespoon is 15 mL; the measure family's is 14.7868.
    assert round(by_serving["calories"]) == 120
    assert round(by_spoon["calories"]) == 237


def test_a_food_without_a_density_is_measured_as_though_it_were_water(client, chicken):
    made = log(client, food_id=chicken["id"], amount=1, unit="cup").json()
    # A cup is 236.588 mL and nothing said what that weighs, so a gram each.
    assert round(made["calories"], 4) == round(165 * 2.36588, 4)


def test_a_deleted_food_leaves_what_was_eaten_standing(client, chicken):
    made = log(
        client, food_id=chicken["id"], amount=1, unit=f"serving:{serving_of(chicken, '1 breast')}"
    ).json()
    before = day(client)

    assert client.delete(f"/api/foods/{chicken['id']}").status_code == 204

    after = day(client)
    assert after["totals"] == before["totals"]
    row = after["slots"]["breakfast"]["entries"][0]
    assert row["name"] == "Chicken breast"
    assert row["calories"] == made["calories"]
    assert row["serving_label"] == "1 breast"
    # The one thing that changed: there is nothing left to open.
    assert row["food_id"] is None


def test_a_linked_entry_is_worked_out_again_from_its_food(client, oil):
    made = log(client, slot="dinner", food_id=oil["id"], amount=2, unit="tbsp").json()
    assert round(made["calories"]) == 237

    changed = client.patch(
        f"/api/diary/{made['id']}",
        json={"amount": 1, "unit": f"serving:{serving_of(oil, '1 tbsp')}"},
    )
    assert changed.status_code == 200
    assert round(changed.json()["calories"]) == 120
    assert changed.json()["serving_label"] == "1 tbsp"


def test_re_measuring_picks_up_a_correction_to_the_food(client, oil):
    made = log(client, food_id=oil["id"], amount=1, unit="tbsp").json()
    corrected = client.patch(
        f"/api/foods/{oil['id']}",
        json={
            "name": "Olive oil",
            "base_unit": "ml",
            "density_g_per_ml": 0.91,
            "calories": 400,
            "protein_g": 0,
            "carbs_g": 0,
            "fat_g": 45,
        },
    )
    assert corrected.status_code == 200

    changed = client.patch(f"/api/diary/{made['id']}", json={"amount": 2, "unit": "tbsp"}).json()
    assert round(changed["calories"], 4) == round(400 * 0.295736, 4)


def test_an_unlinked_entry_is_stretched_rather_than_recomputed(client, chicken):
    made = log(client, food_id=chicken["id"], amount=100, unit="g").json()
    client.delete(f"/api/foods/{chicken['id']}")

    changed = client.patch(f"/api/diary/{made['id']}", json={"amount": 150}).json()
    assert changed["amount"] == 150
    assert round(changed["calories"], 3) == 247.5
    assert round(changed["protein_g"], 3) == 46.5


def test_an_unlinked_entry_cannot_be_measured_a_different_way(client, chicken):
    made = log(client, food_id=chicken["id"], amount=100, unit="g").json()
    client.delete(f"/api/foods/{chicken['id']}")

    refused = client.patch(f"/api/diary/{made['id']}", json={"amount": 4, "unit": "oz"})
    assert refused.status_code == 400
    assert refused.json() == {"detail": UNLINKED_UNIT}


def test_a_quick_add_carries_only_what_it_was_given(client, signed_in):
    minimal = log(client, name="  Flat white  ", calories=120)
    assert minimal.status_code == 201
    made = minimal.json()
    assert made["name"] == "Flat white"
    assert (made["food_id"], made["amount"], made["unit"]) == (None, None, None)
    assert made["calories"] == 120
    assert made["protein_g"] is None

    full = log(client, name="Fruitcake", calories=310, protein_g=4, carbs_g=52, fat_g=9).json()
    assert (full["protein_g"], full["carbs_g"], full["fat_g"]) == (4, 52, 9)


def test_a_quick_add_needs_a_name_and_its_calories(client, signed_in):
    blank = log(client, name="   ", calories=120)
    assert blank.status_code == 400
    assert blank.json() == {"detail": NO_QUICK_ADD}
    assert log(client, name="Fruitcake").json() == {"detail": NO_QUICK_ADD}


def test_a_quick_add_is_corrected_by_hand(client, chicken):
    made = log(client, name="Flat white", calories=120).json()
    changed = client.patch(
        f"/api/diary/{made['id']}", json={"name": "Flat white, large", "calories": 180}
    ).json()
    assert (changed["name"], changed["calories"]) == ("Flat white, large", 180)

    # A logged food's numbers are the food's, and typing over them would be
    # editing the food by the back door.
    linked = log(client, food_id=chicken["id"], amount=100, unit="g").json()
    refused = client.patch(f"/api/diary/{linked['id']}", json={"calories": 5})
    assert refused.status_code == 400
    assert refused.json() == {"detail": LINKED_NUTRIENTS}


def test_a_quick_add_has_no_portion_to_stretch(client, signed_in):
    made = log(client, name="Flat white", calories=120).json()
    refused = client.patch(f"/api/diary/{made['id']}", json={"amount": 2})
    assert refused.status_code == 400
    assert refused.json() == {"detail": NO_PORTION}


def test_the_day_is_split_by_meal(client, chicken, oil):
    log(client, slot="breakfast", food_id=chicken["id"], amount=100, unit="g")
    log(client, slot="dinner", food_id=oil["id"], amount=1, unit="tbsp")

    got = day(client)
    assert got["date"] == TODAY
    assert round(got["slots"]["breakfast"]["subtotal_calories"]) == 165
    # 14.7868 mL of an 800-per-100 oil.
    assert round(got["slots"]["dinner"]["subtotal_calories"]) == 118
    assert got["slots"]["lunch"]["entries"] == []
    assert got["slots"]["lunch"]["subtotal_calories"] is None
    assert round(got["totals"]["calories"]) == 283


def test_a_nutrient_nobody_gave_stays_missing_rather_than_becoming_zero(client, chicken):
    log(client, food_id=chicken["id"], amount=100, unit="g")
    log(client, name="Flat white", calories=120)

    got = day(client)
    # Neither row carries a sodium figure, so there is none to give.
    assert got["totals"]["sodium_mg"] is None
    # The chicken's protein counts, and the coffee nobody described counts as
    # nothing rather than making the whole figure unknowable.
    assert round(got["totals"]["protein_g"], 3) == 31
    assert round(got["totals"]["calories"]) == 285


def test_an_empty_day_has_no_totals_rather_than_zeroes(client, signed_in):
    got = day(client)
    assert got["totals"]["calories"] is None
    assert got["slots"]["breakfast"] == {"entries": [], "subtotal_calories": None}


def test_an_entry_moves_between_meals_and_days(client, chicken):
    made = log(client, food_id=chicken["id"], amount=100, unit="g").json()
    moved = client.patch(
        f"/api/diary/{made['id']}", json={"slot": "dinner", "date": "2026-08-31"}
    )
    assert moved.status_code == 200
    assert day(client)["slots"]["breakfast"]["entries"] == []
    assert len(day(client, "2026-08-31")["slots"]["dinner"]["entries"]) == 1


def test_an_entry_is_deleted(client, chicken):
    made = log(client, food_id=chicken["id"], amount=100, unit="g").json()
    assert client.delete(f"/api/diary/{made['id']}").status_code == 204
    assert day(client)["totals"]["calories"] is None


def test_the_day_defaults_to_the_one_the_account_is_standing_in(client, monkeypatch, make_user):
    # Half past ten at night in London: already tomorrow in Auckland, still
    # teatime in Phoenix.
    monkeypatch.setattr(
        clock, "now_utc", lambda: dt.datetime(2026, 9, 1, 22, 30, tzinfo=dt.timezone.utc)
    )
    make_user("kiwi", timezone="Pacific/Auckland")
    make_user("desert", timezone="America/Phoenix")

    sign_in(client, "kiwi")
    client.post("/api/diary", json={"slot": "snack", "name": "Toast", "calories": 90})
    kiwi_day = client.get("/api/diary/day").json()
    assert kiwi_day["date"] == "2026-09-02"
    assert len(kiwi_day["slots"]["snack"]["entries"]) == 1

    sign_in(client, "desert")
    client.post("/api/diary", json={"slot": "snack", "name": "Toast", "calories": 90})
    desert_day = client.get("/api/diary/day").json()
    assert desert_day["date"] == "2026-09-01"
    assert len(desert_day["slots"]["snack"]["entries"]) == 1
    # The same instant, two dates, and neither account sees the other's row.
    assert client.get("/api/diary/day", params={"date": "2026-09-02"}).json()["totals"][
        "calories"
    ] is None


def test_somebody_else_s_entry_is_absent_rather_than_refused(client, make_user, chicken):
    made = log(client, food_id=chicken["id"], amount=100, unit="g").json()
    make_user("stranger")
    sign_in(client, "stranger")

    assert day(client)["slots"]["breakfast"]["entries"] == []
    theirs = client.patch(f"/api/diary/{made['id']}", json={"slot": "lunch"})
    absent = client.patch("/api/diary/999999", json={"slot": "lunch"})
    assert theirs.status_code == absent.status_code == 404
    assert theirs.json() == absent.json() == {"detail": MISSING_ENTRY}
    assert client.delete(f"/api/diary/{made['id']}").status_code == 404


def test_a_food_that_is_not_visible_cannot_be_logged(client, make_user, chicken):
    make_user("stranger")
    sign_in(client, "stranger")
    refused = log(client, food_id=chicken["id"], amount=100, unit="g")
    assert refused.status_code == 404
    assert refused.json() == {"detail": MISSING_FOOD}


def test_each_refusal_is_one_sentence(client, chicken):
    bad_slot = log(client, slot="brunch", food_id=chicken["id"], amount=1, unit="g")
    assert bad_slot.status_code == 400
    assert bad_slot.json() == {"detail": BAD_SLOT}

    assert log(client, food_id=chicken["id"], amount=1, unit="gulp").json() == {"detail": BAD_UNIT}
    assert log(client, food_id=chicken["id"]).json() == {"detail": NO_AMOUNT}

    stray = log(client, food_id=chicken["id"], amount=1, unit="serving:999999")
    assert stray.status_code == 400
    assert stray.json() == {"detail": "That serving is not on this food."}

    asked = client.get("/api/diary/day", params={"date": "yesterday"})
    assert asked.status_code == 400
    assert asked.json() == {"detail": BAD_DATE}


def test_the_diary_needs_a_session(client):
    assert client.get("/api/diary/day").status_code == 401
    body = {"slot": "breakfast", "name": "Toast", "calories": 90}
    assert client.post("/api/diary", json=body).status_code == 401
    assert client.patch("/api/diary/1", json={"slot": "lunch"}).status_code == 401
    assert client.delete("/api/diary/1").status_code == 401


def test_a_day_carries_the_budget_it_is_read_against(client, signed_in, chicken):
    log(client, food_id=chicken["id"], amount=100, unit="g")
    read = day(client)
    # No profile yet, so the published guideline targets stand.
    assert read["budget"] == {
        "calories": 2000,
        "protein_g": 100,
        "carbs_g": 250,
        "fat_g": 67,
    }
    assert read["exercise_kcal"] == 0
    assert read["remaining_calories"] == 2000 - 165
    assert read["measurement"] is None
    assert read["exercise"] == []


def test_a_workout_is_added_back_to_the_day_it_was_done_on(client, signed_in):
    made = client.post(
        "/api/health/exercise",
        json={"date_for": TODAY, "activity": "walking", "effort": "moderate", "minutes": 30},
    )
    assert made.status_code == 201

    read = day(client)
    # At the assumed 70 kg, walking for half an hour is worth about 103.
    assert read["exercise_kcal"] == 100
    assert read["remaining_calories"] == 2100
    assert [row["name"] for row in read["exercise"]] == ["Walking"]
    # And the day before is untouched by it.
    assert day(client, "2026-08-31")["exercise_kcal"] == 0


def test_a_day_carries_what_was_weighed_on_it(client, signed_in):
    assert (
        client.put(
            f"/api/health/measurements/{TODAY}", json={"weight_kg": 80, "body_fat_pct": 20}
        ).status_code
        == 200
    )
    read = day(client)
    assert read["measurement"]["weight_kg"] == 80.0
    assert read["measurement"]["lean_kg"] == 64.0
    assert day(client, "2026-08-31")["measurement"] is None


# ---- A run of days, and where the day's own number comes from.


@pytest.fixture()
def frozen(monkeypatch):
    """The day the cases below are written against, so none of them is a
    different case tomorrow. The route ends on today and takes no date."""
    monkeypatch.setattr(
        clock, "now_utc", lambda: dt.datetime(2026, 9, 1, 12, 0, tzinfo=dt.timezone.utc)
    )


def days(client, **params):
    return client.get("/api/diary/days", params=params).json()


def quick(client, date, calories):
    return client.post(
        "/api/diary",
        json={"date": date, "slot": "breakfast", "name": "Quick add", "calories": calories},
    )


def personal(client):
    """The four details a worked-out day needs, so a budget is a personal one."""
    assert client.put(f"/api/health/measurements/{TODAY}", json={"weight_kg": 80}).status_code == 200
    assert client.put("/api/health/profile", json={"sex": "male", "height_cm": 180}).status_code == 200


def test_a_run_of_days_ends_today_and_reads_oldest_first(client, signed_in, frozen):
    assert quick(client, TODAY, 500).status_code == 201
    assert quick(client, "2026-08-30", 700).status_code == 201

    rows = days(client)["days"]
    assert len(rows) == 7
    assert [row["date"] for row in rows] == [
        "2026-08-26",
        "2026-08-27",
        "2026-08-28",
        "2026-08-29",
        "2026-08-30",
        "2026-08-31",
        "2026-09-01",
    ]
    assert rows[-1]["calories"] == 500
    assert rows[4]["calories"] == 700
    assert all(row["budget"] == rows[0]["budget"] for row in rows)


def test_a_day_nobody_logged_reads_as_nothing_consumed(client, signed_in, frozen):
    assert quick(client, TODAY, 500).status_code == 201

    rows = days(client)["days"]
    assert rows[-1]["logged"] is True
    assert [(row["calories"], row["logged"]) for row in rows[:-1]] == [(0, False)] * 6


def test_a_workout_is_credited_against_the_day_it_was_done_on(client, signed_in, frozen):
    made = client.post(
        "/api/health/exercise",
        json={"date_for": "2026-08-31", "activity": "walking", "effort": "moderate", "minutes": 30},
    )
    assert made.status_code == 201

    rows = days(client)["days"]
    assert rows[-2]["exercise_kcal"] == 100
    assert rows[-1]["exercise_kcal"] == 0


def test_a_run_of_days_stops_at_ninety(client, signed_in, frozen):
    assert len(days(client, days=400)["days"]) == 90
    assert len(days(client, days=0)["days"]) == 1
    assert len(days(client, days=1)["days"]) == 1


def test_the_days_of_one_diary_are_nobody_else_s(client, signed_in, make_user, frozen):
    assert quick(client, TODAY, 500).status_code == 201
    make_user("other")
    sign_in(client, "other")

    assert all(row["calories"] == 0 for row in days(client)["days"])


def test_the_day_says_what_its_budget_is_made_of(client, signed_in, frozen):
    personal(client)
    made = client.post(
        "/api/health/exercise",
        json={"date_for": TODAY, "activity": "walking", "effort": "moderate", "minutes": 40},
    )
    assert made.status_code == 201

    read = day(client)
    energy = read["energy"]
    assert energy["level"] == "not_much"
    assert energy["exercise"] == read["exercise_kcal"]
    assert energy["adjustment"] == 0
    assert energy["budget"] == read["budget"]["calories"] + read["exercise_kcal"]
    # Each of the five rounds to the nearest ten on its own (decision 28), so
    # they add up to the budget give or take one rounding step each.
    total = energy["resting"] + energy["activity"] + energy["exercise"] + energy["adjustment"]
    assert abs(total - energy["budget"]) <= 20


def test_a_losing_day_carries_a_negative_adjustment(client, signed_in, frozen):
    personal(client)
    assert client.put("/api/health/profile", json={"goal_weight_kg": 70}).status_code == 200

    energy = day(client)["energy"]
    assert energy["adjustment"] < 0
    total = energy["resting"] + energy["activity"] + energy["exercise"] + energy["adjustment"]
    assert abs(total - energy["budget"]) <= 20


def test_a_budget_set_by_hand_is_not_made_of_anything(client, signed_in, frozen):
    personal(client)
    assert day(client)["energy"] is not None

    typed = client.put(
        "/api/health/targets",
        json={"mode": "grams", "calories": 2000, "protein_g": 150, "carbs_g": 200, "fat_g": 60},
    )
    assert typed.status_code == 200
    assert day(client)["energy"] is None


def test_a_day_without_the_four_details_is_not_made_of_anything(client, signed_in, frozen):
    assert day(client)["energy"] is None


def test_a_day_counts_the_minutes_that_were_worked(client, signed_in, frozen):
    for minutes in (30, 45):
        made = client.post(
            "/api/health/exercise",
            json={
                "date_for": TODAY,
                "activity": "walking",
                "effort": "moderate",
                "minutes": minutes,
            },
        )
        assert made.status_code == 201

    read = day(client)
    assert read["exercise_minutes"] == 75
    assert read["exercise_minutes_goal"] == 30
    assert day(client, "2026-08-31")["exercise_minutes"] == 0
