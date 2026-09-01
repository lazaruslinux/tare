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
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import clock, models, schemas, units
from app.db import get_db
from app.deps import require_user
from app.models import DIARY_SLOTS, NUTRIENTS, SERVING_UNIT
from app.routers.foods import MAX_NAME, readable_food

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

# How a serving is asked for, as against a unit from a measure family.
SERVING_PREFIX = "serving:"

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


def snapshot(entry: models.DiaryEntry, food: models.Food, base_amount: float) -> None:
    """Copy the food's panel onto the entry, at the amount actually eaten.

    Null stays null the whole way down: a nutrient the label never gave is not
    zero of it, at any portion size.
    """
    for field in NUTRIENTS:
        per_100 = getattr(food, field)
        setattr(entry, field, None if per_100 is None else per_100 * base_amount / 100)


def stored_unit(entry: models.DiaryEntry, food: models.Food) -> str:
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
    """One day: its entries by meal, its subtotals, and what it came to."""
    day = asked_day(date, user)
    entries = list(
        db.execute(
            select(models.DiaryEntry)
            .where(models.DiaryEntry.user_id == user.id, models.DiaryEntry.date_for == day)
            .order_by(models.DiaryEntry.id)
        ).scalars()
    )
    by_slot = {slot: [entry for entry in entries if entry.slot == slot] for slot in DIARY_SLOTS}
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
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def add_entry(
    body: schemas.DiaryIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Log something. Either a food measured out, or a name and its calories."""
    entry = models.DiaryEntry(
        user_id=user.id,
        date_for=body.date or clock.user_today(user),
        slot=checked_slot(body.slot),
        brand="",
    )

    if body.food_id is not None:
        food = readable_food(db, user, body.food_id)
        if body.amount is None or not body.unit:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_AMOUNT)
        base_amount, label, kept_unit = measure(food, body.amount, body.unit)
        entry.name = food.name
        entry.brand = food.brand
        entry.food_id = food.id
        entry.amount = body.amount
        entry.unit = kept_unit
        entry.serving_label = label
        snapshot(entry, food, base_amount)
    else:
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

    if "amount" in sent or "unit" in sent:
        amount = body.amount if body.amount is not None else entry.amount
        if amount is None or amount <= 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_AMOUNT)
        if food is not None:
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
