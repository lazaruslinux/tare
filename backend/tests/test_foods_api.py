"""The outbound lookups, with a transport under them instead of a network.

Nothing here opens a socket. Every response is one this file wrote, shaped like
the ones the two sources really send, so a case that fails is about the parsing
and never about somebody else's server being slow.
"""

import httpx
import pytest

from app import foods_api
from app.foods_api import FoodApiError, FoodResult

# One product as Open Food Facts answers for it, trimmed to the fields the
# client asks for. Sodium and cholesterol are in grams per 100 g there, which is
# the scaling this file checks.
OFF_PRODUCT = {
    "code": "034000002405",
    "status": 1,
    "product": {
        "product_name": "MILK CHOCOLATE BAR",
        "brands": "Hershey's, Hershey Company",
        "serving_size": "1 bar (43 g)",
        "serving_quantity": 43,
        "serving_quantity_unit": "g",
        "ingredients_text": "Sugar, milk, chocolate, cocoa butter, milk fat, lecithin.",
        "nutriments": {
            "energy-kcal_100g": 535,
            "proteins_100g": 7,
            "carbohydrates_100g": 58.1,
            "fat_100g": 32.6,
            "saturated-fat_100g": 18.6,
            "trans-fat_100g": 0,
            "cholesterol_100g": 0.023,
            "sodium_100g": 0.081,
            "fiber_100g": 2.3,
            "sugars_100g": 51.2,
        },
    },
}

USDA_HIT = {
    "fdcId": 1234567,
    "description": "MILK CHOCOLATE",
    "brandName": "HERSHEY'S",
    "gtinUpc": "00034000002405",
    "publishedDate": "2024-04-01",
    "servingSize": 43,
    "servingSizeUnit": "g",
    "householdServingFullText": "1 bar",
    "ingredients": "SUGAR, MILK, CHOCOLATE.",
    "foodNutrients": [
        {"nutrientNumber": "208", "value": 535},
        {"nutrientNumber": "203", "value": 7},
        {"nutrientNumber": "205", "value": 58.1},
        {"nutrientNumber": "204", "value": 32.6},
        {"nutrientNumber": "307", "value": 81},
        {"nutrientNumber": "269", "value": 51.2},
    ],
}


def transport(handler):
    """A client whose every request is answered by the function given."""
    return httpx.Client(transport=httpx.MockTransport(handler))


def answering(payload, status_code=200):
    def handler(request):
        return httpx.Response(status_code, json=payload)

    return handler


def result(**overrides):
    """A reading with only the fields a case is about, for the energy guard."""
    fields = {"source": "off", "source_id": "1", "name": "Thing", "brand": ""}
    fields.update(overrides)
    return FoodResult(**fields)


# ---- Open Food Facts ----


def test_a_product_reads_back_with_its_whole_panel():
    with transport(answering(OFF_PRODUCT)) as client:
        found = foods_api.lookup_off("034000002405", client)

    assert found is not None
    assert found.source == "off"
    assert found.source_id == "034000002405"
    # Shouted catalogue names are put back into ordinary case, and only the
    # first of the brands listed is the one on the front of the packet.
    assert found.name == "Milk Chocolate Bar"
    assert found.brand == "Hershey's"
    assert (found.calories, found.protein_g, found.carbs_g, found.fat_g) == (535, 7, 58.1, 32.6)
    assert found.fiber_g == 2.3
    assert found.ingredients_text.startswith("Sugar, milk")
    assert found.base_unit == "g"
    assert (found.serving, found.serving_amount) == ("1 bar (43 g)", 43)


def test_grams_per_hundred_become_the_milligrams_a_label_prints():
    with transport(answering(OFF_PRODUCT)) as client:
        found = foods_api.lookup_off("034000002405", client)

    assert found is not None
    # 0.023 g and 0.081 g per 100 g, which is what the label calls 23 mg and 81 mg.
    assert found.cholesterol_mg == 23
    assert found.sodium_mg == 81


