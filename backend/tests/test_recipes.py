"""Recipes: what a serving of one is worth, and what happens to what was eaten.

Hand-computed figures throughout, from two foods that behave differently: oats
that are weighed but measured out by the cup, which is the case that needs a
density, and milk that is poured and whose label never gave its sodium.
"""

import pytest

from app.routers.diary import BOTH_KINDS, NO_AMOUNT, RECIPE_NUTRIENTS, RECIPE_SERVINGS
from app.routers.foods import MISSING_FOOD
from app.recipes import MISSING_RECIPE
from tests.conftest import PASSWORD

TODAY = "2026-09-01"

# Two cups of oats: 473.176 mL, and a millilitre of them weighs 0.4 g.
OATS_BASE = 2 * 236.588 * 0.4
# 380 calories per 100 g of oats, and 42 per 100 mL of milk.
WHOLE_CALORIES = 380 * OATS_BASE / 100 + 42 * 500 / 100
WHOLE_PROTEIN = 13 * OATS_BASE / 100 + 3.4 * 500 / 100


def sign_in(client, username):
    response = client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200


@pytest.fixture()
def oats(client, signed_in):
    """Weighed, and light enough that a cup of them is nothing like a cup of water."""
    return client.post(
        "/api/foods",
        json={
            "name": "Rolled oats",
            "base_unit": "g",
            "density_g_per_ml": 0.4,
            "calories": 380,
            "protein_g": 13,
            "carbs_g": 67,
            "fat_g": 7,
            "sodium_mg": 5,
        },
    ).json()


@pytest.fixture()
def milk(client, signed_in):
    """Poured, and the label never said how much sodium is in it."""
    return client.post(
        "/api/foods",
        json={
            "name": "Whole milk",
            "brand": "Dairy",
            "base_unit": "ml",
            "calories": 42,
            "protein_g": 3.4,
            "carbs_g": 5,
            "fat_g": 1,
        },
    ).json()


@pytest.fixture()
def porridge(client, oats, milk):
    """Two cups of oats and half a litre of milk, making four servings."""
    made = client.post(
        "/api/recipes",
        json={
            "name": "Porridge",
            "yield_servings": 4,
            "ingredients": [
                {"food_id": oats["id"], "amount": 2, "unit": "cup"},
                {"food_id": milk["id"], "amount": 500, "unit": "ml"},
            ],
        },
    )
    assert made.status_code == 201
    return made.json()


def log_recipe(client, recipe, servings=1.5, slot="breakfast"):
    return client.post(
        "/api/diary",
        json={"date": TODAY, "slot": slot, "recipe_id": recipe["id"], "amount": servings},
    )


def only_entry(client):
    day = client.get("/api/diary/day", params={"date": TODAY}).json()
    entries = [row for slot in day["slots"].values() for row in slot["entries"]]
    assert len(entries) == 1
    return entries[0]


def test_a_serving_is_the_whole_recipe_shared_out(client, porridge):
    assert porridge["name"] == "Porridge"
    assert porridge["yield_servings"] == 4
    assert [row["name"] for row in porridge["ingredients"]] == ["Rolled oats", "Whole milk"]

    # The oats cross from volume into weight, which is the one figure here that
    # rests on a density: 473.176 mL at 0.4 g each is 189.2704 g.
    assert round(porridge["ingredients"][0]["calories"], 4) == round(380 * 1.892704, 4)
    assert porridge["ingredients"][1]["brand"] == "Dairy"
    assert round(porridge["ingredients"][1]["calories"], 4) == 210

    assert round(porridge["totals"]["calories"], 4) == round(WHOLE_CALORIES, 4)
    assert round(porridge["totals"]["protein_g"], 4) == round(WHOLE_PROTEIN, 4)
    assert round(porridge["per_serving"]["calories"], 4) == round(WHOLE_CALORIES / 4, 4)
    assert round(porridge["per_serving"]["protein_g"], 4) == round(WHOLE_PROTEIN / 4, 4)


def test_a_nutrient_one_ingredient_lacks_is_unknown_rather_than_smaller(client, porridge):
    # The oats give a sodium figure and the milk does not, so the recipe has an
    # unknown amount of sodium in it rather than the oats' share of it.
    assert porridge["ingredients"][0]["sodium_mg"] is not None
    assert porridge["ingredients"][1]["sodium_mg"] is None
    assert porridge["totals"]["sodium_mg"] is None
    assert porridge["per_serving"]["sodium_mg"] is None
    # And the four everything carries are still there.
    assert porridge["per_serving"]["fat_g"] is not None


