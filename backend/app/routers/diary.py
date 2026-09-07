"""The diary: what was eaten, when, and what it was worth.

An entry keeps its own numbers, worked out once from the food as it stood at
that moment, so correcting a food corrects the food and deleting one leaves
every day it was part of standing. A diary is private without qualification:
somebody else's entry answers what an unused id answers, and an administrator
is nobody special here.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Sequence
from typing import NamedTuple

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import clock, health, models, schemas, units
from app.db import get_db
from app.deps import require_user
from app.models import DIARY_SLOTS, NUTRIENTS, SERVING_UNIT, now_utc
from app.recipes import own_recipe, per_serving, settled_weight, totals, weight
from app.routers.fitness import (
    day_exercise,
    goals_on,
    imported_row,
    steps_on,
    workouts_on,
)
from app.routers.foods import MAX_NAME, readable_food
from app.routers.health import (
    Reckoning,
    day_budget,
    exercise_on,
    exercise_row,
    measurement_row,
)

router = APIRouter(prefix="/diary", tags=["diary"])

# One entry that is not there and one that is somebody else's read the same.
MISSING_ENTRY = "There is no such entry."

BAD_DATE = "That is not a date."
# What a locked day answers every write with, and why a day cannot be locked
# before it has happened.
DAY_COMPLETE = "This day is complete."
FUTURE_DAY = "That day has not happened yet."
BAD_SLOT = "That is not a meal."
# One auto-log that is not there and one that is somebody else's read the same,
# and the refusal for a second one on the same food and meal.
MISSING_AUTO_LOG = "There is no such auto-log."
AUTO_LOG_CLASH = "That {kind} already auto-logs at {slot}."
# An auto-log is about one thing, and there are three it could be.
ONE_AUTO_LOG_KIND = "An auto-log is for a food, a recipe or a meal, and one of them."
# A recipe or a meal is counted in servings or taken off the scale, and there
# is no third way to say how much of one.
AUTO_LOG_DISH_UNIT = "A recipe or a meal auto-logs in servings or in grams."
# Said where grams are asked for and there is nothing to take a share of.
NO_DISH_WEIGHT = "Add a final weight first, or count servings."
BAD_UNIT = "That is not a unit this can measure in."
NO_AMOUNT = "Say how much of it you had."
NO_QUICK_ADD = "A quick add needs an item name and its calories."
# What is left of an entry once its food is gone: a portion and a set of
# numbers, which can be made larger or smaller and nothing else.
UNLINKED_UNIT = "The food this came from is gone, so only the amount can change."
UNLINKED_SERVING = "Say which unit to measure it in."
NO_PORTION = "This entry has no amount to change."
LINKED_NUTRIENTS = "The numbers on a logged food come from the food itself."
RECIPE_NUTRIENTS = "The numbers on a logged recipe come from the recipe itself."
RECIPE_SERVINGS = "A recipe is counted in servings."
# What is said to somebody logging by weight a recipe nothing can weigh.
NO_WEIGHT = "This recipe has no weight yet."
# Grams are a share of a whole thing, so there has to be a whole thing.
GRAMS_NEED_A_RECIPE = "Only a recipe is logged by weight."
BOTH_KINDS = "Log a food or a recipe, not both."

# How a serving is asked for, as against a unit from a measure family.
SERVING_PREFIX = "serving:"

# How many days a run of them may ask for, and how many it asks for by default.
DEFAULT_HISTORY = 7
MAX_HISTORY = 180

# What a quick add carries, and the only fields an unlinked entry may be given
# by hand. The other six are never typed in.
QUICK = ("calories", "protein_g", "carbs_g", "fat_g")


def checked_slot(slot: str | None) -> str:
    if slot not in DIARY_SLOTS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_SLOT)
    return slot


def asked_day(date: str, user: models.User) -> dt.date:
    """The day a request is about: the one it named, or the one it is."""
    if not date:
        return clock.user_today(user)
    try:
        return dt.date.fromisoformat(date)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_DATE) from None


def measure(food: models.Food, amount: float, unit: str) -> tuple[float, str | None, str]:
    """Resolve a portion: how much of the base unit, its label, what to store.

    A serving is counted rather than converted, because it is already an amount
    of the food's own base unit. Everything else goes through the one conversion
    in app.units, so a portion cannot resolve two ways.
    """
    if unit.startswith(SERVING_PREFIX):
        try:
            serving_id = int(unit[len(SERVING_PREFIX) :])
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_UNIT) from None
        serving = next((row for row in food.servings if row.id == serving_id), None)
        if serving is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That serving is not on this food.")
        return amount * serving.base_amount, serving.name, SERVING_UNIT
    if unit not in units.UNIT_TO_BASE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_UNIT)
    return units.to_base(food, amount, unit), None, unit


def snapshot(
    entry: models.DiaryEntry | models.RecipeIngredient, food: models.Food, base_amount: float
) -> None:
    """Copy the food's panel onto the entry, at the amount actually eaten.

    Null stays null the whole way down: a nutrient the label never gave is not
    zero of it, at any portion size.
    """
    for field in NUTRIENTS:
        per_100 = getattr(food, field)
        setattr(entry, field, None if per_100 is None else per_100 * base_amount / 100)


def serve(entry: models.DiaryEntry, recipe: models.Recipe, servings: float) -> None:
    """Copy what one serving of the recipe comes to onto the entry, that often.

    The counterpart of snapshot() for the other thing that can be logged, and
    null travels the same way: a nutrient one ingredient never gave is unknown
    at any number of servings.
    """
    each = per_serving(recipe)
    for field in NUTRIENTS:
        value = each[field]
        setattr(entry, field, None if value is None else value * servings)


def log_food(
    user: models.User,
    day: dt.date,
    slot: str,
    food: models.Food,
    amount: float,
    unit: str,
) -> models.DiaryEntry:
    """One entry from a food measured out, with its numbers already worked out.

    The one place a portion becomes a row, so a food logged by hand and one a
    standing auto-log writes cannot come out different.
    """
    base_amount, label, kept_unit = measure(food, amount, unit)
    entry = models.DiaryEntry(
        user_id=user.id,
        date_for=day,
        slot=slot,
        name=food.name,
        brand=food.brand,
        food_id=food.id,
        amount=amount,
        unit=kept_unit,
        serving_label=label,
    )
    snapshot(entry, food, base_amount)
    return entry


def log_recipe(
    user: models.User,
    day: dt.date,
    slot: str,
    recipe: models.Recipe,
    servings: float,
) -> models.DiaryEntry:
    """One entry from a recipe: that many servings of what it comes to."""
    entry = models.DiaryEntry(
        user_id=user.id,
        date_for=day,
        slot=slot,
        name=recipe.name,
        brand="",
        recipe_id=recipe.id,
        amount=servings,
        unit=SERVING_UNIT,
        serving_label=SERVING_UNIT,
    )
    serve(entry, recipe, servings)
    return entry


def log_recipe_by_weight(
    user: models.User,
    day: dt.date,
    slot: str,
    recipe: models.Recipe,
    grams: float,
    weighs: float,
) -> models.DiaryEntry:
    """One entry from a recipe weighed out: that share of the whole thing.

    The row reads in grams rather than servings, because that is what somebody
    put on the scale, and the numbers are that share of everything in the pot.
    """
    share = grams / weighs
    entry = models.DiaryEntry(
        user_id=user.id,
        date_for=day,
        slot=slot,
        name=recipe.name,
        brand="",
        recipe_id=recipe.id,
        amount=grams,
        unit="g",
        serving_label=None,
    )
    whole = totals(recipe)
    for field in NUTRIENTS:
        value = whole[field]
        setattr(entry, field, None if value is None else value * share)
    return entry


def stored_unit(
    entry: models.DiaryEntry | models.MealTemplateItem, food: models.Food
) -> str:
    """The measurement an entry already carries, as a unit measure() can read.

    Only needed when a change gives a new amount without saying what to measure
    it in. A serving is found again by its name, which is all the entry kept of
    it; a serving that has since been renamed away has to be named afresh.
    """
    if entry.unit != SERVING_UNIT:
        return entry.unit or food.base_unit
    serving = next((row for row in food.servings if row.name == entry.serving_label), None)
    if serving is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, UNLINKED_SERVING)
    return f"{SERVING_PREFIX}{serving.id}"


def entry_row(entry: models.DiaryEntry) -> dict[str, object]:
    """One entry as a day reads it: what it was, how much, what it came to."""
    return {
        "id": entry.id,
        "name": entry.name,
        "brand": entry.brand,
        "amount": entry.amount,
        "unit": entry.unit,
        "serving_label": entry.serving_label,
        # Null once the food is gone, which is the screen's cue that this row
        # can no longer be re-measured.
        "food_id": entry.food_id,
        # Set instead, when what was eaten was a recipe.
        "recipe_id": entry.recipe_id,
        # Or a kept meal, which is one line counted in servings of itself.
        "meal_id": entry.meal_id,
        # Which standing auto-log wrote this row, and null on one somebody
        # logged themselves.
        "auto_log_id": entry.auto_log_id,
        "calories": entry.calories,
        "protein_g": entry.protein_g,
        "carbs_g": entry.carbs_g,
        "fat_g": entry.fat_g,
    }


def total(entries: list[models.DiaryEntry], field: str) -> float | None:
    """One nutrient across a set of entries.

    A missing figure counts as nothing inside the sum: a day is not unknowable
    because one label was short. A nutrient that no entry carries at all stays
    null, because nobody said there was none of it.
    """
    carried = [value for entry in entries if (value := getattr(entry, field)) is not None]
    return sum(carried) if carried else None


def exercise_credit(kcal: float) -> int:
    """Decision 7: what a day's workouts add back to that day's budget, and
    only that day's. Rounded to the nearest ten, like every calorie shown."""
    return round(kcal / 10) * 10


