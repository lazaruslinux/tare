"""Password hashing, opaque session tokens, and the signed-in-user dependency."""

from __future__ import annotations

import datetime as dt
import re
import secrets
from hashlib import sha256

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app import models
from app.config import settings
from app.db import get_db
from app.models import now_utc

# One reusable hasher at the library's own defaults, which are Argon2id with
# parameters the argon2-cffi maintainers keep current. Argon2id is memory hard,
# so a stolen database costs an attacker hardware per guess rather than GPU
# throughput.
_hasher = PasswordHasher()

COOKIE_NAME = "tare_session"

MIN_PASSWORD_LENGTH = 10
# Argon2 will hash a megabyte of text as willingly as a passphrase, and every
# byte costs the server memory and time. Far longer than anything anybody
# types, so the cap only refuses what was never a passphrase.
MAX_PASSWORD_LENGTH = 256

USERNAME_PATTERN = re.compile(r"^[a-z0-9_.-]{3,32}$")

# Deliberately loose. The only thing worth checking is that the address could
# be delivered to; the real proof is the verification mail arriving, and a
# stricter pattern would refuse valid addresses while proving nothing more.
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")
MAX_EMAIL_LENGTH = 255

# How long a verification link stays usable. Long enough to survive a mail that
# lands in a spam folder and is found that evening, short enough that an old
# inbox is not a standing key to the account.
VERIFY_TOKEN_HOURS = 24

# How long a password reset link stays usable. Far shorter than a verification
# link: this one sets a password without knowing the old one, so it is the most
# valuable thing this instance ever puts in an inbox.
RESET_TOKEN_HOURS = 1

# A real hash of a value nobody can log in with, verified against whenever the
# username does not exist. Without it a missing user answers in microseconds
# and a real one pays the full Argon2 cost, which is a timing oracle that
# enumerates accounts. Computed at import, so the cost is paid at startup.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(32))


def hash_password(raw: str) -> str:
    return _hasher.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, raw)
    except (VerifyMismatchError, VerificationError):
        return False


def dummy_verify() -> None:
    """Burn the Argon2 work a real verification would, and discard it.

    Called on login's unknown-username branch so that branch costs what the
    known-username branch costs.
    """
    verify_password("not-the-password", _DUMMY_HASH)


# The zones tare offers, in the order the Display screen lists them. An
# allowlist rather than the whole zone database: everybody here is in the
# United States, and seven names somebody can read beats six hundred they have
# to search. Accounts made before this list keep whatever zone they carry;
# nothing reads this to decide whether a stored zone still works.
US_ZONES = (
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
)


def known_timezone(name: str) -> bool:
    """True for one of the zones tare offers."""
    return name in US_ZONES


def generate_token() -> str:
    """A bearer value with 256 bits of entropy behind it."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """The form a token is stored in.

    Plain SHA-256 rather than Argon2 on purpose: these are long random values
    rather than human-chosen passwords, so there is no dictionary to slow down,
    and a session token is checked on every single request.
    """
    return sha256(token.encode()).hexdigest()


def create_session(db: Session, user_id: int) -> str:
    """Issue a session row and return the plaintext token, which is never stored."""
    token = generate_token()
    now = now_utc()
    db.add(
        models.Session(
            token_hash=hash_token(token),
            user_id=user_id,
            created_at=now,
            expires_at=now + dt.timedelta(hours=settings.session_hours),
        )
    )
    return token


def create_email_token(
    db: Session, user_id: int, purpose: str = "verify", hours: int = VERIFY_TOKEN_HOURS
) -> str:
    """Issue an emailed token and return the plaintext, which is never stored.

    Any earlier token for the same account goes first. Otherwise every resend
    leaves another working link behind, and the oldest mail in the inbox stays
    as good as the newest one for a day.
    """
    db.execute(delete(models.EmailToken).where(models.EmailToken.user_id == user_id))
    token = generate_token()
    now = now_utc()
    db.add(
        models.EmailToken(
            token_hash=hash_token(token),
            user_id=user_id,
            purpose=purpose,
            created_at=now,
            expires_at=now + dt.timedelta(hours=hours),
        )
    )
    return token


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,  # unreadable from JavaScript, so an XSS bug cannot lift it
        samesite="lax",  # not attached to cross-site POSTs, which is the CSRF defence
        secure=settings.cookie_secure,
        max_age=settings.session_hours * 3600,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    # The attributes have to match the ones it was set with, or the browser
    # keeps the original alongside the deletion.
    response.delete_cookie(
        key=COOKIE_NAME,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


def delete_sessions(db: Session, user_id: int, *, keep: str | None = None) -> None:
    """Revoke an account's sessions, optionally sparing the one asking."""
    stmt = delete(models.Session).where(models.Session.user_id == user_id)
    if keep is not None:
        stmt = stmt.where(models.Session.token_hash != keep)
    db.execute(stmt)


def session_token_hash(request: Request) -> str | None:
    token = request.cookies.get(COOKIE_NAME)
    return hash_token(token) if token else None


def current_user(request: Request, db: Session = Depends(get_db)) -> models.User:
    """The signed-in user, or a 401.

    The row is loaded fresh on every request rather than trusted from the
    cookie, so deleting an account or dropping its admin flag takes effect at
    once instead of whenever the session happens to expire.
    """
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "You are not signed in.")
    token_hash = session_token_hash(request)
    if not token_hash:
        raise unauthorized
    row = db.get(models.Session, token_hash)
    if row is None:
        raise unauthorized
    if row.expires_at <= now_utc():
        # Reaping on sight keeps the table from growing forever without needing
        # a scheduled job for it.
        db.delete(row)
        db.commit()
        raise unauthorized
    user = db.get(models.User, row.user_id)
    if user is None:
        db.delete(row)
        db.commit()
        raise unauthorized
    return user
