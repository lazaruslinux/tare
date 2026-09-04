"""What the members of this instance show each other.

One list, read only, and it holds two kinds of thing: a workout somebody did,
and a day somebody finished. No food, no weight, no steps, no likes and no
comments: the feed is here so a small group can see that somebody else went out
this morning, not so anybody can be scored against them. A finished day says
that and nothing else, never what was in it.

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


# The two kinds of row, and how they break a tie at the same instant: a
# workout is listed before a finished day stamped to the same moment. One rule,
# written once, so the page filter and the merge cannot disagree.
WORKOUT = "workout"
JOURNAL = "journal"
RANK = {JOURNAL: 0, WORKOUT: 1}


def write_cursor(at: dt.datetime, kind: str, anchor: str) -> str:
    """Where a page of the feed stopped, as one opaque word.

    Three parts, split on a character none of them holds: which kind of row it
    was, which row, and when. The kind is part of it because the two lists are
    read separately and stitched together, and a marker that named only a time
    would show or skip whatever shared that instant.
    """
    raw = f"{kind}|{anchor}|{at.isoformat()}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def read_cursor(cursor: str) -> tuple[dt.datetime, str, str]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        kind, anchor, at = base64.urlsafe_b64decode(padded).decode().split("|", 2)
        if kind not in RANK:
            raise ValueError(kind)
        return dt.datetime.fromisoformat(at), kind, anchor
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_CURSOR) from None


def pronoun_for(member: models.User, profile: models.HealthProfile | None) -> str:
    """The word a sentence about somebody uses, and the only thing the feed
    learns from the gender they may have shared. The field itself never leaves
    the server, and "their" is the answer for everybody who has not shared it.
    """
    if not member.share_sex or profile is None:
        return "their"
    return {"male": "his", "female": "her"}.get(profile.sex or "", "their")


@router.get("")
def read_feed(
    cursor: str = "",
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Every member's shared workouts and finished days, newest first, a page
    at a time.

    Two tables, one list. They are read separately with the same "before this
    marker" filter, merged here, and cut to a page; the marker written back
    names the last row's time, its kind and which row it was, so the next page
    starts exactly after it whichever table that row came out of. Sorting them
    in the database instead would mean a union of two unlike shapes for no
    gain: a page is thirty rows.

    A row this account hid is still in its own feed and says so, because the
    only way back to a hidden workout is through the list it was hidden from.
    """
    at: dt.datetime | None = None
    kind = ""
    anchor = ""
    if cursor:
        at, kind, anchor = read_cursor(cursor)

    # A row reaches the others when neither it nor its whole account is held
    # back. The owner always sees their own.
    workouts = (
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
    journals = (
        select(models.JournalDay)
        .join(models.User, models.User.id == models.JournalDay.user_id)
        .where(
            or_(
                models.User.share_journal.is_(True),
                models.JournalDay.user_id == user.id,
            )
        )
        .order_by(
            models.JournalDay.completed_at.desc(),
            models.JournalDay.user_id.desc(),
            models.JournalDay.date.desc(),
        )
        .limit(PAGE + 1)
    )

    if at is not None:
        if kind == WORKOUT:
            workouts = workouts.where(
                or_(
                    models.Workout.started_at < at,
                    and_(
                        models.Workout.started_at == at, models.Workout.id < int(anchor)
                    ),
                )
            )
            # A day stamped to the same instant as the workout the last page
            # ended on is listed after it, so it is still to come.
            journals = journals.where(models.JournalDay.completed_at <= at)
        else:
            was_user, was_date = anchor.split(":", 1)
            workouts = workouts.where(models.Workout.started_at < at)
            journals = journals.where(
                or_(
                    models.JournalDay.completed_at < at,
                    and_(
                        models.JournalDay.completed_at == at,
                        or_(
                            models.JournalDay.user_id < int(was_user),
                            and_(
                                models.JournalDay.user_id == int(was_user),
                                models.JournalDay.date < dt.date.fromisoformat(was_date),
                            ),
                        ),
                    ),
                )
            )

    sessions = list(db.execute(workouts).scalars())
    finished = list(db.execute(journals).scalars())

    # Both lists in one order, by the rule the cursor is written to. The last
    # two parts of the key are only ever compared inside one kind, because the
    # rank ahead of them is what separates the kinds.
    Row = models.Workout | models.JournalDay
    Key = tuple[dt.datetime, int, int, str]
    ordered: list[tuple[Key, str, Row]] = [
        *(
            ((row.started_at, RANK[WORKOUT], row.id, ""), WORKOUT, row)
            for row in sessions
        ),
        *(
            (
                (row.completed_at, RANK[JOURNAL], 0, f"{row.user_id:012d}:{row.date}"),
                JOURNAL,
                row,
            )
            for row in finished
        ),
    ]
    ordered.sort(key=lambda each: each[0], reverse=True)
    more = len(ordered) > PAGE
    page = ordered[:PAGE]

    # Three queries for the whole page rather than three per row: who each one
    # belongs to, which workouts recorded a line, and the gender a finished day
    # is spoken about in.
    owner_ids = {each.user_id for _, _, each in page}
    owners = {
        row.id: row
        for row in db.execute(
            select(models.User).where(models.User.id.in_(owner_ids))
        ).scalars()
    }
    profiles = {
        row.user_id: row
        for row in db.execute(
            select(models.HealthProfile).where(
                models.HealthProfile.user_id.in_(
                    {each.id for each in owners.values() if each.share_sex}
                )
            )
        ).scalars()
    }
    with_route = set(
        db.execute(
            select(models.WorkoutRoute.workout_id).where(
                models.WorkoutRoute.workout_id.in_(
                    {each.id for _, _, each in page if isinstance(each, models.Workout)}
                )
            )
        ).scalars()
    )

    items: list[dict[str, object]] = []
    for _, _, each in page:
        owner = owners.get(each.user_id)
        mine = each.user_id == user.id
        name = "" if owner is None else (owner.display_name or owner.username)
        if isinstance(each, models.JournalDay):
            journal: dict[str, object] = {
                "kind": JOURNAL,
                # The row has no id of its own: whose day it was and which day
                # is what names it, and the client only ever uses it as a key.
                "id": f"{each.user_id}:{each.date.isoformat()}",
                "user_id": each.user_id,
                "display_name": name,
                "mine": mine,
                "date": each.date.isoformat(),
                "at": each.completed_at.isoformat(),
                "pronoun": (
                    "their"
                    if owner is None
                    else pronoun_for(owner, profiles.get(owner.id))
                ),
            }
            if mine:
                journal["hidden"] = not user.share_journal
            items.append(journal)
            continue

        hidden = set() if owner is None or mine else kept_back(owner)
        item: dict[str, object] = {
            "kind": WORKOUT,
            "id": each.id,
            "user_id": each.user_id,
            "display_name": name,
            "mine": mine,
            "activity": each.activity,
            "date": each.date_for.isoformat(),
            "started_at": each.started_at.isoformat(),
            "duration_s": each.duration_s,
            "distance_m": each.distance_m,
            "has_route": each.id in with_route and "route" not in hidden,
            "indoor": each.indoor,
            "source": each.source,
        }
        if mine:
            item["hidden"] = each.hidden_from_feed or not user.share_workouts
        items.append(item)

    last = page[-1] if page else None
    return {
        "items": items,
        "next_cursor": (
            write_cursor(last[0][0], last[1], last[0][3] or str(last[0][2]))
            if more and last is not None
            else None
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
