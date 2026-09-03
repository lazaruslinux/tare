"""What a member has to say about tare, appended to one file.

A file rather than a table: this is prose an administrator reads start to
finish, nothing in the app queries it, and it outlives a database that is
dropped between rounds. Every block carries the time in the member's own zone
and in UTC, so a report can be lined up with a log.
"""

from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from app import clock, models, throttle
from app.config import settings
from app.deps import require_admin, require_user
from app.models import now_utc

router = APIRouter(prefix="/feedback", tags=["feedback"])

# Where it happened, in the words the screens use.
AREAS = {
    "dashboard": "Dashboard",
    "journal": "Journal",
    "food": "Food",
    "scanner": "Scanner",
    "targets": "Targets",
    "measurements": "Biometrics",
    "more": "More",
    "other": "Other",
}

KINDS = {
    "bug": "Bug",
    "idea": "Idea",
    "wording": "Wording",
    "confusing": "Confusing",
}

MAX_TEXT = 2000
MAX_EXPECTED = 1000

BAD_AREA = "Pick where it happened."
BAD_KIND = "Pick what kind it is."
NO_TEXT = "Write what happened."
LONG_TEXT = f"Keep it under {MAX_TEXT:,} characters."
LONG_EXPECTED = f"Keep it under {MAX_EXPECTED:,} characters."

# Twenty an hour, keyed to the account rather than the address: this is behind
# a sign-in, so the person is known, and a household on one address should not
# share one allowance.
limiter = throttle.RateLimiter(20, 3600, "feedback")


class FeedbackIn(BaseModel):
    area: str
    kind: str
    text: str
    expected: str = ""


def block(user: models.User, area: str, kind: str, text: str, expected: str) -> str:
    """One entry as it is written down."""
    moment = now_utc()
    local = moment.astimezone(clock.user_tz(user))
    head = (
        f"## {local:%Y-%m-%d %H:%M %Z} ({moment:%Y-%m-%d %H:%M} UTC) | {user.username} | "
        f"{AREAS[area]} | {KINDS[kind]}"
    )
    lines = [head, text]
    if expected:
        lines.append(f"Expected: {expected}")
    return "\n".join(lines) + "\n\n"


@router.post("", status_code=status.HTTP_201_CREATED)
def send_feedback(
    body: FeedbackIn,
    request: Request,
    user: models.User = Depends(require_user),
) -> dict[str, bool]:
    if body.area not in AREAS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_AREA)
    if body.kind not in KINDS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_KIND)
    text = body.text.strip()
    expected = body.expected.strip()
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_TEXT)
    if len(text) > MAX_TEXT:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, LONG_TEXT)
    if len(expected) > MAX_EXPECTED:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, LONG_EXPECTED)
    if limiter.hit(str(user.id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY)

    # Read at call time rather than at import, so a test can point this
    # somewhere it can throw away.
    path = settings.feedback_path
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(block(user, body.area, body.kind, text, expected))
    return {"ok": True}


@router.get("")
def read_feedback(user: models.User = Depends(require_admin)) -> dict[str, str]:
    """The whole file, for the one screen that shows it."""
    try:
        with open(settings.feedback_path, encoding="utf-8") as handle:
            return {"text": handle.read()}
    except FileNotFoundError:
        # Nothing has been sent yet, which is not a fault.
        return {"text": ""}
