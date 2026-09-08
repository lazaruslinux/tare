"""The two addresses a health export arrives at.

The order the checks run in is the design of this file: the body cap in the
middleware, then the rate limiter by address, then the sync token or, for a
file, the session, and only last the body itself. Read any earlier and an
unauthorised caller could make this server parse megabytes for them.
"""

from __future__ import annotations

import datetime as dt
import json
import threading
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app import clock, ingest_hae, ingest_hc, models, throttle
from app.config import settings
from app.db import get_db, rows_touched
from app.deps import require_ingest_user, require_user

router = APIRouter(prefix="/ingest", tags=["ingest"])

BAD_BODY = "Body must be JSON."
NO_FILE = "Choose a file to upload."
NOT_AN_EXPORT = "This file is not a health export."
UPLOADS_OFF = "File uploads are turned off."

# What a health export may look like before this server reads it properly.
# A file is the one thing here somebody hands over by hand, and a hand can hand
# over anything, so the shape is settled first and cheaply: past either of
# these ceilings the walk stops where it is rather than finishing the count.
MAX_DEPTH = 12
MAX_KEYS = 200_000

# How long the record of a sync is kept. Long enough to see a pattern in what a
# phone keeps failing to send, short enough that the table stays small. Purged
# on the account's own next sync, so no scheduled job has to exist for it.
LOG_DAYS = 90

# One import at a time across the whole process. An export is up to fifteen
# megabytes parsed into memory and then walked row by row, so two of them at
# once is twice the memory for no more throughput. A second one waits its turn;
# it is never refused.
_one_at_a_time = threading.Semaphore(1)


def _refuse_constant(literal: str) -> float:
    """Called by the parser for a bare NaN, Infinity or -Infinity.

    Python accepts all three even though no other JSON reader has to, and a
    figure that is not a number has nowhere to go: it would reach a Float
    column as a value Postgres cannot write back out. Refusing here turns it
    into the same refusal any other unreadable body gets.
    """
    raise ValueError(f"{literal} is not a number this address accepts")


def _shaped_like_an_export(payload: dict[str, Any]) -> bool:
    """Whether this is worth reading properly.

    An Apple export carries `data`; the Android bridge carries its arrays. A
    body that is neither is somebody's holiday photos as JSON.
    """
    return "data" in payload or ingest_hc.looks_like(payload)


def _within_shape(payload: Any) -> bool:
    """One walk of the whole body, with a budget for depth and for keys.

    Iterative rather than recursive, because the thing being guarded against
    here is exactly a body deep enough to end a recursive walk in a
    RecursionError. The budget is spent as the walk goes, so a body that is
    past a ceiling costs the walk up to the ceiling and not a byte more.
    """
    budget = MAX_KEYS
    stack: list[tuple[Any, int]] = [(payload, 1)]
    while stack:
        node, depth = stack.pop()
        if depth > MAX_DEPTH:
            return False
        if isinstance(node, dict):
            budget -= len(node)
            if budget < 0:
                return False
            children: Any = node.values()
        elif isinstance(node, list):
            children = node
        else:
            continue
        # Only the boxes are walked. A number at the bottom of one is not
        # another level of nesting, and counting it as one would make the
        # ceiling a level shallower than it says.
        stack.extend(
            (child, depth + 1) for child in children if isinstance(child, (dict, list))
        )
    return True


def _receive(
    db: Session, user: models.User, raw: bytes, uploaded: bool = False
) -> dict[str, int]:
    """One export, from the moment its bytes are in hand.

    Both ways in end here, so a file somebody picked can never be read by
    slightly different rules than a phone's post. The one difference is what
    every row is stamped with, which is the whole of `uploaded`.
    """
    with _one_at_a_time:
        return _import(db, user, raw, uploaded)


def _import(
    db: Session, user: models.User, raw: bytes, uploaded: bool
) -> dict[str, int]:
    """The import itself, with the turn already taken."""
    try:
        payload = json.loads(raw, parse_constant=_refuse_constant)
    except (ValueError, RecursionError):
        # Every way a body can be unreadable is a ValueError, the refusal above
        # included. RecursionError joins them because the parser runs out of
        # stack on a body nested deeply enough, and that is the same unreadable
        # body rather than a fault of this server's.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_BODY) from None
    if not isinstance(payload, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_BODY)
    if not _shaped_like_an_export(payload) or not _within_shape(payload):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NOT_AN_EXPORT)

    dialect = "hc" if ingest_hc.looks_like(payload) else "hae"
    if dialect == "hc":
        payload = ingest_hc.translate(payload, clock.user_tz(user))

    # Counted before anything is parsed, so an export claiming a million
    # readings costs one length check rather than a million rows.
    metrics, workouts = ingest_hae.envelope(payload)
    oversized = ingest_hae.too_big(metrics, workouts)
    if oversized is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, oversized)

    source = "upload" if uploaded else "hc" if dialect == "hc" else "apple"
    counts = ingest_hae.import_payload(db, user, payload, source=source)
    _log(db, user, "upload" if uploaded else dialect, counts, len(raw) if uploaded else None)
    db.commit()
    return {
        "days": counts.days,
        "workouts": counts.workouts,
        "flagged": counts.flagged,
        "skipped": counts.skipped,
    }


async def raw_body(request: Request) -> bytes:
    """The body, read on the event loop so the handler itself can be a plain def.

    A dependency rather than a declared parameter, and last in the signature,
    so it runs after the token or the session: reading the bytes is all that
    happens here, and the parse is still the handler's.
    """
    return await request.body()


