"""The vitamins and minerals: the catalogue, the two readers, the backfill, and
the one screen an administrator decides from.

Nothing here opens a socket. Every answer from Open Food Facts and FoodData
Central is one this file wrote, so a case that fails is about the parsing rather
than about somebody else's server.
"""

import re
from pathlib import Path

import httpx
import pytest

from app import foods_api, micros, micros_backfill, models, usda_api
from app.config import settings
from app.foods_api import FoodApiError
from tests.conftest import PASSWORD

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "micros.ts"

CODE = "0038000391323"

# The ten a panel carries, so a case can prove the backfill left them alone.
PANEL = {
    "calories": 380,
    "protein_g": 6,
    "carbs_g": 86,
    "fat_g": 3,
    "saturated_fat_g": 0.5,
    "trans_fat_g": 0,
    "cholesterol_mg": 0,
    "sodium_mg": 480,
    "fiber_g": 7,
    "sugar_g": 30,
}

# Open Food Facts states every nutrient per hundred grammes in grams, and puts
# the unit beside it. Vitamin A here is 517.2 mcg, iron 15.52 mg.
OFF_NUTRIMENTS = {
    "energy-kcal_100g": 380,
    "vitamin-a_100g": 0.0005172,
    "vitamin-a_unit": "g",
    "vitamin-c_100g": 0.0517,
    "vitamin-c_unit": "g",
    "iron_100g": 0.01552,
    "iron_unit": "g",
    # No unit at all, which is read as the grams Open Food Facts stores in.
    "calcium_100g": 0.13,
    # A unit this app cannot convert without knowing the compound.
    "vitamin-d_100g": 400,
    "vitamin-d_unit": "IU",
}

OFF_PRODUCT = {
    "code": CODE,
    "status": 1,
    "product": {
        "product_name": "Sweetened cereal",
        "brands": "Kellogg's",
        "serving_size": "1 cup (29 g)",
        "serving_quantity": 29,
        "serving_quantity_unit": "g",
        "nutriments": OFF_NUTRIMENTS,
    },
}

# FoodData Central answers a search with the nutrients flattened, and one whole
# food with them nested under 'nutrient'. Both shapes are read.
USDA_SEARCH = {
    "foods": [
        {
            "fdcId": 999001,
            "description": "Cereal, sweetened",
            "dataType": "Branded",
            "gtinUpc": "00038000391323",
            "foodNutrients": [
                {"nutrientNumber": "301", "unitName": "MG", "value": 130},
                {"nutrientNumber": "421", "unitName": "MG", "value": 20},
                {"nutrientNumber": "320", "unitName": "UG", "value": 517.2},
            ],
        }
    ]
}

USDA_FOOD = {
    "fdcId": 999002,
    "description": "Broccoli, raw",
    "dataType": "Foundation",
    "foodNutrients": [
        {"nutrient": {"number": "401", "unitName": "mg"}, "amount": 91.3},
        {"nutrient": {"number": "301", "unitName": "mg"}, "amount": 46},
        {"nutrient": {"number": "417", "unitName": "ug"}, "amount": 63},
        # Not in the catalogue, so it is dropped rather than stored.
        {"nutrient": {"number": "307", "unitName": "mg"}, "amount": 33},
    ],
}

USDA_NAMES = {
    "foods": [
        {"fdcId": 999002, "description": "Broccoli, raw", "dataType": "Foundation"},
        {"fdcId": 999003, "description": "Broccoli, cooked", "dataType": "SR Legacy"},
    ]
}


@pytest.fixture()
def usda_key():
    """A key, so the FoodData Central half of anything is allowed to run."""
    was = settings.usda_api_key
    settings.usda_api_key = "test-key"
    yield
    settings.usda_api_key = was


