"""Pictures of food: uploading one, and reading one back.

A photo is uploaded before the food it belongs to exists, because somebody
attaches it while filling the form in and may never send the form. So an upload
lands as a row belonging to nobody's food, and the submission that follows
claims it. The ones no submission ever claims are swept up here.

Two kinds, and they are not read by the same rule. A front photo is the pack on
a shelf: one per food is published and anybody signed in may read it. A label
photo is the nutrition panel, offered as evidence for a request, and it is
never served to anybody but the person who took it and an administrator. That
is the whole of the difference, and it is enforced here rather than trusted to
the screens.

A photo somebody may not see answers exactly what an id that was never used
answers.
"""

from __future__ import annotations

import datetime as dt
import os
import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import Select, or_, select, update
from sqlalchemy.orm import Session

from app import caps, models, photos
from app.db import get_db
from app.deps import require_user, reviews
from app.models import now_utc

router = APIRouter(prefix="/photos", tags=["photos"])

MISSING_PHOTO = "There is no such photo."
NO_FILE = "Choose a picture to attach."
TOO_LARGE = "A photo must be at most 10 MB."
BAD_PURPOSE = "A photo is of the front or of the label."

# What a stored file is named, which is the only shape this router will look
# for on disk. An avatar is read by its file name rather than by an id, so the
# name in the address is held to the pattern the server writes before anything
# is joined to a path with it.
STORED_NAME = re.compile(r"^[0-9a-f]{32}\.webp$")

# How long an upload that was never sent with anything is kept. Long enough
# that somebody who filled a form in, went away, and came back still has their
# picture; short enough that the directory is not a graveyard.
ORPHAN_HOURS = 24

# How long a label photo outlives the decision it was evidence for: long enough
# that a member can still question the answer, and then gone.
LABEL_KEEP_DAYS = 30


def readable_photo(db: Session, user: models.User, photo_id: int) -> models.FoodPhoto:
    """The picture, or the answer a wrong id gets.

    A label photo is the narrow case and it is checked first: whatever its
    status, only the person who took it and somebody who reviews are ever
    served one. Nothing publishes a label photo, so this is a second lock on a
    door that should already be shut. A reviewer is served it because reading
    the panel against the numbers is the whole of what reviewing is.
    """
    photo = db.get(models.FoodPhoto, photo_id)
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_PHOTO)
    if photo.uploaded_by_id == user.id or reviews(user):
        return photo
    if photo.purpose == "front" and photo.status == "approved":
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
            models.FoodPhoto.purpose == "front",
        )
    ).scalars().first()


