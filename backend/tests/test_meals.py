"""Kept meals: a list of things to log, and what logging it comes to.

A meal holds no numbers of its own, so what these cases are mostly about is
when the numbers are worked out: at the moment the meal is logged, from the
foods as they stand then.
"""

import pytest

from app.routers.diary import BAD_SLOT
from app.routers.foods import MISSING_FOOD
from app.routers.meals import MISSING_MEAL
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


def log_meal(client, meal, slot="breakfast"):
    return client.post(f"/api/meals/{meal['id']}/log", json={"date": TODAY, "slot": slot})


def entries(client, slot="breakfast"):
    day = client.get("/api/diary/day", params={"date": TODAY}).json()
    return day["slots"][slot]["entries"]


def test_a_meal_is_a_list_of_things_to_log(client, breakfast):
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
            # Nothing in the diary says a meal was the reason for an entry, so
            # this list has no date to read. The key is sent all the same.
            "last_logged": None,
        }
    ]


def test_logging_a_meal_makes_one_entry_for_each_thing_in_it(client, breakfast):
    logged = log_meal(client, breakfast)
    assert logged.status_code == 201
    answer = logged.json()
    assert answer["skipped"] == []
    assert [row["name"] for row in answer["entries"]] == ["Sourdough", "Flat white"]

    # Two slices of 45 g at 260 calories per 100 g, and 200 mL at 60 per 100.
    assert round(answer["entries"][0]["calories"], 4) == round(260 * 0.9, 4)
    assert answer["entries"][0]["serving_label"] == "1 slice"
    assert round(answer["entries"][1]["calories"], 4) == 120
    assert len(entries(client)) == 2


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
    assert round(answer["entries"][1]["calories"], 4) == 60


def test_something_whose_food_has_gone_is_left_out_and_named(client, breakfast, toast):
    assert client.delete(f"/api/foods/{toast['id']}").status_code == 204

    answer = log_meal(client, breakfast).json()
    assert answer["skipped"] == ["Sourdough"]
    assert [row["name"] for row in answer["entries"]] == ["Flat white"]
    # The rest of the meal really was eaten, so the rest of it is logged.
    assert len(entries(client)) == 1


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
    assert round(answer["entries"][0]["calories"], 4) == 180


def test_a_meal_is_deleted_and_what_was_logged_from_it_stays(client, breakfast):
    log_meal(client, breakfast)
    assert client.delete(f"/api/meals/{breakfast['id']}").status_code == 204
    assert client.get("/api/meals").json() == []
    # The entries were ordinary entries the moment they were written.
    assert len(entries(client)) == 2


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
