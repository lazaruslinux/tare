"""Registration, sign in, sign out, email verification, and password changes."""

from __future__ import annotations

import datetime as dt

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Request,
    Response,
    status,
)
from pydantic import BaseModel
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app import mail, models, security, throttle
from app.config import settings
from app.db import get_db, rows_touched
from app.deps import require_user
from app.models import now_utc
from app.routers.invites import DEAD_INVITE, live_invite

router = APIRouter(prefix="/auth", tags=["auth"])

# One wording for every way a sign in can fail. Saying "no such user" would let
# anyone map out who has an account here, which is the first move of a targeted
# guessing run.
BAD_CREDENTIALS = "Username or password is not correct."
UNVERIFIED = "Check your email and verify your account before signing in."
STALE_LINK = "That verification link is no longer valid. Ask for a new one."

# Decision 21. tare is for adults, the birthdate is asked for at registration,
# and the check is the server's rather than the form's.
MIN_AGE = 18
UNDER_AGE = "Tare is for adults 18 and over."
FUTURE_BIRTHDATE = "That birthdate is in the future."
# A hundred and twenty years is older than anybody has been. Beyond it the
# entry is a typed year rather than a person.
MAX_AGE = 120
IMPOSSIBLE_BIRTHDATE = "That birthdate is too far back to be right."
CLEARED_BIRTHDATE = "Tare needs your birthdate."

# What a signup is refused with when the instance has a mail server and the
# address was left blank.
EMAIL_REQUIRED = "This Tare needs an email address to sign up."

# The one answer a reset request ever gets. The same words for an address with
# an account, an address without one, and an instance that cannot send mail at
# all: whether somebody is a member here is exactly what a person probing this
# form is after, and any second wording would tell them.
RESET_SENT = "If that address has an account, a link is on its way."
STALE_RESET = "That link has expired or was already used."


def checked_birthdate(birthdate: dt.date, today: dt.date) -> dt.date:
    """The one age rule, in the one place both the front door and the settings
    screen call it from."""
    if birthdate > today:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, FUTURE_BIRTHDATE)
    years = today.year - birthdate.year - (
        0 if (today.month, today.day) >= (birthdate.month, birthdate.day) else 1
    )
    if years > MAX_AGE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, IMPOSSIBLE_BIRTHDATE)
    if years < MIN_AGE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, UNDER_AGE)
    return birthdate


class RegisterBody(BaseModel):
    invite_code: str
    username: str
    password: str
    # Required, and checked on the server (decision 21).
    birthdate: dt.date
    timezone: str = "UTC"
    email: str = ""
    display_name: str = ""


class LoginBody(BaseModel):
    username: str
    password: str


class VerifyBody(BaseModel):
    token: str


class PasswordBody(BaseModel):
    current_password: str
    new_password: str


class ForgotBody(BaseModel):
    email: str


class ResetBody(BaseModel):
    token: str
    password: str


def me_payload(user: models.User) -> dict[str, object]:
    """What the client is told about the account it is signed in as. Shared with
    the account router, so the answer cannot drift between the two."""
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "email": user.email,
        "email_verified": user.email_verified,
        "is_admin": user.is_admin,
        "units": user.units,
        "timezone": user.timezone,
        # Null on an account made before the gate existed, which is what sends
        # it to the one screen that asks (decision 21).
        "birthdate": None if user.birthdate is None else user.birthdate.isoformat(),
        "location": user.location,
    }


def check_password_length(password: str) -> None:
    if len(password) < security.MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Password must be at least {security.MIN_PASSWORD_LENGTH} characters.",
        )
    if len(password) > security.MAX_PASSWORD_LENGTH:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Password must be at most {security.MAX_PASSWORD_LENGTH} characters.",
        )


def clean_username(raw: str) -> str:
    cleaned = raw.strip().lower()
    if not security.USERNAME_PATTERN.match(cleaned):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Username must be 3 to 32 characters: lowercase letters, numbers, "
            "dot, dash, underscore.",
        )
    return cleaned


def clean_email(raw: str) -> str:
    """The cleaned, lower-cased address. Stored lower-cased because that is how
    it is compared, and comparing one way while storing another is how the same
    mailbox ends up registered twice."""
    cleaned = raw.strip().lower()
    if len(cleaned) > security.MAX_EMAIL_LENGTH or not security.EMAIL_PATTERN.match(cleaned):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "That does not look like an email address."
        )
    return cleaned


def signup_email(raw: str) -> str | None:
    """The address a new account is made with, and the one rule about needing one.

    An instance that verifies by mail cannot make an account with nowhere to
    send the link: it would be created unable to sign in and unable to ask for
    another one. An instance with no mail server has nothing to send anyway, so
    the field stays optional there.
    """
    if raw.strip():
        return clean_email(raw)
    if mail.configured():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, EMAIL_REQUIRED)
    return None


