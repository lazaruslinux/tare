"""One read-only list of what members share: workouts, finished days, weigh-ins
that came in lower, and arrivals. It never carries food, steps, what was in a
day, or a weight itself, and there is no answering back. Only the friends a
member adds see any of it, and every fact still follows its owner's switch.
"""

from __future__ import annotations

import base64
import binascii
import datetime as dt
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app import clock, health, models
from app.db import get_db
from app.deps import require_user
from app.friends import friend_ids
from app.models import now_utc
from app.profiles import avatar_url, contribution_counts, role_of
from app.routers.admin import name_match
from app.routers.diary import fill_auto_logs, total
from app.routers.fitness import day_exercise, steps_on, workouts_on
from app.routers.health import Reckoning, exercise_on

router = APIRouter(prefix="/feed", tags=["feed"])

# How many workouts one page of the feed carries.
PAGE = 30

# One page marker that is not ours, and one member who is not there.
BAD_CURSOR = "That page marker is not one of ours."
MISSING_MEMBER = "There is no such member."

# The three ways asking to be friends can be refused.
NOT_YOURSELF = "You cannot add yourself."
NO_REQUEST = "There is no request from this member."
NOTHING_TO_DROP = "There is no friendship with this member."


# The four kinds of row, and how they break a tie at the same instant: the
# higher rank is listed first, so arriving comes before a workout, a workout
# before a weigh-in and a weigh-in before a finished day. One rule, written
# once, so the page filter and the merge cannot disagree.
WORKOUT = "workout"
JOURNAL = "journal"
WEIGHT = "weight"
JOINED = "joined"
RANK = {JOURNAL: 0, WEIGHT: 1, WORKOUT: 2, JOINED: 3}

# How much has to have come off before a weigh-in is worth a row. Under this a
# sentence would read "lost 0.0", because 0.05 kg is the smallest difference
# that still rounds to a tenth in both pounds and kilograms.
MIN_LOSS_KG = 0.05


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


def journal_behind(anchor: str) -> Any:
    """A finished day listed after the one a marker named. That row has no id
    of its own, so whose day it was and which day is what orders it."""
    was_user, was_date = anchor.split(":", 1)
    return or_(
        models.JournalDay.user_id < int(was_user),
        and_(
            models.JournalDay.user_id == int(was_user),
            models.JournalDay.date < dt.date.fromisoformat(was_date),
        ),
    )


