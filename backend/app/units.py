"""How much of a food an amount is, whatever it was measured in.

A food declares one family, mass or volume, and its nutrition is stored per 100
of that family's base unit, the gram or the millilitre, so a liquid labelled in
millilitres never has to pretend it knows its own weight. Crossing the families
needs a density, which to_base takes from the label or, failing that, from
water. Every amount turned into nutrition comes through here, so one amount
cannot resolve two ways.
"""

from __future__ import annotations

from app import models

MASS_UNITS: dict[str, float] = {"g": 1.0, "oz": 28.3495, "lb": 453.592}
VOLUME_UNITS: dict[str, float] = {
    "ml": 1.0,
    "floz": 29.5735,
    "cup": 236.588,
    "tbsp": 14.7868,
    "tsp": 4.92892,
    "l": 1000.0,
    "gal": 3785.41,
}

# How many base units one of each unit is, both families in one table.
UNIT_TO_BASE: dict[str, float] = {**MASS_UNITS, **VOLUME_UNITS}

# What a millilitre weighs when the label never said. Water is right for milk,
# juice, broth and most of what a kitchen pours, and it is the assumption the
# screens name out loud whenever it is the one being used.
WATER_DENSITY = 1.0


def base_unit_of(unit: str) -> str:
    """The base unit a measurement unit belongs to."""
    return "ml" if unit in VOLUME_UNITS else "g"


def crosses_family(food: models.Food, unit: str) -> bool:
    """Whether measuring this food in this unit leaves its own family.

    What the screens ask before deciding whether to say that a density was
    assumed: a same-family amount needs no such sentence, because nothing was
    assumed to convert it.
    """
    return base_unit_of(unit) != food.base_unit


def to_base(food: models.Food, amount: float, unit: str) -> float:
    """`amount` of `unit` expressed in the food's own base unit."""
    base_amount = amount * UNIT_TO_BASE.get(unit, 1.0)
    if not crosses_family(food, unit):
        return base_amount
    density = food.density_g_per_ml or WATER_DENSITY
    # A millilitre of this food weighs `density` grams, so a gram of it takes
    # up 1/density millilitres.
    return base_amount * density if food.base_unit == "g" else base_amount / density


def to_grams(food: models.Food, amount: float, unit: str, base_amount: float) -> float | None:
    """What that much of this food weighs, or nothing when it cannot be weighed.

    A mass unit is a weight already, whatever the food is kept in. Anything
    else, a volume or one of the food's own servings, is a weight only when the
    food is kept by weight or when its label gave up a density. A pinch of
    something poured, with no density anywhere, weighs nothing anybody knows.
    """
    if unit in MASS_UNITS:
        return amount * MASS_UNITS[unit]
    if food.base_unit == "g":
        return base_amount
    density = food.density_g_per_ml
    return None if density is None else base_amount * density
