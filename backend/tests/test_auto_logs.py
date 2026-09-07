"""A food that logs itself into the same meal every day.

The whole of it turns on one rule: a day is filled in once. Every case here is
a way of asking whether that held, including the two ways it would be most
annoying if it did not, which are a day read twice and an entry somebody threw
away on purpose.
"""

import datetime as dt

import pytest

from app import models
from app.routers.diary import (
    AUTO_LOG_CLASH,
    AUTO_LOG_DISH_UNIT,
    BAD_SLOT,
    MISSING_AUTO_LOG,
    NO_DISH_WEIGHT,
    ONE_AUTO_LOG_KIND,
)
from app.routers.foods import MISSING_FOOD
from tests.conftest import PASSWORD

TODAY = dt.datetime.now(dt.timezone.utc).date()


def iso(day):
    return day.isoformat()


@pytest.fixture()
def oats(client, signed_in):
    """Weighed, with a serving that is not a round hundred."""
    return client.post(
        "/api/foods",
        json={
            "name": "Porridge oats",
            "base_unit": "g",
            "calories": 379,
            "protein_g": 13.2,
            "carbs_g": 67.7,
            "fat_g": 6.5,
            "servings": [{"name": "1 scoop", "amount": 40, "unit": "g", "position": 0}],
        },
    ).json()


def set_auto(client, food, *, amount=50, unit="g", slot="breakfast"):
    return client.post(
        "/api/diary/auto-logs",
        json={"food_id": food["id"], "amount": amount, "unit": unit, "slot": slot},
    )


def day(client, when=None):
    return client.get("/api/diary/day", params={"date": iso(when or TODAY)}).json()


def entries(read, slot="breakfast"):
    return read["slots"][slot]["entries"]


def backdate(db_session, auto_log_id, when):
    """Move a standing auto-log's first day, which is the only way a case can
    have one that has been running for a week."""
    row = db_session.get(models.AutoLog, auto_log_id)
    row.started_on = when
    db_session.commit()


def test_a_new_auto_log_fills_today_once_however_often_the_day_is_read(
    client, signed_in, oats
):
    created = set_auto(client, oats)
    assert created.status_code == 201
    assert created.json()["name"] == "Porridge oats"
    assert created.json()["slot"] == "breakfast"

    first = entries(day(client))
    assert len(first) == 1
    assert first[0]["name"] == "Porridge oats"
    assert first[0]["auto_log_id"] == created.json()["id"]

    # The day read again is the same day, not a second breakfast.
    assert len(entries(day(client))) == 1


def test_an_entry_deleted_on_one_day_does_not_come_back_for_that_day(
    client, signed_in, oats
):
    set_auto(client, oats)
    written = entries(day(client))[0]

    assert client.delete(f"/api/diary/{written['id']}").status_code == 204
    assert entries(day(client)) == []


def test_a_completed_day_receives_nothing(client, signed_in, oats):
    assert client.put("/api/diary/complete", json={"date": iso(TODAY)}).status_code == 200
    set_auto(client, oats)
    assert entries(day(client)) == []

    # And the day it is opened again is the day it is owed.
    assert client.delete(f"/api/diary/complete/{iso(TODAY)}").status_code == 204
    assert len(entries(day(client))) == 1


def test_a_day_that_has_not_happened_is_never_filled(client, signed_in, oats):
    set_auto(client, oats)
    tomorrow = day(client, TODAY + dt.timedelta(days=1))
    assert entries(tomorrow) == []


def test_a_run_of_days_fills_every_day_since_it_started(
    client, signed_in, oats, db_session
):
    created = set_auto(client, oats)
    started = TODAY - dt.timedelta(days=3)
    backdate(db_session, created.json()["id"], started)

    run = client.get("/api/diary/days", params={"days": 7}).json()["days"]
    logged = [row for row in run if row["logged"]]
    assert [row["date"] for row in logged] == [
        iso(started + dt.timedelta(days=step)) for step in range(4)
    ]
    # The day before it started is still an empty day.
    assert entries(day(client, started - dt.timedelta(days=1))) == []


