"""Kept meals: the foods somebody eats together, logged as one line.

A meal holds no numbers of its own. It is a list of things, and each of them
takes its panel from the food as that food stands at the moment the meal is
read or eaten, through the very code path a single food goes through. Nothing
here is a recipe: a recipe is cooked and shared out, a meal is a shortcut.

A meal is private without qualification. Somebody else's answers exactly what
an id that was never used answers.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from app import clock, models, schemas, units
from app.db import get_db
from app.deps import require_user
from app.models import NUTRIENTS, SERVING_UNIT, now_utc
from app.recipes import HEADLINE, settled_weight
from app.routers.diary import (
    checked_slot,
    entry_row,
    measure,
    refuse_if_complete,
    snapshot,
    stored_unit,
)
from app.routers.foods import MY_LIST_CAP, last_logged_by, readable_food
from app.routers.recipes import checked_name, part_food

router = APIRouter(prefix="/meals", tags=["meals"])

# One meal that is not there and one that is somebody else's read the same.
MISSING_MEAL = "There is no such meal."
NO_NAME = "A meal needs a name."
# What is said to somebody logging by weight a meal nothing can weigh.
NO_WEIGHT = "This meal has no weight yet."


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


def item_panel(
    db: Session, user: models.User, item: models.MealTemplateItem
) -> dict[str, float | None] | None:
    """What one item comes to, from its food as that food stands now.

    Nothing at all when the food has gone, or when the serving it was measured
    in has been renamed away: either way there is no longer anything to measure
    with. The two the diary uses do the arithmetic, so an item in a meal and
    the same portion logged by hand cannot come out different. The row it fills
    in is never kept: this is read every time a meal is shown.
    """
    if item.food_id is None:
        return None
    try:
        food = readable_food(db, user, item.food_id)
        base_amount, _, _ = measure(food, item.amount, stored_unit(item, food))
    except HTTPException:
        return None
    scratch = models.DiaryEntry()
    snapshot(scratch, food, base_amount)
    return {field: getattr(scratch, field) for field in NUTRIENTS}


def item_grams(
    db: Session, user: models.User, item: models.MealTemplateItem
) -> float | None:
    """What one item weighs, from its food as that food stands now.

    Nothing at all where the food has gone or the amount is a volume nothing
    has given a weight for, which is the same silence the panel above keeps.
    """
    if item.food_id is None:
        return None
    try:
        food = readable_food(db, user, item.food_id)
        base_amount, _, unit = measure(food, item.amount, stored_unit(item, food))
    except HTTPException:
        return None
    return units.to_grams(food, item.amount, unit, base_amount)


def weight(
    db: Session, user: models.User, meal: models.MealTemplate
) -> tuple[float | None, list[str]]:
    """What the whole meal weighs in grams, and the items nothing can weigh.

    Null the moment one item cannot be weighed: a total that left one out
    would be a lighter meal rather than the same one measured worse.
    """
    grams = 0.0
    unweighed: list[str] = []
    for item in meal.items:
        each = item_grams(db, user, item)
        if each is None:
            unweighed.append(item.name)
        else:
            grams += each
    # Whole grams, so the figure a screen prints is the one a share is worked
    # out from.
    return (None if unweighed else round(grams)), unweighed


def portions(
    db: Session, user: models.User, meal: models.MealTemplate
) -> tuple[list[dict[str, float | None] | None], list[str]]:
    """Every item worked out, in order, and the names of the ones that cannot
    be worked out any more."""
    panels: list[dict[str, float | None] | None] = []
    skipped: list[str] = []
    for item in meal.items:
        panel = item_panel(db, user, item)
        if panel is None:
            skipped.append(item.name)
        panels.append(panel)
    return panels, skipped


def totals(panels: list[dict[str, float | None] | None]) -> dict[str, float | None]:
    """The whole meal added up, by the rule a recipe's total uses: a nutrient
    one item is missing is unknown for the meal, not a smaller amount of it."""
    carried = [panel for panel in panels if panel is not None]
    whole: dict[str, float | None] = {}
    for field in NUTRIENTS:
        figures = [value for panel in carried if (value := panel[field]) is not None]
        whole[field] = sum(figures) if len(figures) == len(carried) else None
    # An item keeps the ten a portion carries and nothing a packet says about
    # itself, so how much sugar was added is unknown here rather than none.
    whole["added_sugars_g"] = None
    return whole


def item_row(
    row: models.MealTemplateItem, panel: dict[str, float | None] | None
) -> dict[str, object]:
    """One item. food_id is null once its food is gone, and the name stays.

    The four the lists and the form read come with it, and they are null on an
    item whose food has gone, the same way the row itself says so.
    """
    data: dict[str, object] = {
        "id": row.id,
        "food_id": row.food_id,
        "name": row.name,
        "brand": row.brand,
        "amount": row.amount,
        "unit": row.unit,
        "serving_label": row.serving_label,
    }
    for field in HEADLINE:
        data[field] = None if panel is None else panel[field]
    return data


def meal_detail(db: Session, user: models.User, meal: models.MealTemplate) -> dict[str, object]:
    panels, _ = portions(db, user, meal)
    grams, unweighed = weight(db, user, meal)
    return {
        "id": meal.id,
        "name": meal.name,
        "items": [item_row(row, panel) for row, panel in zip(meal.items, panels)],
        "totals": totals(panels),
        # What the items weigh, the ones nothing can weigh, and what the scale
        # said when it was made up.
        "weight_g": grams,
        "unweighed": unweighed,
        "final_weight_g": meal.final_weight_g,
    }


@router.get("")
def list_meals(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> list[dict[str, object]]:
    """This account's kept meals, by when each was last eaten.

    A logged meal is one line that names the meal it came from, so there is a
    date to read here now, and the ordering is the food list's: last eaten
    first, and by when it was written down for the ones nobody has logged yet.
    """
    logged = last_logged_by(models.DiaryEntry.meal_id, user)
    query = (
        select(models.MealTemplate, logged.c.last_logged)
        .options(selectinload(models.MealTemplate.items))
        .outerjoin(logged, logged.c.owner == models.MealTemplate.id)
        .where(models.MealTemplate.user_id == user.id)
        .order_by(
            logged.c.last_logged.desc().nullslast(),
            models.MealTemplate.created_at.desc(),
            models.MealTemplate.id.desc(),
        )
        .limit(MY_LIST_CAP)
    )
    return [
        {
            "id": meal.id,
            "name": meal.name,
            "items": len(meal.items),
            # What the whole meal comes to, so a row can say it. The foods
            # behind a list of meals are read once each: the session hands the
            # same food back to every meal that holds it.
            "totals": totals(portions(db, user, meal)[0]),
            "last_logged": stamp,
        }
        for meal, stamp in db.execute(query).all()
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
        final_weight_g=body.final_weight_g,
        items=build_items(db, user, body.items, {}),
    )
    db.add(meal)
    db.commit()
    return meal_detail(db, user, meal)


@router.get("/{meal_id}")
def read_meal(
    meal_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    return meal_detail(db, user, own_meal(db, user, meal_id))


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
    meal.final_weight_g = body.final_weight_g
    meal.items = rows
    meal.updated_at = now_utc()
    db.commit()
    return meal_detail(db, user, meal)


@router.delete("/{meal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meal(
    meal_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    meal = own_meal(db, user, meal_id)
    # What the foreign key already says, said again here so SQLite and the rows
    # this process is holding stay in step with Postgres. What was eaten keeps
    # its numbers either way.
    db.execute(
        update(models.DiaryEntry)
        .where(models.DiaryEntry.meal_id == meal.id)
        .values(meal_id=None)
    )
    # Through the session, so the items go with it on SQLite too, where the
    # foreign key is only enforced when it is asked for.
    db.delete(meal)
    db.commit()


@router.post("/{meal_id}/log", status_code=status.HTTP_201_CREATED)
def log_meal(
    meal_id: int,
    body: schemas.MealLogIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Log the whole meal as one line: what all of it comes to, that often.

    A breakfast is one thing somebody ate, so it reads as one row in the day
    rather than five, the way a recipe already did. An item whose food has gone
    is left out and named rather than holding up the rest of the meal, because
    the other four things really were eaten.

    Weighed instead of counted where somebody says what came off the scale: the
    share of the whole meal that many grams is, worked out from what the scale
    said it all weighed, or from what the items come to when nobody weighed it.
    """
    meal = own_meal(db, user, meal_id)
    day = body.date or clock.user_today(user)
    refuse_if_complete(db, user, day)
    slot = checked_slot(body.slot)

    panels, skipped = portions(db, user, meal)
    whole = totals(panels)
    amount: float
    unit: str
    label: str | None
    if body.grams is None:
        share = body.servings
        amount, unit, label = body.servings, SERVING_UNIT, SERVING_UNIT
    else:
        weighs = settled_weight(meal.final_weight_g, weight(db, user, meal)[0])
        if weighs is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_WEIGHT)
        share = body.grams / weighs
        amount, unit, label = body.grams, "g", None
    entry = models.DiaryEntry(
        user_id=user.id,
        date_for=day,
        slot=slot,
        name=meal.name,
        brand="",
        meal_id=meal.id,
        amount=amount,
        unit=unit,
        serving_label=label,
    )
    for field in NUTRIENTS:
        value = whole[field]
        setattr(entry, field, None if value is None else value * share)
    db.add(entry)
    db.commit()
    return {"entry": entry_row(entry), "skipped": skipped}