def day_energy(
    state: Reckoning, budget_calories: float, credit: float
) -> dict[str, object] | None:
    """The five figures a day's budget is made of, for the fold that shows them.

    Nothing while the budget is typed in by hand: a number somebody set is not
    made of anything. Nothing either while the profile is short of a detail,
    because then the published general targets stand rather than a worked-out
    day. Each figure rounds to the nearest ten on its own (decision 28), so the
    five add up to the budget give or take one rounding step.
    """
    if state.profile.targets_mode != "auto":
        return None
    resting = state.rmr()
    using = state.maintenance()
    if resting is None or using is None:
        return None
    level = state.profile.activity_level
    option = next(
        (row for row in health.activity_options(resting) if row.level == level), None
    )
    adds = 0.0 if option is None or option.adds is None else option.adds
    return {
        "resting": health.round_for_display(resting, "calories"),
        "activity": health.round_for_display(adds, "calories"),
        "level": level,
        "exercise": credit,
        # Signed: below what the body uses on a losing day, above it on a
        # gaining one, and nothing at all on a maintaining one.
        "adjustment": health.round_for_display(budget_calories - using, "calories"),
        "budget": round(budget_calories + credit),
    }


def own_entry(db: Session, user: models.User, entry_id: int) -> models.DiaryEntry:
    entry = db.get(models.DiaryEntry, entry_id)
    if entry is None or entry.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_ENTRY)
    return entry