def test_a_recipe_is_logged_by_the_serving(client, porridge):
    logged = log_recipe(client, porridge, 1.5)
    assert logged.status_code == 201
    made = logged.json()
    assert made["name"] == "Porridge"
    assert made["brand"] == ""
    assert (made["amount"], made["unit"], made["serving_label"]) == (1.5, "serving", "serving")
    assert made["food_id"] is None
    assert made["recipe_id"] == porridge["id"]
    assert round(made["calories"], 4) == round(WHOLE_CALORIES / 4 * 1.5, 4)
    assert round(made["protein_g"], 4) == round(WHOLE_PROTEIN / 4 * 1.5, 4)


def test_the_list_reads_by_what_a_serving_is_worth(client, porridge):
    rows = client.get("/api/recipes").json()
    assert len(rows) == 1
    assert rows[0]["name"] == "Porridge"
    assert rows[0]["yield_servings"] == 4
    assert round(rows[0]["per_serving"]["calories"], 4) == round(WHOLE_CALORIES / 4, 4)
    # A list is read by the four, and the other six are on the recipe itself.
    assert set(rows[0]["per_serving"]) == {"calories", "protein_g", "carbs_g", "fat_g"}


def test_the_recipe_list_leads_with_what_was_eaten_last(client, porridge, oats, milk):
    second = client.post(
        "/api/recipes",
        json={
            "name": "Overnight oats",
            "yield_servings": 2,
            "ingredients": [{"food_id": oats["id"], "amount": 1, "unit": "cup"}],
        },
    ).json()

    # The newer recipe leads while neither has been eaten.
    assert [row["name"] for row in client.get("/api/recipes").json()] == [
        "Overnight oats",
        "Porridge",
    ]
    assert [row["last_logged"] for row in client.get("/api/recipes").json()] == [None, None]

    assert log_recipe(client, porridge).status_code == 201
    rows = client.get("/api/recipes").json()
    assert [row["name"] for row in rows] == ["Porridge", "Overnight oats"]
    assert [row["last_logged"] for row in rows] == [TODAY, None]
    assert second["id"] == rows[1]["id"]


def test_editing_the_recipe_leaves_what_was_already_eaten_alone(client, porridge, oats, milk):
    log_recipe(client, porridge, 1.5)
    before = only_entry(client)

    changed = client.put(
        f"/api/recipes/{porridge['id']}",
        json={
            "name": "Porridge for two",
            "yield_servings": 2,
            "ingredients": [
                {"food_id": oats["id"], "amount": 2, "unit": "cup"},
                {"food_id": milk["id"], "amount": 500, "unit": "ml"},
            ],
        },
    )
    assert changed.status_code == 200
    assert round(changed.json()["per_serving"]["calories"], 4) == round(WHOLE_CALORIES / 2, 4)

    # The recipe changed. The porridge somebody already ate did not.
    assert only_entry(client) == before


def test_touching_a_logged_recipe_works_it_out_again(client, porridge, oats, milk):
    made = log_recipe(client, porridge, 1.5).json()
    client.put(
        f"/api/recipes/{porridge['id']}",
        json={
            "name": "Porridge",
            "yield_servings": 2,
            "ingredients": [
                {"food_id": oats["id"], "amount": 2, "unit": "cup"},
                {"food_id": milk["id"], "amount": 500, "unit": "ml"},
            ],
        },
    )

    changed = client.patch(f"/api/diary/{made['id']}", json={"amount": 1})
    assert changed.status_code == 200
    # One serving of what the recipe says now, not of what it said then.
    assert round(changed.json()["calories"], 4) == round(WHOLE_CALORIES / 2, 4)


def test_a_deleted_recipe_leaves_the_meal_standing(client, porridge):
    made = log_recipe(client, porridge, 1.5).json()
    assert client.delete(f"/api/recipes/{porridge['id']}").status_code == 204

    row = only_entry(client)
    assert row["name"] == "Porridge"
    assert row["calories"] == made["calories"]
    # The one thing that changed: there is nothing left to work it out from.
    assert row["recipe_id"] is None

    # So a new amount stretches what survived rather than recomputing it.
    changed = client.patch(f"/api/diary/{made['id']}", json={"amount": 3}).json()
    assert changed["amount"] == 3
    assert round(changed["calories"], 4) == round(WHOLE_CALORIES / 4 * 3, 4)


