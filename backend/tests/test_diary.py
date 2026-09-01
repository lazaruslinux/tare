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
                {"name": "1 breast", "base_amount": 174, "position": 0},
                {"name": "100 g", "base_amount": 100, "position": 1},
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
            "servings": [{"name": "1 tbsp", "base_amount": 15, "position": 0}],
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
