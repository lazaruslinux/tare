"""Every notification Tare sends: the words, and the one door they go out of.

One module for the strings so a sentence is never written twice, and one
function, notify(), for everything that is not on a schedule. Anything that
wants to tell a member something calls that and nothing else, which is what
lets a send fail, or the whole feature be turned off, without the request that
caused it noticing.
"""

from __future__ import annotations

import datetime as dt
import logging
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app import clock, models, notify_prefs, webpush
from app.db import SessionLocal
from app.models import now_utc

log = logging.getLogger("tare.push")

# The four Tare sends itself, on the member's own hours.
MORNING = "morning"
EVENING = "evening"
WEIGH_IN = "weigh_in"
QUIET = "quiet"
# And the one somebody asks for from the Notifications screen.
TEST = "test"

# The calendar's, each raised by something another member did.
APPOINTMENT_ADDED = "appointment_added"
APPOINTMENT_CHANGED = "appointment_changed"
APPOINTMENT_DELETED = "appointment_deleted"
OCCURRENCE_CANCELLED = "occurrence_cancelled"
INVITED = "invited"
INVITATION_ACCEPTED = "invitation_accepted"
INVITATION_DECLINED = "invitation_declined"
CALENDAR_OFFERED = "calendar_offered"
MEMBER_JOINED = "member_joined"

# Which switch on the Notifications screen decides whether a kind is sent.
# None means the kind is not one of the switches: the scheduled ones carry
# their own, and a test is a member asking for it there and then.
PREF_OF: dict[str, str | None] = {
    MORNING: None,
    EVENING: None,
    WEIGH_IN: None,
    QUIET: None,
    TEST: None,
    APPOINTMENT_ADDED: "calendar",
    APPOINTMENT_CHANGED: "calendar",
    APPOINTMENT_DELETED: "calendar",
    OCCURRENCE_CANCELLED: "calendar",
    MEMBER_JOINED: "calendar",
    INVITED: "invitations",
    INVITATION_ACCEPTED: "invitations",
    INVITATION_DECLINED: "invitations",
    CALENDAR_OFFERED: "invitations",
}

# How long the push service holds one for a phone that is off. A check-in is
# worth the hour and a half its slot lasts and no longer; anything about the
# calendar is worth a day; a test is worth the minutes somebody is watching.
TTL: dict[str, int] = {
    MORNING: 5400,
    EVENING: 5400,
    WEIGH_IN: 5400,
    QUIET: 86400,
    TEST: 300,
    APPOINTMENT_ADDED: 86400,
    APPOINTMENT_CHANGED: 86400,
    APPOINTMENT_DELETED: 86400,
    OCCURRENCE_CANCELLED: 86400,
    INVITED: 86400,
    INVITATION_ACCEPTED: 86400,
    INVITATION_DECLINED: 86400,
    CALENDAR_OFFERED: 86400,
    MEMBER_JOINED: 86400,
}


@dataclass(frozen=True)
class Event:
    """What happened, in the few facts every message is written from.

    The zone is the appointment's own, so the time can be moved into whatever
    zone the person being told reads in rather than arriving as somebody
    else's nine o'clock.
    """

    kind: str
    title: str = ""
    who: str = ""
    day: dt.date | None = None
    at: dt.time | None = None
    zone: str = ""
    ref: int | None = None
    calendar: str = ""
    end_at: dt.time | None = None
    whole_series: bool = False


@dataclass(frozen=True)
class Message:
    """One notification as the browser will show it."""

    title: str
    body: str
    url: str
    tag: str


def time_text(at: dt.time, reads: str) -> str:
    """A time on the clock this account reads, written the way the app writes
    one: 9:00AM tight, or 09:00 on the 24-hour clock."""
    if reads == "24h":
        return f"{at.hour:02d}:{at.minute:02d}"
    return f"{at.hour % 12 or 12}:{at.minute:02d}{'AM' if at.hour < 12 else 'PM'}"


def range_text(start: dt.time, end: dt.time | None, reads: str) -> str:
    """The whole slot. The start drops its half of the day when the end shares
    it, so a short slot stays short."""
    from_text = time_text(start, reads)
    if end is None:
        return from_text
    to_text = time_text(end, reads)
    if reads == "24h":
        return f"{from_text} to {to_text}"
    if from_text[-2:] == to_text[-2:]:
        from_text = from_text[:-2]
    return f"{from_text} to {to_text}"


