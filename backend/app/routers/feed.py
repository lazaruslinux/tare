"""What the members of this instance show each other.

One list, read only, and it holds workouts and nothing else. No food, no
weight, no steps, no likes and no comments: the feed is here so a small group
can see that somebody else went out this morning, not so anybody can be scored
against them.

What a member is shown about another member is the shortest list the app
could work with: a name, how long they have been here, and up to three facts
they turned on themselves. Everything else about an account is private to it,
administrators included.
"""

from __future__ import annotations

import base64
import binascii
import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app import clock, health, models
from app.db import get_db
from app.deps import require_user
from app.routers.admin import waiting_items
from app.routers.diary import exercise_credit, total
from app.routers.fitness import day_exercise, kept_back, steps_on, workouts_on
from app.routers.health import Reckoning, day_budget, exercise_on

router = APIRouter(prefix="/feed", tags=["feed"])

# How many workouts one page of the feed carries.
PAGE = 30

# One page marker that is not ours, and one member who is not there.
BAD_CURSOR = "That page marker is not one of ours."
MISSING_MEMBER = "There is no such member."


def write_cursor(started_at: dt.datetime, workout_id: int) -> str:
    """Where a page of the feed stopped, as one opaque word.

    The id leads so the two parts split cleanly: a timestamp holds full stops
    and a row id never does.
    """
    raw = f"{workout_id}.{started_at.isoformat()}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def read_cursor(cursor: str) -> tuple[dt.datetime, int]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        workout_id, started = base64.urlsafe_b64decode(padded).decode().split(".", 1)
        return dt.datetime.fromisoformat(started), int(workout_id)
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_CURSOR) from None


@router.get("")
def read_feed(
    cursor: str = "",
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Every member's shared workouts, newest first, a page at a time.

    A row this account hid is still in its own feed and says so, because the
    only way back to a hidden workout is through the list it was hidden from.
    """
    # A row reaches the others when neither it nor its whole account is held
    # back. The owner always sees their own.
    query = (
        select(models.Workout)
        .join(models.User, models.User.id == models.Workout.user_id)
        .where(
            or_(
                and_(
                    models.Workout.hidden_from_feed.is_(False),
                    models.User.share_workouts.is_(True),
                ),
                models.Workout.user_id == user.id,
            )
        )
        .order_by(models.Workout.started_at.desc(), models.Workout.id.desc())
        .limit(PAGE + 1)
    )
    if cursor:
        at, anchor = read_cursor(cursor)
        query = query.where(
            or_(
                models.Workout.started_at < at,
                and_(models.Workout.started_at == at, models.Workout.id < anchor),
            )
        )
    found = list(db.execute(query).scalars())
    more = len(found) > PAGE
    rows = found[:PAGE]

    # Two queries for the whole page rather than two per row: who each one
    # belongs to, and which of them recorded a line.
    owners = {
        row.id: row
        for row in db.execute(
            select(models.User).where(
                models.User.id.in_({workout.user_id for workout in rows})
            )
        ).scalars()
    }
    with_route = set(
        db.execute(
            select(models.WorkoutRoute.workout_id).where(
                models.WorkoutRoute.workout_id.in_({workout.id for workout in rows})
            )
        ).scalars()
    )

    items: list[dict[str, object]] = []
    for workout in rows:
        owner = owners.get(workout.user_id)
        mine = workout.user_id == user.id
        hidden = set() if owner is None or mine else kept_back(owner)
        item: dict[str, object] = {
            "id": workout.id,
            "user_id": workout.user_id,
            "display_name": (
                "" if owner is None else (owner.display_name or owner.username)
            ),
            "mine": mine,
            "activity": workout.activity,
            "date": workout.date_for.isoformat(),
            "started_at": workout.started_at.isoformat(),
            "duration_s": workout.duration_s,
            "distance_m": workout.distance_m,
            "has_route": workout.id in with_route and "route" not in hidden,
            "indoor": workout.indoor,
            "source": workout.source,
        }
        if mine:
            item["hidden"] = workout.hidden_from_feed or not user.share_workouts
        items.append(item)

    return {
        "items": items,
        "next_cursor": (
            write_cursor(rows[-1].started_at, rows[-1].id) if more and rows else None
        ),
    }


@router.get("/today")
def read_today(
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """The few figures the wide layout keeps beside whatever is on screen.

    The same numbers the Dashboard reads, worked out the same way, so the
    strip and the card can never disagree about a day.
    """
    day = clock.user_today(user)
    entries = list(
        db.execute(
            select(models.DiaryEntry).where(
                models.DiaryEntry.user_id == user.id,
                models.DiaryEntry.date_for == day,
            )
        ).scalars()
    )
    state = Reckoning(db, user)
    budget = day_budget(state)
    kcal, _ = day_exercise(exercise_on(db, user, day), workouts_on(db, user, day))
    eaten = total(entries, "calories") or 0.0
    latest = state.latest
    db.commit()

    figures: dict[str, object] = {
        "calories_left": round(budget["calories"] + exercise_credit(kcal) - eaten),
        "steps": steps_on(db, user, [day]).get(day),
        "latest_weight_kg": None if latest is None else latest.weight_kg,
        "latest_weight_date": None if latest is None else latest.date_for.isoformat(),
    }
    if user.is_admin:
        figures["waiting"] = len(waiting_items(db))
    return figures


@router.get("/members/{user_id}")
def read_member(
    user_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """One member as other members see them: a name, a month, and whatever
    they chose to show. A fact that is not shared is absent rather than null,
    so nothing on the far side has to know what was withheld."""
    member = db.get(models.User, user_id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_MEMBER)

    shown: dict[str, object] = {
        "display_name": member.display_name or member.username,
        "member_since": member.created_at.strftime("%Y-%m"),
    }
    if member.share_age and member.birthdate is not None:
        # Counted against the date in UTC: an age in whole years is not worth
        # asking whose midnight it is.
        shown["age"] = health.age_on(member.birthdate, dt.datetime.now(dt.timezone.utc).date())
    if member.share_sex:
        profile = db.get(models.HealthProfile, member.id)
        if profile is not None and profile.sex is not None:
            shown["sex"] = profile.sex
    if member.share_location and member.location:
        shown["location"] = member.location
    return shown
