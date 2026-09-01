"""The review queue: the only way anything reaches the shared database.

Approving a food does two things and no more. It changes the row's status and
lets go of its owner, so what was one person's becomes everybody's, and it
deletes the cached lookup for that barcode, so the next scan of the packet is
answered out of this database rather than off somebody else's server.

What it deliberately does not do is touch a diary. An entry keeps the numbers it
was logged with, worked out from the food as it stood at that moment, and a
decision made afterwards does not reach back and rewrite anybody's day. The
submitter's entries keep pointing at the same food, which is now the shared one.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app import models, schemas
from app.db import get_db
from app.deps import require_admin
from app.models import NUTRIENTS, now_utc
from app.routers.photos import discard
from app.routers.submissions import ALREADY_SHARED, MISSING_SUBMISSION

router = APIRouter(prefix="/admin", tags=["admin"])

# One already decided is not in the queue, so it reads the same as one that was
# never there.
NOT_WAITING = "That submission has already been decided."
NO_FOOD = "The food this was about is gone."


def proposed(food: models.Food) -> dict[str, object]:
    """The food as it is being offered: the whole panel, and nothing about who.

    Not the shape /foods/{id} answers with. That one says whether the reader
    owns it and whether they pin it, and neither question means anything to
    somebody reading a queue.
    """
    payload: dict[str, object] = {
        "id": food.id,
        "name": food.name,
        "brand": food.brand,
        "barcode": food.barcode,
        "base_unit": food.base_unit,
        "density_g_per_ml": food.density_g_per_ml,
        "ingredients_text": food.ingredients_text,
        "servings": [
            {"name": serving.name, "base_amount": serving.base_amount}
            for serving in food.servings
        ],
    }
    for field in NUTRIENTS:
        payload[field] = getattr(food, field)
    return payload


def waiting(db: Session, submission_id: int) -> models.FoodSubmission:
    submission = db.get(models.FoodSubmission, submission_id)
    if submission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_SUBMISSION)
    if submission.status != "pending":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NOT_WAITING)
    return submission


def offered_food(db: Session, submission: models.FoodSubmission) -> models.Food:
    food = db.get(models.Food, submission.food_id) if submission.food_id else None
    if food is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_FOOD)
    return food


def stamp(submission: models.FoodSubmission, admin: models.User, outcome: str, note: str) -> None:
    submission.status = outcome
    submission.decided_by_id = admin.id
    submission.decided_at = now_utc()
    submission.decision_note = note


@router.get("/queue")
def read_queue(
    db: Session = Depends(get_db), admin: models.User = Depends(require_admin)
) -> list[dict[str, object]]:
    """Everything waiting, oldest first: a queue, not a feed."""
    rows = db.execute(
        select(models.FoodSubmission, models.User.username)
        .outerjoin(models.User, models.User.id == models.FoodSubmission.submitted_by_id)
        .where(models.FoodSubmission.status == "pending")
        .order_by(models.FoodSubmission.created_at, models.FoodSubmission.id)
        .limit(200)
    ).all()

    queue: list[dict[str, object]] = []
    for submission, username in rows:
        food = db.get(models.Food, submission.food_id) if submission.food_id else None
        if food is None:
            continue
        photo_id = submission.photo_id
        queue.append(
            {
                "id": submission.id,
                "kind": submission.kind,
                "note": submission.note,
                "created_at": submission.created_at,
                # Null once the account that offered it is gone. The food is
                # still worth judging; there is just nobody to tell.
                "submitted_by": username,
                "photo_url": None if photo_id is None else f"/api/photos/{photo_id}.webp",
                "food": proposed(food),
            }
        )
    return queue


@router.post("/queue/{submission_id}/approve")
def approve(
    submission_id: int,
    body: schemas.ApproveIn,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
) -> dict[str, object]:
    """Publish a food. From here it is everybody's and nobody's."""
    submission = waiting(db, submission_id)
    food = offered_food(db, submission)

    if food.barcode:
        clash = db.execute(
            select(models.Food.id).where(
                models.Food.status == "approved",
                models.Food.barcode == food.barcode,
                models.Food.id != food.id,
            )
        ).first()
        if clash is not None:
            # Refused before anything is written. Two rows in the shared
            # database claiming one barcode is the one state the scanner
            # cannot resolve.
            raise HTTPException(status.HTTP_409_CONFLICT, ALREADY_SHARED)

    food.status = "approved"
    # Let go of the owner. A shared food outlives whoever submitted it, and it
    # is not theirs to edit any more than it is anybody else's.
    food.owner_id = None

    if food.barcode:
        # The cached lookup for this code has been superseded by a row a person
        # checked, so it goes. Every future scan of this packet is answered
        # from here without a request leaving the machine.
        db.execute(
            delete(models.Food).where(
                models.Food.status == "cache", models.Food.barcode == food.barcode
            )
        )

    photo = db.get(models.FoodPhoto, submission.photo_id) if submission.photo_id else None
    if photo is not None:
        if body.keep_photo:
            photo.status = "approved"
        else:
            discard(db, photo)

    stamp(submission, admin, "approved", "")
    db.commit()
    return {"food": proposed(food)}


@router.post("/queue/{submission_id}/reject")
def reject(
    submission_id: int,
    body: schemas.RejectIn,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
) -> dict[str, object]:
    """Turn a food down. The person who offered it keeps it, privately."""
    submission = waiting(db, submission_id)
    food = db.get(models.Food, submission.food_id) if submission.food_id else None
    if food is not None and food.status == "pending":
        food.status = "custom"

    photo = db.get(models.FoodPhoto, submission.photo_id) if submission.photo_id else None
    if photo is not None and photo.status == "pending":
        discard(db, photo)

    stamp(submission, admin, "rejected", body.note.strip())
    db.commit()
    return {"id": submission.id, "status": submission.status}