def test_a_second_auto_log_for_the_same_food_and_meal_is_refused(client, signed_in, oats):
    assert set_auto(client, oats).status_code == 201
    clash = set_auto(client, oats)
    assert clash.status_code == 409
    assert clash.json()["detail"] == AUTO_LOG_CLASH.format(kind="food", slot="breakfast")
    # Another meal is another instruction, and that one is allowed.
    assert set_auto(client, oats, slot="dinner").status_code == 201


def test_stopping_it_leaves_today_and_writes_no_more_days(
    client, signed_in, oats, db_session
):
    created = set_auto(client, oats).json()
    written = entries(day(client))[0]

    assert client.delete(f"/api/diary/auto-logs/{created['id']}").status_code == 204
    # What it already wrote was eaten. It stays.
    assert [row["id"] for row in entries(day(client))] == [written["id"]]
    # And nothing is owed tomorrow, which is read as the next day arriving.
    assert client.get("/api/diary/auto-logs").json() == []


def test_the_numbers_match_a_manual_log_of_the_same_amount(client, signed_in, oats):
    manual = client.post(
        "/api/diary",
        json={
            "date": iso(TODAY),
            "slot": "lunch",
            "food_id": oats["id"],
            "amount": 1,
            "unit": f"serving:{oats['servings'][0]['id']}",
        },
    ).json()

    set_auto(client, oats, amount=1, unit=f"serving:{oats['servings'][0]['id']}")
    written = entries(day(client))[0]

    for field in ("calories", "protein_g", "carbs_g", "fat_g"):
        assert written[field] == pytest.approx(manual[field])
    assert written["serving_label"] == "1 scoop"
    assert written["unit"] == "serving"


def test_setting_one_up_after_eating_it_today_does_not_log_it_twice(
    client, signed_in, oats
):
    client.post(
        "/api/diary",
        json={
            "date": iso(TODAY),
            "slot": "breakfast",
            "food_id": oats["id"],
            "amount": 50,
            "unit": "g",
        },
    )
    set_auto(client, oats)
    assert len(entries(day(client))) == 1


def test_the_list_reads_what_was_set_and_a_change_lands_on_it(client, signed_in, oats):
    created = set_auto(client, oats).json()
    listed = client.get("/api/diary/auto-logs").json()
    assert len(listed) == 1
    assert listed[0]["amount"] == 50
    assert listed[0]["unit"] == "g"
    assert listed[0]["serving_label"] is None

    changed = client.patch(
        f"/api/diary/auto-logs/{created['id']}", json={"amount": 80, "slot": "dinner"}
    )
    assert changed.status_code == 200
    assert changed.json()["amount"] == 80
    assert changed.json()["slot"] == "dinner"


def test_a_manual_entry_carries_no_auto_log_and_a_bad_meal_is_refused(
    client, signed_in, oats
):
    manual = client.post(
        "/api/diary",
        json={
            "date": iso(TODAY),
            "slot": "snack",
            "food_id": oats["id"],
            "amount": 20,
            "unit": "g",
        },
    ).json()
    assert manual["auto_log_id"] is None

    refused = set_auto(client, oats, slot="elevenses")
    assert refused.status_code == 400
    assert refused.json()["detail"] == BAD_SLOT


def test_somebody_elses_auto_log_and_food_are_both_absent(
    client, signed_in, oats, make_user
):
    mine = set_auto(client, oats).json()
    make_user("other")
    assert (
        client.post("/api/auth/login", json={"username": "other", "password": PASSWORD})
    ).status_code == 200

    assert client.get("/api/diary/auto-logs").json() == []
    missing = client.patch(f"/api/diary/auto-logs/{mine['id']}", json={"amount": 10})
    assert missing.status_code == 404
    assert missing.json()["detail"] == MISSING_AUTO_LOG
    assert client.delete(f"/api/diary/auto-logs/{mine['id']}").status_code == 404

    hidden = client.post(
        "/api/diary/auto-logs",
        json={"food_id": oats["id"], "amount": 10, "unit": "g", "slot": "lunch"},
    )
    assert hidden.status_code == 404
    assert hidden.json()["detail"] == MISSING_FOOD