def test_a_product_that_is_not_there_is_nothing_rather_than_an_error():
    with transport(answering({"status": 0, "status_verbose": "product not found"})) as client:
        assert foods_api.lookup_off("00000000", client) is None


def test_a_record_carrying_only_kilojoules_still_has_calories():
    payload = {
        "status": 1,
        "product": {"product_name": "Fizzy drink", "nutriments": {"energy-kj_100g": 180}},
    }
    with transport(answering(payload)) as client:
        found = foods_api.lookup_off("12345678", client)

    assert found is not None
    assert found.calories == 43.0


def test_a_source_that_will_not_answer_raises_the_one_error():
    def refuse(request):
        raise httpx.ConnectError("no route to host")

    with transport(refuse) as client, pytest.raises(FoodApiError):
        foods_api.lookup_off("034000002405", client)


def test_a_source_answering_with_a_fault_raises_the_one_error():
    with transport(answering({}, status_code=503)) as client, pytest.raises(FoodApiError):
        foods_api.lookup_off("034000002405", client)


# ---- USDA ----


def test_the_branded_set_is_asked_with_the_padded_code_first():
    asked = []

    def handler(request):
        asked.append(request.url.params["query"])
        return httpx.Response(200, json={"foods": [USDA_HIT]})

    with transport(handler) as client:
        found = foods_api.lookup_usda("034000002405", "a-key", client)

    assert found is not None
    assert found.name == "Milk Chocolate"
    assert found.brand == "Hershey's"
    # The barcode, not the catalogue's own id: this row is found again by the
    # code somebody scanned.
    assert found.source_id == "034000002405"
    assert found.sodium_mg == 81
    assert (found.serving, found.serving_amount) == ("1 bar", 43)
    # The padded form matched, so the bare one was never asked for.
    assert asked == ["00034000002405"]


def test_the_bare_code_is_asked_only_when_the_padded_one_missed():
    asked = []

    def handler(request):
        query = request.url.params["query"]
        asked.append(query)
        return httpx.Response(200, json={"foods": [USDA_HIT] if query == "034000002405" else []})

    with transport(handler) as client:
        found = foods_api.lookup_usda("034000002405", "a-key", client)

    assert found is not None
    assert asked == ["00034000002405", "034000002405"]


def test_a_hit_on_some_other_product_s_digits_does_not_count():
    other = {**USDA_HIT, "gtinUpc": "00034000009999"}
    with transport(answering({"foods": [other]})) as client:
        assert foods_api.lookup_usda("034000002405", "a-key", client) is None


def test_the_newest_printing_of_a_label_wins():
    older = {**USDA_HIT, "publishedDate": "2019-01-01", "description": "OLD WRAPPER"}
    newer = {**USDA_HIT, "publishedDate": "2025-06-01", "description": "NEW WRAPPER"}
    with transport(answering({"foods": [older, newer]})) as client:
        found = foods_api.lookup_usda("034000002405", "a-key", client)

    assert found is not None
    assert found.name == "New Wrapper"


def test_an_install_with_no_key_never_asks_the_branded_set():
    def handler(request):
        raise AssertionError(f"a request went out to {request.url}")

    with transport(handler) as client:
        assert foods_api.lookup_usda("034000002405", "", client) is None


def test_a_lookup_falls_through_to_the_other_source():
    def handler(request):
        if "openfoodfacts" in str(request.url):
            return httpx.Response(200, json=OFF_PRODUCT)
        return httpx.Response(200, json={"foods": []})

    with transport(handler) as client:
        found = foods_api.lookup("034000002405", "a-key", client)

    assert found is not None
    assert found.source == "off"


# ---- Servings and density ----


def test_a_serving_named_both_ways_gives_up_the_density():
    # "1 tbsp (14 g)": a spoon is 14.7868 ml, so this weighs 0.947 g per ml.
    measured = foods_api.measured_serving(14, "g", "1 tbsp (14 g)")
    assert measured.base_unit == "g"
    assert measured.amount == 14
    assert measured.density_g_per_ml == pytest.approx(0.9468, abs=0.001)


