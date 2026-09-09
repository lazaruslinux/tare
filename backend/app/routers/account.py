"""The account's own settings: what to call it, what units it reads in, which
day it is in, how old it is, and the key its phone syncs with."""

from __future__ import annotations

import datetime as dt

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import clock, mail, models, photos, profiles, security, throttle
from app.config import settings
from app.db import get_db
from app.deps import require_account, require_user
from app.models import now_utc
from app.review_log import log_review
from app.routers import fitness
from app.routers.auth import (
    CLEARED_BIRTHDATE,
    EMAIL_TAKEN,
    address_taken,
    checked_birthdate,
    clean_email,
    me_payload,
)
from app.routers.ingest import has_uploads

router = APIRouter(tags=["account"])

UNITS = ("imperial", "metric")

# Which clock a time is read on. Twelve hours is the default because that is
# what this app's members read; the other is here for whoever prefers it.
CLOCKS = ("12h", "24h")

MAX_DISPLAY_NAME = profiles.MAX_DISPLAY_NAME

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
    clock: str | None = None
    birthdate: dt.date | None = None
    location: str | None = None
    # The Sharing screen's switches, saved together because they are one answer
    # to one question: what other members see.
    feed_hidden: list[str] | None = None
    share_age: bool | None = None
    share_sex: bool | None = None
    share_location: bool | None = None
    share_workouts: bool | None = None
    share_journal: bool | None = None
    share_weight_loss: bool | None = None


@router.patch("/account")
def update_account(
    body: AccountPatch,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    sent = body.model_fields_set

    if "display_name" in sent:
        # Blank clears it, and the account falls back to its username wherever
        # a name is shown.
        try:
            user.display_name = profiles.checked_display_name(body.display_name)
        except ValueError as refused:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(refused)) from None

    if "units" in sent:
        if body.units not in UNITS:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Units must be either imperial or metric."
            )
        user.units = body.units

    if "clock" in sent:
        if body.clock not in CLOCKS:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Time format must be either 12h or 24h."
            )
        user.clock = body.clock

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

    if "feed_hidden" in sent:
        asked = body.feed_hidden or []
        for name in asked:
            if name not in fitness.HIDEABLE:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, fitness.BAD_HIDDEN)
        # Kept in the order Tare names them, and each name once.
        user.feed_hidden = [name for name in fitness.HIDEABLE if name in asked]

    for field in (
        "share_age",
        "share_sex",
        "share_location",
        "share_workouts",
        "share_journal",
        "share_weight_loss",
    ):
        if field in sent:
            setattr(user, field, bool(getattr(body, field)))

    db.commit()
    return me_payload(db, user)


class EmailBody(BaseModel):
    email: str


@router.post("/account/email")
def set_email(
    body: EmailBody,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_account),
) -> dict[str, object]:
    """Put an address on this account, or move it to a different one.

    Reachable without a verified address, since an account whose address is
    missing or mistyped has no other way past. An account with none takes the
    new one unverified; an account with one holds the new one aside until the
    link sent there is opened, so a typo cannot lock anybody out of their own
    mail.
    """
    address = clean_email(body.email)
    # Counted against the resend allowance and keyed by the address rather than
    # the caller, because what this spends is somebody else's inbox.
    if throttle.resend_limiter.hit(address):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY)
    if address_taken(db, address, user.id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, EMAIL_TAKEN)

    if user.email is None:
        user.email = address
        user.email_verified = False
        purpose = "verify"
    else:
        user.pending_email = address
        purpose = "change"
    token = security.create_email_token(db, user.id, purpose)
    db.commit()
    # After the response, like every other message this instance sends.
    background.add_task(mail.send_verification, address, token)
    return me_payload(db, user)


