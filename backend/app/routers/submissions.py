"""Offering a food to the shared database, and taking the offer back.

Nothing here publishes anything. A submission makes a food 'pending', which is
still that person's own food: they can log it today, and it stays private until
an administrator says otherwise. That is the whole point of the arrangement. The
alternative is a database that fills up with whatever the first person to scan
something happened to type.

What a submission is held to is stricter than what a private food is held to. A
food kept for yourself needs four numbers, because the other six are on the
label or they are not and nobody else is relying on them. A food everybody will
eat out of needs the whole panel and at least one serving, because the person
filling it in is looking at the packet and nobody after them will be.
"""

from __future__ import annotations

from collections.abc import Sequence

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.db import get_db
from app.deps import require_user
from app.models import NUTRIENTS
from app.routers.barcode import BAD_BARCODE, BARCODE_PATTERN
from app.routers.foods import OWNED, apply_body, food_detail, readable_food
from app.routers.photos import discard

router = APIRouter(tags=["submissions"])

MISSING_SUBMISSION = "There is no such submission."
# A pending submission is the only kind that can still be taken back. One that
# has been decided is history, and history does not get withdrawn.
NOT_WITHDRAWABLE = "That submission has already been decided."
ALREADY_MINE = "You already have a food with this barcode."
ALREADY_SHARED = "This barcode is already in the shared database."
ALREADY_OFFERED = "This food is already waiting for a decision."
NOT_YOURS_TO_OFFER = "Only your own foods can be offered to the shared database."
MISSING_PHOTO = "That photo is not there to attach."

# What each nutrient is called when a sentence has to name the missing one.
NUTRIENT_LABELS = {
    "calories": "Calories",
    "protein_g": "Protein",
    "carbs_g": "Carbs",
    "fat_g": "Fat",
    "saturated_fat_g": "Saturated fat",
    "trans_fat_g": "Trans fat",
    "cholesterol_mg": "Cholesterol",
    "sodium_mg": "Sodium",
    "fiber_g": "Fibre",
    "sugar_g": "Sugar",
}


def check_complete(panel: object, servings: Sequence[object] | None) -> None:
    """Refuse a half-filled panel, naming the first thing that is not there.

    Zero is an answer: a food with no fibre in it says nought, and that is a
    number somebody read off a label. An empty box is not an answer, and the
    difference is the whole rule.
    """
    for field in NUTRIENTS:
        if getattr(panel, field) is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"{NUTRIENT_LABELS[field]} is needed before this can be shared.",
            )
    if not servings:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "A serving is needed before this can be shared."
        )


def attach(db: Session, user: models.User, photo_id: int | None, food_id: int) -> int | None:
    """Claim an uploaded photo for a food, or refuse a photo that is not theirs."""
    if photo_id is None:
        return None
    photo = db.get(models.FoodPhoto, photo_id)
    if photo is None or photo.uploaded_by_id != user.id or photo.food_id is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, MISSING_PHOTO)
    photo.food_id = food_id
    return photo.id


def open_submission(db: Session, food_id: int) -> models.FoodSubmission | None:
    return db.execute(
        select(models.FoodSubmission).where(
            models.FoodSubmission.food_id == food_id,
            models.FoodSubmission.status == "pending",
        )
    ).scalars().first()


def submission_row(submission: models.FoodSubmission, name: str | None) -> dict[str, object]:
    return {
        "id": submission.id,
        "kind": submission.kind,
        "status": submission.status,
        # Null once the food it was about has been deleted. The row still reads,
        # because what somebody offered and what came of it is their own record.
        "name": name,
        "note": submission.note,
        "decision_note": submission.decision_note,
        "decided_at": submission.decided_at,
        "created_at": submission.created_at,
    }


@router.post("/submissions/food", status_code=status.HTTP_201_CREATED)
def submit_new_food(
    body: schemas.SubmissionIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """A food nobody has entered yet, offered from a scan or typed in whole."""
    code = (body.barcode or "").strip()
    if code and not BARCODE_PATTERN.match(code):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_BARCODE)

    if code:
        shared = db.execute(
            select(models.Food.id).where(
                models.Food.status == "approved", models.Food.barcode == code
            )
        ).first()
        if shared is not None:
            # Somebody got there first, most likely between the scan and the
            # send. 409 rather than 400: nothing about the body is wrong, and
            # the client answers this by resolving the code again.
            raise HTTPException(status.HTTP_409_CONFLICT, ALREADY_SHARED)
        held = db.execute(
            select(models.Food.id).where(
                models.Food.owner_id == user.id,
                models.Food.barcode == code,
                models.Food.status.in_(OWNED),
            )
        ).first()
        if held is not None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, ALREADY_MINE)

    check_complete(body, body.servings)
    food = models.Food(
        status="pending",
        owner_id=user.id,
        created_by_id=user.id,
        source="user",
        barcode=code or None,
    )
    apply_body(food, body)
    db.add(food)
    # The food's id is what the photo and the submission both point at, so it
    # has to exist before either of them is written.
    db.flush()

    submission = models.FoodSubmission(
        kind="new",
        food_id=food.id,
        photo_id=attach(db, user, body.photo_id, food.id),
        submitted_by_id=user.id,
        note=body.note.strip(),
        status="pending",
    )
    db.add(submission)
    db.commit()
    return {"submission_id": submission.id, "food": food_detail(db, food, user)}


@router.post("/foods/{food_id}/submit", status_code=status.HTTP_201_CREATED)
def submit_own_food(
    food_id: int,
    body: schemas.SubmitIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """One of your own foods, offered as it stands. A barcode is not needed."""
    food = readable_food(db, user, food_id)
    if food.owner_id != user.id or food.status != "custom":
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_YOURS_TO_OFFER)
    if open_submission(db, food.id) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, ALREADY_OFFERED)

    check_complete(food, food.servings)
    food.status = "pending"
    submission = models.FoodSubmission(
        kind="new",
        food_id=food.id,
        photo_id=attach(db, user, body.photo_id, food.id),
        submitted_by_id=user.id,
        note=body.note.strip(),
        status="pending",
    )
    db.add(submission)
    db.commit()
    return {"submission_id": submission.id, "food": food_detail(db, food, user)}


@router.get("/submissions/mine")
def list_my_submissions(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> list[dict[str, object]]:
    """What this account has offered, newest first, and what came of each."""
    rows = db.execute(
        select(models.FoodSubmission, models.Food.name)
        .outerjoin(models.Food, models.Food.id == models.FoodSubmission.food_id)
        .where(models.FoodSubmission.submitted_by_id == user.id)
        .order_by(models.FoodSubmission.created_at.desc(), models.FoodSubmission.id.desc())
        .limit(100)
    ).all()
    return [submission_row(submission, name) for submission, name in rows]


@router.delete("/submissions/{submission_id}", status_code=status.HTTP_204_NO_CONTENT)
def withdraw_submission(
    submission_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    """Take an offer back. The food stays, privately, exactly as it was."""
    submission = db.get(models.FoodSubmission, submission_id)
    if submission is None or submission.submitted_by_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_SUBMISSION)
    if submission.status != "pending":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NOT_WITHDRAWABLE)

    food = db.get(models.Food, submission.food_id) if submission.food_id else None
    if food is not None and food.status == "pending":
        food.status = "custom"

    # The picture went with the offer, so it goes back with it. A photo that
    # has already been published belongs to the shared database now and is left
    # exactly where it is.
    photo = db.get(models.FoodPhoto, submission.photo_id) if submission.photo_id else None
    if photo is not None and photo.status == "pending":
        discard(db, photo)

    db.delete(submission)
    db.commit()
