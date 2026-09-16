"""The check-ins Tare sends itself, and the one loop that decides they are due.

One asyncio task inside the API process, because the deployment runs a single
uvicorn worker by the Dockerfile's own command; there is no second process to
race and so no lock. The push_sends row is what keeps that honest anyway: it
is written and committed before a message goes out, so a second ticker, or a
tick that crashes mid-send, can only ever send less rather than twice.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app import clock, models, notifications, notify_prefs
from app.db import SessionLocal
from app.models import now_utc
from app.notifications import EVENING, MORNING, QUIET, WEIGH_IN

log = logging.getLogger("tare.push")

# How late a slot may still fire. A phone that was off is not worth waking at
# two in the afternoon about breakfast, so a missed morning is missed.
WINDOW = dt.timedelta(minutes=90)

# A week with nothing in the journal is what pauses the daily check-ins, and
# how often the one note asking how it is going may go out.
QUIET_DAYS = 7

# A weigh-in this recent means the weekly nudge has nothing to ask for.
WEIGH_STALE_DAYS = 3

# How long a record of a send is worth keeping. Long enough that nothing can
# re-fire, short enough that the table stays small.
KEEP_SENDS_DAYS = 30

# How often the loop wakes. A slot is an hour and a half wide, so a minute is
# far finer than it needs to be and cheap enough not to matter.
TICK_SECONDS = 60


@dataclass(frozen=True)
class Facts:
    """Everything one member's schedule is decided from, fetched once.

    Held apart from the deciding so the rules below are a pure function of a
    moment and these, which is what makes them testable without a database.
    """

    prefs: dict[str, Any]
    sent_today: frozenset[str]
    last_quiet_day: dt.date | None
    last_entry_day: dt.date | None
    created_day: dt.date
    entries_today: int
    dinner_today: int
    completed_today: bool
    last_weigh_day: dt.date | None


def slot_open(local_now: dt.datetime, hhmm: str) -> bool:
    """Whether the moment falls inside a slot's hour and a half."""
    hour, _, minute = hhmm.partition(":")
    start = dt.datetime.combine(
        local_now.date(), dt.time(int(hour), int(minute)), local_now.tzinfo
    )
    return start <= local_now < start + WINDOW


def due(local_now: dt.datetime, facts: Facts) -> str | None:
    """The one kind owed to this member at this moment, if any.

    At most one: the morning slot carries three kinds that never coincide, and
    a quiet week pauses the dailies rather than adding to them.
    """
    today = local_now.date()
    prefs = facts.prefs
    morning, evening, weigh_in = prefs["morning"], prefs["evening"], prefs["weigh_in"]
    since = facts.last_entry_day or facts.created_day
    quiet = (today - since).days >= QUIET_DAYS

    if quiet:
        # Both check-ins off means a member who asked for nothing daily, and
        # the quiet note is a daily check-in in a quieter form.
        if not (morning["on"] or evening["on"]):
            return None
        if not slot_open(local_now, morning["time"]) or QUIET in facts.sent_today:
            return None
        since_quiet = (
            None if facts.last_quiet_day is None else (today - facts.last_quiet_day).days
        )
        if since_quiet is not None and since_quiet < QUIET_DAYS:
            return None
        return QUIET

    if slot_open(local_now, morning["time"]) and not (
        {MORNING, WEIGH_IN} & facts.sent_today
    ):
        weighed_lately = (
            facts.last_weigh_day is not None
            and (today - facts.last_weigh_day).days <= WEIGH_STALE_DAYS
        )
        if weigh_in["on"] and today.weekday() == weigh_in["weekday"] and not weighed_lately:
            return WEIGH_IN
        if morning["on"]:
            return MORNING

    if (
        evening["on"]
        and slot_open(local_now, evening["time"])
        and EVENING not in facts.sent_today
        and not facts.completed_today
        and (facts.entries_today == 0 or facts.dinner_today == 0)
    ):
        return EVENING
    return None