# ---- The same instruction about a recipe or a kept meal ----


@pytest.fixture()
def porridge(client, oats):
    """Four servings out of 200 g of oats, so the whole pot weighs itself."""
    return client.post(
        "/api/recipes",
        json={
            "name": "Porridge",
            "yield_servings": 4,
            "ingredients": [{"food_id": oats["id"], "amount": 200, "unit": "g"}],
        },
    ).json()


@pytest.fixture()
def plate(client, oats):
    """One kept meal, weighable because its only item is weighed."""
    return client.post(
        "/api/meals",
        json={
            "name": "Oat plate",
            "items": [{"food_id": oats["id"], "amount": 250, "unit": "g"}],
        },
    ).json()


def set_dish(client, key, dish, *, amount=1, unit="serving", slot="breakfast"):
    return client.post(
        "/api/diary/auto-logs",
        json={key: dish["id"], "amount": amount, "unit": unit, "slot": slot},
    )


def test_a_recipe_auto_logs_by_the_serving(client, porridge):
    created = set_dish(client, "recipe_id", porridge, amount=2)
    assert created.status_code == 201
    assert created.json()["kind"] == "recipe"
    assert created.json()["recipe_id"] == porridge["id"]
    assert created.json()["name"] == "Porridge"
    assert created.json()["serving_label"] is None

    written = entries(day(client))[0]
    assert written["recipe_id"] == porridge["id"]
    assert (written["amount"], written["unit"]) == (2, "serving")
    # Two of four servings is half the pot.
    assert written["calories"] == pytest.approx(porridge["totals"]["calories"] / 2)


def test_a_recipe_auto_logs_by_the_gram(client, porridge):
    assert set_dish(client, "recipe_id", porridge, amount=100, unit="g").status_code == 201
    written = entries(day(client))[0]
    assert (written["amount"], written["unit"], written["serving_label"]) == (100, "g", None)
    weighs = porridge["weight_g"]
    assert written["calories"] == pytest.approx(
        porridge["totals"]["calories"] * 100 / weighs
    )


def test_a_meal_auto_logs_by_the_serving_and_by_the_gram(client, plate):
    created = set_dish(client, "meal_id", plate)
    assert created.status_code == 201
    assert (created.json()["kind"], created.json()["meal_id"]) == ("meal", plate["id"])
    whole = entries(day(client))[0]
    assert whole["meal_id"] == plate["id"]
    assert whole["calories"] == pytest.approx(plate["totals"]["calories"])

    weighed = set_dish(client, "meal_id", plate, amount=125, unit="g", slot="dinner")
    assert weighed.status_code == 201
    row = entries(day(client), "dinner")[0]
    assert (row["amount"], row["unit"]) == (125, "g")
    assert row["calories"] == pytest.approx(
        plate["totals"]["calories"] * 125 / plate["weight_g"]
    )


def test_grams_are_refused_where_there_is_no_weight_to_share_out(client, oats):
    """A cup of oats is a volume nothing has weighed, so nothing can be a share
    of the pot."""
    poured = client.post(
        "/api/foods",
        json={
            "name": "Milk",
            "base_unit": "ml",
            "calories": 42,
            "protein_g": 3.4,
            "carbs_g": 5,
            "fat_g": 1,
        },
    ).json()
    soup = client.post(
        "/api/meals",
        json={
            "name": "Warm milk",
            "items": [{"food_id": poured["id"], "amount": 200, "unit": "ml"}],
        },
    ).json()
    assert soup["weight_g"] is None

    refused = set_dish(client, "meal_id", soup, amount=100, unit="g")
    assert refused.status_code == 400
    assert refused.json()["detail"] == NO_DISH_WEIGHT

    # Counted in servings it is fine, and then asking for grams is refused too.
    standing = set_dish(client, "meal_id", soup).json()
    changed = client.patch(f"/api/diary/auto-logs/{standing['id']}", json={"unit": "g"})
    assert changed.status_code == 400
    assert changed.json()["detail"] == NO_DISH_WEIGHT


