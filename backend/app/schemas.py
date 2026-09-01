"""The shapes the food and diary routes accept.

Everything a type can settle is settled here, so a body that cannot possibly be
a food is refused before a route sees it. What is left over is the rules a type
cannot express, and those live in the route with a sentence each.
"""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field

# A density outside this is not a food anybody eats: the lightest things poured
# in a kitchen sit near 0.6, and the heaviest syrups near 1.5. The bounds are
# wide enough to be wrong about, and narrow enough to catch a typed decimal
# point in the wrong place.
DENSITY_MIN = 0.2
DENSITY_MAX = 3.0

# Enough for a label's own list. Beyond this it is a recipe, not a food.
MAX_SERVINGS = 8


class ServingIn(BaseModel):
    name: str
    # In the food's base unit. Zero is not a serving, and a negative one is a
    # typo, so neither is a rounding question worth having later.
    base_amount: float = Field(gt=0)
    position: int = 0


class FoodIn(BaseModel):
    """One custom food, as it arrives from the form.

    The same body creates and edits, because the form is the same form. Every
    nutrient is optional here: which of them a private food must carry is the
    route's rule, not a type's.
    """

    name: str
    brand: str = ""
    base_unit: Literal["g", "ml"] = "g"
    density_g_per_ml: float | None = Field(default=None, ge=DENSITY_MIN, le=DENSITY_MAX)

    # Per 100 of the base unit. Negative nutrition is not a thing.
    calories: float | None = Field(default=None, ge=0)
    protein_g: float | None = Field(default=None, ge=0)
    carbs_g: float | None = Field(default=None, ge=0)
    fat_g: float | None = Field(default=None, ge=0)
    saturated_fat_g: float | None = Field(default=None, ge=0)
    trans_fat_g: float | None = Field(default=None, ge=0)
    cholesterol_mg: float | None = Field(default=None, ge=0)
    sodium_mg: float | None = Field(default=None, ge=0)
    fiber_g: float | None = Field(default=None, ge=0)
    sugar_g: float | None = Field(default=None, ge=0)

    ingredients_text: str = ""
    # None means the list was left out, which on an edit leaves the servings
    # alone. An empty list is a value: it means this food has none.
    servings: list[ServingIn] | None = Field(default=None, max_length=MAX_SERVINGS)


# Long enough for "serving:" and an id, and short enough that nothing else
# arrives in the field at all.
MAX_UNIT = 24


class DiaryIn(BaseModel):
    """One thing eaten: either a food measured out, or a name and its calories.

    Which of the two it is comes down to whether food_id is there. The route
    holds each shape to what it needs, because a type cannot say "these four
    together or those two, and not a mixture".
    """

    # Left out means today, wherever the account says it is.
    date: dt.date | None = None
    slot: str
    food_id: int | None = None
    # A unit from a measure family, or "serving:<id>" for one of the food's own.
    amount: float | None = Field(default=None, gt=0)
    unit: str | None = Field(default=None, max_length=MAX_UNIT)

    # The quick add. What was eaten, and what it was worth.
    name: str = ""
    calories: float | None = Field(default=None, ge=0)
    protein_g: float | None = Field(default=None, ge=0)
    carbs_g: float | None = Field(default=None, ge=0)
    fat_g: float | None = Field(default=None, ge=0)


class DiaryPatch(BaseModel):
    """A change to one entry. A field left out is left alone."""

    date: dt.date | None = None
    slot: str | None = None
    amount: float | None = Field(default=None, gt=0)
    unit: str | None = Field(default=None, max_length=MAX_UNIT)

    name: str | None = None
    calories: float | None = Field(default=None, ge=0)
    protein_g: float | None = Field(default=None, ge=0)
    carbs_g: float | None = Field(default=None, ge=0)
    fat_g: float | None = Field(default=None, ge=0)
