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
    # As it was typed, in the unit beside it. Zero is not a serving, and a
    # negative one is a typo, so neither is a rounding question worth having
    # later. What it comes to in the food's base unit is the server's sum: a
    # client that could send its own could disagree with the label it read.
    amount: float = Field(gt=0)
    unit: str
    position: int = 0


class FoodIn(BaseModel):
    """One custom food, as it arrives from the form.

    The same body creates and edits, because the form is the same form. Every
    nutrient is optional here: which of them a private food must carry is the
    route's rule, not a type's.
    """

    name: str
    brand: str = ""
    # The short line under the name. Left out is the same as blank: most foods
    # have nothing to add to their own name.
    description: str = ""
    # The aisle it would be found in, as a slug. Blank is a food nobody has
    # put anywhere, which is every private one: only a food headed for the
    # shared database is asked.
    section: str = ""
    base_unit: Literal["g", "ml"] = "g"
    density_g_per_ml: float | None = Field(default=None, ge=DENSITY_MIN, le=DENSITY_MAX)
    # The code the form was filled in from, kept with the food so the next scan
    # of that packet is answered from here. Set when a food is created and
    # ignored on an edit: a code that moves is a code the scanner cannot trust.
    barcode: str | None = None

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
    added_sugars_g: float | None = Field(default=None, ge=0)

    ingredients_text: str = ""
    # None means the list was left out, which on an edit leaves the servings
    # alone. An empty list is a value: it means this food has none.
    servings: list[ServingIn] | None = Field(default=None, max_length=MAX_SERVINGS)
    # The food's stamp as the form loaded it. Sent back on an edit so one
    # written against an older copy is refused rather than applied over
    # somebody else's. Left out is accepted: creating a food has nothing to
    # compare against, and neither does an owner editing their own.
    as_of: dt.datetime | None = None


# Enough for a paragraph either way, and no more. A reviewer reads these in a
# list, and a note nobody finishes reading is a note nobody reads.
MAX_NOTE = 500


class SubmissionIn(FoodIn):
    """A food offered to the shared database.

    The same form as a private food, with the two things only a shared one
    has: the picture of the label somebody took, and a word for whoever reviews
    it. Which of the nutrients are needed is the route's rule and a stricter one
    than a private food's, because everybody eats out of what this becomes.
    """

    photo_id: int | None = None
    # The nutrition panel, for whoever reviews this. Needed on anything with a
    # barcode on it, because a packaged food has a panel printed on the back.
    label_photo_id: int | None = None
    note: str = Field(default="", max_length=MAX_NOTE)


class FoodPhotoIn(BaseModel):
    """A picture put on a food: the front of the pack, or its panel.

    The front is what anybody may attach to a food of their own. The panel is
    an administrator's, on a food everybody eats out of.
    """

    photo_id: int
    purpose: str = "front"


class DishPhotoIn(BaseModel):
    """A picture of the finished dish, put on a recipe or a kept meal.

    No purpose to say: there is one kind of picture a dish carries, and it is
    private to the member who took it.
    """

    photo_id: int


class SubmitIn(BaseModel):
    """One food already kept privately, offered as it stands."""

    photo_id: int | None = None
    label_photo_id: int | None = None
    note: str = Field(default="", max_length=MAX_NOTE)


class EditIn(BaseModel):
    """A correction to a food that is already shared.

    The proposal is a whole food rather than the fields that changed. A
    reviewer decides by reading two panels side by side, and half a panel
    cannot be read against a whole one.
    """

    target_food_id: int
    proposed: FoodIn
    # Optional evidence: a picture of the panel these numbers were read off.
    label_photo_id: int | None = None
    note: str = Field(default="", max_length=MAX_NOTE)


class PhotoIn(BaseModel):
    """A picture offered for a food that is already shared."""

    target_food_id: int
    photo_id: int
    note: str = Field(default="", max_length=MAX_NOTE)


class ReportIn(BaseModel):
    """Something wrong with a food that is already shared, said in words.

    No panel and no picture. A member holding the packet knows what is wrong
    with the row long before they know what the row should say instead, and
    asking them to rewrite eleven numbers to report one of them is what put an
    edit form in front of them in the first place.
    """

    target_food_id: int
    # Held to a length here and to having something in it in the route, so the
    # refusal for an empty box is a sentence rather than a type error.
    note: str = Field(default="", max_length=MAX_NOTE)


class ApproveIn(BaseModel):
    """Publishing a submission. The photo is kept unless it is said otherwise."""

    keep_photo: bool = True
    # What the member is told when a report is resolved. Optional: a fixed food
    # is usually its own answer.
    note: str = Field(default="", max_length=MAX_NOTE)


