"""The account's own settings: what to call it, what units it reads in, which
day it is in, and how old it is."""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models, security
from app.db import get_db
from app.deps import require_user
from app.routers.auth import me_payload

router = APIRouter(tags=["account"])

UNITS = ("imperial", "metric")

MAX_DISPLAY_NAME = 60


class AccountPatch(BaseModel):
    # Every field optional, and a field left out is left alone. Null is a value
    # here rather than an absence: it is how a display name or a birthdate is
    # cleared, which is why what was sent is read from model_fields_set rather
    # than from what is None.
    display_name: str | None = None
    units: str | None = None
    timezone: str | None = None
    birthdate: dt.date | None = None


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
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That is not a known time zone.")
        user.timezone = body.timezone

    if "birthdate" in sent:
        user.birthdate = body.birthdate

    db.commit()
    return me_payload(user)