def completion(db: Session, user: models.User, day: dt.date) -> models.JournalDay | None:
    """The row that says this day is finished, if there is one."""
    return db.get(models.JournalDay, (user.id, day))


def completed_days(
    db: Session, user: models.User, first: dt.date, last: dt.date
) -> set[dt.date]:
    """Which days in a run were marked complete, in one query rather than one
    a day."""
    return set(
        db.execute(
            select(models.JournalDay.date).where(
                models.JournalDay.user_id == user.id,
                models.JournalDay.date >= first,
                models.JournalDay.date <= last,
            )
        ).scalars()
    )


def refuse_if_complete(db: Session, user: models.User, day: dt.date) -> None:
    """The lock, in one place.

    Every route that writes something onto a day asks this first, so the mark
    means the same thing wherever it is met. What a phone syncs is not asked:
    that is a record arriving, not somebody editing a day they closed.
    """
    if completion(db, user, day) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, DAY_COMPLETE)


def serving_names(db: Session, standing: list[models.AutoLog]) -> dict[int, str]:
    """What each auto-log's serving is called, in one query for the whole list.

    Only the ones counted in a food's own servings have a name to look up; a
    portion in grams reads as its own unit.
    """
    wanted: dict[int, int] = {}
    for row in standing:
        if row.unit.startswith(SERVING_PREFIX):
            try:
                wanted[row.id] = int(row.unit[len(SERVING_PREFIX) :])
            except ValueError:
                continue
    if not wanted:
        return {}
    names = {
        serving_id: name
        for serving_id, name in db.execute(
            select(models.FoodServing.id, models.FoodServing.name).where(
                models.FoodServing.id.in_(set(wanted.values()))
            )
        )
    }
    return {row_id: names[serving_id] for row_id, serving_id in wanted.items() if serving_id in names}


class Thing(NamedTuple):
    """What one auto-log is about, as its row reads it: which of the three it
    is, what it is called, and the small picture beside the name."""

    kind: str
    name: str
    brand: str
    thumb: str | None


# Which column on an auto-log and which on a diary entry each kind is held in,
# so the clash rule and the already-eaten rule read the same for all three.
AUTO_LOG_COLUMNS = {
    "food": (models.AutoLog.food_id, models.DiaryEntry.food_id),
    "recipe": (models.AutoLog.recipe_id, models.DiaryEntry.recipe_id),
    "meal": (models.AutoLog.meal_id, models.DiaryEntry.meal_id),
}


def auto_log_kind(row: models.AutoLog | schemas.AutoLogIn) -> str:
    """Which of the three an auto-log is about. Exactly one column is set, so
    the first one that is answers it."""
    if row.food_id is not None:
        return "food"
    return "recipe" if row.recipe_id is not None else "meal"