@router.post("/account/first-run", status_code=status.HTTP_204_NO_CONTENT)
def finish_first_run(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> None:
    """Mark the questions asked on the way in as answered, or skipped.

    Idempotent, and it only ever sets the stamp: the screen is shown once, and
    a second call from a browser that was slow to move on must not move the
    moment or offer the screen again.
    """
    if user.first_run_at is None:
        user.first_run_at = now_utc()
        db.commit()


@router.post("/account/tour", status_code=status.HTTP_204_NO_CONTENT)
def finish_tour(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> None:
    """Mark the welcome tour as walked, or skipped.

    Idempotent, and it only ever sets the stamp: the tour is offered once, and
    a second call from a browser that was slow to move on must not move the
    moment or offer the tour again.
    """
    if user.tour_seen_at is None:
        user.tour_seen_at = now_utc()
        db.commit()


# A picture of a person, not a shelf: smaller than a food photo, because the
# screen that sends one has already framed it to the square it will be shown in.
AVATAR_MAX_BYTES = 5 * 1024 * 1024
NO_AVATAR_FILE = "Choose a picture."
AVATAR_TOO_LARGE = "A picture must be at most 5 MB."


@router.post("/account/avatar")
def set_avatar(
    file: UploadFile = File(default=None),
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Take the picture this account is shown by, and answer with its address.

    What arrives is thrown away: what is stored is a square webp this server
    built, carrying nothing the camera wrote into it. The picture that was
    there goes at the same moment, so an account is never holding two.
    """
    if file is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_AVATAR_FILE)
    raw = file.file.read(AVATAR_MAX_BYTES + 1)
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_AVATAR_FILE)
    if len(raw) > AVATAR_MAX_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, AVATAR_TOO_LARGE)

    try:
        name = photos.store(raw, "avatar")
    except photos.RejectedImage as refused:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(refused)) from None

    was = user.avatar_path
    user.avatar_path = name
    db.commit()
    # The row first, the file after: a file left behind is a tidying job, a row
    # pointing at a file that is gone is a broken picture on somebody's screen.
    if was:
        photos.remove(was)
    return {"avatar_url": profiles.avatar_url(user)}


@router.delete("/account/avatar", status_code=status.HTTP_204_NO_CONTENT)
def clear_avatar(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> None:
    was = user.avatar_path
    user.avatar_path = None
    db.commit()
    if was:
        photos.remove(was)


# What somebody is told when they ask to review too early, and when they ask
# having nothing to gain by it. Both plain: neither is a fault.
NOT_ENOUGH_YET = "Not yet."
ALREADY_REVIEWING = "You already review."


@router.post("/account/apply-reviewer")
def apply_reviewer(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> dict[str, object]:
    """Ask to be a reviewer, once enough of your foods have been taken.

    An application and nothing more. Nobody is made a reviewer by asking, and
    there is no path from here to an administrator at all: the one role this
    can ever lead to is the second one, and an administrator still grants it.
    Asking twice is the same as asking once.
    """
    if profiles.role_of(user) is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, ALREADY_REVIEWING)
    if profiles.approved_count(db, user) < profiles.REVIEWER_THRESHOLD:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NOT_ENOUGH_YET)

    if user.reviewer_requested_at is None:
        user.reviewer_requested_at = now_utc()
        log_review(
            db,
            user,
            "applied",
            "user",
            user.id,
            user.display_name or user.username,
        )
        db.commit()
    return {"reviewer_requested": True}


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


# What a row on the sync record is called on screen. A phone's export is a
# sync whichever dialect it spoke; the other two say what they were.
UPLOAD_KINDS = {"hae": "sync", "hc": "sync", "upload": "upload", "wipe": "wipe"}

# How many rows of the record the screen is handed. The record itself keeps 90
# days; this is the part somebody reads.
RECENT_UPLOADS = 50


@router.get("/account/uploads")
def read_uploads(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> dict[str, object]:
    """What has arrived on this account, and when it last did.

    Counted off the rows themselves rather than off the record, so a member
    who only ever uploaded files still sees their totals: the record says what
    each arrival did, the rows say what is actually here.
    """
    days_with_data, first_day, last_day = db.execute(
        select(
            func.count(func.distinct(models.FitnessDaily.date_for)),
            func.min(models.FitnessDaily.date_for),
            func.max(models.FitnessDaily.date_for),
        ).where(models.FitnessDaily.user_id == user.id)
    ).one()
    # Everything a phone or a file brought. A workout somebody typed in is
    # theirs rather than something that arrived.
    workouts = db.scalar(
        select(func.count(models.Workout.id)).where(
            models.Workout.user_id == user.id, models.Workout.source != "manual"
        )
    )
    received = db.scalar(
        select(func.max(models.IngestLog.received_at)).where(
            models.IngestLog.user_id == user.id
        )
    )
    if received is None:
        token = db.get(models.IngestToken, user.id)
        received = None if token is None else token.last_used_at
    recent = db.scalars(
        select(models.IngestLog)
        .where(models.IngestLog.user_id == user.id)
        .order_by(models.IngestLog.received_at.desc(), models.IngestLog.id.desc())
        .limit(RECENT_UPLOADS)
    )
    return {
        "days_with_data": days_with_data or 0,
        "workouts": workouts or 0,
        "first_day": None if first_day is None else first_day.isoformat(),
        "last_day": None if last_day is None else last_day.isoformat(),
        "last_received_at": None if received is None else received.isoformat(),
        "recent": [
            {
                "received_at": row.received_at.isoformat(),
                "kind": UPLOAD_KINDS.get(row.dialect, row.dialect),
                "days": row.days,
                "workouts": row.workouts,
                "accepted": row.accepted,
                "skipped": row.skipped,
                "flagged": row.flagged,
                "error": row.error,
            }
            for row in recent
        ],
    }
