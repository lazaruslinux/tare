"""The diary: what was eaten, when, and what it was worth.

An entry keeps its own numbers. They are worked out once, from the food as it
stood at that moment, and nothing afterwards rewrites them behind somebody's
back: correcting a food corrects the food, and deleting one leaves every meal it
was part of standing, with its name, its portion and its calories intact.

A diary is private without qualification. Somebody else's entry answers exactly
what an id that was never used answers, and an administrator is nobody special
here.
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import clock, health, models, schemas, units
from app.db import get_db
from app.deps import require_user
from app.models import DIARY_SLOTS, NUTRIENTS, SERVING_UNIT
from app.recipes import own_recipe, per_serving
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
BAD_SLOT = "That is not a meal."
BAD_UNIT = "That is not a unit this can measure in."
NO_AMOUNT = "Say how much of it you had."
NO_QUICK_ADD = "A quick add needs a name and its calories."
# What is left of an entry once its food is gone: a portion and a set of
# numbers, which can be made larger or smaller and nothing else.
UNLINKED_UNIT = "The food this came from is gone, so only the amount can change."
UNLINKED_SERVING = "Say which unit to measure it in."
NO_PORTION = "This entry has no amount to change."
LINKED_NUTRIENTS = "The numbers on a logged food come from the food itself."
RECIPE_NUTRIENTS = "The numbers on a logged recipe come from the recipe itself."
RECIPE_SERVINGS = "A recipe is counted in servings."
BOTH_KINDS = "Log a food or a recipe, not both."

# How a serving is asked for, as against a unit from a measure family.
SERVING_PREFIX = "serving:"

# How many days a run of them may ask for, and how many it asks for by default.
DEFAULT_HISTORY = 7
MAX_HISTORY = 90

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

    The one place a portion becomes a row, so a food logged by hand and a whole
    meal logged in one go cannot come out different.
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
    credit = exercise_credit(sum(row.kcal for row in workouts))
    weighed = next((row for row in state.rows if row.date_for == day), None)
    eaten = total(entries, "calories") or 0.0
    db.commit()

    return {
        "date": day.isoformat(),
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
        "exercise_minutes": sum(row.minutes for row in workouts),
        "exercise_minutes_goal": state.profile.exercise_minutes_goal,
        "remaining_calories": round(budget["calories"] + credit - eaten),
        # Where the day's own number came from, in five lines that add up. Null
        # when there is nothing to break down.
        "energy": day_energy(state, budget["calories"], credit),
        "measurement": None if weighed is None else measurement_row(weighed),
        "exercise": [exercise_row(row) for row in workouts],
    }


@router.get("/days")
def read_days(
    days: int = DEFAULT_HISTORY,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """A run of days ending today: what was consumed against what was budgeted.

    One row per calendar day rather than one per day that was logged, because
    the point of it is the days nobody logged. Two grouped queries and not one
    per day: a month of days is one answer, not a month of round trips.

    The budget is today's, the same one the day view reads a past day against
    (Reckoning takes no date). A day-by-day history of somebody's profile is
    not kept, so a past day is read against what is true now.
    """
    span = max(1, min(days, MAX_HISTORY))
    today = clock.user_today(user)
    first = today - dt.timedelta(days=span - 1)

    eaten = {
        row.date_for: row
        for row in db.execute(
            select(
                models.DiaryEntry.date_for,
                func.sum(func.coalesce(models.DiaryEntry.calories, 0.0)).label("calories"),
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

    state = Reckoning(db, user)
    budget = day_budget(state)["calories"]
    db.commit()

    run: list[dict[str, object]] = []
    for step in range(span):
        day = first + dt.timedelta(days=step)
        food = eaten.get(day)
        run.append(
            {
                "date": day.isoformat(),
                # Nothing logged is nothing consumed, which is a bar of no
                # height rather than a day with no answer.
                "calories": 0 if food is None else round(food.calories),
                "budget": budget,
                "exercise_kcal": exercise_credit(worked.get(day, 0.0)),
                "logged": food is not None,
            }
        )
    return {"days": run}


@router.post("", status_code=status.HTTP_201_CREATED)
def add_entry(
    body: schemas.DiaryIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Log something: a food measured out, a recipe by the serving, or a name
    and its calories."""
    day = body.date or clock.user_today(user)
    slot = checked_slot(body.slot)
    if body.food_id is not None and body.recipe_id is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BOTH_KINDS)

    if body.food_id is not None:
        food = readable_food(db, user, body.food_id)
        if body.amount is None or not body.unit:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_AMOUNT)
        entry = log_food(user, day, slot, food, body.amount, body.unit)
    elif body.recipe_id is not None:
        recipe = own_recipe(db, user, body.recipe_id)
        if body.amount is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_AMOUNT)
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

    if "date" in sent:
        if body.date is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_DATE)
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
        if recipe is not None:
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
            # Nothing left to recompute from, so the numbers that survived the
            # food are stretched. Null stays null.
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
    db.delete(own_entry(db, user, entry_id))
    db.commit()