class QueuePhotoIn(BaseModel):
    """A picture a reviewer puts on a waiting request in place of what it had."""

    photo_id: int
    purpose: str


class RejectIn(BaseModel):
    """Turning one down, and what the submitter is told about why."""

    note: str = Field(default="", max_length=MAX_NOTE)


class MicroPickIn(BaseModel):
    """Which of the offered records an administrator says a food really is."""

    fdc_id: int


class RoleIn(BaseModel):
    """The one thing an administrator may change about somebody's account."""

    is_reviewer: bool


class InviteIn(BaseModel):
    """How many people a new link lets in. The bounds are checked in the
    handler, so a number outside them is answered in words rather than by the
    validator."""

    seats: int = 1


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
    # Set instead of food_id when a recipe is what was eaten, in which case the
    # amount is a number of its servings. Both together is the route's refusal.
    recipe_id: int | None = None
    # A unit from a measure family, or "serving:<id>" for one of the food's own.
    amount: float | None = Field(default=None, gt=0)
    unit: str | None = Field(default=None, max_length=MAX_UNIT)
    # What a recipe weighed on the plate, given instead of an amount of
    # servings. Only a recipe is logged this way.
    grams: float | None = Field(default=None, gt=0)

    # The quick add. What was eaten, and what it was worth.
    name: str = ""
    calories: float | None = Field(default=None, ge=0)
    protein_g: float | None = Field(default=None, ge=0)
    carbs_g: float | None = Field(default=None, ge=0)
    fat_g: float | None = Field(default=None, ge=0)


class AutoLogIn(BaseModel):
    """A food, a recipe or a kept meal set to log itself every day.

    Exactly one of the three, which is the route's rule with a sentence of its
    own: a type cannot say "one of these, and not two". A food's portion
    arrives the way one on a diary entry does, because it is measured by the
    same code: a unit from a measure family, or "serving:<id>" for one of the
    food's own. A recipe or a meal counts in servings or weighs in grams.
    """

    food_id: int | None = None
    recipe_id: int | None = None
    meal_id: int | None = None
    amount: float = Field(gt=0)
    unit: str = Field(max_length=MAX_UNIT)
    slot: str


class AutoLogPatch(BaseModel):
    """A change to a standing auto-log. A field left out is left alone."""

    amount: float | None = Field(default=None, gt=0)
    unit: str | None = Field(default=None, max_length=MAX_UNIT)
    slot: str | None = None


class CompleteIn(BaseModel):
    """The day somebody is finished with. Left out means today."""

    date: dt.date | None = None


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

    # Whether the auto-log that wrote this entry takes the change with it, so
    # the days to come read the same. Left out is a change to the one day.
    follow_auto_log: bool | None = None


# How many things one recipe or one meal may hold. Enough for anything a
# kitchen does, and few enough that saving one is a single screenful of work.
MAX_PARTS = 50

# The most servings a recipe may claim to make. A batch bigger than this is a
# typed decimal point rather than a Sunday lunch.
MAX_YIELD = 1000


class PartIn(BaseModel):
    """One food inside a recipe or a kept meal, and how much of it."""

    food_id: int
    amount: float = Field(gt=0)
    # A unit from a measure family, or "serving:<id>" for one of the food's own.
    unit: str = Field(max_length=MAX_UNIT)


# The least a scale can be told a pot weighs. Under a gram is a typo.
MIN_WEIGHT = 1


class RecipeIn(BaseModel):
    """A recipe as the form sends it, whole.

    The ingredient list is replaced rather than merged, the same way a food's
    servings are: a row that did not arrive is a row somebody took out.
    """

    name: str
    yield_servings: float = Field(gt=0, le=MAX_YIELD)
    # What the scale said when it was done, where somebody weighed it. Left out
    # means nobody did, and the parts are what it weighs.
    final_weight_g: float | None = Field(default=None, ge=MIN_WEIGHT)
    ingredients: list[PartIn] = Field(min_length=1, max_length=MAX_PARTS)


class MealIn(BaseModel):
    """A kept meal: a name, and the things it is a shortcut for."""

    name: str
    final_weight_g: float | None = Field(default=None, ge=MIN_WEIGHT)
    items: list[PartIn] = Field(min_length=1, max_length=MAX_PARTS)


class MealLogIn(BaseModel):
    """Logging a whole kept meal: so many servings of it, or so many grams."""

    # Left out means today, wherever the account says it is.
    date: dt.date | None = None
    slot: str
    # How many of the whole meal. One, unless somebody says otherwise.
    servings: float = Field(default=1, gt=0)
    # Or what was taken off the scale, which is a share of what all of it
    # weighs. Given instead of servings, never beside it.
    grams: float | None = Field(default=None, gt=0)