def auto_log_things(
    db: Session, user: models.User, standing: Sequence[models.AutoLog]
) -> dict[int, Thing]:
    """What each of these auto-logs is about, by auto-log id.

    A few queries for the whole list rather than a lookup a row, the same way
    the serving names beside it are read. One whose thing has gone is simply
    not in the answer, and the list leaves that row out.
    """
    from app.routers.foods import dish_pictures, dish_thumb, pictures_for

    foods = list(
        db.execute(
            select(models.Food).where(
                models.Food.id.in_({row.food_id for row in standing if row.food_id})
            )
        ).scalars()
    )
    recipes = {
        recipe.id: recipe
        for recipe in db.execute(
            select(models.Recipe).where(
                models.Recipe.id.in_({row.recipe_id for row in standing if row.recipe_id})
            )
        ).scalars()
    }
    meals = {
        meal.id: meal
        for meal in db.execute(
            select(models.MealTemplate).where(
                models.MealTemplate.id.in_({row.meal_id for row in standing if row.meal_id})
            )
        ).scalars()
    }
    shots = pictures_for(db, user, foods)
    dishes = dish_pictures(
        db,
        [recipe.photo_id for recipe in recipes.values()]
        + [meal.photo_id for meal in meals.values()],
    )

    things: dict[int, Thing] = {}
    for row in standing:
        if row.food_id is not None:
            food = next((one for one in foods if one.id == row.food_id), None)
            if food is not None:
                shot = shots.get(food.id)
                thumb = None if shot is None else (shot.thumb or shot.url)
                things[row.id] = Thing("food", food.name, food.brand, thumb)
        elif row.recipe_id is not None:
            recipe = recipes.get(row.recipe_id)
            if recipe is not None:
                things[row.id] = Thing(
                    "recipe", recipe.name, "", dish_thumb(dishes, recipe.photo_id)
                )
        elif row.meal_id is not None:
            meal = meals.get(row.meal_id)
            if meal is not None:
                things[row.id] = Thing(
                    "meal", meal.name, "", dish_thumb(dishes, meal.photo_id)
                )
    return things


def auto_log_row(row: models.AutoLog, thing: Thing, label: str | None) -> dict[str, object]:
    """One standing auto-log as its list reads it: what, how much, which meal."""
    return {
        "id": row.id,
        "kind": thing.kind,
        "food_id": row.food_id,
        "recipe_id": row.recipe_id,
        "meal_id": row.meal_id,
        "name": thing.name,
        "brand": thing.brand,
        # The small picture the row draws, of the food or of the finished dish.
        "thumb_url": thing.thumb,
        "amount": row.amount,
        # The portion as it was set, which is what the sheet opens on again.
        "unit": row.unit,
        # The name of the serving it counts in. Null where it is measured, and
        # null on every recipe and meal: those count in servings of themselves.
        "serving_label": label,
        "slot": row.slot,
        "started_on": row.started_on.isoformat(),
    }


def dish_weight(
    db: Session, user: models.User, dish: models.Recipe | models.MealTemplate
) -> float | None:
    """What a share by weight of a recipe or a meal is worked out from: the
    scale where somebody typed a figure, and what the parts come to otherwise."""
    from app.routers.meals import weight as meal_weight

    if isinstance(dish, models.Recipe):
        return settled_weight(dish.final_weight_g, weight(db, user, dish)[0])
    return settled_weight(dish.final_weight_g, meal_weight(db, user, dish)[0])


def checked_dish_portion(
    db: Session, user: models.User, dish: models.Recipe | models.MealTemplate, unit: str
) -> None:
    """A recipe or a meal counts in servings or comes off the scale, and grams
    are a share of something, so there has to be something to share out."""
    if unit not in (SERVING_UNIT, "g"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, AUTO_LOG_DISH_UNIT)
    if unit == "g" and dish_weight(db, user, dish) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_DISH_WEIGHT)


Loggable = models.Food | models.Recipe | models.MealTemplate


def auto_log_target(db: Session, user: models.User, body: schemas.AutoLogIn) -> Loggable:
    """The thing a new auto-log is about, with its portion checked.

    Measured once here so a portion that cannot be worked out is refused now,
    rather than at a fill-in nobody is watching.
    """
    from app.routers.meals import own_meal

    given = [body.food_id, body.recipe_id, body.meal_id]
    if sum(one is not None for one in given) != 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, ONE_AUTO_LOG_KIND)
    if body.food_id is not None:
        food = readable_food(db, user, body.food_id)
        measure(food, body.amount, body.unit)
        return food
    if body.recipe_id is not None:
        recipe = own_recipe(db, user, body.recipe_id)
        checked_dish_portion(db, user, recipe, body.unit)
        return recipe
    # The check above leaves the meal and nothing else. The fallback id is
    # never reached: it is there because a type cannot say that.
    meal = own_meal(db, user, body.meal_id or 0)
    checked_dish_portion(db, user, meal, body.unit)
    return meal


def standing_target(db: Session, row: models.AutoLog) -> Loggable:
    """The thing a standing auto-log is about. One whose thing has gone answers
    exactly what an auto-log that was never there answers."""
    found: Loggable | None
    if row.food_id is not None:
        found = db.get(models.Food, row.food_id)
    elif row.recipe_id is not None:
        found = db.get(models.Recipe, row.recipe_id)
    else:
        found = db.get(models.MealTemplate, row.meal_id)
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_AUTO_LOG)
    return found


def auto_entry(
    db: Session, user: models.User, row: models.AutoLog, day: dt.date, thing: Loggable
) -> models.DiaryEntry:
    """The entry one auto-log owes for one day.

    Built by the same code a manual log of that thing uses, so a day filled in
    and the same portion logged by hand cannot come out different.
    """
    from app.routers.meals import log_entry

    if isinstance(thing, models.Food):
        return log_food(user, day, row.slot, thing, row.amount, row.unit)
    if isinstance(thing, models.Recipe):
        if row.unit == SERVING_UNIT:
            return log_recipe(user, day, row.slot, thing, row.amount)
        weighs = dish_weight(db, user, thing)
        if weighs is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_DISH_WEIGHT)
        return log_recipe_by_weight(user, day, row.slot, thing, row.amount, weighs)
    return log_entry(db, user, thing, day, row.slot, row.amount, row.unit != SERVING_UNIT)[0]


