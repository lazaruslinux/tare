"""What a recipe is worth, and whose it is.

The screens that keep recipes and the diary that eats them both need these
answers, and neither route should have to import the other to get them, so
they live here on their own.

A total is stricter about a missing figure than a day is. A day with one
unlabelled coffee in it is still a day, so a nutrient nobody gave counts as
nothing; a recipe with one ingredient nobody has the sodium for has an unknown
amount of sodium in it, not a smaller one.
"""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.models import NUTRIENTS

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
