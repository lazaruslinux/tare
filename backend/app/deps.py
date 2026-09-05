"""Who may call what. Four dependencies, so a route says its requirement in
its signature rather than checking a flag in its body."""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, security, throttle
from app.db import get_db
from app.models import now_utc

# One sentence for every way a sync key can be wrong: missing, malformed,
# revoked, or belonging to an account that is gone. Saying which would tell
# somebody working through keys how close they are.
BAD_INGEST_TOKEN = "Invalid token."


def require_user(user: models.User = Depends(security.current_user)) -> models.User:
    return user


def require_admin(user: models.User = Depends(require_user)) -> models.User:
    # 403 rather than 401: whoever is asking is signed in and known, they are
    # simply not allowed, and answering 401 would send the client off to sign
    # in again for a session that is already valid.
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This needs an administrator account.")
    return user


def reviews(user: models.User) -> bool:
    """Whether this account may judge what reaches the shared database.

    An administrator does, by being one: the role is a second way in rather
    than a different job, and every route reads the pair through here so the
    two can never drift apart.
    """
    return user.is_admin or user.is_reviewer


def require_reviewer(user: models.User = Depends(require_user)) -> models.User:
    if not reviews(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This needs a reviewer account.")
    return user


def require_ingest_user(
    request: Request, db: Session = Depends(get_db)
) -> models.User:
    """The account behind an Authorization bearer token.

    A bearer token rather than the session cookie because the caller is an
    automation on a phone that cannot answer a sign-in screen, and because a
    cookie is never an ingest key: the two are separate credentials on purpose,
    so a stolen sync key opens nothing but the sync.

    The limiter runs first, before anything about the token is looked at, so a
    run of guesses costs the same allowance as a run of valid syncs.
    """
    if throttle.ingest_limiter.hit(throttle.client_address(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY)
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    refused = HTTPException(status.HTTP_401_UNAUTHORIZED, BAD_INGEST_TOKEN)
    if scheme.lower() != "bearer" or not token.strip():
        raise refused
    row = db.execute(
        select(models.IngestToken).where(
            models.IngestToken.token_hash == security.hash_token(token.strip())
        )
    ).scalar_one_or_none()
    if row is None:
        raise refused
    user = db.get(models.User, row.user_id)
    if user is None:
        raise refused
    row.last_used_at = now_utc()
    return user