def front_photo(db: Session, food_id: int) -> models.FoodPhoto | None:
    """The front picture this food carries, published or still waiting.

    The published one if there is one, and otherwise the newest its owner has
    attached: while a food is somebody's own, the picture they put on it is the
    picture they should be looking at.
    """
    shown = published(db, food_id)
    if shown is not None:
        return shown
    return db.execute(
        select(models.FoodPhoto)
        .where(
            models.FoodPhoto.food_id == food_id,
            models.FoodPhoto.status == "pending",
            models.FoodPhoto.purpose == "front",
        )
        .order_by(models.FoodPhoto.id.desc())
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
    db.execute(
        update(models.FoodSubmission)
        .where(models.FoodSubmission.label_photo_id == photo.id)
        .values(label_photo_id=None)
    )
    db.execute(
        update(models.Food)
        .where(models.Food.label_photo_id == photo.id)
        .values(label_photo_id=None)
    )
    db.delete(photo)
    photos.remove(name)


def kept_by_a_food() -> Select[tuple[int | None]]:
    """The labels shared foods are holding, which nothing ever sweeps up.

    A food keeps one panel for life. It is the picture a reviewer checks a
    correction against, so it outlives every request that ever carried it.
    """
    return select(models.Food.label_photo_id).where(models.Food.label_photo_id.is_not(None))


def _spent_labels(db: Session) -> list[models.FoodPhoto]:
    """Label photos under decisions old enough to be settled.

    A label is evidence for one request. Once that request has been answered
    and the answer has stood for LABEL_KEEP_DAYS, the picture has done its job.
    A photo is only let go when every request pointing at it is that old, and
    when no food is keeping it as its own panel.
    """
    settled = now_utc() - dt.timedelta(days=LABEL_KEEP_DAYS)
    aged = select(models.FoodSubmission.label_photo_id).where(
        models.FoodSubmission.label_photo_id.is_not(None),
        models.FoodSubmission.status != "pending",
        models.FoodSubmission.decided_at.is_not(None),
        models.FoodSubmission.decided_at < settled,
    )
    still_needed = select(models.FoodSubmission.label_photo_id).where(
        models.FoodSubmission.label_photo_id.is_not(None),
        or_(
            models.FoodSubmission.status == "pending",
            models.FoodSubmission.decided_at.is_(None),
            models.FoodSubmission.decided_at >= settled,
        ),
    )
    return list(
        db.execute(
            select(models.FoodPhoto).where(
                models.FoodPhoto.purpose == "label",
                models.FoodPhoto.id.in_(aged),
                models.FoodPhoto.id.not_in(still_needed),
                models.FoodPhoto.id.not_in(kept_by_a_food()),
            )
        ).scalars().all()
    )


def _sweep(db: Session) -> None:
    """Drop the uploads nobody ever sent, on the way past.

    Opportunistic rather than scheduled: the only thing that makes orphans is
    an upload, so an upload is exactly when it is worth looking for them, and
    an instance nobody is uploading to has none to sweep.
    """
    cutoff = now_utc() - dt.timedelta(hours=ORPHAN_HOURS)
    # A label photo never gets a food: it belongs to the request that carries
    # it. So the sweep asks whether anything still points at it rather than
    # whether it reached a food, or it would take away the evidence under a
    # request nobody has judged yet.
    spoken_for = select(models.FoodSubmission.label_photo_id).where(
        models.FoodSubmission.label_photo_id.is_not(None)
    )
    stale = db.execute(
        select(models.FoodPhoto).where(
            models.FoodPhoto.food_id.is_(None),
            models.FoodPhoto.status == "pending",
            models.FoodPhoto.created_at < cutoff,
            models.FoodPhoto.id.not_in(spoken_for),
            # A panel an administrator put straight on a shared food never
            # reaches a food_id either, and the food is what holds it.
            models.FoodPhoto.id.not_in(kept_by_a_food()),
        )
    ).scalars().all()
    for photo in stale:
        discard(db, photo)
    for photo in _spent_labels(db):
        discard(db, photo)


@router.post("", status_code=status.HTTP_201_CREATED)
def upload_photo(
    file: UploadFile = File(default=None),
    purpose: str = Form(default="front"),
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, int]:
    """Take one picture, and answer with the id a submission attaches it by."""
    caps.check_photos(db, user)
    if file is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_FILE)
    if purpose not in models.PHOTO_PURPOSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_PURPOSE)
    # One byte past the ceiling is enough to know it is over it, and is the
    # most this ever holds.
    raw = file.file.read(photos.MAX_UPLOAD_BYTES + 1)
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_FILE)
    if len(raw) > photos.MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, TOO_LARGE)

    try:
        name = photos.store(raw, purpose)
    except photos.RejectedImage as refused:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(refused)) from None

    _sweep(db)
    row = models.FoodPhoto(
        uploaded_by_id=user.id, path=name, status="pending", purpose=purpose
    )
    db.add(row)
    db.commit()
    return {"photo_id": row.id}


@router.get("/avatar/{name}")
def read_avatar(
    name: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> FileResponse:
    """One member's picture of themselves.

    Every signed-in member may read any of them: an avatar is what somebody
    chose to be seen as, and it is shown beside their name wherever they turn
    up. A name that is not an account's current picture answers the same as a
    name that was never anybody's.
    """
    if STORED_NAME.match(name) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_PHOTO)
    owner = db.execute(
        select(models.User.id).where(models.User.avatar_path == name)
    ).scalars().first()
    stored = photos.path_for(name)
    if owner is None or not os.path.isfile(stored):
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_PHOTO)
    return FileResponse(
        stored,
        media_type=photos.MEDIA_TYPE,
        headers={"Cache-Control": "private, max-age=3600"},
    )


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