def standing_auto_logs(db: Session, user: models.User) -> list[models.AutoLog]:
    return list(
        db.execute(
            select(models.AutoLog)
            .where(models.AutoLog.user_id == user.id)
            .order_by(models.AutoLog.id)
        ).scalars()
    )


def own_auto_log(db: Session, user: models.User, auto_log_id: int) -> models.AutoLog:
    row = db.get(models.AutoLog, auto_log_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_AUTO_LOG)
    return row


def fill_auto_logs(db: Session, user: models.User, first: dt.date, last: dt.date) -> None:
    """Write in what the standing auto-logs owe across a run of days.

    Every day is filled in once and once only: the day rows beside the auto-log
    are the record of that, so a day whose entry was deleted stays deleted and a
    day read twice is not logged twice. Nothing is written onto a day that has
    not happened yet or onto one the member has closed.

    Two queries and a set rather than a lookup a day, because a month of days
    is read in one request.
    """
    last = min(last, clock.user_today(user))
    if last < first:
        return
    standing = list(
        db.execute(
            select(models.AutoLog).where(
                models.AutoLog.user_id == user.id, models.AutoLog.started_on <= last
            )
        ).scalars()
    )
    if not standing:
        return

    written = {
        (row.auto_log_id, row.date)
        for row in db.execute(
            select(models.AutoLogDay.auto_log_id, models.AutoLogDay.date).where(
                models.AutoLogDay.auto_log_id.in_([row.id for row in standing]),
                models.AutoLogDay.date >= first,
                models.AutoLogDay.date <= last,
            )
        )
    }
    marked = completed_days(db, user, first, last)
    foods = {
        food.id: food
        for food in db.execute(
            select(models.Food).where(
                models.Food.id.in_({row.food_id for row in standing if row.food_id})
            )
        ).scalars()
    }
    recipes = {
        recipe.id: recipe
        for recipe in db.execute(
            select(models.Recipe).where(
                models.Recipe.id.in_({row.recipe_id for row in standing if row.recipe_id})
            )
        ).scalars()
    }
    meals = {
        meal.id: meal
        for meal in db.execute(
            select(models.MealTemplate).where(
                models.MealTemplate.id.in_({row.meal_id for row in standing if row.meal_id})
            )
        ).scalars()
    }

    added = False
    for row in standing:
        thing: Loggable | None = None
        if row.food_id is not None:
            thing = foods.get(row.food_id)
        elif row.recipe_id is not None:
            thing = recipes.get(row.recipe_id)
        elif row.meal_id is not None:
            thing = meals.get(row.meal_id)
        if thing is None:
            continue
        day = max(first, row.started_on)
        while day <= last:
            if day not in marked and (row.id, day) not in written:
                try:
                    entry = auto_entry(db, user, row, day, thing)
                except HTTPException:
                    # The portion no longer resolves, which is a serving that
                    # has been deleted since, or a dish that can no longer be
                    # weighed. Nothing is written rather than something nobody
                    # chose, and the list still shows the row so it can be set
                    # again or taken off.
                    break
                entry.auto_log_id = row.id
                db.add(entry)
                db.add(models.AutoLogDay(auto_log_id=row.id, date=day))
                added = True
            day += dt.timedelta(days=1)

    if not added:
        return
    try:
        db.commit()
    except IntegrityError:
        # Two reads of the same day at once. The day rows are the referee, and
        # whichever request lost reads what the other one wrote.
        db.rollback()


