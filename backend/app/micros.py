"""The vitamins and minerals a Nutrition Facts panel may print, and what a day
of each of them is.

The list is the FDA's: the twenty-seven nutrients that have a Daily Value for
adults and children four and older, in the order a label prints them. The
figures are from 21 CFR 101.9 by way of the FDA's own reference guide, and they
are targets rather than advice: the app does arithmetic against them and says
so out loud.

Stored the way the panel is stored, per 100 of a food's base unit, in the unit
beside each row. Nothing per 100 ever reaches a screen; a screen scales it to
the portion it is showing.

frontend/src/lib/micros.ts is the mirror of this list, and a test holds the two
together.
"""

from __future__ import annotations

import dataclasses
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models import Food

# What the two sources call a nutrient, and what a day of it is.
#
#   off   the Open Food Facts nutriment stem, read as "<off>_100g". None where
#         Open Food Facts has no such nutrient at all, which is choline.
#   usda  FoodData Central nutrient numbers, the most exact first. Several
#         where a nutrient is filed under more than one definition and the
#         later ones are worth falling back to.
@dataclasses.dataclass(frozen=True)
class Micro:
    key: str
    label: str
    unit: str
    daily_value: float
    off: str | None
    usda: tuple[str, ...]


# The USDA numbers are the nutrient numbers FoodData Central prints on every
# record (the old NDB numbering), not the newer nutrient ids, which the API
# does not return in abridged or search results. Vitamin D keeps the IU
# reading as a fallback; it is the one vitamin with a fixed IU to mcg factor.
CATALOG: tuple[Micro, ...] = (
    Micro("vitamin_a", "Vitamin A", "mcg", 900, "vitamin-a", ("320",)),
    Micro("vitamin_c", "Vitamin C", "mg", 90, "vitamin-c", ("401",)),
    Micro("vitamin_d", "Vitamin D", "mcg", 20, "vitamin-d", ("328", "324")),
    Micro("vitamin_e", "Vitamin E", "mg", 15, "vitamin-e", ("323",)),
    Micro("vitamin_k", "Vitamin K", "mcg", 120, "vitamin-k", ("430",)),
    Micro("thiamin", "Thiamin", "mg", 1.2, "vitamin-b1", ("404",)),
    Micro("riboflavin", "Riboflavin", "mg", 1.3, "vitamin-b2", ("405",)),
    Micro("niacin", "Niacin", "mg", 16, "vitamin-pp", ("406",)),
    Micro("vitamin_b6", "Vitamin B6", "mg", 1.7, "vitamin-b6", ("415",)),
    # Folate is counted as dietary folate equivalents on a label. Total folate
    # is the fallback: the same microgrammes under a looser definition, which
    # is nearer the truth than leaving the row empty.
    Micro("folate", "Folate", "mcg", 400, "vitamin-b9", ("435", "417")),
    Micro("vitamin_b12", "Vitamin B12", "mcg", 2.4, "vitamin-b12", ("418",)),
    Micro("biotin", "Biotin", "mcg", 30, "biotin", ("416",)),
    Micro("pantothenic_acid", "Pantothenic acid", "mg", 5, "pantothenic-acid", ("410",)),
    Micro("choline", "Choline", "mg", 550, None, ("421",)),
    Micro("calcium", "Calcium", "mg", 1300, "calcium", ("301",)),
    Micro("iron", "Iron", "mg", 18, "iron", ("303",)),
    Micro("potassium", "Potassium", "mg", 4700, "potassium", ("306",)),
    Micro("magnesium", "Magnesium", "mg", 420, "magnesium", ("304",)),
    Micro("zinc", "Zinc", "mg", 11, "zinc", ("309",)),
    Micro("phosphorus", "Phosphorus", "mg", 1250, "phosphorus", ("305",)),
    Micro("iodine", "Iodine", "mcg", 150, "iodine", ("314",)),
    Micro("selenium", "Selenium", "mcg", 55, "selenium", ("317",)),
    Micro("copper", "Copper", "mg", 0.9, "copper", ("312",)),
    Micro("manganese", "Manganese", "mg", 2.3, "manganese", ("315",)),
    Micro("chromium", "Chromium", "mcg", 35, "chromium", ("310",)),
    # No FoodData Central record found that carries it, so no number yet.
    Micro("molybdenum", "Molybdenum", "mcg", 45, "molybdenum", ()),
    # Filed by FoodData Central under the element's name, Chlorine, Cl.
    Micro("chloride", "Chloride", "mg", 2300, "chloride", ("302",)),
)

KEYS: tuple[str, ...] = tuple(micro.key for micro in CATALOG)
BY_KEY: dict[str, Micro] = {micro.key: micro for micro in CATALOG}

# What one of each unit is in grams, which is the unit both sources report a
# hundred grammes of a food in.
PER_GRAM = {"g": 1.0, "mg": 1e3, "mcg": 1e6}

# Every spelling a source uses for the same three units. Anything else, an
# international unit above all, is a reading this app cannot convert without
# knowing which compound it was measured as, so it is dropped rather than
# guessed at.
UNIT_NAMES = {
    "g": "g",
    "gram": "g",
    "grams": "g",
    "mg": "mg",
    "mg_ate": "mg",
    "mg_ne": "mg",
    "milligram": "mg",
    "milligrams": "mg",
    "mcg": "mcg",
    "ug": "mcg",
    "µg": "mcg",
    "mcg_dfe": "mcg",
    "mcg_re": "mcg",
    "mcg_rae": "mcg",
    "microgram": "mcg",
    "micrograms": "mcg",
}


def convert(value: float, unit: str, key: str) -> float | None:
    """A reading in whatever the source measured it in, in the unit stored here.

    Nothing when the unit is not one of the three, which keeps an international
    unit from being written down as though it were a microgramme.
    """
    named = UNIT_NAMES.get(unit.strip().lower())
    micro = BY_KEY.get(key)
    if named is None or micro is None:
        return None
    grams = value / PER_GRAM[named]
    return round(grams * PER_GRAM[micro.unit], 4)


def percent_dv(key: str, amount: float) -> int:
    """How much of a day that much of a nutrient is, as a whole number."""
    micro = BY_KEY[key]
    return round(amount / micro.daily_value * 100)


def clean(micros: object) -> dict[str, float]:
    """A stored reading as this app is willing to hand it back: known keys,
    real numbers, nothing negative, in catalogue order."""
    if not isinstance(micros, dict):
        return {}
    kept: dict[str, float] = {}
    for key in KEYS:
        value = micros.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0:
            kept[key] = float(value)
    return kept


def fill_empty(food: Food, found: dict[str, float], source: str, ref: str) -> list[str]:
    """Write onto a food the keys it has none of, and say which they were.

    Only the empty ones, ever. A reading already on the row was put there by a
    source that was chosen over this one, or by an administrator, and neither is
    something a later pass gets to overwrite. The ten panel figures are not
    touched here at all: they live in their own columns.
    """
    held = clean(food.micros)
    added = [key for key in KEYS if key in found and key not in held]
    if not added:
        return []
    food.micros = {**held, **{key: found[key] for key in added}}
    # Credited to whoever supplied the most of what is now on the row, so one
    # filled mostly from elsewhere is not named after whichever ran last.
    if food.micros_source is None or len(added) > len(held):
        food.micros_source = source
        food.micros_ref = ref[:32]
    return added
