"""How much one member may add to the shared database in a day.

Day counts held in the database rather than a sliding window in memory, because
what they guard against is not a burst: it is somebody scanning a shelf of toys
into the review queue at whatever speed, and a window in memory forgets.
Administrators are not counted, the queue being theirs to work through.
"""

from __future__ import annotations

import datetime as dt

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import InstrumentedAttribute, Session

from app import clock, models

# What one member may offer, and photograph, between one midnight and the next.
# Both are far past a person cooking and shopping and nowhere near a script.
DAILY_SUBMISSIONS = 25
DAILY_PHOTOS = 40

TOO_MANY_SUBMISSIONS = (
    "You've reached today's limit for community submissions. Try again tomorrow."
)
TOO_MANY_PHOTOS = "You've reached today's limit for photo uploads. Try again tomorrow."


def day_start(user: models.User) -> dt.datetime:
    """The first moment of this member's own day, as a UTC instant.

    Their day rather than the server's: the counts reset at their midnight, the
    same one the diary calls today.
    """
    midnight = dt.datetime.combine(clock.user_today(user), dt.time.min, clock.user_tz(user))
    return midnight.astimezone(dt.timezone.utc)


def _made_today(
    db: Session,
    whose: InstrumentedAttribute[int | None],
    when: InstrumentedAttribute[dt.datetime],
    user: models.User,
) -> int:
    """How many of one kind of row this member wrote since their midnight."""
    return int(
        db.execute(
            select(func.count()).where(whose == user.id, when >= day_start(user))
        ).scalar_one()
    )


def check_submissions(db: Session, user: models.User) -> None:
    """Refuse a submission from somebody who has offered enough today."""
    if user.is_admin:
        return
    made = _made_today(
        db,
        models.FoodSubmission.submitted_by_id,
        models.FoodSubmission.created_at,
        user,
    )
    if made >= DAILY_SUBMISSIONS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, TOO_MANY_SUBMISSIONS)


def check_photos(db: Session, user: models.User) -> None:
    """Refuse an upload from somebody who has sent enough pictures today."""
    if user.is_admin:
        return
    sent = _made_today(
        db, models.FoodPhoto.uploaded_by_id, models.FoodPhoto.created_at, user
    )
    if sent >= DAILY_PHOTOS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, TOO_MANY_PHOTOS)
