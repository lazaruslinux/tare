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
from app.notifications import EVENING, MORNING, QUIET, REMINDER, WEIGH_IN

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

# What push_sends.kind holds. A reminder books its slot under the appointment
# it is about, so the id has to fit inside the column.
KIND_CHARS = 16


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


def weighed_lately(today: dt.date, facts: Facts) -> bool:
    """Whether a weigh-in this recent leaves the weekly ask nothing to ask for."""
    return (
        facts.last_weigh_day is not None
        and (today - facts.last_weigh_day).days <= WEIGH_STALE_DAYS
    )


def weigh_in_due(today: dt.date, facts: Facts) -> bool:
    """Whether today is this member's weigh-in day and the scale is overdue."""
    weigh_in = facts.prefs["weigh_in"]
    return bool(
        weigh_in["on"]
        and today.weekday() == weigh_in["weekday"]
        and not weighed_lately(today, facts)
    )


def due(local_now: dt.datetime, facts: Facts) -> str | None:
    """The one kind owed to this member at this moment, if any.

    At most one: the morning slot carries three kinds that never coincide, and
    a quiet week pauses the dailies rather than adding to them.
    """
    today = local_now.date()
    prefs = facts.prefs
    morning, evening = prefs["morning"], prefs["evening"]
    since = facts.last_entry_day or facts.created_day
    quiet = (today - since).days >= QUIET_DAYS

    if quiet:
        # The dailies pause whatever else is set: seven days with nothing
        # logged is not a week to be told about breakfast every morning. The
        # weekly switch decides only whether the one note asking how it is
        # going goes out in their place.
        if not prefs["weekly"]["on"]:
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
        # The morning note asks for the weigh-in itself now, so only a member
        # with no morning note needs the weigh-in on its own.
        if morning["on"]:
            return MORNING
        if weigh_in_due(today, facts):
            return WEIGH_IN

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


def _budget_of(db: Session, user: models.User) -> float | None:
    """What this member has to spend today, or nothing when it is not theirs."""
    # Imported here rather than at the top: the router pulls in half the app,
    # and this module is imported by the application itself.
    from app.routers.health import Reckoning, day_budget, typed_figures

    try:
        state = Reckoning(db, user)
        figures = day_budget(state)
        # An account whose numbers are not set up is reading Tare's general
        # guideline rather than a budget of its own, so the line says so
        # instead of quoting a figure nobody chose.
        own = state.complete or typed_figures(state, figures["calories"]) is not None
        return figures["calories"] if own else None
    except (KeyError, TypeError, ValueError, SQLAlchemyError):
        # A profile too thin to work anything out of is not a reason to skip
        # the check-in; the line without a number says the same thing.
        return None


def _first_up(
    db: Session, user: models.User, local_now: dt.datetime
) -> dict[str, Any] | None:
    """The first appointment of today this member has not reached yet."""
    from app.routers.calendar import timed_starts

    today = local_now.date()
    try:
        for row, _day, start, _shelf in timed_starts(db, user, today, today):
            if start > local_now:
                return {
                    "title": row.title,
                    "at": start.astimezone(local_now.tzinfo).time(),
                }
    except SQLAlchemyError:
        # A calendar that will not answer is not worth losing the check-in over.
        return None
    return None


def _facts_for(
    db: Session, user: models.User, kind: str, facts: Facts, local_now: dt.datetime
) -> dict[str, Any]:
    """The few numbers the words need, fetched only for the kind being sent."""
    if kind == MORNING:
        return {
            "weigh_ask": weigh_in_due(local_now.date(), facts),
            "budget": _budget_of(db, user),
            "first_up": _first_up(db, user, local_now),
        }
    if kind == WEIGH_IN:
        return {"ever_weighed": facts.last_weigh_day is not None}
    if kind == EVENING:
        return {"entries": facts.entries_today}
    since = facts.last_entry_day or facts.created_day
    return {"quiet_days": (clock.user_today(user) - since).days}


def send_scheduled(
    db: Session,
    user: models.User,
    kind: str,
    today: dt.date,
    facts: Facts,
    local_now: dt.datetime,
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
            notifications.Event(kind),
            user,
            facts=_facts_for(db, user, kind, facts, local_now),
        ),
        ttl=notifications.TTL[kind],
        topic=kind,
    )
    return True


def send_reminders(
    db: Session, user: models.User, local_now: dt.datetime, facts: Facts
) -> int:
    """Anything starting within the member's lead time, told once.

    Apart from the check-ins on purpose: a reminder is about one occurrence
    rather than an hour of the day, several can be owed at once, and an
    appointment does not stop mattering because the journal went quiet.
    """
    reminders = facts.prefs["reminders"]
    if not reminders["on"]:
        return 0
    from app.routers.calendar import timed_starts

    minutes = int(reminders["minutes"])
    lead = dt.timedelta(minutes=minutes)
    today = local_now.date()
    sent = 0
    # A day either side of today, so an appointment just after midnight is
    # reminded about the evening before whatever zone the member keeps.
    window = timed_starts(
        db, user, today - dt.timedelta(days=1), today + dt.timedelta(days=1)
    )
    for row, day, start, shelf in window:
        if not start - lead <= local_now < start:
            continue
        kind = f"appt-{row.id}"
        if len(kind) > KIND_CHARS:
            # Nothing to book the send against, so nothing that could stop it
            # going again every minute. Better silent than repeating.
            log.warning("no room to record a reminder for appointment %s", row.id)
            continue
        try:
            with db.begin_nested():
                db.add(models.PushSend(user_id=user.id, kind=kind, day=day))
                db.flush()
        except IntegrityError:
            # This occurrence was already told about.
            db.expire_all()
            continue
        db.commit()
        notifications.deliver(
            db,
            user,
            notifications.compose(
                notifications.Event(
                    REMINDER,
                    title=row.title,
                    day=day,
                    at=row.time_of_day,
                    zone=row.timezone,
                    ref=row.id,
                    calendar=shelf,
                    location=row.location or "",
                    minutes=minutes,
                ),
                user,
            ),
            # Worth no longer than the head start it was meant to give.
            ttl=minutes * 60,
            topic=None,
        )
        sent += 1
    return sent


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
                if kind is not None and send_scheduled(
                    db, user, kind, today, facts, local_now
                ):
                    sent += 1
                sent += send_reminders(db, user, local_now, facts)
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