def test_a_dish_counts_in_servings_or_weighs_and_nothing_else(client, porridge):
    refused = set_dish(client, "recipe_id", porridge, unit="cup")
    assert refused.status_code == 400
    assert refused.json()["detail"] == AUTO_LOG_DISH_UNIT


def test_an_auto_log_is_about_exactly_one_thing(client, oats, porridge):
    neither = client.post(
        "/api/diary/auto-logs", json={"amount": 1, "unit": "serving", "slot": "breakfast"}
    )
    assert neither.status_code == 400
    assert neither.json()["detail"] == ONE_AUTO_LOG_KIND

    both = client.post(
        "/api/diary/auto-logs",
        json={
            "food_id": oats["id"],
            "recipe_id": porridge["id"],
            "amount": 1,
            "unit": "g",
            "slot": "breakfast",
        },
    )
    assert both.status_code == 400
    assert both.json()["detail"] == ONE_AUTO_LOG_KIND


def test_a_second_auto_log_for_the_same_recipe_and_meal_is_refused(client, porridge):
    assert set_dish(client, "recipe_id", porridge).status_code == 201
    clash = set_dish(client, "recipe_id", porridge)
    assert clash.status_code == 409
    assert clash.json()["detail"] == AUTO_LOG_CLASH.format(kind="recipe", slot="breakfast")


def test_eating_the_recipe_today_already_means_it_is_not_written_again(client, porridge):
    client.post(
        "/api/diary",
        json={
            "date": iso(TODAY),
            "slot": "breakfast",
            "recipe_id": porridge["id"],
            "amount": 1,
        },
    )
    set_dish(client, "recipe_id", porridge)
    assert len(entries(day(client))) == 1


def test_the_portion_on_a_standing_dish_can_be_changed(client, porridge):
    created = set_dish(client, "recipe_id", porridge).json()
    changed = client.patch(f"/api/diary/auto-logs/{created['id']}", json={"amount": 3})
    assert changed.status_code == 200
    assert changed.json()["amount"] == 3
    assert changed.json()["kind"] == "recipe"


def test_the_list_says_which_of_the_three_each_row_is(client, oats, porridge, plate):
    set_auto(client, oats)
    set_dish(client, "recipe_id", porridge, slot="lunch")
    set_dish(client, "meal_id", plate, slot="dinner")

    listed = client.get("/api/diary/auto-logs").json()
    assert [(row["kind"], row["name"]) for row in listed] == [
        ("food", "Porridge oats"),
        ("recipe", "Porridge"),
        ("meal", "Oat plate"),
    ]
    # Nothing has been photographed, so no row draws a picture yet.
    assert [row["thumb_url"] for row in listed] == [None, None, None]


def test_a_deleted_recipe_takes_its_auto_log_with_it(client, porridge):
    set_dish(client, "recipe_id", porridge)
    assert len(client.get("/api/diary/auto-logs").json()) == 1

    assert client.delete(f"/api/recipes/{porridge['id']}").status_code == 204
    assert client.get("/api/diary/auto-logs").json() == []
    # And tomorrow is not written either.
    assert entries(day(client, TODAY + dt.timedelta(days=1))) == []


def test_somebody_elses_recipe_and_meal_are_both_absent(client, make_user, porridge, plate):
    make_user("other")
    assert (
        client.post("/api/auth/login", json={"username": "other", "password": PASSWORD})
    ).status_code == 200

    assert set_dish(client, "recipe_id", porridge).status_code == 404
    assert set_dish(client, "meal_id", plate).status_code == 404


# ---- A change in the Journal that the standing instruction follows ----


def standing_row(client, auto_log_id):
    """One standing auto-log as the list reads it back."""
    listed = client.get("/api/diary/auto-logs").json()
    return next(row for row in listed if row["id"] == auto_log_id)


def test_moving_an_auto_logged_entry_takes_the_instruction_with_it(client, signed_in, oats):
    created = set_auto(client, oats).json()
    written = entries(day(client))[0]
    assert written["auto_log_id"] == created["id"]

    moved = client.patch(
        f"/api/diary/{written['id']}", json={"slot": "lunch", "follow_auto_log": True}
    )
    assert moved.status_code == 200
    assert moved.json()["id"] == written["id"]
    assert standing_row(client, created["id"])["slot"] == "lunch"


