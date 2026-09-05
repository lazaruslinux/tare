"""The small copies of the front photos that were stored before there were any.

A thumb is written beside every front photo as it is uploaded. The pictures
that predate that get theirs from here, run once from the shell:

    python manage.py make-thumbnails

Every front photo on disk without one gets it, and everything else is left
alone, so running it a second time costs a stat per photo and nothing else.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, photos

log = logging.getLogger("tare.thumbs")


def backfill(db: Session) -> int:
    """Write the missing thumbs, and answer with how many were written."""
    names = db.execute(
        select(models.FoodPhoto.path).where(models.FoodPhoto.purpose == "front")
    ).scalars().all()
    written = 0
    for name in names:
        if photos.stored(photos.thumb_name(name)) or not photos.stored(name):
            continue
        try:
            with open(photos.path_for(name), "rb") as handle:
                photos.write_thumb(handle.read(), name)
        except (OSError, photos.RejectedImage):
            # One file that will not be read is not a reason to leave the rest
            # of the list without their thumbs.
            log.warning("Could not write a thumbnail for %s", name)
            continue
        written += 1
    return written
