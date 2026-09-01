"""The one conversion every surface goes through.

Hand-computed figures throughout: a table that checks itself against its own
constants would pass with the constants wrong.
"""

import pytest

from app import models, units


def food(base_unit="g", density=None):
    return models.Food(base_unit=base_unit, density_g_per_ml=density)


def close(got, want):
    assert round(got, 4) == round(want, 4)


@pytest.mark.parametrize(
    ("amount", "unit", "grams"),
    [
        (1, "g", 1.0),
        (250, "g", 250.0),
        (1, "oz", 28.3495),
        (4, "oz", 113.398),
        (1, "lb", 453.592),
        (0.5, "lb", 226.796),
    ],
)
def test_mass_units_resolve_to_grams(amount, unit, grams):
    close(units.to_base(food(), amount, unit), grams)


@pytest.mark.parametrize(
    ("amount", "unit", "millilitres"),
    [
        (1, "ml", 1.0),
        (330, "ml", 330.0),
        (1, "floz", 29.5735),
        (8, "floz", 236.588),
        (1, "cup", 236.588),
        (1, "tbsp", 14.7868),
        (3, "tsp", 14.78676),
        (1, "l", 1000.0),
        (1, "gal", 3785.41),
        (0.25, "gal", 946.3525),
    ],
)
def test_volume_units_resolve_to_millilitres(amount, unit, millilitres):
    close(units.to_base(food("ml"), amount, unit), millilitres)


def test_a_measure_family_is_read_off_the_unit():
    assert [units.base_unit_of(u) for u in ("g", "oz", "lb")] == ["g", "g", "g"]
    assert [units.base_unit_of(u) for u in ("ml", "floz", "cup", "l")] == ["ml"] * 4


def test_crossing_is_the_unit_leaving_the_food_s_own_family():
    assert units.crosses_family(food("g"), "tbsp")
    assert units.crosses_family(food("ml"), "oz")
    assert not units.crosses_family(food("g"), "lb")
    assert not units.crosses_family(food("ml"), "cup")


def test_a_solid_measured_by_volume_goes_through_its_density():
    # Olive oil at 0.91 g per mL: 2 tbsp is 29.5736 mL, and that weighs 26.912 g.
    close(units.to_base(food("g", 0.91), 2, "tbsp"), 2 * 14.7868 * 0.91)
    close(units.to_base(food("g", 0.91), 2, "tbsp"), 26.9120)


def test_a_liquid_measured_by_weight_divides_by_its_density():
    # 100 g of the same oil takes up more room than 100 mL of water does.
    close(units.to_base(food("ml", 0.91), 100, "g"), 100 / 0.91)
    close(units.to_base(food("ml", 0.91), 100, "g"), 109.8901)


def test_without_a_density_water_is_assumed_exactly():
    # One millilitre weighs one gram, so the number is the number.
    close(units.to_base(food("g"), 240, "ml"), 240.0)
    close(units.to_base(food("ml"), 240, "g"), 240.0)
    close(units.to_base(food("g"), 1, "cup"), 236.588)
    close(units.to_base(food("ml"), 1, "lb"), 453.592)


def test_an_unknown_unit_is_taken_at_face_value():
    # Nothing types one of these in: the units come from a fixed list. Reading
    # it as one base unit keeps a stray value from resolving to zero, which
    # would be a silently empty portion rather than a visibly wrong one.
    close(units.to_base(food(), 7, "handful"), 7.0)