def test_a_logged_recipe_is_counted_in_servings_and_nothing_else(client, porridge):
    made = log_recipe(client, porridge, 1).json()

    unit = client.patch(f"/api/diary/{made['id']}", json={"amount": 2, "unit": "cup"})
    assert unit.status_code == 400
    assert unit.json() == {"detail": RECIPE_SERVINGS}

    typed = client.patch(f"/api/diary/{made['id']}", json={"calories": 5})
    assert typed.status_code == 400
    assert typed.json() == {"detail": RECIPE_NUTRIENTS}


def test_a_food_and_a_recipe_together_is_refused(client, porridge, oats):
    both = client.post(
        "/api/diary",
        json={
            "date": TODAY,
            "slot": "lunch",
            "food_id": oats["id"],
            "recipe_id": porridge["id"],
            "amount": 1,
            "unit": "g",
        },
    )
    assert both.status_code == 400
    assert both.json() == {"detail": BOTH_KINDS}

    assert client.post(
        "/api/diary", json={"slot": "lunch", "recipe_id": porridge["id"]}
    ).json() == {"detail": NO_AMOUNT}


def test_a_recipe_has_to_make_at_least_something(client, oats):
    nothing = client.post(
        "/api/recipes",
        json={
            "name": "Porridge",
            "yield_servings": 0,
            "ingredients": [{"food_id": oats["id"], "amount": 2, "unit": "cup"}],
        },
    )
    assert nothing.status_code == 400


def test_a_recipe_needs_a_name_and_a_workable_list(client, oats):
    blank = client.post(
        "/api/recipes",
        json={
            "name": "   ",
            "yield_servings": 4,
            "ingredients": [{"food_id": oats["id"], "amount": 2, "unit": "cup"}],
        },
    )
    assert blank.status_code == 400
    assert blank.json() == {"detail": "A recipe needs a name."}

    empty = client.post(
        "/api/recipes", json={"name": "Porridge", "yield_servings": 4, "ingredients": []}
    )
    assert empty.status_code == 400

    too_many = client.post(
        "/api/recipes",
        json={
            "name": "Porridge",
            "yield_servings": 4,
            "ingredients": [{"food_id": oats["id"], "amount": 1, "unit": "g"}] * 51,
        },
    )
    assert too_many.status_code == 400

    stray = client.post(
        "/api/recipes",
        json={
            "name": "Porridge",
            "yield_servings": 4,
            "ingredients": [{"food_id": 999999, "amount": 1, "unit": "g"}],
        },
    )
    assert stray.status_code == 404
    assert stray.json() == {"detail": MISSING_FOOD}


def test_an_ingredient_whose_food_has_gone_is_named(client, porridge, oats, milk):
    assert client.delete(f"/api/foods/{oats['id']}").status_code == 204

    refused = client.put(
        f"/api/recipes/{porridge['id']}",
        json={
            "name": "Porridge",
            "yield_servings": 4,
            "ingredients": [
                {"food_id": oats["id"], "amount": 2, "unit": "cup"},
                {"food_id": milk["id"], "amount": 500, "unit": "ml"},
            ],
        },
    )
    assert refused.status_code == 400
    assert refused.json() == {"detail": "Rolled oats is not there any more."}


def test_somebody_else_s_recipe_is_absent_rather_than_refused(client, make_user, porridge):
    make_user("stranger")
    sign_in(client, "stranger")

    assert client.get("/api/recipes").json() == []
    theirs = client.get(f"/api/recipes/{porridge['id']}")
    absent = client.get("/api/recipes/999999")
    assert theirs.status_code == absent.status_code == 404
    assert theirs.json() == absent.json() == {"detail": MISSING_RECIPE}

    replaced = client.put(
        f"/api/recipes/{porridge['id']}",
        json={
            "name": "Mine now",
            "yield_servings": 1,
            "ingredients": [{"food_id": 999999, "amount": 1, "unit": "g"}],
        },
    )
    assert replaced.status_code == 404
    assert replaced.json() == {"detail": MISSING_RECIPE}
    assert client.delete(f"/api/recipes/{porridge['id']}").status_code == 404
    assert client.post(
        "/api/diary", json={"slot": "lunch", "recipe_id": porridge["id"], "amount": 1}
    ).status_code == 404


def test_recipes_need_a_session(client):
    assert client.get("/api/recipes").status_code == 401
    body = {"name": "Porridge", "yield_servings": 4, "ingredients": []}
    assert client.post("/api/recipes", json=body).status_code == 401
    assert client.get("/api/recipes/1").status_code == 401
    assert client.put("/api/recipes/1", json=body).status_code == 401
    assert client.delete("/api/recipes/1").status_code == 401
