"""Kept meals: a list of things to eat together, and the one line it logs as.

A meal holds no numbers of its own, so what these cases are mostly about is
when the numbers are worked out: at the moment the meal is read or logged,
from the foods as they stand then.
"""

import pytest

from app.routers.diary import BAD_SLOT
from app.routers.foods import MISSING_FOOD
from app.routers.meals import MISSING_MEAL, NO_WEIGHT
from tests.conftest import PASSWORD

TODAY = "2026-09-01"


def sign_in(client, username):
    response = client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200


@pytest.fixture()
def toast(client, signed_in):
    """Weighed, with a serving of its own."""
    return client.post(
        "/api/foods",
        json={
            "name": "Sourdough",
            "base_unit": "g",
            "calories": 260,
            "protein_g": 9,
            "carbs_g": 50,
            "fat_g": 2,
            "servings": [{"name": "1 slice", "amount": 45, "unit": "g", "position": 0}],
        },
    ).json()


@pytest.fixture()
def coffee(client, signed_in):
    """Poured, and measured in what it is poured in."""
    return client.post(
        "/api/foods",
        json={
            "name": "Flat white",
            "brand": "Cafe",
            "base_unit": "ml",
            "calories": 60,
            "protein_g": 3,
            "carbs_g": 5,
            "fat_g": 3,
        },
    ).json()


@pytest.fixture()
def breakfast(client, toast, coffee):
    """Two slices and a cup, kept so it is one tap rather than four."""
    serving = toast["servings"][0]["id"]
    made = client.post(
        "/api/meals",
        json={
            "name": "Usual breakfast",
            "items": [
                {"food_id": toast["id"], "amount": 2, "unit": f"serving:{serving}"},
                {"food_id": coffee["id"], "amount": 200, "unit": "ml"},
            ],
        },
    )
    assert made.status_code == 201
    return made.json()


def log_meal(client, meal, slot="breakfast", **extra):
    return client.post(
        f"/api/meals/{meal['id']}/log", json={"date": TODAY, "slot": slot, **extra}
    )


def entries(client, slot="breakfast"):
    day = client.get("/api/diary/day", params={"date": TODAY}).json()
    return day["slots"][slot]["entries"]


def test_a_meal_is_a_list_of_things_to_eat_together(client, breakfast):
    assert breakfast["name"] == "Usual breakfast"
    first, second = breakfast["items"]
    assert (first["name"], first["amount"], first["unit"]) == ("Sourdough", 2, "serving")
    assert first["serving_label"] == "1 slice"
    assert (second["name"], second["brand"], second["unit"]) == ("Flat white", "Cafe", "ml")

    listed = client.get("/api/meals").json()
    assert listed == [
        {
            "id": breakfast["id"],
            "name": "Usual breakfast",
            "items": 2,
            "totals": breakfast["totals"],
            # Nothing has been eaten yet, so there is no date to read.
            "last_logged": None,
        }
    ]


def test_a_meal_is_worth_what_the_things_in_it_are_worth(client, breakfast):
    first, second = breakfast["items"]
    # Two slices of 45 g at 260 calories per 100 g, and 200 mL at 60 per 100.
    assert round(first["calories"], 4) == round(260 * 0.9, 4)
    assert round(second["calories"], 4) == 120
    assert round(breakfast["totals"]["calories"], 4) == round(234 + 120, 4)
    assert round(breakfast["totals"]["protein_g"], 4) == round(9 * 0.9 + 6, 4)
    for field in ("calories", "protein_g", "carbs_g", "fat_g"):
        assert round(breakfast["totals"][field], 4) == round(
            sum(item[field] for item in breakfast["items"]), 4
        )
    # Neither label gave a saturated fat figure, so the meal has no answer for
    # it rather than none of it, and added sugars is never read off an item.
    assert breakfast["totals"]["saturated_fat_g"] is None
    assert breakfast["totals"]["added_sugars_g"] is None


def test_logging_a_meal_makes_one_line_with_everything_in_it(client, breakfast):
    logged = log_meal(client, breakfast)
    assert logged.status_code == 201
    answer = logged.json()
    assert answer["skipped"] == []

    entry = answer["entry"]
    assert entry["name"] == "Usual breakfast"
    assert (entry["meal_id"], entry["food_id"], entry["recipe_id"]) == (breakfast["id"], None, None)
    assert (entry["amount"], entry["unit"], entry["serving_label"]) == (1, "serving", "serving")
    assert round(entry["calories"], 4) == round(234 + 120, 4)
    assert round(entry["protein_g"], 4) == round(9 * 0.9 + 6, 4)

    day = entries(client)
    assert len(day) == 1
    assert day[0]["meal_id"] == breakfast["id"]

    # And the list can now say when this meal was last eaten.
    assert client.get("/api/meals").json()[0]["last_logged"] == TODAY