def test_a_serving_named_one_way_gives_up_nothing():
    measured = foods_api.measured_serving(43, "g", "1 bar (43 g)")
    assert measured.density_g_per_ml is None


def test_a_stated_volume_beats_a_unit_field_that_says_grams():
    # Labels routinely stamp a poured serving with a mass unit. The phrase is
    # the honest reading, so this is a drink measured in millilitres.
    measured = foods_api.measured_serving(30, "g", "2 tbsp (30 ml)")
    assert (measured.base_unit, measured.amount) == ("ml", 30)


def test_a_density_below_the_floor_is_not_reported():
    # 20 g in a cup is 0.085 g per ml: a reading that was misread, not a food.
    measured = foods_api.measured_serving(20, "g", "1 cup (20 g)")
    assert measured.density_g_per_ml is None


def test_a_density_above_the_ceiling_is_not_reported():
    # 60 g in a teaspoon is 12 g per ml. Nothing edible is that heavy.
    measured = foods_api.measured_serving(60, "g", "1 tsp (60 g)")
    assert measured.density_g_per_ml is None


def test_the_bounds_themselves_are_allowed():
    at_floor = foods_api.measured_serving(200, "g", "1 l (200 g)")
    at_ceiling = foods_api.measured_serving(3000, "g", "1 l (3000 g)")
    assert at_floor.density_g_per_ml == foods_api.DENSITY_MIN
    assert at_ceiling.density_g_per_ml == foods_api.DENSITY_MAX


def test_a_household_phrase_with_no_size_leaves_the_serving_unmeasured():
    measured = foods_api.measured_serving(None, None, "1 piece")
    assert (measured.base_unit, measured.amount) == ("g", None)


# ---- The energy guard ----


def test_a_row_whose_units_got_mixed_up_is_repaired():
    # Maple syrup: sugars alone account for 384 calories, and the record says 78.
    fixed = foods_api.repair_energy(
        result(calories=78, protein_g=0, carbs_g=96, fat_g=0, fiber_g=0, sugar_g=96)
    )
    assert fixed.calories == 384


def test_a_sugar_alcohol_label_is_left_exactly_as_it_stands():
    # Erythritol: high carbohydrate, almost no sugar, almost no energy, and
    # every one of those numbers is true. A floor built on carbohydrate would
    # push this to 392.
    fixed = foods_api.repair_energy(
        result(calories=20, protein_g=0, carbs_g=98, fat_g=0, fiber_g=0, sugar_g=0)
    )
    assert fixed.calories == 20


def test_nothing_is_ever_lowered():
    # A liqueur: alcohol carries seven calories a gram and appears in no column
    # here, so calories above the macronutrients are ordinary.
    fixed = foods_api.repair_energy(
        result(calories=320, protein_g=0, carbs_g=30, fat_g=0, fiber_g=0, sugar_g=30)
    )
    assert fixed.calories == 320


def test_a_record_with_no_sugars_figure_is_not_judged_at_all():
    fixed = foods_api.repair_energy(
        result(calories=10, protein_g=20, carbs_g=40, fat_g=10, sugar_g=None)
    )
    assert fixed.calories == 10


def test_a_floor_built_out_of_trace_figures_is_not_worth_acting_on():
    # Four calories against a floor of sixteen. Both are label rounding.
    fixed = foods_api.repair_energy(result(calories=4, protein_g=0, carbs_g=4, fat_g=0, sugar_g=4))
    assert fixed.calories == 4


def test_the_repair_allows_for_fibre_that_passes_through():
    # 4x2 + 4x60 + 9x1 is 257, less twice the 30 g of fibre.
    fixed = foods_api.repair_energy(
        result(calories=40, protein_g=2, carbs_g=60, fat_g=1, fiber_g=30, sugar_g=55)
    )
    assert fixed.calories == 197
