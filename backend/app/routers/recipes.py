"""Recipes: something cooked out of other foods, by the serving.

An ingredient is written down the way a diary entry is: measured out once,
through the same conversion, with the food's panel copied onto it at that
amount. Correcting a food afterwards corrects the food, and the recipe still
reads as what was written down until somebody saves it again.

A recipe is private without qualification. Somebody else's answers exactly
what an id that was never used answers.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from app import models, schemas
from app.db import get_db
from app.deps import require_user
from app.models import NUTRIENTS, now_utc
from app.recipes import HEADLINE, own_recipe, per_serving, totals
from app.routers.diary import measure, snapshot
from app.routers.foods import MAX_NAME, readable_food

router = APIRouter(prefix="/recipes", tags=["recipes"])

NO_NAME = "A recipe needs a name."


def checked_name(raw: str, missing: str) -> str:
    """A name that is really there and is not a paragraph."""
    name = raw.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, missing)
    if len(name) > MAX_NAME:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"A name must be at most {MAX_NAME} characters."
        )
    return name


def part_food(
    db: Session, user: models.User, food_id: int, kept: dict[int, str]
) -> models.Food:
    """The food a row names, or the refusal saying which one has gone.

    Naming it is only safe for a food this recipe or meal already held: that
    name is one the person has read on this screen already. Anything else is
    absent, exactly as an id that was never used is.
    """
    if food_id in kept and db.get(models.Food, food_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{kept[food_id]} is not there any more.")
    return readable_food(db, user, food_id)


def build_ingredients(
    db: Session, user: models.User, sent: list[schemas.PartIn], kept: dict[int, str]
) -> list[models.RecipeIngredient]:
    """Every ingredient measured out and snapshotted from the live foods."""
    rows = []
    for position, part in enumerate(sent):
        food = part_food(db, user, part.food_id, kept)
        base_amount, label, unit = measure(food, part.amount, part.unit)
        row = models.RecipeIngredient(
            food_id=food.id,
            name=food.name,
            brand=food.brand,
            amount=part.amount,
            unit=unit,
            serving_label=label,
            base_amount=base_amount,
            position=position,
        )
        snapshot(row, food, base_amount)
        rows.append(row)
    return rows


def held_names(recipe: models.Recipe) -> dict[int, str]:
    """What this recipe already calls each of the foods in it."""
    return {row.food_id: row.name for row in recipe.ingredients if row.food_id is not None}


def ingredient_row(row: models.RecipeIngredient) -> dict[str, object]:
    """One ingredient: what it is, how much of it, and what that came to."""
    data: dict[str, object] = {
        "id": row.id,
        "food_id": row.food_id,
        "name": row.name,
        "brand": row.brand,
        "amount": row.amount,
        "unit": row.unit,
        "serving_label": row.serving_label,
    }
    for field in NUTRIENTS:
        data[field] = getattr(row, field)
    return data


def recipe_detail(recipe: models.Recipe) -> dict[str, object]:
    """The whole recipe: its ingredients, what it makes, and what it comes to."""
    return {
        "id": recipe.id,
        "name": recipe.name,
        "yield_servings": recipe.yield_servings,
        "ingredients": [ingredient_row(row) for row in recipe.ingredients],
        "totals": totals(recipe),
        "per_serving": per_serving(recipe),
    }


@router.get("")
def list_recipes(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> list[dict[str, object]]:
    """This account's recipes, newest first, by what a serving is worth."""
    query = (
        select(models.Recipe)
        .options(selectinload(models.Recipe.ingredients))
        .where(models.Recipe.user_id == user.id)
        .order_by(models.Recipe.created_at.desc(), models.Recipe.id.desc())
    )
    rows = []
    for recipe in db.execute(query).scalars():
        each = per_serving(recipe)
        rows.append(
            {
                "id": recipe.id,
                "name": recipe.name,
                "yield_servings": recipe.yield_servings,
                "per_serving": {field: each[field] for field in HEADLINE},
            }
        )
    return rows


@router.post("", status_code=status.HTTP_201_CREATED)
def create_recipe(
    body: schemas.RecipeIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    recipe = models.Recipe(
        user_id=user.id,
        name=checked_name(body.name, NO_NAME),
        yield_servings=body.yield_servings,
        ingredients=build_ingredients(db, user, body.ingredients, {}),
    )
    db.add(recipe)
    db.commit()
    return recipe_detail(recipe)


@router.get("/{recipe_id}")
def read_recipe(
    recipe_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    return recipe_detail(own_recipe(db, user, recipe_id))


@router.put("/{recipe_id}")
def replace_recipe(
    recipe_id: int,
    body: schemas.RecipeIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Save it again, which is what works the numbers out afresh.

    The ingredient list is replaced wholesale rather than merged: a row that
    did not arrive is a row somebody took out, and matching them up by food
    would put it back.
    """
    recipe = own_recipe(db, user, recipe_id)
    rows = build_ingredients(db, user, body.ingredients, held_names(recipe))
    recipe.name = checked_name(body.name, NO_NAME)
    recipe.yield_servings = body.yield_servings
    recipe.ingredients = rows
    recipe.updated_at = now_utc()
    db.commit()
    return recipe_detail(recipe)


@router.delete("/{recipe_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recipe(
    recipe_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    recipe = own_recipe(db, user, recipe_id)
    # What the foreign key already says, said again here so SQLite and the rows
    # this process is holding stay in step with Postgres. What was eaten keeps
    # its numbers either way.
    db.execute(
        update(models.DiaryEntry)
        .where(models.DiaryEntry.recipe_id == recipe.id)
        .values(recipe_id=None)
    )
    # Through the session rather than in SQL, so the ingredients go with it on
    # SQLite too, where the foreign key is only enforced when it is asked for.
    db.delete(recipe)
    db.commit()