def test_changing_the_amount_with_the_switch_on_changes_the_instruction(
    client, signed_in, oats
):
    created = set_auto(client, oats).json()
    written = entries(day(client))[0]

    changed = client.patch(
        f"/api/diary/{written['id']}", json={"amount": 80, "follow_auto_log": True}
    )
    assert changed.status_code == 200
    row = standing_row(client, created["id"])
    assert (row["amount"], row["unit"], row["slot"]) == (80, "g", "breakfast")


def test_the_switch_off_or_left_out_is_a_change_to_the_one_day(client, signed_in, oats):
    created = set_auto(client, oats).json()
    written = entries(day(client))[0]

    off = client.patch(
        f"/api/diary/{written['id']}", json={"slot": "lunch", "follow_auto_log": False}
    )
    assert off.status_code == 200
    assert standing_row(client, created["id"])["slot"] == "breakfast"

    assert client.patch(f"/api/diary/{written['id']}", json={"amount": 90}).status_code == 200
    row = standing_row(client, created["id"])
    assert (row["slot"], row["amount"]) == ("breakfast", 50)


def test_a_meal_that_already_auto_logs_it_refuses_the_whole_change(client, signed_in, oats):
    first = set_auto(client, oats).json()
    assert set_auto(client, oats, amount=20, slot="lunch").status_code == 201
    written = entries(day(client))[0]

    refused = client.patch(
        f"/api/diary/{written['id']}", json={"slot": "lunch", "follow_auto_log": True}
    )
    assert refused.status_code == 409
    assert refused.json()["detail"] == AUTO_LOG_CLASH.format(kind="food", slot="lunch")
    # Neither the day nor the instruction moved.
    assert [row["id"] for row in entries(day(client))] == [written["id"]]
    assert standing_row(client, first["id"])["slot"] == "breakfast"


def test_a_recipe_entry_carries_its_instruction_in_servings_and_in_grams(client, porridge):
    counted = set_dish(client, "recipe_id", porridge, amount=2).json()
    written = entries(day(client))[0]
    moved = client.patch(
        f"/api/diary/{written['id']}",
        json={"amount": 3, "slot": "lunch", "follow_auto_log": True},
    )
    assert moved.status_code == 200
    row = standing_row(client, counted["id"])
    assert (row["amount"], row["unit"], row["slot"]) == (3, "serving", "lunch")

    weighed = set_dish(
        client, "recipe_id", porridge, amount=100, unit="g", slot="dinner"
    ).json()
    plated = entries(day(client), "dinner")[0]
    changed = client.patch(
        f"/api/diary/{plated['id']}", json={"amount": 150, "follow_auto_log": True}
    )
    assert changed.status_code == 200
    grams = standing_row(client, weighed["id"])
    assert (grams["amount"], grams["unit"]) == (150, "g")


def test_a_meal_entry_carries_its_instruction_too(client, plate):
    created = set_dish(client, "meal_id", plate).json()
    written = entries(day(client))[0]

    changed = client.patch(
        f"/api/diary/{written['id']}",
        json={"amount": 2, "slot": "dinner", "follow_auto_log": True},
    )
    assert changed.status_code == 200
    row = standing_row(client, created["id"])
    assert (row["amount"], row["unit"], row["slot"]) == (2, "serving", "dinner")


def test_an_entry_nothing_set_to_repeat_is_simply_edited(client, signed_in, oats):
    manual = client.post(
        "/api/diary",
        json={
            "date": iso(TODAY),
            "slot": "breakfast",
            "food_id": oats["id"],
            "amount": 30,
            "unit": "g",
        },
    ).json()
    assert manual["auto_log_id"] is None

    changed = client.patch(
        f"/api/diary/{manual['id']}",
        json={"slot": "lunch", "amount": 40, "follow_auto_log": True},
    )
    assert changed.status_code == 200
    assert changed.json()["amount"] == 40
    assert client.get("/api/diary/auto-logs").json() == []
