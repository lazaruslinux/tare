"""The account's own settings: what to call it, what units it reads in, which
day it is in, how old it is, and the key its phone syncs with."""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import clock, models, security, throttle
from app.config import settings
from app.db import get_db
from app.deps import require_user
from app.models import now_utc
from app.routers.auth import CLEARED_BIRTHDATE, checked_birthdate, me_payload
from app.routers.ingest import has_uploads

router = APIRouter(tags=["account"])

UNITS = ("imperial", "metric")

MAX_DISPLAY_NAME = 60

# Free text, "City, State". Never geocoded, never looked up, never checked
# against a list: it is the member's own words for where they are.
MAX_LOCATION = 80


def clean_location(raw: str | None) -> str | None:
    """Trimmed, and blank clears it. Shared with the health router, which sets
    the same field from the profile screen."""
    text = (raw or "").strip()
    if len(text) > MAX_LOCATION:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Location must be at most {MAX_LOCATION} characters.",
        )
    return text or None


class AccountPatch(BaseModel):
    # Every field optional, and a field left out is left alone. Null is a value
    # here rather than an absence: it is how a display name or a birthdate is
    # cleared, which is why what was sent is read from model_fields_set rather
    # than from what is None.
    display_name: str | None = None
    units: str | None = None
    timezone: str | None = None
    birthdate: dt.date | None = None
    location: str | None = None


@router.patch("/account")
def update_account(
    body: AccountPatch,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    sent = body.model_fields_set

    if "display_name" in sent:
        name = (body.display_name or "").strip()
        if len(name) > MAX_DISPLAY_NAME:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Display name must be at most {MAX_DISPLAY_NAME} characters.",
            )
        # Blank clears it, and the account falls back to its username wherever
        # a name is shown.
        user.display_name = name or None

    if "units" in sent:
        if body.units not in UNITS:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Units must be either imperial or metric."
            )
        user.units = body.units

    if "timezone" in sent:
        if body.timezone is None or not security.known_timezone(body.timezone):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pick a US time zone.")
        user.timezone = body.timezone

    if "birthdate" in sent:
        # Null is refused here rather than clearing the field: tare is for
        # adults, and an account that could empty its birthdate could walk
        # back out of the check it already passed.
        if body.birthdate is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, CLEARED_BIRTHDATE)
        user.birthdate = checked_birthdate(body.birthdate, clock.user_today(user))

    if "location" in sent:
        user.location = clean_location(body.location)

    db.commit()
    return me_payload(user)


# Where a phone posts its export. Handed back with a freshly minted key so the
# member copies an address rather than typing one.
INGEST_PATH = "/api/ingest/health"


def token_status(row: models.IngestToken | None, uploaded: bool = False) -> dict[str, object]:
    """What is said about a sync key, which never includes the key.

    A key is shown once, at the moment it is made, and is not stored in a form
    anything could show again.

    The two upload answers ride here because the screen that asks this question
    is the screen they belong to: whether this instance takes files at all, and
    whether this account has anything that came out of one.
    """
    return {
        "connected": row is not None,
        "path": INGEST_PATH,
        "rotated_at": None if row is None else row.created_at.isoformat(),
        "last_used_at": (
            None if row is None or row.last_used_at is None else row.last_used_at.isoformat()
        ),
        "uploads": settings.uploads_enabled,
        "uploaded": uploaded,
    }


@router.get("/account/ingest-token")
def read_ingest_token(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> dict[str, object]:
    return token_status(db.get(models.IngestToken, user.id), has_uploads(db, user.id))


@router.post("/account/ingest-token")
def mint_ingest_token(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> dict[str, object]:
    """A new key for this account's phone, replacing whatever it had.

    The old one stops working the moment this answers: there is one key per
    account, and a key somebody replaced because they think it leaked has to be
    dead rather than merely superseded.
    """
    if throttle.ingest_token_limiter.hit(str(user.id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY)
    token = security.generate_token()
    row = db.get(models.IngestToken, user.id)
    if row is None:
        row = models.IngestToken(user_id=user.id, token_hash=security.hash_token(token))
        db.add(row)
    else:
        row.token_hash = security.hash_token(token)
    row.created_at = now_utc()
    row.last_used_at = None
    db.commit()
    return {"token": token, **token_status(row)}


@router.delete("/account/ingest-token", status_code=status.HTTP_204_NO_CONTENT)
def revoke_ingest_token(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> None:
    row = db.get(models.IngestToken, user.id)
    if row is not None:
        db.delete(row)
        db.commit()