def still_to_come(
    rows_of: str,
    when: Any,
    behind: Callable[[], Any],
    at: dt.datetime,
    kind: str,
) -> Any:
    """What a page starting after one marker may still hold, for one kind.

    One rule for all three kinds rather than a branch each. A row of the
    marker's own kind is past it when it is older, or stamped to the same
    instant and behind it in the order. Any other kind is settled by the rank
    alone: the kinds listed after the marker at that instant were not sent, so
    they keep the instant itself, and the kinds listed before it lose it.
    """
    if rows_of == kind:
        return or_(when < at, and_(when == at, behind()))
    return when <= at if RANK[rows_of] < RANK[kind] else when < at


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
    """Friends' shared workouts, finished days and weigh-ins plus everybody's
    arrivals, newest first, thirty a page.

    Four tables are read with the same "after this marker" filter and merged
    here, and the marker written back names the last row's time, kind and id
    so the next page starts exactly after it. A row this account hid stays in
    its own feed and says so, because that is the only way back to it.
    """
    at: dt.datetime | None = None
    kind = ""
    anchor = ""
    if cursor:
        at, kind, anchor = read_cursor(cursor)

    # Whose rows may be read at all: the friends this account has, and itself.
    # Every switch below is asked after this one, so a switch left on is still
    # nothing to anybody who was never added.
    friends = friend_ids(db, user)
    shared_by = friends | {user.id}

    # A row reaches a friend when neither it nor its whole account is held
    # back. The owner always sees their own.
    workouts = (
        select(models.Workout)
        .join(models.User, models.User.id == models.Workout.user_id)
        .where(
            models.Workout.user_id.in_(shared_by),
            or_(
                and_(
                    models.Workout.hidden_from_feed.is_(False),
                    models.User.share_workouts.is_(True),
                ),
                models.Workout.user_id == user.id,
            ),
        )
        .order_by(models.Workout.started_at.desc(), models.Workout.id.desc())
        .limit(PAGE + 1)
    )
    # Arriving is not a fact about a body and there is no switch over it: the
    # row says a member is here, which everybody can already see. An account
    # from before the first-run screen existed has no moment to date it by and
    # gets no row.
    # Dated by when the account was made, not by the walkthrough: the first-run
    # stamp was given to every account that existed before the screen did, all
    # at the same minute, and that minute is nobody's arrival.
    joined = (
        select(models.User.id.label("user_id"), models.User.created_at)
        .where(models.User.first_run_at.is_not(None))
        .order_by(models.User.created_at.desc(), models.User.id.desc())
        .limit(PAGE + 1)
    )
    journals = (
        select(models.JournalDay)
        .join(models.User, models.User.id == models.JournalDay.user_id)
        .where(
            models.JournalDay.user_id.in_(shared_by),
            or_(
                models.User.share_journal.is_(True),
                models.JournalDay.user_id == user.id,
            ),
        )
        .order_by(
            models.JournalDay.completed_at.desc(),
            models.JournalDay.user_id.desc(),
            models.JournalDay.date.desc(),
        )
        .limit(PAGE + 1)
    )

    # A weigh-in is only a row when it came in under the one before it, which
    # is the reading the window function beside it carries. The comparison has
    # to be made before it can be filtered on, so it is made in a subquery and
    # the loss is read out of that.
    readings = select(
        models.WeightEntry.id,
        models.WeightEntry.user_id,
        models.WeightEntry.date_for,
        models.WeightEntry.weight_kg,
        models.WeightEntry.created_at,
        func.lag(models.WeightEntry.weight_kg)
        .over(
            partition_by=models.WeightEntry.user_id,
            order_by=models.WeightEntry.date_for,
        )
        .label("prev_kg"),
    ).where(
        # A day holding a body fat and no weight is neither a row here nor the
        # reading the next one is read against.
        models.WeightEntry.weight_kg.is_not(None)
    ).subquery()
    weights = (
        select(readings)
        .join(models.User, models.User.id == readings.c.user_id)
        .where(
            readings.c.user_id.in_(shared_by),
            readings.c.prev_kg.is_not(None),
            readings.c.prev_kg - readings.c.weight_kg >= MIN_LOSS_KG,
            or_(
                models.User.share_weight_loss.is_(True),
                readings.c.user_id == user.id,
            ),
        )
        .order_by(readings.c.created_at.desc(), readings.c.id.desc())
        .limit(PAGE + 1)
    )

    if at is not None:
        workouts = workouts.where(
            still_to_come(
                WORKOUT,
                models.Workout.started_at,
                lambda: models.Workout.id < int(anchor),
                at,
                kind,
            )
        )
        weights = weights.where(
            still_to_come(
                WEIGHT,
                readings.c.created_at,
                lambda: readings.c.id < int(anchor),
                at,
                kind,
            )
        )
        journals = journals.where(
            still_to_come(
                JOURNAL,
                models.JournalDay.completed_at,
                lambda: journal_behind(anchor),
                at,
                kind,
            )
        )
        joined = joined.where(
            still_to_come(
                JOINED,
                models.User.created_at,
                lambda: models.User.id < int(anchor),
                at,
                kind,
            )
        )

    sessions = list(db.execute(workouts).scalars())
    finished = list(db.execute(journals).scalars())
    weighed = list(db.execute(weights))
    arrived = list(db.execute(joined))

    # Every list in one order, by the rule the cursor is written to. The last
    # two parts of the key are only ever compared inside one kind, because the
    # rank ahead of them is what separates the kinds.
    Key = tuple[dt.datetime, int, int, str]
    ordered: list[tuple[Key, str, Any]] = [
        *(
            ((row.started_at, RANK[WORKOUT], row.id, ""), WORKOUT, row)
            for row in sessions
        ),
        *(
            ((row.created_at, RANK[WEIGHT], row.id, ""), WEIGHT, row)
            for row in weighed
        ),
        *(
            (
                (row.completed_at, RANK[JOURNAL], 0, f"{row.user_id:012d}:{row.date}"),
                JOURNAL,
                row,
            )
            for row in finished
        ),
        *(
            ((row.created_at, RANK[JOINED], row.user_id, ""), JOINED, row)
            for row in arrived
        ),
    ]
    ordered.sort(key=lambda each: each[0], reverse=True)
    more = len(ordered) > PAGE
    page = ordered[:PAGE]

    # Two queries for the whole page rather than two per row: who each one
    # belongs to, and the gender a row about a person is spoken about in.
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
    items: list[dict[str, object]] = []
    for _, of, each in page:
        owner = owners.get(each.user_id)
        mine = each.user_id == user.id
        name = "" if owner is None else (owner.display_name or owner.username)
        # The shield beside the name, the same one every other screen draws.
        role = None if owner is None else role_of(owner)
        said = "their" if owner is None else pronoun_for(owner, profiles.get(owner.id))
        if of == WEIGHT:
            # How much came off, and nothing either weight was. The reading
            # before it is what made this a row and does not leave the server.
            lost: dict[str, object] = {
                "kind": WEIGHT,
                "id": each.id,
                "user_id": each.user_id,
                "display_name": name,
                "role": role,
                "mine": mine,
                "date": each.date_for.isoformat(),
                "at": each.created_at.isoformat(),
                "lost_kg": each.prev_kg - each.weight_kg,
                "pronoun": said,
            }
            if mine:
                lost["hidden"] = not user.share_weight_loss
            items.append(lost)
            continue

        if of == JOINED:
            # Nothing but that they are here, so there is nothing to hide and
            # no switch to read.
            items.append(
                {
                    "kind": JOINED,
                    # The member is the row, so their id names it.
                    "id": each.user_id,
                    "user_id": each.user_id,
                    "display_name": name,
                    "role": role,
                    "mine": mine,
                    "date": each.created_at.date().isoformat(),
                    "at": each.created_at.isoformat(),
                }
            )
            continue

        if of == JOURNAL:
            journal: dict[str, object] = {
                "kind": JOURNAL,
                # The row has no id of its own: whose day it was and which day
                # is what names it, and the client only ever uses it as a key.
                "id": f"{each.user_id}:{each.date.isoformat()}",
                "user_id": each.user_id,
                "display_name": name,
                "role": role,
                "mine": mine,
                "date": each.date.isoformat(),
                "at": each.completed_at.isoformat(),
                "pronoun": said,
            }
            if mine:
                journal["hidden"] = not user.share_journal
            items.append(journal)
            continue

        # That somebody synced a session, and when. Every figure on it is
        # behind a switch, so none of them is on the row: the row is a way in
        # to the workout, and the workout answers what was shared.
        item: dict[str, object] = {
            "kind": WORKOUT,
            "id": each.id,
            "user_id": each.user_id,
            "display_name": name,
            "role": role,
            "mine": mine,
            "activity": each.activity,
            "date": each.date_for.isoformat(),
            "started_at": each.started_at.isoformat(),
        }
        if mine:
            item["hidden"] = each.hidden_from_feed or not user.share_workouts
        items.append(item)

    last = page[-1] if page else None
    return {
        "items": items,
        "friends": len(friends),
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
    # The strip is a reading of today, so today owes its auto-logs first.
    fill_auto_logs(db, user, day, day)
    entries = list(
        db.execute(
            select(models.DiaryEntry).where(
                models.DiaryEntry.user_id == user.id,
                models.DiaryEntry.date_for == day,
            )
        ).scalars()
    )
    _, minutes = day_exercise(exercise_on(db, user, day), workouts_on(db, user, day))
    eaten = total(entries, "calories") or 0.0
    latest = Reckoning(db, user).latest
    db.commit()

    figures: dict[str, object] = {
        "calories_eaten": round(eaten),
        "steps": steps_on(db, user, [day]).get(day),
        "exercise_min": minutes,
        "latest_weight_kg": None if latest is None else latest.weight_kg,
        "latest_weight_date": None if latest is None else latest.date_for.isoformat(),
        "contributions": contribution_counts(db, [user.id])[user.id],
        "pending": db.scalar(
            select(func.count())
            .select_from(models.FoodSubmission)
            .where(
                models.FoodSubmission.submitted_by_id == user.id,
                models.FoodSubmission.status == "pending",
            )
        )
        or 0,
    }
    return figures


# One page of the roster. The list is read in the order of the name each
# member is shown under, which is a name somebody can change, so a page is
# counted from the top rather than marked by a row: a marker made of a name
# would point at nothing the moment its owner renamed themselves.
MEMBERS_PAGE = 25


def member_rows(db: Session, members: list[models.User]) -> list[dict[str, object]]:
    """The few things a member is listed by, wherever they are listed.

    One count for the whole list rather than one per row, so a page of
    twenty-five is one query and not twenty-five.
    """
    counts = contribution_counts(db, [member.id for member in members])
    return [
        {
            "id": member.id,
            "display_name": member.display_name or member.username,
            "role": role_of(member),
            "avatar_url": avatar_url(member),
            "member_since": member.created_at.strftime("%Y-%m"),
            "contributions": counts[member.id],
        }
        for member in members
    ]


@router.get("/members")
def read_members(
    q: str = "",
    offset: int = 0,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """One page of everybody in this Tare, by the name they are shown under.

    Twenty-five at a time with a box above them rather than the whole list:
    every row carries a picture, so a screen that draws all of them is a screen
    that gets slower every time somebody joins.

    An administrator is shown exactly what anybody else is shown. This is the
    community list, not the account list.
    """
    shown = func.coalesce(models.User.display_name, models.User.username)
    query = select(models.User)
    if q.strip():
        query = query.where(name_match(q))
    # A page before the first one is the first one.
    start = max(offset, 0)
    members = list(
        db.execute(
            query.order_by(func.lower(shown), models.User.username, models.User.id)
            .offset(start)
            .limit(MEMBERS_PAGE + 1)
        ).scalars()
    )
    more = len(members) > MEMBERS_PAGE
    members = members[:MEMBERS_PAGE]
    friends = friend_ids(db, user)
    rows = member_rows(db, members)
    for row in rows:
        row["friend"] = row["id"] in friends
    return {
        "items": rows,
        "next_offset": start + len(members) if more else None,
    }


@router.get("/members/{user_id}")
def read_member(
    user_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """One member as another member sees them: a name, a month, and whatever
    they chose to show their friends. A fact that is not shared is absent
    rather than null, so nothing on the far side has to know what was
    withheld."""
    member = db.get(models.User, user_id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_MEMBER)

    standing = state_of(user, user_id, pair(db, user, user_id))
    shown: dict[str, object] = {
        "friendship": standing,
        "display_name": member.display_name or member.username,
        # What they do for the group, which is not a private fact: everybody
        # can see who reviews.
        "role": role_of(member),
        "member_since": member.created_at.strftime("%Y-%m"),
        "avatar_url": avatar_url(member),
        # What they have given the shared database, shown for everybody. It is
        # a count of work done for the group rather than a fact about them, so
        # there is nothing here to keep private.
        "contributions": contribution_counts(db, [member.id])[member.id],
    }
    # The three opt-in facts are for friends. A switch turned on is an offer to
    # the people this member added, not to the whole instance.
    if standing not in ("self", "friends"):
        return shown
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


def pair(db: Session, user: models.User, other_id: int) -> models.Friendship | None:
    """The one row between two members, whichever of them did the asking."""
    return db.scalar(
        select(models.Friendship).where(
            or_(
                and_(
                    models.Friendship.requester_id == user.id,
                    models.Friendship.addressee_id == other_id,
                ),
                and_(
                    models.Friendship.requester_id == other_id,
                    models.Friendship.addressee_id == user.id,
                ),
            )
        )
    )


def state_of(user: models.User, other_id: int, row: models.Friendship | None) -> str:
    """What these two are to each other, in the reader's own terms.

    Said from one side, so the same pending row is "requested" to whoever asked
    and "incoming" to whoever was asked.
    """
    if other_id == user.id:
        return "self"
    if row is None:
        return "none"
    if row.accepted_at is not None:
        return "friends"
    return "requested" if row.requester_id == user.id else "incoming"


@router.get("/friends")
def read_friends(
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Who this account shares with, who has asked it, and who it has asked.

    Three lists out of one table: every row touching this account, sorted into
    the side it is waiting on.
    """
    rows = list(
        db.execute(
            select(models.Friendship).where(
                or_(
                    models.Friendship.requester_id == user.id,
                    models.Friendship.addressee_id == user.id,
                )
            )
        ).scalars()
    )
    sides: dict[str, list[int]] = {"friends": [], "incoming": [], "outgoing": []}
    for row in rows:
        other = row.addressee_id if row.requester_id == user.id else row.requester_id
        if row.accepted_at is not None:
            sides["friends"].append(other)
        elif row.requester_id == user.id:
            sides["outgoing"].append(other)
        else:
            sides["incoming"].append(other)

    named = list(
        db.execute(
            select(models.User).where(
                models.User.id.in_({other for ids in sides.values() for other in ids})
            )
        ).scalars()
    )
    shown = {row["id"]: row for row in member_rows(db, named)}
    listed: dict[str, object] = {
        side: sorted(
            (shown[other] for other in ids if other in shown),
            key=lambda row: str(row["display_name"]).lower(),
        )
        for side, ids in sides.items()
    }
    return listed


@router.post("/friends/{user_id}")
def ask_friend(
    user_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Ask a member to be friends.

    Asking somebody who already asked is agreeing with them, so their pending
    row is accepted rather than a second one written the other way round.
    Asking twice says what already stands instead of failing.
    """
    if user_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NOT_YOURSELF)
    if db.get(models.User, user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_MEMBER)

    row = pair(db, user, user_id)
    if row is None:
        row = models.Friendship(requester_id=user.id, addressee_id=user_id)
        db.add(row)
    elif row.accepted_at is None and row.requester_id == user_id:
        row.accepted_at = now_utc()
    db.commit()
    return {"friendship": state_of(user, user_id, row)}


@router.post("/friends/{user_id}/accept")
def accept_friend(
    user_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Agree to a request. Only the side that was asked may."""
    row = db.scalar(
        select(models.Friendship).where(
            models.Friendship.requester_id == user_id,
            models.Friendship.addressee_id == user.id,
            models.Friendship.accepted_at.is_(None),
        )
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NO_REQUEST)
    row.accepted_at = now_utc()
    db.commit()
    return {"friendship": "friends"}


@router.delete("/friends/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def drop_friend(
    user_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    """Withdraw a request, decline one, or remove a friend.

    One row holds all three, so which of them this is depends only on who wrote
    the row and whether it was accepted. Nothing is said to the other side.
    """
    row = pair(db, user, user_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOTHING_TO_DROP)
    db.delete(row)
    db.commit()