def test_a_meal_can_be_logged_more_than_once_over(client, breakfast):
    answer = log_meal(client, breakfast, servings=2).json()
    assert answer["entry"]["amount"] == 2
    assert round(answer["entry"]["calories"], 4) == round((234 + 120) * 2, 4)


def test_a_meal_is_logged_in_servings_of_itself(client, breakfast):
    refused = log_meal(client, breakfast, servings=0)
    assert refused.status_code == 400
    assert entries(client) == []


def test_a_logged_meal_is_edited_by_the_serving(client, breakfast):
    entry = log_meal(client, breakfast).json()["entry"]
    changed = client.patch(f"/api/diary/{entry['id']}", json={"amount": 3})
    assert changed.status_code == 200
    assert changed.json()["amount"] == 3
    assert round(changed.json()["calories"], 4) == round((234 + 120) * 3, 4)


def test_the_numbers_come_from_the_food_as_it_stands_when_the_meal_is_logged(
    client, breakfast, coffee
):
    corrected = client.patch(
        f"/api/foods/{coffee['id']}",
        json={
            "name": "Flat white",
            "brand": "Cafe",
            "base_unit": "ml",
            "calories": 30,
            "protein_g": 3,
            "carbs_g": 5,
            "fat_g": 3,
        },
    )
    assert corrected.status_code == 200

    answer = log_meal(client, breakfast).json()
    # The meal kept no panel of its own, so the correction is what was logged.
    assert round(answer["entry"]["calories"], 4) == round(234 + 60, 4)


def test_something_whose_food_has_gone_is_left_out_and_named(client, breakfast, toast):
    assert client.delete(f"/api/foods/{toast['id']}").status_code == 204

    answer = log_meal(client, breakfast).json()
    assert answer["skipped"] == ["Sourdough"]
    # The rest of the meal really was eaten, so the line still lands, worth
    # what is left of it.
    assert round(answer["entry"]["calories"], 4) == 120
    assert len(entries(client)) == 1

    # And the meal reads the same way while that food is gone.
    meal = client.get(f"/api/meals/{breakfast['id']}").json()
    assert meal["items"][0]["calories"] is None
    assert round(meal["totals"]["calories"], 4) == 120


def test_a_meal_needs_a_name_and_a_workable_list(client, toast):
    blank = client.post(
        "/api/meals",
        json={"name": " ", "items": [{"food_id": toast["id"], "amount": 1, "unit": "g"}]},
    )
    assert blank.status_code == 400
    assert blank.json() == {"detail": "A meal needs a name."}

    empty = client.post("/api/meals", json={"name": "Breakfast", "items": []})
    assert empty.status_code == 400

    too_many = client.post(
        "/api/meals",
        json={
            "name": "Breakfast",
            "items": [{"food_id": toast["id"], "amount": 1, "unit": "g"}] * 51,
        },
    )
    assert too_many.status_code == 400

    stray = client.post(
        "/api/meals",
        json={"name": "Breakfast", "items": [{"food_id": 999999, "amount": 1, "unit": "g"}]},
    )
    assert stray.status_code == 404
    assert stray.json() == {"detail": MISSING_FOOD}


def test_a_meal_is_replaced_wholesale(client, breakfast, coffee):
    changed = client.put(
        f"/api/meals/{breakfast['id']}",
        json={
            "name": "Just the coffee",
            "items": [{"food_id": coffee["id"], "amount": 300, "unit": "ml"}],
        },
    )
    assert changed.status_code == 200
    assert changed.json()["name"] == "Just the coffee"
    assert [row["name"] for row in changed.json()["items"]] == ["Flat white"]

    answer = log_meal(client, breakfast).json()
    assert round(answer["entry"]["calories"], 4) == 180


def test_a_meal_is_deleted_and_what_was_logged_from_it_stays(client, breakfast):
    log_meal(client, breakfast)
    assert client.delete(f"/api/meals/{breakfast['id']}").status_code == 204
    assert client.get("/api/meals").json() == []
    # The line keeps its name and its numbers, and stops pointing at a meal
    # that is not there.
    day = entries(client)
    assert len(day) == 1
    assert (day[0]["name"], day[0]["meal_id"]) == ("Usual breakfast", None)
    assert round(day[0]["calories"], 4) == round(234 + 120, 4)


def test_a_meal_is_logged_into_a_meal_that_exists(client, breakfast):
    refused = client.post(f"/api/meals/{breakfast['id']}/log", json={"slot": "brunch"})
    assert refused.status_code == 400
    assert refused.json() == {"detail": BAD_SLOT}


