"""Pictures of labels: uploading one, and reading one back.

A photo is uploaded before the food it belongs to exists, because somebody
attaches it while filling the form in and may never send the form. So an upload
lands as a row belonging to nobody's food, and the submission that follows
claims it. The ones no submission ever claims are swept up here.

Who may see one follows the food it is attached to. A picture waiting on a
decision is visible to the person who took it and to an administrator; a
published one is visible to anybody signed in. A photo somebody may not see
answers exactly what an id that was never used answers.
"""

from __future__ import annotations

import datetime as dt
import os

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app import models, photos
from app.db import get_db
from app.deps import require_user
from app.models import now_utc

router = APIRouter(prefix="/photos", tags=["photos"])

MISSING_PHOTO = "There is no such photo."
NO_FILE = "Choose a picture to attach."
TOO_LARGE = "A photo must be at most 10 MB."

# How long an upload that was never sent with anything is kept. Long enough
# that somebody who filled a form in, went away, and came back still has their
# picture; short enough that the directory is not a graveyard.
ORPHAN_HOURS = 24


def readable_photo(db: Session, user: models.User, photo_id: int) -> models.FoodPhoto:
    photo = db.get(models.FoodPhoto, photo_id)
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_PHOTO)
    if photo.status == "approved":
        return photo
    if photo.uploaded_by_id == user.id or user.is_admin:
        return photo
    raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_PHOTO)


def published(db: Session, food_id: int) -> models.FoodPhoto | None:
    """The one picture a food shows, if it has been given one.

    Partial-unique in the database, so this is the row rather than the first of
    several: everything else attached to that food is still waiting.
    """
    return db.execute(
        select(models.FoodPhoto).where(
            models.FoodPhoto.food_id == food_id,
            models.FoodPhoto.status == "approved",
        )
    ).scalars().first()


def discard(db: Session, photo: models.FoodPhoto) -> None:
    """Take a photo out of the database and off the disk.

    The row goes first. A file left behind is a tidying job; a row pointing at
    a file that is gone is a broken picture on somebody's screen.
    """
    name = photo.path
    # What the foreign key already says, said again here: the constraint holds
    # on Postgres, and this keeps SQLite and the rows this session is holding
    # in step with it.
    db.execute(
        update(models.FoodSubmission)
        .where(models.FoodSubmission.photo_id == photo.id)
        .values(photo_id=None)
    )
    db.delete(photo)
    photos.remove(name)


def _sweep(db: Session) -> None:
    """Drop the uploads nobody ever sent, on the way past.

    Opportunistic rather than scheduled: the only thing that makes orphans is
    an upload, so an upload is exactly when it is worth looking for them, and
    an instance nobody is uploading to has none to sweep.
    """
    cutoff = now_utc() - dt.timedelta(hours=ORPHAN_HOURS)
    stale = db.execute(
        select(models.FoodPhoto).where(
            models.FoodPhoto.food_id.is_(None),
            models.FoodPhoto.status == "pending",
            models.FoodPhoto.created_at < cutoff,
        )
    ).scalars().all()
    for photo in stale:
        discard(db, photo)


@router.post("", status_code=status.HTTP_201_CREATED)
def upload_photo(
    file: UploadFile = File(default=None),
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, int]:
    """Take one picture, and answer with the id a submission attaches it by."""
    if file is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_FILE)
    # One byte past the ceiling is enough to know it is over it, and is the
    # most this ever holds.
    raw = file.file.read(photos.MAX_UPLOAD_BYTES + 1)
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_FILE)
    if len(raw) > photos.MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, TOO_LARGE)

    try:
        name = photos.store(raw)
    except photos.RejectedImage as refused:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(refused)) from None

    _sweep(db)
    row = models.FoodPhoto(uploaded_by_id=user.id, path=name, status="pending")
    db.add(row)
    db.commit()
    return {"photo_id": row.id}


@router.get("/{photo_id}.webp")
def read_photo(
    photo_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> FileResponse:
    photo = readable_photo(db, user, photo_id)
    stored = photos.path_for(photo.path)
    # A row whose file has gone reads as a photo that is not there, rather than
    # as the server failing: the answer a screen can do something with is the
    # same one a wrong id gets.
    if not os.path.isfile(stored):
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_PHOTO)
    return FileResponse(
        stored,
        media_type=photos.MEDIA_TYPE,
        # Private: the same address answers differently depending on who is
        # asking, so no shared cache should ever keep a copy of it.
        headers={"Cache-Control": "private, max-age=3600"},
    )
