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
from sqlalchemy.orm import Session

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


def _made_today(db: Session, user: models.User, kind: str) -> int:
    """How many of one kind this member has been marked for since their
    midnight. Marks rather than the rows themselves, so withdrawing a
    submission or sweeping a photo up does not hand the allowance back."""
    return int(
        db.execute(
            select(func.count()).where(
                models.CapMark.user_id == user.id,
                models.CapMark.kind == kind,
                models.CapMark.created_at >= day_start(user),
            )
        ).scalar_one()
    )


def mark(db: Session, user: models.User, kind: str) -> None:
    """Count one thing against today. Written in the same transaction as the
    row it is about, so the two cannot come apart."""
    db.add(models.CapMark(user_id=user.id, kind=kind))


def check_submissions(db: Session, user: models.User) -> None:
    """Refuse a submission from somebody who has offered enough today."""
    if user.is_admin:
        return
    if _made_today(db, user, "submission") >= DAILY_SUBMISSIONS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, TOO_MANY_SUBMISSIONS)


def check_photos(db: Session, user: models.User) -> None:
    """Refuse an upload from somebody who has sent enough pictures today."""
    if user.is_admin:
        return
    if _made_today(db, user, "photo") >= DAILY_PHOTOS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, TOO_MANY_PHOTOS)