@router.post("/health")
def ingest_health(
    db: Session = Depends(get_db),
    user: models.User = Depends(require_ingest_user),
    body: bytes = Depends(raw_body),
) -> dict[str, int]:
    """Plain and synchronous, like every other handler here: FastAPI runs one in
    a worker thread, so parsing megabytes never holds up anybody else's
    request."""
    return _receive(db, user, body)


def allowed_to_upload(
    request: Request, user: models.User = Depends(require_user)
) -> models.User:
    """Whether this account may hand over a file at all, before one is read.

    The switch and both limiters live here rather than in the handler so they
    are settled before the dependency below parses a multipart body.
    """
    if not settings.uploads_enabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, UPLOADS_OFF)
    if throttle.ingest_limiter.hit(throttle.client_address(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY)
    # And again per account, on top of the address. A file is parsed for
    # somebody this server already knows, so the allowance is theirs.
    if throttle.upload_limiter.hit(str(user.id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY_UPLOADS)
    return user


async def picked_file(request: Request) -> bytes:
    """The file somebody chose, read on the event loop for the same reason as
    the body above."""
    async with request.form() as form:
        picked = form.get("file")
        if not isinstance(picked, UploadFile):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_FILE)
        return await picked.read()


@router.post("/upload")
def upload_export(
    db: Session = Depends(get_db),
    user: models.User = Depends(allowed_to_upload),
    raw: bytes = Depends(picked_file),
) -> dict[str, int]:
    """The same export as a file, from somebody already signed in.

    A session and never a sync key: this is a person at a screen, and the key
    belongs to the phone. The name a file was given and the type it claims are
    read by nothing here: the only thing that decides what this is, is what is
    inside it.
    """
    return _receive(db, user, raw, uploaded=True)


def has_uploads(db: Session, user_id: int) -> bool:
    """Whether anything on this account came out of a file.

    Read rather than remembered: the mark is on the rows, so a wipe leaves this
    false without anything having to be reset.
    """
    for statement in (
        select(models.FitnessDaily.id).where(
            models.FitnessDaily.user_id == user_id, models.FitnessDaily.source == "upload"
        ),
        select(models.FitnessIntraday.id).where(
            models.FitnessIntraday.user_id == user_id,
            models.FitnessIntraday.source == "upload",
        ),
        select(models.Workout.id).where(
            models.Workout.user_id == user_id, models.Workout.source == "upload"
        ),
        select(models.WeightEntry.id).where(
            models.WeightEntry.user_id == user_id, models.WeightEntry.via == "upload"
        ),
    ):
        if db.scalar(statement.limit(1)) is not None:
            return True
    return False


@router.delete("/uploads")
def wipe_uploads(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> dict[str, int]:
    """Take back every number that came out of a file, and nothing else.

    A member who uploaded something they should not have has to be able to
    undo that in one act, and it has to be believable: what a phone synced and
    what they typed in are untouched, because neither carries the mark.

    The route and the minute rows of a workout go with it explicitly rather
    than by trusting a cascade, so this reads the same on Postgres and on the
    SQLite the tests run against.
    """
    workouts = list(
        db.scalars(
            select(models.Workout.id).where(
                models.Workout.user_id == user.id, models.Workout.source == "upload"
            )
        )
    )
    removed = 0
    if workouts:
        db.execute(
            delete(models.WorkoutSample).where(models.WorkoutSample.workout_id.in_(workouts))
        )
        db.execute(
            delete(models.WorkoutRoute).where(models.WorkoutRoute.workout_id.in_(workouts))
        )
        removed += rows_touched(
            db.execute(delete(models.Workout).where(models.Workout.id.in_(workouts)))
        )
    removed += rows_touched(
        db.execute(
            delete(models.FitnessDaily).where(
                models.FitnessDaily.user_id == user.id,
                models.FitnessDaily.source == "upload",
            )
        )
    )
    removed += rows_touched(
        db.execute(
            delete(models.FitnessIntraday).where(
                models.FitnessIntraday.user_id == user.id,
                models.FitnessIntraday.source == "upload",
            )
        )
    )
    removed += rows_touched(
        db.execute(
            delete(models.WeightEntry).where(
                models.WeightEntry.user_id == user.id, models.WeightEntry.via == "upload"
            )
        )
    )
    # A wipe is a thing that happened to the data, so it is written down where
    # the syncs are. The count is what went, and there is nothing else to say.
    _log(db, user, "wipe", ingest_hae.Counts(items=removed))
    db.commit()
    return {"removed": removed}


def _log(
    db: Session,
    user: models.User,
    dialect: str,
    counts: ingest_hae.Counts,
    size: int | None = None,
) -> None:
    """That the sync happened, and this account's expired records dropped in the
    same breath. There is no payload column and there never will be one."""
    now = models.now_utc()
    db.add(
        models.IngestLog(
            user_id=user.id,
            received_at=now,
            dialect=dialect,
            bytes=size,
            items=counts.items,
            accepted=counts.days + counts.workouts,
            # The split, so a row can say what it brought. A wipe brought
            # nothing, and says so by leaving both null.
            days=None if dialect == "wipe" else counts.days,
            workouts=None if dialect == "wipe" else counts.workouts,
            flagged=counts.flagged,
            skipped=counts.skipped,
            error=counts.error,
        )
    )
    db.execute(
        delete(models.IngestLog).where(
            models.IngestLog.user_id == user.id,
            models.IngestLog.received_at < now - dt.timedelta(days=LOG_DAYS),
        )
    )
