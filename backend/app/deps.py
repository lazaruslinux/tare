"""Who may call what. A handful of dependencies, so a route says its
requirement in its signature rather than checking a flag in its body."""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import mail, models, security, throttle
from app.db import get_db
from app.models import now_utc

# One sentence for every way a sync key can be wrong: missing, malformed,
# revoked, or belonging to an account that is gone. Saying which would tell
# somebody working through keys how close they are.
BAD_INGEST_TOKEN = "Invalid token."

# What an account that has not answered its verification mail is told, on every
# route but the few it needs to get out of that state.
UNVERIFIED_ACCOUNT = "Verify your email to continue."


def require_account(user: models.User = Depends(security.current_user)) -> models.User:
    """Signed in, verified or not. The few routes a walled account still needs."""
    return user


def verified(user: models.User) -> models.User:
    """The wall itself, in the one place every requirement reads it from.

    Only on an instance that can send mail: without one there is no link to
    open, so an old account carrying no address is left alone rather than shut
    out of the app it is already in.
    """
    if mail.configured() and (user.email is None or not user.email_verified):
        raise HTTPException(status.HTTP_403_FORBIDDEN, UNVERIFIED_ACCOUNT)
    return user


def require_user(user: models.User = Depends(require_account)) -> models.User:
    return verified(user)


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
    # And again per account, on top of the address above. A phone that moves
    # between networks arrives from a new address each time, so without this a
    # key is only ever limited as far as one address at a time.
    if throttle.ingest_user_limiter.hit(str(user.id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY)
    # The same wall the session routes are behind. A sync key is a credential
    # for an account, so an account that cannot open the app cannot post to it
    # either; the check comes after the token so a bad key still reads as a bad
    # key rather than as an unverified one.
    verified(user)
    row.last_used_at = now_utc()
    return user
