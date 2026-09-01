"""The page somebody sent an invite link lands on.

One shape for a live code and the same 404 for every dead one. Unknown,
claimed, revoked, and expired are four different endings and one answer,
because a link that no longer works has no business going on to say why.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, throttle
from app.db import get_db
from app.models import now_utc

router = APIRouter(prefix="/invites", tags=["invites"])

# What a code that no longer works is told, whichever way it stopped working.
# Registration answers with the same sentence, so the two doors into an invite
# cannot be played off against each other.
DEAD_INVITE = "This invite link is no longer valid."


def live_invite(db: Session, code: str) -> models.Invite | None:
    """The invite behind a code, if it is still worth anything.

    Claimed, revoked, and expired all read as nothing here, which is what makes
    the four dead cases answer identically: they never reach a branch that
    could tell them apart.
    """
    invite = db.execute(
        select(models.Invite).where(models.Invite.code == code)
    ).scalar_one_or_none()
    if invite is None or invite.used_by is not None or invite.revoked_at is not None:
        return None
    # Null means it never expires, which is what the command line mints unless
    # it is asked for a date.
    if invite.expires_at is not None and invite.expires_at <= now_utc():
        return None
    return invite


@router.get("/{code}")
def read_invite(code: str, request: Request, db: Session = Depends(get_db)) -> dict[str, str]:
    """Who invited you, and nothing else about them."""
    if throttle.welcome_limiter.hit(throttle.client_address(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY)

    invite = live_invite(db, code.strip())
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, DEAD_INVITE)

    inviter = db.get(models.User, invite.created_by)
    if inviter is None:
        # The account that minted it is gone. Nothing is left to name, and a
        # link with no inviter behind it is not a link worth opening.
        raise HTTPException(status.HTTP_404_NOT_FOUND, DEAD_INVITE)
    return {"inviter_display_name": inviter.display_name or inviter.username}