@router.get("/auto-logs")
def read_auto_logs(
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> list[dict[str, object]]:
    """Everything this account has set to log itself, oldest first."""
    standing = standing_auto_logs(db, user)
    if not standing:
        return []
    things = auto_log_things(db, user, standing)
    labels = serving_names(db, standing)
    return [
        auto_log_row(row, thing, labels.get(row.id))
        for row in standing
        if (thing := things.get(row.id)) is not None
    ]


@router.post("/auto-logs", status_code=status.HTTP_201_CREATED)
def add_auto_log(
    body: schemas.AutoLogIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Set a food, a recipe or a kept meal to log itself into the same meal
    every day from today on."""
    slot = checked_slot(body.slot)
    thing = auto_log_target(db, user, body)
    kind = auto_log_kind(body)
    standing, logged = AUTO_LOG_COLUMNS[kind]
    clash = db.execute(
        select(models.AutoLog).where(
            models.AutoLog.user_id == user.id,
            standing == thing.id,
            models.AutoLog.slot == slot,
        )
    ).scalar_one_or_none()
    if clash is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, AUTO_LOG_CLASH.format(kind=kind, slot=slot)
        )

    today = clock.user_today(user)
    row = models.AutoLog(
        user_id=user.id,
        food_id=body.food_id,
        recipe_id=body.recipe_id,
        meal_id=body.meal_id,
        amount=body.amount,
        unit=body.unit,
        slot=slot,
        started_on=today,
    )
    db.add(row)
    db.flush()
    # Setting this up after eating the thing is not eating it twice: a meal
    # that already holds it today has had its turn.
    eaten = db.execute(
        select(models.DiaryEntry.id).where(
            models.DiaryEntry.user_id == user.id,
            models.DiaryEntry.date_for == today,
            models.DiaryEntry.slot == slot,
            logged == thing.id,
        )
    ).first()
    if eaten is not None:
        db.add(models.AutoLogDay(auto_log_id=row.id, date=today))
    db.commit()
    return auto_log_row(
        row, auto_log_things(db, user, [row])[row.id], serving_names(db, [row]).get(row.id)
    )


@router.patch("/auto-logs/{auto_log_id}")
def update_auto_log(
    auto_log_id: int,
    body: schemas.AutoLogPatch,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Change the portion or the meal. The days already written stand: this is
    an instruction about the days to come."""
    row = own_auto_log(db, user, auto_log_id)
    sent = body.model_fields_set
    thing = standing_target(db, row)
    kind = auto_log_kind(row)

    slot = checked_slot(body.slot) if "slot" in sent else row.slot
    amount = body.amount if body.amount is not None else row.amount
    unit = body.unit if "unit" in sent and body.unit else row.unit
    if isinstance(thing, models.Food):
        measure(thing, amount, unit)
    else:
        checked_dish_portion(db, user, thing, unit)
    if slot != row.slot:
        clash = db.execute(
            select(models.AutoLog).where(
                models.AutoLog.user_id == user.id,
                AUTO_LOG_COLUMNS[kind][0] == thing.id,
                models.AutoLog.slot == slot,
            )
        ).scalar_one_or_none()
        if clash is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT, AUTO_LOG_CLASH.format(kind=kind, slot=slot)
            )

    row.amount = amount
    row.unit = unit
    row.slot = slot
    db.commit()
    return auto_log_row(
        row, auto_log_things(db, user, [row])[row.id], serving_names(db, [row]).get(row.id)
    )


@router.delete("/auto-logs/{auto_log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_auto_log(
    auto_log_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    """Stop it. Tomorrow is not written; what it already wrote is eaten and
    stays where it is."""
    row = own_auto_log(db, user, auto_log_id)
    db.delete(row)
    db.commit()


@router.get("/day")
def read_day(
    date: str = "",
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """One day, whole: its entries by meal, its subtotals, its targets, what was
    weighed and what was worked off.

    Everything the Journal draws comes back in one answer. A screen that had to
    ask three times for one day would show three quarters of it while the last
    request was still out.
    """
    day = asked_day(date, user)
    # Whatever the standing auto-logs owe this day is written before it is
    # read, so the Journal never shows a day half filled in.
    fill_auto_logs(db, user, day, day)
    entries = list(
        db.execute(
            select(models.DiaryEntry)
            .where(models.DiaryEntry.user_id == user.id, models.DiaryEntry.date_for == day)
            .order_by(models.DiaryEntry.id)
        ).scalars()
    )
    by_slot = {slot: [entry for entry in entries if entry.slot == slot] for slot in DIARY_SLOTS}

    state = Reckoning(db, user)
    budget = day_budget(state)
    workouts = exercise_on(db, user, day)
    imported = workouts_on(db, user, day)
    # Decision 7: a day's exercise is counted once, and app.routers.fitness
    # holds the rule so the Journal and the Targets screen cannot drift apart.
    kcal, minutes = day_exercise(workouts, imported)
    credit = exercise_credit(kcal)
    # This day's own goal, which is the usual one unless it was set apart.
    _, minutes_goal = goals_on(db, user, day)
    weighed = next((row for row in state.rows if row.date_for == day), None)
    eaten = total(entries, "calories") or 0.0
    db.commit()

    done = completion(db, user, day)

    return {
        "date": day.isoformat(),
        # Whether the member has closed this day. A closed day is read only.
        "completed": done is not None,
        "completed_at": None if done is None else done.completed_at.isoformat(),
        "totals": {field: total(entries, field) for field in NUTRIENTS},
        "slots": {
            slot: {
                "entries": [entry_row(entry) for entry in in_slot],
                "subtotal_calories": total(in_slot, "calories"),
            }
            for slot, in_slot in by_slot.items()
        },
        "budget": {
            "calories": budget["calories"],
            "protein_g": budget["protein_g"],
            "carbs_g": budget["carbs_g"],
            "fat_g": budget["fat_g"],
        },
        "exercise_kcal": credit,
        "exercise_minutes": minutes,
        "exercise_minutes_goal": minutes_goal,
        # Null rather than nothing when no phone has sent a day: the ring on the
        # Dashboard is drawn only for a day that has an answer.
        "steps": steps_on(db, user, [day]).get(day),
        "remaining_calories": round(budget["calories"] + credit - eaten),
        # Where the day's own number came from, in five lines that add up. Null
        # when there is nothing to break down.
        "energy": day_energy(state, budget["calories"], credit),
        "measurement": None if weighed is None else measurement_row(weighed),
        "exercise": [exercise_row(row) for row in workouts]
        + [imported_row(row) for row in imported],
    }


@router.get("/days")
def read_days(
    days: int = DEFAULT_HISTORY,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """A run of days ending today: what was consumed against what was budgeted.

    One row per calendar day rather than one per day that was logged, because
    the point of it is the days nobody logged. The budget is today's: no
    day-by-day history of a profile is kept, so a past day is read against what
    is true now.
    """
    span = max(1, min(days, MAX_HISTORY))
    today = clock.user_today(user)
    first = today - dt.timedelta(days=span - 1)
    # The whole run at once, for the same reason the day view does it: a bar
    # is drawn from what the day holds.
    fill_auto_logs(db, user, first, today)

    eaten = {
        row.date_for: row
        for row in db.execute(
            select(
                models.DiaryEntry.date_for,
                func.sum(func.coalesce(models.DiaryEntry.calories, 0.0)).label("calories"),
                # The three the day is also read against, summed the same way,
                # so a readout on one bar can say what the day was made of.
                func.sum(func.coalesce(models.DiaryEntry.protein_g, 0.0)).label("protein_g"),
                func.sum(func.coalesce(models.DiaryEntry.carbs_g, 0.0)).label("carbs_g"),
                func.sum(func.coalesce(models.DiaryEntry.fat_g, 0.0)).label("fat_g"),
                func.count(models.DiaryEntry.id).label("entries"),
            )
            .where(
                models.DiaryEntry.user_id == user.id,
                models.DiaryEntry.date_for >= first,
                models.DiaryEntry.date_for <= today,
            )
            .group_by(models.DiaryEntry.date_for)
        )
    }
    worked = {
        row.date_for: row.kcal
        for row in db.execute(
            select(
                models.ExerciseEntry.date_for,
                func.sum(models.ExerciseEntry.kcal).label("kcal"),
            )
            .where(
                models.ExerciseEntry.user_id == user.id,
                models.ExerciseEntry.date_for >= first,
                models.ExerciseEntry.date_for <= today,
            )
            .group_by(models.ExerciseEntry.date_for)
        )
    }

    # The imported sessions across the same run, gathered once rather than a
    # query per day, and grouped the way the day view groups them.
    imported: dict[dt.date, list[models.Workout]] = {}
    for row in db.execute(
        select(models.Workout).where(
            models.Workout.user_id == user.id,
            models.Workout.date_for >= first,
            models.Workout.date_for <= today,
        )
    ).scalars():
        imported.setdefault(row.date_for, []).append(row)

    span_days = [first + dt.timedelta(days=step) for step in range(span)]
    steps = steps_on(db, user, span_days)

    marked = completed_days(db, user, first, today)

    state = Reckoning(db, user)
    budget = day_budget(state)["calories"]
    db.commit()

    run: list[dict[str, object]] = []
    for day in span_days:
        food = eaten.get(day)
        # Decision 7 again, at the resolution a run of days has: the manual
        # total for the day against the imported one, counted once.
        manual_kcal = worked.get(day, 0.0)
        day_imported = imported.get(day, [])
        counted = max(manual_kcal, sum(row.kcal or 0.0 for row in day_imported))
        run.append(
            {
                "date": day.isoformat(),
                # Nothing logged is nothing consumed, which is a bar of no
                # height rather than a day with no answer.
                "calories": 0 if food is None else round(food.calories),
                "protein_g": 0 if food is None else round(food.protein_g),
                "carbs_g": 0 if food is None else round(food.carbs_g),
                "fat_g": 0 if food is None else round(food.fat_g),
                "budget": budget,
                "exercise_kcal": exercise_credit(counted),
                "steps": steps.get(day),
                "logged": food is not None,
                "completed": day in marked,
            }
        )
    return {"days": run}


@router.put("/complete")
def complete_day(
    body: schemas.CompleteIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Say a day is finished, which counts it and locks it.

    Asking twice is not an error: the answer to "this day is done" is the same
    the second time, and a phone that sent it twice should not have to care.
    """
    day = body.date or clock.user_today(user)
    if day > clock.user_today(user):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, FUTURE_DAY)
    row = completion(db, user, day)
    if row is None:
        row = models.JournalDay(user_id=user.id, date=day, completed_at=now_utc())
        db.add(row)
        db.commit()
    return {"date": day.isoformat(), "completed_at": row.completed_at.isoformat()}


@router.delete("/complete/{date}", status_code=status.HTTP_204_NO_CONTENT)
def uncomplete_day(
    date: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    """Open the day again. One tap, no question asked: it is undoing a mark,
    not throwing anything away."""
    day = asked_day(date, user)
    row = completion(db, user, day)
    if row is not None:
        db.delete(row)
        db.commit()


@router.post("", status_code=status.HTTP_201_CREATED)
def add_entry(
    body: schemas.DiaryIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Log something: a food measured out, a recipe by the serving, or a name
    and its calories."""
    day = body.date or clock.user_today(user)
    refuse_if_complete(db, user, day)
    slot = checked_slot(body.slot)
    if body.food_id is not None and body.recipe_id is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BOTH_KINDS)
    if body.grams is not None and body.recipe_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, GRAMS_NEED_A_RECIPE)

    if body.food_id is not None:
        food = readable_food(db, user, body.food_id)
        if body.amount is None or not body.unit:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_AMOUNT)
        entry = log_food(user, day, slot, food, body.amount, body.unit)
    elif body.recipe_id is not None:
        recipe = own_recipe(db, user, body.recipe_id)
        if body.grams is not None:
            weighs = settled_weight(recipe.final_weight_g, weight(db, user, recipe)[0])
            if weighs is None:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_WEIGHT)
            entry = log_recipe_by_weight(user, day, slot, recipe, body.grams, weighs)
        elif body.amount is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_AMOUNT)
        else:
            entry = log_recipe(user, day, slot, recipe, body.amount)
    else:
        entry = models.DiaryEntry(user_id=user.id, date_for=day, slot=slot, brand="")
        name = body.name.strip()
        if not name or body.calories is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_QUICK_ADD)
        if len(name) > MAX_NAME:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"A name must be at most {MAX_NAME} characters."
            )
        entry.name = name
        # Only what was given. The other six were never asked for, and a quick
        # add that claimed zero of them would be inventing a label.
        for field in QUICK:
            setattr(entry, field, getattr(body, field))
        # Calories are kept whole, the way every label states them.
        entry.calories = float(round(body.calories))

    db.add(entry)
    db.commit()
    return entry_row(entry)