def facts_of(db: Session, user: models.User, today: dt.date) -> Facts:
    """The queries behind one decision, one member at a time."""
    sent_today = frozenset(
        db.scalars(
            select(models.PushSend.kind).where(
                models.PushSend.user_id == user.id, models.PushSend.day == today
            )
        )
    )
    last_quiet_day = db.scalar(
        select(func.max(models.PushSend.day)).where(
            models.PushSend.user_id == user.id, models.PushSend.kind == QUIET
        )
    )
    last_entry_day = db.scalar(
        select(func.max(models.DiaryEntry.date_for)).where(
            models.DiaryEntry.user_id == user.id
        )
    )
    entries_today = int(
        db.scalar(
            select(func.count())
            .select_from(models.DiaryEntry)
            .where(
                models.DiaryEntry.user_id == user.id, models.DiaryEntry.date_for == today
            )
        )
        or 0
    )
    dinner_today = int(
        db.scalar(
            select(func.count())
            .select_from(models.DiaryEntry)
            .where(
                models.DiaryEntry.user_id == user.id,
                models.DiaryEntry.date_for == today,
                models.DiaryEntry.slot == "dinner",
            )
        )
        or 0
    )
    last_weigh_day = db.scalar(
        select(func.max(models.WeightEntry.date_for)).where(
            models.WeightEntry.user_id == user.id,
            models.WeightEntry.weight_kg.is_not(None),
        )
    )
    return Facts(
        prefs=notify_prefs.normalize(user.notify),
        sent_today=sent_today,
        last_quiet_day=last_quiet_day,
        last_entry_day=last_entry_day,
        created_day=user.created_at.astimezone(clock.user_tz(user)).date(),
        entries_today=entries_today,
        dinner_today=dinner_today,
        completed_today=db.get(models.JournalDay, (user.id, today)) is not None,
        last_weigh_day=last_weigh_day,
    )


def _facts_for(db: Session, user: models.User, kind: str, facts: Facts) -> dict[str, Any]:
    """The few numbers the words need, fetched only for the kind being sent."""
    if kind == MORNING:
        # Imported here rather than at the top: the router pulls in half the
        # app, and this module is imported by the application itself.
        from app.routers.health import Reckoning, day_budget, typed_figures

        try:
            state = Reckoning(db, user)
            figures = day_budget(state)
            # An account whose numbers are not set up is reading Tare's general
            # guideline rather than a budget of its own, so the line says so
            # instead of quoting a figure nobody chose.
            own = state.complete or typed_figures(state, figures["calories"]) is not None
            return {"budget": figures["calories"] if own else None}
        except (KeyError, TypeError, ValueError, SQLAlchemyError):
            # A profile too thin to work anything out of is not a reason to
            # skip the check-in; the line without a number says the same thing.
            return {"budget": None}
    if kind == WEIGH_IN:
        return {"ever_weighed": facts.last_weigh_day is not None}
    if kind == EVENING:
        return {"entries": facts.entries_today}
    since = facts.last_entry_day or facts.created_day
    return {"quiet_days": (clock.user_today(user) - since).days}


def send_scheduled(
    db: Session, user: models.User, kind: str, today: dt.date, facts: Facts
) -> bool:
    """Write the record, then send. Never the other way round.

    The row is committed first so a crash between the two costs one
    notification rather than sending the same one every minute afterwards. A
    weigh-in also books the morning slot, so the day gets one push and not two.
    """
    try:
        with db.begin_nested():
            db.add(models.PushSend(user_id=user.id, kind=kind, day=today))
            if kind == WEIGH_IN:
                db.add(models.PushSend(user_id=user.id, kind=MORNING, day=today))
            db.flush()
    except IntegrityError:
        # Something else already booked this slot for today.
        db.expire_all()
        return False
    db.commit()
    notifications.deliver(
        db,
        user,
        notifications.compose(
            notifications.Event(kind), user, facts=_facts_for(db, user, kind, facts)
        ),
        ttl=notifications.TTL[kind],
        topic=kind,
    )
    return True


def tick(now: dt.datetime | None = None) -> int:
    """One pass over everybody with a device turned on. Returns what went out."""
    moment = now or now_utc()
    sent = 0
    with SessionLocal() as db:
        people = list(
            db.scalars(
                select(models.User).where(
                    models.User.id.in_(select(models.PushSubscription.user_id))
                )
            )
        )
        for user in people:
            try:
                local_now = moment.astimezone(clock.user_tz(user))
                today = local_now.date()
                facts = facts_of(db, user, today)
                kind = due(local_now, facts)
                if kind is not None and send_scheduled(db, user, kind, today, facts):
                    sent += 1
            except Exception:
                # One member's notification is never worth the rest of the tick.
                db.rollback()
                log.exception("a scheduled notification was not sent")
        db.execute(
            delete(models.PushSend).where(
                models.PushSend.day < moment.date() - dt.timedelta(days=KEEP_SENDS_DAYS)
            )
        )
        db.commit()
    return sent


async def run() -> None:
    """The loop itself, started at lifespan when this instance has keys."""
    log.info("notification schedule started")
    try:
        while True:
            try:
                await asyncio.to_thread(tick)
            except Exception:
                log.exception("a notification tick failed")
            await asyncio.sleep(TICK_SECONDS)
    except asyncio.CancelledError:
        log.info("notification schedule stopped")
        raise