@router.post("/register")
def register(
    body: RegisterBody,
    request: Request,
    response: Response,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Spend an invite and make the account behind it.

    Two endings, and which one arrives depends on the instance rather than on
    anything the caller sent. With a mail server configured the account is made
    unverified and has to answer a link; without one there is nowhere to send
    that link, so the account is verified on the spot and signed in.
    """
    if throttle.register_limiter.hit(throttle.client_address(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY)

    dead_invite = HTTPException(status.HTTP_404_NOT_FOUND, DEAD_INVITE)
    # The invite is settled before the form is: an unknown code must not be
    # able to learn from an answer about a username, which is what makes every
    # dead code end in the same sentence the welcome page gives.
    code = body.invite_code.strip()
    invite = live_invite(db, code)
    if invite is None:
        raise dead_invite

    username = clean_username(body.username)
    check_password_length(body.password)
    # The account has no zone of its own until it exists, so the day is read in
    # UTC. Being a day out on an eighteenth birthday is the honest edge of a
    # date-only field.
    birthdate = checked_birthdate(body.birthdate, now_utc().date())
    email = signup_email(body.email)
    display_name = body.display_name.strip()[:60] or None
    # A browser sends whatever zone it is set to, and one tare does not offer
    # is not worth refusing a signup over: the instance's own zone stands in,
    # and the Display screen can change it.
    timezone = body.timezone if security.known_timezone(body.timezone) else settings.tz

    # Hashed before the duplicate check, and the wasted work on the duplicate
    # path is the point: Argon2 is by far the slowest part of this request, so
    # answering early for a name already taken would make that answer arrive in
    # a fraction of the time a real signup takes.
    password_hash = security.hash_password(body.password)

    # lower() on the column rather than a plain comparison, so this matches the
    # case-insensitive uniqueness the schema enforces and can use that index.
    conflicts = [models.User.username == username]
    if email is not None:
        conflicts.append(func.lower(models.User.email) == email)
    if db.execute(select(models.User.id).where(or_(*conflicts))).first() is not None:
        # A plain answer, unlike the sentence a dead code gets. Whoever is here
        # holds a working invite, so they are not enumerating anything; they
        # are a person who picked a name somebody else already has.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "That username or email is already taken."
        )

    now = now_utc()
    user = models.User(
        username=username,
        password_hash=password_hash,
        email=email,
        email_verified=not mail.configured(),
        display_name=display_name,
        birthdate=birthdate,
        is_admin=False,
        units="imperial",
        timezone=timezone,
        feed_hidden=[],
        created_at=now,
    )
    db.add(user)
    db.flush()

    # The claim itself, as one conditional UPDATE rather than a write to the
    # row read above. Two people spending the same link at once both pass that
    # read; only one of them can touch a row here, and the loser is told what
    # everyone holding a dead link is told.
    claimed = db.execute(
        update(models.Invite)
        .where(
            models.Invite.id == invite.id,
            models.Invite.used_by.is_(None),
            models.Invite.revoked_at.is_(None),
            or_(models.Invite.expires_at.is_(None), models.Invite.expires_at > now),
        )
        .values(used_by=user.id)
    )
    if rows_touched(claimed) != 1:
        db.rollback()
        raise dead_invite

    if user.email_verified:
        token = security.create_session(db, user.id)
        db.commit()
        security.set_session_cookie(response, token)
        return {"state": "ready"}

    verify_token = security.create_email_token(db, user.id, "verify")
    db.commit()
    # After the response, so a mail server having a slow morning is not
    # something the person registering has to sit through.
    background.add_task(mail.send_verification, email or "", verify_token)
    return {"state": "check_email"}


@router.post("/login")
def login(
    body: LoginBody, request: Request, response: Response, db: Session = Depends(get_db)
) -> dict[str, object]:
    if throttle.login_limiter.hit(throttle.client_address(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY)

    username = body.username.strip().lower()
    user = db.execute(
        select(models.User).where(models.User.username == username)
    ).scalar_one_or_none()
    if user is None:
        # Verify against a throwaway hash anyway. Answering early here would
        # make an unknown username measurably faster than a known one, and that
        # difference alone is enough to enumerate accounts from outside.
        security.dummy_verify()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, BAD_CREDENTIALS)
    if not security.verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, BAD_CREDENTIALS)
    if not user.email_verified:
        # After the password and never before it. The other order answers
        # differently for a right and a wrong password on an unverified
        # account, which is a password oracle for anyone who registers once and
        # then goes looking for other people.
        raise HTTPException(status.HTTP_403_FORBIDDEN, UNVERIFIED)

    token = security.create_session(db, user.id)
    db.commit()
    security.set_session_cookie(response, token)
    return me_payload(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> Response:
    # No sign-in requirement: signing out has to work even when the session is
    # already gone, or a stale cookie leaves the browser stuck.
    token_hash = security.session_token_hash(request)
    if token_hash:
        row = db.get(models.Session, token_hash)
        if row is not None:
            db.delete(row)
            db.commit()
    security.clear_session_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me")
def read_me(user: models.User = Depends(require_user)) -> dict[str, object]:
    return me_payload(user)


@router.post("/verify-email", status_code=status.HTTP_204_NO_CONTENT)
def verify_email(body: VerifyBody, response: Response, db: Session = Depends(get_db)) -> Response:
    """Spend an emailed link. Once, and only for what it was issued for."""
    row = db.execute(
        select(models.EmailToken).where(
            models.EmailToken.token_hash == security.hash_token(body.token.strip()),
            # What the token authorises is stored with it, never sent by the
            # caller, so this endpoint cannot be handed a token minted for
            # something else.
            models.EmailToken.purpose == "verify",
        )
    ).scalar_one_or_none()
    if row is None or row.expires_at <= now_utc():
        if row is not None:
            # An expired link is spent on sight rather than left in the table
            # until somebody thinks to clean it out.
            db.delete(row)
            db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, STALE_LINK)

    user = db.get(models.User, row.user_id)
    # The token goes whether or not the account is still there, which is what
    # makes the link single use.
    db.delete(row)
    if user is not None:
        user.email_verified = True
    db.commit()
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/resend-verification", status_code=status.HTTP_204_NO_CONTENT)
def resend_verification(
    request: Request,
    response: Response,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> Response:
    """Send another verification link to the address already on the account.

    Behind the session on purpose. An endpoint that mails whatever address it
    is handed is a way to use this server to bother a stranger; this one can
    only ever mail the account asking.
    """
    if throttle.resend_limiter.hit(throttle.client_address(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY)

    if not user.email_verified and user.email and mail.configured():
        token = security.create_email_token(db, user.id, "verify")
        db.commit()
        background.add_task(mail.send_verification, user.email, token)

    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/forgot")
def forgot_password(
    body: ForgotBody,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Send a reset link, or send nothing, and say the same thing either way.

    Every ending is the same sentence with the same status. A different answer
    for an address that has an account would turn this form into a way to find
    out who is a member here, which is the first move against a small private
    instance where the members are the point.
    """
    if throttle.forgot_limiter.hit(throttle.client_address(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY)

    address = body.email.strip().lower()
    usable = len(address) <= security.MAX_EMAIL_LENGTH and bool(
        security.EMAIL_PATTERN.match(address)
    )
    if mail.configured() and usable:
        user = db.execute(
            select(models.User).where(
                func.lower(models.User.email) == address,
                # An account that never answered its verification mail is no
                # proof anybody holds that inbox, so a reset link sent there
                # would be a way in through an address nobody ever claimed.
                models.User.email_verified.is_(True),
            )
        ).scalar_one_or_none()
        if user is not None:
            token = security.create_email_token(
                db, user.id, "reset", security.RESET_TOKEN_HOURS
            )
            db.commit()
            # After the response, like the verification mail, so a slow relay
            # is never something the person asking has to sit through.
            background.add_task(mail.send_reset, address, token)

    return {"detail": RESET_SENT}


@router.post("/reset")
def reset_password(
    body: ResetBody, response: Response, db: Session = Depends(get_db)
) -> dict[str, object]:
    """Spend a reset link: a new password, no sessions, and signed in here."""
    stale = HTTPException(status.HTTP_400_BAD_REQUEST, STALE_RESET)
    row = db.execute(
        select(models.EmailToken).where(
            models.EmailToken.token_hash == security.hash_token(body.token.strip()),
            # What the token authorises is stored with it rather than sent by
            # the caller, so a verification link cannot be spent here.
            models.EmailToken.purpose == "reset",
        )
    ).scalar_one_or_none()
    if row is None or row.expires_at <= now_utc():
        if row is not None:
            db.delete(row)
            db.commit()
        raise stale

    user = db.get(models.User, row.user_id)
    if user is None:
        db.delete(row)
        db.commit()
        raise stale

    # After the token and before it is spent. A password the rule refuses is a
    # typing mistake, and the link has to still work for the next try.
    check_password_length(body.password)

    user.password_hash = security.hash_password(body.password)
    # The token goes, which is what makes the link single use.
    db.delete(row)
    # Every session, not all but this one. Somebody resetting a password may be
    # doing it because another device is signed in that should not be, and
    # there is no session of their own here to spare yet.
    security.delete_sessions(db, user.id)
    token = security.create_session(db, user.id)
    db.commit()
    security.set_session_cookie(response, token)
    return me_payload(user)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: PasswordBody,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> Response:
    if not security.verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Current password is not correct.")
    check_password_length(body.new_password)

    user.password_hash = security.hash_password(body.new_password)
    # A password change is how somebody reacts to a session they think was
    # stolen, so every other session dies with it. The one making the request
    # survives: being signed out of the browser you just used to fix the
    # problem reads as the change having failed.
    security.delete_sessions(db, user.id, keep=security.session_token_hash(request))
    db.commit()
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