def date_text(day: dt.date, today: dt.date) -> str:
    """Tue, Sep 16. The year is only said when the day is not in this one."""
    spelled = f"{day:%a}, {day:%b} {day.day}"
    return spelled if day.year == today.year else f"{spelled}, {day.year}"


def when_text(
    recipient: models.User,
    day: dt.date,
    at: dt.time | None,
    zone: str,
    end_at: dt.time | None = None,
) -> str:
    """When it is, read where the recipient is standing.

    An all-day appointment has no moment to move, so it keeps its date; a
    timed one is moved out of the zone it was arranged in and into theirs.
    """
    today = clock.user_today(recipient)
    if at is None:
        return f"{date_text(day, today)}, all day"
    here = dt.datetime.combine(day, at, clock.zone(zone or recipient.timezone)).astimezone(
        clock.user_tz(recipient)
    )
    ends = (
        None
        if end_at is None
        else dt.datetime.combine(
            day, end_at, clock.zone(zone or recipient.timezone)
        ).astimezone(clock.user_tz(recipient))
    )
    stamp = date_text(here.date(), today)
    if ends is None:
        return f"{stamp} at {time_text(here.time(), recipient.clock)}"
    return f"{stamp}, {range_text(here.time(), ends.time(), recipient.clock)}"


# Where a tap lands. The app reads these as a deep link on the way in and
# erases anything it does not know, so a kind added later needs a kind here.
URL_OF: dict[str, str] = {
    MORNING: "/?open=journal",
    EVENING: "/?open=journal",
    QUIET: "/?open=journal",
    WEIGH_IN: "/?open=biometrics",
    INVITED: "/?open=invitations",
    CALENDAR_OFFERED: "/?open=calendar",
    MEMBER_JOINED: "/?open=calendar",
    TEST: "/?open=notifications",
}

# The kinds that land on one day of the calendar, which carry the day with them.
ON_A_DAY = (
    APPOINTMENT_ADDED,
    APPOINTMENT_CHANGED,
    APPOINTMENT_DELETED,
    OCCURRENCE_CANCELLED,
    INVITATION_ACCEPTED,
    INVITATION_DECLINED,
)

# And the ones that are about one appointment, whichever day that is.
ABOUT_AN_APPOINTMENT = (*ON_A_DAY, INVITED)


def _url_of(event: Event) -> str:
    if event.kind in ON_A_DAY:
        day = "" if event.day is None else event.day.isoformat()
        return f"/?open=calendar&day={day}" if day else "/?open=calendar"
    return URL_OF.get(event.kind, "/")


def _tag_of(event: Event) -> str:
    if event.kind in ABOUT_AN_APPOINTMENT:
        return f"appt-{event.ref}"
    if event.kind in (CALENDAR_OFFERED, MEMBER_JOINED):
        return f"cal-{event.ref}"
    return event.kind


def _on_calendar(event: Event, word: str) -> str:
    """Added X to Home, or plain Added X for somebody who was only asked."""
    return f"{word} {event.title} {'to' if word == 'Added' else 'on'} {event.calendar}"


def _stamp(event: Event, recipient: models.User) -> str:
    if event.day is None:
        return ""
    return when_text(recipient, event.day, event.at, event.zone, event.end_at)


def _scheduled_body(kind: str, facts: dict[str, Any]) -> str:
    if kind == MORNING:
        budget = facts.get("budget")
        if budget is None:
            return "A new day in your journal. Log breakfast when you have it."
        return f"Your budget today is {budget:,.0f} cal. Log breakfast when you have it."
    if kind == WEIGH_IN:
        if facts.get("ever_weighed"):
            return (
                "Time for your weekly weigh-in. Step on the scale and log it "
                "under Biometrics."
            )
        return "Your first weigh-in starts the progress chart. Log it under Biometrics."
    if kind == EVENING:
        if facts.get("entries"):
            return "Dinner is not in your journal yet. Add it to finish the day."
        return "Your journal is empty today. Add what you ate, even roughly."
    spell = "a while" if int(facts.get("quiet_days") or 0) >= 14 else "a week"
    return f"Your journal has been quiet for {spell}. Log one meal to pick it back up."