def test_somebody_else_s_meal_is_absent_rather_than_refused(client, make_user, breakfast):
    make_user("stranger")
    sign_in(client, "stranger")

    assert client.get("/api/meals").json() == []
    theirs = client.get(f"/api/meals/{breakfast['id']}")
    absent = client.get("/api/meals/999999")
    assert theirs.status_code == absent.status_code == 404
    assert theirs.json() == absent.json() == {"detail": MISSING_MEAL}

    replaced = client.put(
        f"/api/meals/{breakfast['id']}",
        json={"name": "Mine now", "items": [{"food_id": 999999, "amount": 1, "unit": "g"}]},
    )
    assert replaced.status_code == 404
    assert client.delete(f"/api/meals/{breakfast['id']}").status_code == 404
    assert log_meal(client, breakfast).status_code == 404


def test_meals_need_a_session(client):
    assert client.get("/api/meals").status_code == 401
    body = {"name": "Breakfast", "items": []}
    assert client.post("/api/meals", json=body).status_code == 401
    assert client.get("/api/meals/1").status_code == 401
    assert client.put("/api/meals/1", json=body).status_code == 401
    assert client.delete("/api/meals/1").status_code == 401
    assert client.post("/api/meals/1/log", json={"slot": "lunch"}).status_code == 401


# ---- What the whole meal weighs, and logging a share of it ----

# Two slices at 45 g, and another hundred grams weighed out.
TOAST_GRAMS = 2 * 45 + 100
TOAST_CALORIES = 260 * TOAST_GRAMS / 100


@pytest.fixture()
def toast_plate(client, toast):
    """Bread twice: by its own serving, and weighed out."""
    serving = toast["servings"][0]["id"]
    made = client.post(
        "/api/meals",
        json={
            "name": "Toast plate",
            "items": [
                {"food_id": toast["id"], "amount": 2, "unit": f"serving:{serving}"},
                {"food_id": toast["id"], "amount": 100, "unit": "g"},
            ],
        },
    )
    assert made.status_code == 201
    return made.json()


def test_a_meal_weighs_what_its_items_weigh(client, toast_plate):
    assert toast_plate["weight_g"] == TOAST_GRAMS
    assert toast_plate["unweighed"] == []
    assert toast_plate["final_weight_g"] is None


def test_an_item_nothing_can_weigh_leaves_the_meal_unweighed(client, breakfast):
    # The coffee is poured and nothing gave its density, so 200 mL of it
    # weighs nothing anybody here knows.
    assert breakfast["weight_g"] is None
    assert breakfast["unweighed"] == ["Flat white"]


def test_a_meal_keeps_what_the_scale_said(client, toast, toast_plate):
    serving = toast["servings"][0]["id"]
    saved = client.put(
        f"/api/meals/{toast_plate['id']}",
        json={
            "name": "Toast plate",
            "final_weight_g": 180,
            "items": [
                {"food_id": toast["id"], "amount": 2, "unit": f"serving:{serving}"},
                {"food_id": toast["id"], "amount": 100, "unit": "g"},
            ],
        },
    )
    assert saved.status_code == 200
    assert saved.json()["final_weight_g"] == 180
    assert saved.json()["weight_g"] == TOAST_GRAMS


def test_a_meal_is_logged_by_what_the_scale_says(client, toast_plate):
    logged = log_meal(client, toast_plate, grams=95)
    assert logged.status_code == 201
    made = logged.json()["entry"]
    assert (made["amount"], made["unit"], made["serving_label"]) == (95, "g", None)
    assert round(made["calories"], 4) == round(TOAST_CALORIES * 95 / TOAST_GRAMS, 4)


def test_the_final_weight_beats_what_the_items_come_to(client, toast, toast_plate):
    serving = toast["servings"][0]["id"]
    client.put(
        f"/api/meals/{toast_plate['id']}",
        json={
            "name": "Toast plate",
            "final_weight_g": 100,
            "items": [
                {"food_id": toast["id"], "amount": 2, "unit": f"serving:{serving}"},
                {"food_id": toast["id"], "amount": 100, "unit": "g"},
            ],
        },
    )
    made = log_meal(client, toast_plate, grams=50).json()["entry"]
    # Half of what the scale said, whatever the items add up to.
    assert round(made["calories"], 4) == round(TOAST_CALORIES / 2, 4)


def test_a_meal_nothing_can_weigh_refuses_to_be_logged_by_weight(client, breakfast):
    refused = log_meal(client, breakfast, grams=100)
    assert refused.status_code == 400
    assert refused.json()["detail"] == NO_WEIGHT
