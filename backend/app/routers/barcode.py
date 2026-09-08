"""Resolving a scanned barcode, which is the one thing here that goes online.

A code is answered from the shared database, then from the caller's own foods,
then from what this instance already fetched, and only then from somebody else's
server, so the second scan of an approved food never leaves the machine. What
comes back is kept as a food row with status 'cache': a note this instance made
rather than a food, belonging to nobody and never searched or listed.
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import foods_api, models, throttle
from app.db import get_db
from app.deps import require_user
from app.models import FOOD_NUTRIENTS, now_utc
from app.routers.foods import (
    BAD_BARCODE,
    BARCODE_PATTERN,
    LISTED,
    MAX_SERVING_NAME,
    food_detail,
)

router = APIRouter(prefix="/barcode", tags=["barcode"])

# How long a fetched reading is trusted before it is asked for again. A label
# changes rarely and a month is far longer than anybody's shopping cycle, so in
# practice this only matters for a product that was reformulated.
CACHE_DAYS = 30

# What the screen says a reading came from. The internal names are short
# because they live in a column; these are what a person reads.
SOURCE_NAMES = {
    "off": "Open Food Facts",
}

# A record with no product name at all is still worth prefilling from: every
# other number on it is good, and naming it is the first thing the form asks.
UNNAMED = "Unnamed product"


def prefill(food: models.Food) -> dict[str, object]:
    """A cached reading as the form reads it: a suggestion, not a food.

    Deliberately not shaped like a food. It has no id, because there is nothing
    to log or to pin, and calling it a food is how a cache row ends up somewhere
    a cache row must never be.
    """
    serving = food.servings[0] if food.servings else None
    payload: dict[str, object] = {
        "barcode": food.barcode,
        "name": food.name,
        "brand": food.brand,
        "base_unit": food.base_unit,
        "density_g_per_ml": food.density_g_per_ml,
        "ingredients_text": food.ingredients_text,
        "source": SOURCE_NAMES.get(food.source, food.source),
        "serving": None
        if serving is None
        else {
            "name": serving.name,
            "amount": serving.amount,
            "unit": serving.unit,
            "base_amount": serving.base_amount,
        },
    }
    for field in FOOD_NUTRIENTS:
        payload[field] = getattr(food, field)
    return payload


def remember(db: Session, code: str, result: foods_api.FoodResult) -> models.Food:
    """Write a fetched reading down, replacing any older one for this barcode.

    Updated in place rather than inserted beside, so scanning the same code
    twice leaves one row however many times it happens.
    """
    row = db.execute(
        select(models.Food).where(models.Food.status == "cache", models.Food.barcode == code)
    ).scalars().first()
    if row is None:
        row = models.Food(status="cache", barcode=code)
        db.add(row)

    row.owner_id = None
    row.created_by_id = None
    row.source = result.source
    row.source_id = result.source_id
    row.name = result.name or UNNAMED
    row.brand = result.brand
    row.base_unit = result.base_unit
    row.density_g_per_ml = result.density_g_per_ml
    row.ingredients_text = result.ingredients_text
    for field in FOOD_NUTRIENTS:
        setattr(row, field, getattr(result, field))
    # Whatever the record had, kept on the cache row so a food built from this
    # scan arrives with its vitamins already in it. Nothing about the panel
    # above depends on them and nothing here goes looking for more.
    row.micros = result.micros or None
    row.micros_source = "off" if result.micros else None
    row.micros_ref = code if result.micros else None
    row.fetched_at = now_utc()

    # The label's own serving, when the source gave one that can be multiplied.
    # A phrase with no size behind it is not a serving anything can be weighed
    # against, so it is dropped rather than stored as a name with no number.
    if result.serving_amount:
        name = (result.serving.strip() or "1 serving")[:MAX_SERVING_NAME]
        # A source states a serving in the food's own base unit, so that is
        # what it was typed in as far as this row is concerned.
        row.servings = [
            models.FoodServing(
                name=name,
                amount=result.serving_amount,
                unit=row.base_unit,
                base_amount=result.serving_amount,
            )
        ]
    else:
        row.servings = []
    db.commit()
    return row


@router.get("/{code}")
def resolve_barcode(
    code: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """What this instance knows about one scanned code.

    Four answers, and the client does something different with each. 'approved'
    and 'mine' are a food to log. 'prefill' is a form to correct and send.
    'blank' is a form with nothing in it but the number.

    A plain synchronous route on purpose: FastAPI runs one in a worker thread,
    so the seconds this may spend waiting on somebody else's server are spent
    off the event loop without any of it being written out by hand here.
    """
    if not BARCODE_PATTERN.match(code):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_BARCODE)
    # Administrators are not counted, the same as the day caps: the person
    # working the queue scans the shelf they are checking.
    if not user.is_admin and throttle.barcode_limiter.hit(str(user.id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY_SCANS)

    shared = db.execute(
        select(models.Food).where(models.Food.status == "approved", models.Food.barcode == code)
    ).scalars().first()
    if shared is not None:
        return {"state": "approved", "food": food_detail(db, shared, user)}

    # Their own copy, whether it is private or waiting on the queue. Somebody
    # else's is not consulted: a private food is private, and a pending one is
    # only theirs until it is approved. A correction they have offered is not a
    # food at all, so it is not one a scan can land on either.
    own = db.execute(
        select(models.Food)
        .where(
            models.Food.owner_id == user.id,
            models.Food.barcode == code,
            models.Food.status.in_(LISTED),
        )
        .order_by(models.Food.id)
    ).scalars().first()
    if own is not None:
        return {"state": "mine", "food": food_detail(db, own, user)}

    cached = db.execute(
        select(models.Food).where(models.Food.status == "cache", models.Food.barcode == code)
    ).scalars().first()
    if cached is not None and cached.fetched_at is not None:
        if cached.fetched_at > now_utc() - dt.timedelta(days=CACHE_DAYS):
            return {"state": "prefill", "prefill": prefill(cached)}

    # The connection goes back to the pool before the wait. Nothing here is
    # half written, so this ends the transaction rather than saving anything,
    # and the seconds somebody else's server may take are seconds this process
    # is not holding a connection nobody else can have.
    db.commit()

    try:
        result = foods_api.lookup(code)
    except foods_api.FoodApiError as failure:
        # A reading this instance already has beats an error about a network.
        # It is out of date rather than wrong, and the person is standing in
        # front of the product either way.
        if cached is not None:
            return {"state": "prefill", "prefill": prefill(cached)}
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(failure)) from None

    if result is None:
        # Nothing out there. An old reading is still better than an empty form.
        if cached is not None:
            return {"state": "prefill", "prefill": prefill(cached)}
        return {"state": "blank", "barcode": code}
    return {"state": "prefill", "prefill": prefill(remember(db, code, result))}