def compose(
    event: Event, recipient: models.User, *, facts: dict[str, Any] | None = None
) -> Message:
    """One message, in the recipient's own clock and zone.

    Every string a member reads lives in this function. The scheduled kinds
    take their few numbers from the caller rather than looking anything up, so
    the words stay separate from the counting.
    """
    kind = event.kind
    said = facts or {}
    title = ""
    body = ""
    if kind == MORNING:
        title, body = "Good morning", _scheduled_body(MORNING, said)
    elif kind == WEIGH_IN:
        title, body = "Weigh-in day", _scheduled_body(WEIGH_IN, said)
    elif kind == EVENING:
        title, body = "How did today go?", _scheduled_body(EVENING, said)
    elif kind == QUIET:
        title, body = "How's it going?", _scheduled_body(QUIET, said)
    elif kind == TEST:
        title, body = "This is a test", "Notifications reach this device."
    elif kind == APPOINTMENT_ADDED:
        title = _on_calendar(event, "Added") if event.calendar else f"Added {event.title}"
        body = f"{_stamp(event, recipient)}, by {event.who}."
    elif kind == APPOINTMENT_CHANGED:
        title = _on_calendar(event, "Updated") if event.calendar else f"Updated {event.title}"
        body = f"{_stamp(event, recipient)}, by {event.who}."
    elif kind in (APPOINTMENT_DELETED, OCCURRENCE_CANCELLED):
        title = (
            _on_calendar(event, "Cancelled") if event.calendar else f"Cancelled {event.title}"
        )
        when = "All dates" if event.whole_series else _day_only(event, recipient)
        body = f"{when}, by {event.who}."
    elif kind == INVITED:
        title = f"{event.who} invited you to {event.title}"
        body = f"{_stamp(event, recipient)}. Tap to answer."
    elif kind in (INVITATION_ACCEPTED, INVITATION_DECLINED):
        said_yes = "accepted" if kind == INVITATION_ACCEPTED else "declined"
        title = f"{event.who} {said_yes} {event.title}"
        body = f"{_stamp(event, recipient)}."
    elif kind == CALENDAR_OFFERED:
        title = f"{event.who} shared a calendar with you"
        body = f"{event.title}. Tap to answer."
    elif kind == MEMBER_JOINED:
        title = f"{event.who} joined {event.title}"
        body = "They see everything on it now."
    return Message(title=title, body=body, url=_url_of(event), tag=_tag_of(event))


def _day_only(event: Event, recipient: models.User) -> str:
    """The date without the time, which is all a call-off needs to say."""
    if event.day is None:
        return ""
    return date_text(event.day, clock.user_today(recipient))


def deliver(
    db: Session,
    user: models.User,
    message: Message,
    *,
    ttl: int,
    topic: str | None,
) -> int:
    """Put one message on every device this member has turned on.

    A device the push service says is gone is deleted here rather than left to
    fail forever: that answer means the browser dropped the subscription, and
    the member turns it on again from the screen.
    """
    rows = list(
        db.scalars(
            select(models.PushSubscription)
            .where(models.PushSubscription.user_id == user.id)
            .order_by(models.PushSubscription.id)
        )
    )
    if not rows:
        return 0
    payload = {
        "title": message.title,
        "body": message.body,
        "url": message.url,
        "tag": message.tag,
    }
    sent = 0
    with webpush.session() as client:
        for row in rows:
            outcome = webpush.send(
                row.endpoint,
                row.p256dh,
                row.auth,
                payload,
                ttl=ttl,
                topic=topic,
                client=client,
            )
            if outcome is webpush.Outcome.SENT:
                row.last_ok_at = now_utc()
                row.failures = 0
                sent += 1
            elif outcome is webpush.Outcome.GONE:
                db.delete(row)
            else:
                row.failures += 1
    db.commit()
    return sent


def notify(user_ids: Iterable[int], event: Event) -> None:
    """Tell these members what happened. The seam, and the only one.

    A session of its own because this runs after the request that raised it has
    already closed one, and everything is swallowed: nothing a push service
    does is worth turning somebody's saved appointment into an error.
    """
    if not webpush.configured():
        return
    wanted = sorted(set(user_ids))
    if not wanted:
        return
    switch = PREF_OF.get(event.kind)
    try:
        with SessionLocal() as db:
            people = list(
                db.scalars(select(models.User).where(models.User.id.in_(wanted)))
            )
            for user in people:
                if switch is not None and not notify_prefs.normalize(user.notify)[switch]:
                    continue
                deliver(
                    db,
                    user,
                    compose(event, user),
                    ttl=TTL.get(event.kind, 86400),
                    topic=None,
                )
    except SQLAlchemyError:
        log.exception("a notification could not be written out")
    except Exception:
        log.exception("a notification could not be sent")