def transport(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def answering(payload):
    def handler(request):
        return httpx.Response(200, json=payload)

    return handler


@pytest.fixture()
def sources(monkeypatch, usda_key):
    """Both servers, answered from this file, and every address they were asked."""
    seen: list[str] = []

    def route(request):
        seen.append(str(request.url))
        if "openfoodfacts" in str(request.url):
            return httpx.Response(200, json=OFF_PRODUCT)
        if "/fdc/v1/food/" in str(request.url):
            return httpx.Response(200, json=USDA_FOOD)
        if "gtinUpc" in str(request.url) or "Branded" in str(request.url):
            return httpx.Response(200, json=USDA_SEARCH)
        return httpx.Response(200, json=USDA_NAMES)

    monkeypatch.setattr(foods_api, "session", lambda: transport(route))
    monkeypatch.setattr(usda_api, "session", lambda: transport(route))
    monkeypatch.setattr(micros_backfill, "PAUSE", 0)
    return seen


def put_food(db, **fields):
    food = models.Food(**{"base_unit": "g", **PANEL, **fields})
    db.add(food)
    db.commit()
    return food


# ---- The catalogue


def test_the_catalogue_is_the_twenty_seven_with_a_day_of_each():
    assert len(micros.CATALOG) == 27
    assert len(set(micros.KEYS)) == 27
    assert all(entry.daily_value > 0 for entry in micros.CATALOG)
    assert all(entry.unit in ("mcg", "mg") for entry in micros.CATALOG)
    # Every nutrient has somewhere to come from; molybdenum has no USDA number yet.
    assert all(entry.usda or entry.off for entry in micros.CATALOG)


def test_the_frontend_mirror_says_the_same_thing():
    """The screen and the server have to agree about the list, its order, its
    units and what a day of each is."""
    source = FRONTEND.read_text(encoding="utf-8")
    rows = re.findall(
        r"\{ key: '([a-z0-9_]+)', label: '([^']+)', unit: '([a-z]+)', dv: ([0-9.]+) \}",
        source,
    )
    assert [
        (entry.key, entry.label, entry.unit, entry.daily_value) for entry in micros.CATALOG
    ] == [(key, label, unit, float(dv)) for key, label, unit, dv in rows]


def test_a_reading_in_a_unit_this_app_cannot_carry_is_dropped():
    assert micros.convert(1, "g", "vitamin_a") == 1e6
    assert micros.convert(1, "MG", "calcium") == 1
    assert micros.convert(517.2, "UG", "vitamin_a") == 517.2
    assert micros.convert(400, "IU", "vitamin_d") is None


# ---- Open Food Facts


def test_open_food_facts_readings_land_in_the_catalogue_units():
    found = foods_api.read_micros(OFF_NUTRIMENTS)
    assert found["vitamin_a"] == 517.2
    assert found["vitamin_c"] == 51.7
    assert found["iron"] == 15.52
    # No unit beside it, so grams, which is what Open Food Facts stores in.
    assert found["calcium"] == 130
    # An international unit is not a microgramme, so the row stays empty.
    assert "vitamin_d" not in found


def test_a_lookup_carries_its_vitamins_along_with_the_panel():
    result = foods_api.lookup_off(CODE, transport(answering(OFF_PRODUCT)))
    assert result is not None
    assert result.calories == 380
    assert result.micros["vitamin_a"] == 517.2


def test_a_scan_writes_the_vitamins_onto_the_cache_row(client, db_session, signed_in, monkeypatch):
    monkeypatch.setattr(foods_api, "session", lambda: transport(answering(OFF_PRODUCT)))
    body = client.get(f"/api/barcode/{CODE}").json()
    assert body["state"] == "prefill"
    # And the form is handed them, per 100, to scale to the serving it shows.
    assert body["prefill"]["micros"]["vitamin_a"] == 517.2
    row = db_session.query(models.Food).filter_by(status="cache", barcode=CODE).one()
    assert row.micros["vitamin_a"] == 517.2
    assert row.micros_source == "off"
    assert row.micros_ref == CODE


def test_a_member_scanning_never_reaches_food_data_central(
    client, db_session, signed_in, monkeypatch, usda_key
):
    """His rule: a scan is Open Food Facts and nothing else, key or no key."""
    seen: list[str] = []

    def route(request):
        seen.append(str(request.url))
        if "nal.usda.gov" in str(request.url):
            raise AssertionError("a scan reached FoodData Central")
        return httpx.Response(200, json=OFF_PRODUCT)

    monkeypatch.setattr(foods_api, "session", lambda: transport(route))
    client.get(f"/api/barcode/{CODE}")
    assert seen and all("openfoodfacts" in address for address in seen)


# ---- FoodData Central


def test_food_data_central_readings_are_read_from_either_shape():
    flat = usda_api.read_micros(USDA_SEARCH["foods"][0])
    assert flat == {"vitamin_a": 517.2, "choline": 20, "calcium": 130}

    nested = usda_api.read_micros(USDA_FOOD)
    assert nested["vitamin_c"] == 91.3
    assert nested["calcium"] == 46
    # Folate under the fallback definition, because the record has no DFE line.
    assert nested["folate"] == 63
    # Sodium is a panel figure and never a micro.
    assert len(nested) == 3


def test_a_barcode_search_asks_for_the_padded_number_first(usda_key):
    asked: list[str] = []

    def route(request):
        asked.append(str(request.url))
        return httpx.Response(200, json=USDA_SEARCH)

    found = usda_api.search_by_barcode("38000391323", transport(route))
    assert found is not None and found["fdcId"] == 999001
    assert "query=00038000391323" in asked[0]


def test_food_data_central_is_refused_without_a_key():
    with pytest.raises(FoodApiError):
        usda_api.search_by_name("broccoli", transport(answering(USDA_NAMES)))


# ---- The backfill


def test_the_backfill_takes_open_food_facts_first_and_leaves_the_panel_alone(
    db_session, sources
):
    food = put_food(db_session, status="approved", name="Sweetened cereal", barcode=CODE)

    filled, skipped, _ = micros_backfill.barcoded_pass(db_session, None)
    db_session.refresh(food)

    assert filled == 1 and skipped == 0
    assert food.micros["vitamin_a"] == 517.2
    # Open Food Facts had no choline; FoodData Central filled that one alone.
    assert food.micros["choline"] == 20
    assert food.micros_source == "off"
    # And the ten a label was read for are exactly as they were.
    assert food.calories == 380 and food.sodium_mg == 480


def test_a_reading_already_on_a_food_is_never_written_over(db_session):
    food = models.Food(status="approved", name="Broccoli", base_unit="g", **PANEL)
    food.micros = {"calcium": 5}

    added = micros.fill_empty(food, {"calcium": 46, "vitamin_c": 91.3}, "usda", "999002")

    assert added == ["vitamin_c"]
    assert food.micros == {"calcium": 5, "vitamin_c": 91.3}


def test_running_the_backfill_again_changes_nothing(db_session, sources):
    put_food(db_session, status="approved", name="Sweetened cereal", barcode=CODE)
    micros_backfill.barcoded_pass(db_session, None)
    was = db_session.query(models.Food).one().micros

    filled, _, _ = micros_backfill.barcoded_pass(db_session, None)
    assert filled == 0
    assert db_session.query(models.Food).one().micros == was


def test_a_food_measured_in_millilitres_without_a_density_is_skipped(db_session, sources):
    put_food(db_session, status="approved", name="Sports drink", base_unit="ml")
    queued, skipped, notes = micros_backfill.name_pass(db_session, False, None)
    assert queued == 0 and skipped == 1
    assert "no density" in " ".join(notes)
    assert db_session.query(models.MicroMatch).count() == 0


def test_a_food_without_a_barcode_is_queued_for_somebody_to_match(db_session, sources):
    food = put_food(db_session, status="approved", name="Broccoli")
    queued, _, _ = micros_backfill.name_pass(db_session, False, None)

    assert queued == 1
    match = db_session.query(models.MicroMatch).one()
    assert match.food_id == food.id and match.status == "pending"
    assert [row["fdc_id"] for row in match.candidates] == [999002, 999003]

    # And it is not asked about twice.
    assert micros_backfill.name_pass(db_session, False, None)[0] == 0


def test_nothing_is_queued_without_a_key(db_session, monkeypatch):
    put_food(db_session, status="approved", name="Broccoli")
    monkeypatch.setattr(settings, "usda_api_key", "")
    queued, skipped, notes = micros_backfill.name_pass(db_session, False, None)
    assert queued == 0 and skipped == 1
    assert "USDA_API_KEY" in " ".join(notes)


# ---- The picker


def queued_match(db, food_name="Broccoli"):
    food = models.Food(status="approved", name=food_name, base_unit="g", **PANEL)
    db.add(food)
    db.commit()
    match = models.MicroMatch(
        food_id=food.id,
        candidates=[
            {"fdc_id": 999002, "description": "Broccoli, raw", "data_type": "Foundation"}
        ],
        status="pending",
    )
    db.add(match)
    db.commit()
    return food, match


def test_an_administrator_reads_what_is_waiting(admin_client, db_session, sources):
    food, _ = queued_match(db_session)
    rows = admin_client.get("/api/admin/micro-matches").json()
    assert [row["name"] for row in rows] == [food.name]
    assert rows[0]["candidates"][0]["fdc_id"] == 999002


def test_applying_fills_the_food_and_writes_a_line_in_the_log(
    admin_client, db_session, sources
):
    food, match = queued_match(db_session)
    answer = admin_client.post(
        f"/api/admin/micro-matches/{match.id}/apply", json={"fdc_id": 999002}
    )
    assert answer.status_code == 200
    db_session.refresh(food)
    db_session.refresh(match)

    assert food.micros["vitamin_c"] == 91.3
    assert food.micros_source == "usda" and food.micros_ref == "999002"
    assert food.calories == 380
    assert match.status == "applied" and match.decided_by_id is not None
    assert db_session.query(models.ReviewLog).filter_by(action="micros_applied").count() == 1


def test_a_record_that_was_never_offered_is_refused(admin_client, db_session, sources):
    _, match = queued_match(db_session)
    answer = admin_client.post(
        f"/api/admin/micro-matches/{match.id}/apply", json={"fdc_id": 4}
    )
    assert answer.status_code == 400


def test_skipping_keeps_the_row_so_the_backfill_does_not_ask_again(
    admin_client, db_session, sources
):
    _, match = queued_match(db_session)
    assert admin_client.post(f"/api/admin/micro-matches/{match.id}/skip").status_code == 200
    db_session.refresh(match)
    assert match.status == "skipped"
    assert micros_backfill.name_pass(db_session, False, None)[0] == 0
    # Until it is asked for again, and then it is one question rather than two.
    assert micros_backfill.name_pass(db_session, True, None)[0] == 1
    assert db_session.query(models.MicroMatch).count() == 1


def test_nobody_but_an_administrator_sees_any_of_it(client, db_session, make_user):
    make_user("plain")
    assert (
        client.post("/api/auth/login", json={"username": "plain", "password": PASSWORD})
    ).status_code == 200
    _, match = queued_match(db_session)
    assert client.get("/api/admin/micro-matches").status_code == 403
    assert client.post(f"/api/admin/micro-matches/{match.id}/skip").status_code == 403
    assert (
        client.post(f"/api/admin/micro-matches/{match.id}/apply", json={"fdc_id": 999002})
    ).status_code == 403


# ---- What a food hands the screen


def test_a_food_is_read_with_its_vitamins_per_hundred(client, db_session, signed_in):
    food = put_food(db_session, status="approved", name="Broccoli")
    food.micros = {"vitamin_c": 91.3, "not_a_nutrient": 5}
    db_session.commit()

    body = client.get(f"/api/foods/{food.id}").json()
    # Only the keys the catalogue knows.
    assert body["micros"] == {"vitamin_c": 91.3}


def test_a_food_nobody_has_filled_hands_back_nothing(client, db_session, signed_in):
    food = put_food(db_session, status="approved", name="Kitchen granola")
    assert client.get(f"/api/foods/{food.id}").json()["micros"] == {}


# ---- What a day comes to

DAY = "2026-09-01"


def with_micros(client, db, name, found, **fields):
    """A food somebody can log, with vitamins written onto it afterwards."""
    response = client.post(
        "/api/foods",
        json={
            "name": name,
            "base_unit": "g",
            "calories": 100,
            "protein_g": 5,
            "carbs_g": 10,
            "fat_g": 2,
            **fields,
        },
    )
    assert response.status_code == 201
    made = response.json()
    food = db.get(models.Food, made["id"])
    food.micros = found
    db.commit()
    return made


def logged(client, **body):
    sent = {"date": DAY, "slot": "breakfast"}
    sent.update(body)
    response = client.post("/api/diary", json=sent)
    assert response.status_code == 201
    return response.json()


def day_micros(client, date=DAY):
    return client.get("/api/diary/day", params={"date": date}).json()["micros"]


def test_a_day_scales_each_food_s_vitamins_by_the_portion(client, db_session, signed_in):
    broccoli = with_micros(client, db_session, "Broccoli", {"vitamin_c": 89.2, "calcium": 47})
    cereal = with_micros(
        client,
        db_session,
        "Fortified cereal",
        {"vitamin_c": 20, "iron": 8},
        servings=[{"name": "1 cup", "amount": 40, "unit": "g", "position": 0}],
    )
    cup = cereal["servings"][0]["id"]

    logged(client, food_id=broccoli["id"], amount=150, unit="g")
    logged(client, food_id=cereal["id"], amount=2, unit=f"serving:{cup}")

    found = day_micros(client)
    # 150 g of the one, 80 g of the other, and the keys in catalogue order.
    assert list(found) == ["vitamin_c", "calcium", "iron"]
    assert found["vitamin_c"] == pytest.approx(133.8 + 16)
    assert found["calcium"] == pytest.approx(70.5)
    assert found["iron"] == pytest.approx(6.4)


def test_a_day_reads_its_vitamins_from_the_food_as_it_stands_now(client, db_session, signed_in):
    """Nothing is copied onto an entry, so a food filled in later fills in
    every day it was already eaten on."""
    food = with_micros(client, db_session, "Broccoli", {})
    logged(client, food_id=food["id"], amount=100, unit="g")
    assert day_micros(client) == {}

    db_session.get(models.Food, food["id"]).micros = {"vitamin_c": 89.2}
    db_session.commit()
    assert day_micros(client) == {"vitamin_c": 89.2}


def test_a_recipe_entry_counts_what_went_into_the_pot(client, db_session, signed_in):
    broccoli = with_micros(client, db_session, "Broccoli", {"vitamin_c": 89.2})
    cereal = with_micros(client, db_session, "Fortified cereal", {"vitamin_c": 20, "iron": 8})
    recipe = client.post(
        "/api/recipes",
        json={
            "name": "Breakfast bowl",
            "yield_servings": 4,
            "ingredients": [
                {"food_id": broccoli["id"], "amount": 200, "unit": "g"},
                {"food_id": cereal["id"], "amount": 100, "unit": "g"},
            ],
        },
    ).json()

    logged(client, recipe_id=recipe["id"], amount=1.5)

    found = day_micros(client)
    # The whole pot is 198.4 mg of vitamin C and 8 mg of iron; a serving is a
    # quarter of it, and one and a half servings were eaten.
    assert found["vitamin_c"] == pytest.approx(198.4 * 1.5 / 4)
    assert found["iron"] == pytest.approx(8 * 1.5 / 4)


def test_a_quick_add_and_a_food_that_has_gone_add_nothing(client, db_session, signed_in):
    broccoli = with_micros(client, db_session, "Broccoli", {"vitamin_c": 89.2})
    logged(client, food_id=broccoli["id"], amount=100, unit="g")
    logged(client, name="Flat white", calories=120)
    assert day_micros(client) == {"vitamin_c": 89.2}

    assert client.delete(f"/api/foods/{broccoli['id']}").status_code == 204
    # The entry stands with the calories it was logged at, and says nothing
    # about vitamins any more.
    assert day_micros(client) == {}


def test_one_diary_s_vitamins_are_nobody_else_s(client, db_session, signed_in, make_user):
    broccoli = with_micros(client, db_session, "Broccoli", {"vitamin_c": 89.2})
    logged(client, food_id=broccoli["id"], amount=100, unit="g")

    make_user("stranger")
    assert (
        client.post("/api/auth/login", json={"username": "stranger", "password": PASSWORD})
    ).status_code == 200
    assert day_micros(client) == {}
