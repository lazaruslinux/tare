"""The two addresses a health export arrives at.

The order the checks run in is the whole design of this file, so it is written
out once here and followed exactly below.

The body cap comes first, in the middleware, before a single byte is held.
Then the rate limiter, keyed by address, inside the dependency and ahead of the
token: guessing keys has to cost the same allowance as syncing does, or the
limiter protects nothing. Then the token. Only then is the body read, so an
unauthorised caller never gets this server to parse fifteen megabytes for them.

After that, one row at a time inside its own savepoint. A sync carrying a
thousand days and one unreadable line writes the thousand days.

The second address takes the same export as a file, picked by somebody already
signed in, behind their session rather than a key. Same order, same caps, same
import, same answer.
"""

from __future__ import annotations

import datetime as dt
import json

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app import clock, ingest_hae, ingest_hc, models, throttle
from app.db import get_db
from app.deps import require_ingest_user, require_user

router = APIRouter(prefix="/ingest", tags=["ingest"])

BAD_BODY = "Body must be JSON."
NO_FILE = "Choose a file to upload."

# How long the record of a sync is kept. Long enough to see a pattern in what a
# phone keeps failing to send, short enough that the table stays small. Purged
# on the account's own next sync, so no scheduled job has to exist for it.
LOG_DAYS = 90


def _refuse_constant(literal: str) -> float:
    """Called by the parser for a bare NaN, Infinity or -Infinity.

    Python accepts all three even though no other JSON reader has to, and a
    figure that is not a number has nowhere to go: it would reach a Float
    column as a value Postgres cannot write back out. Refusing here turns it
    into the same refusal any other unreadable body gets.
    """
    raise ValueError(f"{literal} is not a number this address accepts")


def _receive(db: Session, user: models.User, raw: bytes) -> dict[str, int]:
    """One export, from the moment its bytes are in hand.

    Both ways in end here, so a file somebody picked can never be read by
    slightly different rules than a phone's post.
    """
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

    dialect = "hc" if ingest_hc.looks_like(payload) else "hae"
    if dialect == "hc":
        payload = ingest_hc.translate(payload, clock.user_tz(user))

    # Counted before anything is parsed, so an export claiming a million
    # readings costs one length check rather than a million rows.
    metrics, workouts = ingest_hae.envelope(payload)
    oversized = ingest_hae.too_big(metrics, workouts)
    if oversized is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, oversized)

    counts = ingest_hae.import_payload(
        db, user, payload, source="hc" if dialect == "hc" else "apple"
    )
    _log(db, user, dialect, counts)
    db.commit()
    return {
        "days": counts.days,
        "workouts": counts.workouts,
        "flagged": counts.flagged,
        "skipped": counts.skipped,
    }


@router.post("/health")
async def ingest_health(
    request: Request,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_ingest_user),
) -> dict[str, int]:
    return _receive(db, user, await request.body())


@router.post("/upload")
async def upload_export(
    request: Request,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, int]:
    """The same export as a file, from somebody already signed in.

    A session and never a sync key: this is a person at a screen, and the key
    belongs to the phone. The form is read here rather than declared as a
    parameter so the limiter and the session are both settled before this
    server parses a file for anybody.
    """
    if throttle.ingest_limiter.hit(throttle.client_address(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY)
    async with request.form() as form:
        picked = form.get("file")
        if not isinstance(picked, UploadFile):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_FILE)
        raw = await picked.read()
    return _receive(db, user, raw)


def _log(
    db: Session, user: models.User, dialect: str, counts: ingest_hae.Counts
) -> None:
    """That the sync happened, and this account's expired records dropped in the
    same breath. There is no payload column and there never will be one."""
    now = models.now_utc()
    db.add(
        models.IngestLog(
            user_id=user.id,
            received_at=now,
            dialect=dialect,
            items=counts.items,
            accepted=counts.days + counts.workouts,
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