@router.patch("/{entry_id}")
def update_entry(
    entry_id: int,
    body: schemas.DiaryPatch,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Move an entry, re-measure it, or correct what a quick add claimed."""
    entry = own_entry(db, user, entry_id)
    sent = body.model_fields_set
    refuse_if_complete(db, user, entry.date_for)

    if "date" in sent:
        if body.date is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_DATE)
        # Moving a row onto a closed day is writing onto it, so that day is
        # asked as well.
        refuse_if_complete(db, user, body.date)
        entry.date_for = body.date
    if "slot" in sent:
        entry.slot = checked_slot(body.slot)

    food = None if entry.food_id is None else db.get(models.Food, entry.food_id)
    # The entry is this account's own, so the recipe under it is too.
    recipe = None if entry.recipe_id is None else db.get(models.Recipe, entry.recipe_id)

    if "amount" in sent or "unit" in sent:
        amount = body.amount if body.amount is not None else entry.amount
        if amount is None or amount <= 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_AMOUNT)
        # A recipe row logged by weight is a number of grams, so it stretches
        # the way a meal's does rather than being served again.
        if recipe is not None and entry.unit == SERVING_UNIT:
            if "unit" in sent:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, RECIPE_SERVINGS)
            # Worked out again from the recipe as it stands now, for the same
            # reason a logged food is: this row is being touched anyway.
            entry.amount = amount
            serve(entry, recipe, amount)
        elif food is not None:
            # Worked out again from the food as it stands now, so an entry that
            # is being touched anyway picks up a correction to its food.
            unit = body.unit if "unit" in sent and body.unit else stored_unit(entry, food)
            base_amount, label, kept_unit = measure(food, amount, unit)
            entry.amount = amount
            entry.unit = kept_unit
            entry.serving_label = label
            snapshot(entry, food, base_amount)
        else:
            if "unit" in sent:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, UNLINKED_UNIT)
            if entry.amount is None or entry.amount <= 0:
                # A quick add is a name and a number. There is no portion under
                # it to make larger or smaller.
                raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_PORTION)
            # A quick add, a row whose food has gone, or a kept meal, which is
            # counted in servings of what it came to when it was logged. There
            # is nothing to work out again, so what the row carries is
            # stretched. Null stays null.
            factor = amount / entry.amount
            for field in NUTRIENTS:
                carried = getattr(entry, field)
                if carried is not None:
                    setattr(entry, field, carried * factor)
            entry.amount = amount

    typed = [field for field in ("name", *QUICK) if field in sent]
    if typed and recipe is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, RECIPE_NUTRIENTS)
    if typed and food is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, LINKED_NUTRIENTS)
    for field in typed:
        value = getattr(body, field)
        if field == "name":
            name = (value or "").strip()
            if not name:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "A food needs a name.")
            if len(name) > MAX_NAME:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, f"A name must be at most {MAX_NAME} characters."
                )
            entry.name = name
        else:
            setattr(entry, field, value)

    db.commit()
    return entry_row(entry)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    entry = own_entry(db, user, entry_id)
    refuse_if_complete(db, user, entry.date_for)
    db.delete(entry)
    db.commit()
