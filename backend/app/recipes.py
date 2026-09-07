"""What a recipe is worth, and whose it is.

The screens that keep recipes and the diary that eats them both need these
answers, so they live here rather than in either route. A total is stricter
than a day about a missing figure: a recipe with one ingredient nobody has the
sodium for has an unknown amount of sodium in it, not a smaller one.
"""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app import models, units
from app.models import NUTRIENTS
from app.routers.foods import readable_food

# One recipe that is not there and one that is somebody else's read the same.
MISSING_RECIPE = "There is no such recipe."

# The four a list is read by, which are the first four of the panel.
HEADLINE = NUTRIENTS[:4]


def own_recipe(db: Session, user: models.User, recipe_id: int) -> models.Recipe:
    recipe = db.get(models.Recipe, recipe_id)
    if recipe is None or recipe.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_RECIPE)
    return recipe


def totals(recipe: models.Recipe) -> dict[str, float | None]:
    """Every nutrient across the whole recipe, null where one is unknown."""
    whole: dict[str, float | None] = {}
    for field in NUTRIENTS:
        carried = [getattr(row, field) for row in recipe.ingredients]
        whole[field] = None if any(value is None for value in carried) else sum(carried)
    # An ingredient keeps the ten a portion carries and nothing a packet says
    # about itself, so how much sugar was added to a recipe is unknown here
    # rather than none: the panel reads it as the blank it is.
    whole["added_sugars_g"] = None
    return whole


def per_serving(recipe: models.Recipe) -> dict[str, float | None]:
    """One serving of it: the whole thing shared out by what it makes."""
    return {
        field: None if value is None else value / recipe.yield_servings
        for field, value in totals(recipe).items()
    }


def weight(
    db: Session, user: models.User, recipe: models.Recipe
) -> tuple[float | None, list[str]]:
    """What the whole recipe weighs in grams, and the parts nothing can weigh.

    Null the moment one part cannot be weighed, for the reason a nutrient is:
    a total that quietly left an ingredient out would be a lighter recipe
    rather than the same one measured worse.
    """
    grams = 0.0
    unweighed: list[str] = []
    for row in recipe.ingredients:
        each = None
        food = None if row.food_id is None else readable(db, user, row.food_id)
        if food is not None:
            each = units.to_grams(food, row.amount, row.unit, row.base_amount)
        if each is None:
            unweighed.append(row.name)
        else:
            grams += each
    # Whole grams, so the figure a screen prints is the one a share is worked
    # out from.
    return (None if unweighed else round(grams)), unweighed


def readable(db: Session, user: models.User, food_id: int) -> models.Food | None:
    """The food behind a part, or nothing where it is gone or out of reach."""
    try:
        return readable_food(db, user, food_id)
    except HTTPException:
        return None


def settled_weight(final: float | None, computed: float | None) -> float | None:
    """What a portion by weight is worked out from: the scale beats the parts."""
    return final if final is not None else computed
