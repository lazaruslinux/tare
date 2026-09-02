"""Kept meals: the foods somebody eats together, logged in one go.

A meal holds no numbers of its own. It is a list of things to log, and each of
them takes its panel from the food as that food stands at the moment the meal
is logged, through the very code path a single food goes through. Nothing here
is a recipe: a recipe is cooked and shared out, a meal is a shortcut.

A meal is private without qualification. Somebody else's answers exactly what
an id that was never used answers.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app import clock, models, schemas
from app.db import get_db
from app.deps import require_user
from app.models import now_utc
from app.routers.diary import checked_slot, entry_row, log_food, measure, stored_unit
from app.routers.foods import readable_food
from app.routers.recipes import checked_name, part_food

router = APIRouter(prefix="/meals", tags=["meals"])

# One meal that is not there and one that is somebody else's read the same.
MISSING_MEAL = "There is no such meal."
NO_NAME = "A meal needs a name."


def own_meal(db: Session, user: models.User, meal_id: int) -> models.MealTemplate:
    meal = db.get(models.MealTemplate, meal_id)
    if meal is None or meal.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_MEAL)
    return meal


def build_items(
    db: Session, user: models.User, sent: list[schemas.PartIn], kept: dict[int, str]
) -> list[models.MealTemplateItem]:
    """Every item measured out, so a unit that cannot mean anything is refused
    while somebody is still looking at the form."""
    rows = []
    for position, part in enumerate(sent):
        food = part_food(db, user, part.food_id, kept)
        _, label, unit = measure(food, part.amount, part.unit)
        rows.append(
            models.MealTemplateItem(
                food_id=food.id,
                name=food.name,
                brand=food.brand,
                amount=part.amount,
                unit=unit,
                serving_label=label,
                position=position,
            )
        )
    return rows


def held_names(meal: models.MealTemplate) -> dict[int, str]:
    """What this meal already calls each of the foods in it."""
    return {row.food_id: row.name for row in meal.items if row.food_id is not None}


def item_row(row: models.MealTemplateItem) -> dict[str, object]:
    """One item. food_id is null once its food is gone, and the name stays."""
    return {
        "id": row.id,
        "food_id": row.food_id,
        "name": row.name,
        "brand": row.brand,
        "amount": row.amount,
        "unit": row.unit,
        "serving_label": row.serving_label,
    }


def meal_detail(meal: models.MealTemplate) -> dict[str, object]:
    return {
        "id": meal.id,
        "name": meal.name,
        "items": [item_row(row) for row in meal.items],
    }


@router.get("")
def list_meals(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> list[dict[str, object]]:
    """This account's kept meals, newest first."""
    query = (
        select(models.MealTemplate)
        .options(selectinload(models.MealTemplate.items))
        .where(models.MealTemplate.user_id == user.id)
        .order_by(models.MealTemplate.created_at.desc(), models.MealTemplate.id.desc())
    )
    return [
        {"id": meal.id, "name": meal.name, "items": len(meal.items)}
        for meal in db.execute(query).scalars()
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_meal(
    body: schemas.MealIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    meal = models.MealTemplate(
        user_id=user.id,
        name=checked_name(body.name, NO_NAME),
        items=build_items(db, user, body.items, {}),
    )
    db.add(meal)
    db.commit()
    return meal_detail(meal)


@router.get("/{meal_id}")
def read_meal(
    meal_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    return meal_detail(own_meal(db, user, meal_id))


@router.put("/{meal_id}")
def replace_meal(
    meal_id: int,
    body: schemas.MealIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Save it again. The item list is replaced wholesale, never merged: a row
    that did not arrive is a row somebody took out."""
    meal = own_meal(db, user, meal_id)
    rows = build_items(db, user, body.items, held_names(meal))
    meal.name = checked_name(body.name, NO_NAME)
    meal.items = rows
    meal.updated_at = now_utc()
    db.commit()
    return meal_detail(meal)


@router.delete("/{meal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meal(
    meal_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    # Through the session, so the items go with it on SQLite too, where the
    # foreign key is only enforced when it is asked for. Anything already
    # logged from this meal is an ordinary entry and stays where it is.
    db.delete(own_meal(db, user, meal_id))
    db.commit()


@router.post("/{meal_id}/log", status_code=status.HTTP_201_CREATED)
def log_meal(
    meal_id: int,
    body: schemas.MealLogIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Log the whole meal: one ordinary entry for each thing in it.

    An item whose food has gone is left out and named rather than holding up
    the rest of the meal, because the other four things really were eaten.
    """
    meal = own_meal(db, user, meal_id)
    day = body.date or clock.user_today(user)
    slot = checked_slot(body.slot)

    made: list[models.DiaryEntry] = []
    skipped: list[str] = []
    for item in meal.items:
        if item.food_id is None:
            skipped.append(item.name)
            continue
        try:
            food = readable_food(db, user, item.food_id)
            unit = stored_unit(item, food)
        except HTTPException:
            # The food is gone, or the serving it was measured in has been
            # renamed away. Either way there is nothing left to measure with.
            skipped.append(item.name)
            continue
        entry = log_food(user, day, slot, food, item.amount, unit)
        db.add(entry)
        made.append(entry)

    db.commit()
    return {"entries": [entry_row(entry) for entry in made], "skipped": skipped}
