"""The shared calendar: what is on, who it is on with, and who was asked.

An appointment belongs to whoever wrote it and carries the zone it was written
in, so nine o'clock stays nine o'clock where it was arranged however far away
it is read. It reaches anybody else two ways and only two: published to a
calendar they accepted, or as an invitation they accepted. Anything else
answers the way an appointment that is not there answers, because a refusal
that reads differently is a way of finding out what somebody has on.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Literal, NoReturn

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import clock, models, recurrence, throttle
from app.calendar_colors import PALETTE
from app.db import get_db
from app.deps import require_user
from app.friends import friend_ids
from app.models import now_utc

router = APIRouter(prefix="/calendar", tags=["calendar"])

# What an invitation can be. A declined one keeps its row, so somebody who said
# no is not asked again by an owner who cannot see that they did.
PENDING = "pending"
ACCEPTED = "accepted"
DECLINED = "declined"

# One appointment that is not there and one nobody may see read the same.
MISSING_APPOINTMENT = "There is no such appointment."
MISSING_CALENDAR = "There is no such calendar."
MISSING_INVITATION = "There is no such invitation."
NOT_A_MEMBER = "They are not on this calendar."

BAD_DATE = "That is not a date."
NEEDS_DATE = "Appointments need a date."
BAD_END_DATE = "The end date must be on or after the start date."
NEEDS_TIMES = "Appointments need a start and end time, or mark them all-day."
ALL_DAY_NO_TIMES = "An all-day appointment has no times."
END_BEFORE_START = "End time must be after the start time."
NEEDS_TITLE = "Give it a title."
SPAN_CAP = "An appointment can span up to 90 days."
NO_SPAN_REPEAT = "A repeating appointment cannot span days."
RANGE_TOO_WIDE = "That range is too wide."

NEEDS_DAYS = "Weekly repeat needs at least one day."
NEEDS_MONTH_DAY = "Monthly repeat needs a day of the month."
BAD_INTERVAL = "Repeat interval must be at least 1."
TWO_ENDS = "A repeat ends by date or after a count, not both."
TOO_FAR = "That repeat ends too far out."
NOT_A_SERIES = "That appointment does not repeat."
NO_OCCURRENCE = "No occurrence on that day."
DETACHED_NO_REPEAT = "A detached appointment doesn't repeat."

OWNER_ONLY_FIELD = "Only the owner can change that."
OWNER_ONLY_EDIT = "Only the owner or a member of its calendars can change this."
OWNER_ONLY_DELETE = "Only the owner can delete this appointment."
NOT_YOUR_CALENDAR = "That is not one of your calendars."
NOT_ON_CALENDAR = "It is not on that calendar."
CREATOR_ONLY = "Only the calendar's creator can remove a member."

INVITE_CAP = "You can invite up to 20 people."
PICK_FRIENDS = "Pick friends to invite."
FRIENDS_ONLY = "You can only invite your friends."
NO_NAME = "Give it a name."
BAD_COLOR = "Pick a color."
PICK_FRIEND = "Pick a friend to share with."
ALREADY_MEMBER = "They are already on this calendar."

MAX_TITLE = 120
MAX_NAME = 60
# How many people one appointment may be arranged with. Past this it is a
# mailing list rather than an arrangement.
MAX_INVITEES = 20
# How long one appointment may run, and how much of the calendar one request
# may ask for. The second is the cap on the work a single call can cause.
SPAN_DAYS = 90
RANGE_DAYS = 45
# How far a count-based end is walked before it is called unreasonable. A touch
# over ten years, so a yearly repeat of ten still resolves.
WALK_DAYS = 3700
# How far ahead the next occurrence of a series is looked for, which has to
# clear a year for a yearly one.
LOOK_AHEAD = 400
# What a repeating proposal is checked for conflicts over: its first eight
# weeks, and no more occurrences than a daily one has in them.
CONFLICT_DAYS = 56
CONFLICT_OCCURRENCES = 60
# How many clashes one bucket carries. A list past this is not read.
MAX_HITS = 5

ONE_DAY = dt.timedelta(days=1)
# The last instant an occurrence covers, for the day it is listed on: an
# appointment ending at midnight ends on the day before, not on the next one.
A_MOMENT = dt.timedelta(microseconds=1)


def bad(sentence: str) -> NoReturn:
    """Every refusal in this file, said as a whole sentence."""
    raise HTTPException(status.HTTP_400_BAD_REQUEST, sentence)


class RepeatIn(BaseModel):
    """How an appointment repeats.

    Weekly counts days (Monday is 0), monthly a day of the month, and yearly
    takes both from the anchor. The end is a date or a number of occurrences
    and never both: a count is walked out into a date before anything is
    stored, so nothing downstream ever counts occurrences.
    """

    type: Literal["weekly", "monthly", "yearly"]
    days: list[int] = Field(default_factory=list)
    interval: int = 1
    month_day: int | None = Field(default=None, ge=1, le=31)
    anchor: dt.date | None = None
    until: dt.date | None = None
    count: int | None = Field(default=None, ge=1, le=500)


# What an every-so-often repeat may count up to, by kind. A year of weeks, two
# years of months, a decade of years.
INTERVAL_CAP = {"weekly": 52, "monthly": 24, "yearly": 10}


class AppointmentIn(BaseModel):
    """One appointment as the form sends it."""

    title: str = ""
    notes: str = Field(default="", max_length=1000)
    location: str | None = Field(default=None, max_length=120)
    all_day: bool = False
    date_for: dt.date | None = None
    end_date: dt.date | None = None
    time_of_day: dt.time | None = None
    end_time: dt.time | None = None
    repeat: RepeatIn | None = None
    calendar_ids: list[int] = Field(default_factory=list)
    invitee_ids: list[int] = Field(default_factory=list)


class AppointmentPatch(BaseModel):
    """A change to one appointment. A field left out is left alone."""

    title: str | None = None
    notes: str | None = Field(default=None, max_length=1000)
    location: str | None = Field(default=None, max_length=120)
    all_day: bool | None = None
    date_for: dt.date | None = None
    end_date: dt.date | None = None
    time_of_day: dt.time | None = None
    end_time: dt.time | None = None
    repeat: RepeatIn | None = None
    calendar_ids: list[int] | None = None
    invitee_ids: list[int] | None = None


class ConflictIn(BaseModel):
    """A proposal, asked about before it is written down."""

    date_for: dt.date | None = None
    end_date: dt.date | None = None
    time_of_day: dt.time | None = None
    end_time: dt.time | None = None
    all_day: bool = False
    timezone: str | None = None
    repeat: RepeatIn | None = None
    # The appointment being edited, which never clashes with itself.
    exclude_id: int | None = None
    invitee_ids: list[int] = Field(default_factory=list)


class CalendarIn(BaseModel):
    """A new shared calendar, and the one friend it starts out shared with."""

    name: str = ""
    color: str = ""
    friend_id: int = 0


class CalendarPatch(BaseModel):
    name: str | None = None
    color: str | None = None


class MemberIn(BaseModel):
    user_id: int


class InvitesIn(BaseModel):
    user_ids: list[int] = Field(default_factory=list)


@dataclass
class Plan:
    """The shape an appointment is about to take, before it is a row.

    Held apart from the row so the same rules read the same on a create and on
    a change: a patch fills this in from what is stored and what was sent, and
    both go through one validation.
    """

    title: str
    notes: str
    location: str | None
    all_day: bool
    date_for: dt.date | None
    end_date: dt.date | None
    time_of_day: dt.time | None
    end_time: dt.time | None
    repeat_type: str | None
    repeat_days: int | None
    repeat_interval: int
    repeat_anchor: dt.date | None
    repeat_month_day: int | None
    repeat_until: dt.date | None


@dataclass
class Sheet:
    """Everything a page of appointments is drawn from, fetched once.

    A day of the calendar holds dozens of occurrences of a handful of
    appointments, so each of these is one query for the lot rather than one
    query per row.
    """

    calendars: dict[int, list[int]]
    invites: dict[int, list[models.AppointmentInvite]]
    skips: dict[int, set[dt.date]]
    marks: dict[tuple[int, dt.date], bool]
    named: dict[int, models.User]
    shelves: dict[int, models.Calendar]
    accepted: set[int]


def asked_date(raw: str, user: models.User) -> dt.date:
    if not raw:
        return clock.user_today(user)
    try:
        return dt.date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_DATE) from None


def iso(day: dt.date | None) -> str | None:
    return None if day is None else day.isoformat()


def clock_text(at: dt.datetime) -> str:
    return at.strftime("%H:%M")


def display_name(member: models.User | None) -> str:
    return "" if member is None else (member.display_name or member.username)


def named_member(member: models.User | None) -> dict[str, object]:
    return {"id": None if member is None else member.id, "display_name": display_name(member)}


def days_from_mask(mask: int | None) -> list[int]:
    return [weekday for weekday in range(7) if mask and mask & (1 << weekday)]


def mask_from_days(days: list[int]) -> int:
    return sum(1 << weekday for weekday in set(days) if 0 <= weekday <= 6)


def date_range(first: dt.date, last: dt.date) -> list[dt.date]:
    return [first + dt.timedelta(days=step) for step in range((last - first).days + 1)]


# Rules a type cannot express
# ---------------------------


def nth_occurrence(
    repeat_type: str,
    repeat_days: int | None,
    interval: int,
    anchor: dt.date,
    month_day: int | None,
    count: int,
) -> dt.date:
    """The day the count-th occurrence lands on, walked a day at a time.

    Every pattern answers the same question through occurs_on, so there is no
    arithmetic per kind to keep in step with what the calendar really draws.
    """
    day = anchor
    seen = 0
    for _ in range(WALK_DAYS):
        if recurrence.occurs_on(repeat_type, repeat_days, interval, anchor, month_day, None, day):
            seen += 1
            if seen == count:
                return day
        day += ONE_DAY
    bad(TOO_FAR)


def resolve_repeat(
    repeat: RepeatIn | None, date_for: dt.date | None
) -> tuple[str | None, int | None, int, dt.date | None, int | None, dt.date | None]:
    """The repeat as it is stored: a type, a pattern, and one concrete end."""
    if repeat is None:
        return None, None, 1, None, None, None
    if repeat.until is not None and repeat.count is not None:
        bad(TWO_ENDS)
    if repeat.interval < 1:
        bad(BAD_INTERVAL)
    if repeat.interval > INTERVAL_CAP[repeat.type]:
        bad(BAD_INTERVAL)
    mask = mask_from_days(repeat.days) if repeat.type == recurrence.WEEKLY else None
    month_day = repeat.month_day if repeat.type == recurrence.MONTHLY else None
    if repeat.type == recurrence.WEEKLY and not mask:
        bad(NEEDS_DAYS)
    if repeat.type == recurrence.MONTHLY and not month_day:
        bad(NEEDS_MONTH_DAY)
    anchor = repeat.anchor or date_for
    if anchor is None:
        bad(NEEDS_DATE)
    until = repeat.until
    if repeat.count is not None:
        until = nth_occurrence(repeat.type, mask, repeat.interval, anchor, month_day, repeat.count)
    return repeat.type, mask, repeat.interval, anchor, month_day, until


def validate(plan: Plan) -> None:
    """Everything about one appointment that a type cannot settle."""
    if not plan.title or len(plan.title) > MAX_TITLE:
        bad(NEEDS_TITLE)
    validate_when(plan)


def validate_when(plan: Plan) -> None:
    """When it is, which is the half a proposal is checked on before it has a
    title or an owner."""
    if plan.date_for is None:
        bad(NEEDS_DATE)
    if plan.repeat_type is not None and plan.end_date is not None:
        bad(NO_SPAN_REPEAT)
    if plan.end_date is not None:
        if plan.end_date < plan.date_for:
            bad(BAD_END_DATE)
        if plan.end_date - plan.date_for > dt.timedelta(days=SPAN_DAYS):
            bad(SPAN_CAP)
    if plan.all_day:
        if plan.time_of_day is not None or plan.end_time is not None:
            bad(ALL_DAY_NO_TIMES)
        return
    if plan.time_of_day is None or plan.end_time is None:
        bad(NEEDS_TIMES)
    # Compared as a day and a time together, so an evening that ends after
    # midnight passes when the end date is the next day and still does not
    # when both times sit on the same one.
    starts = dt.datetime.combine(plan.date_for, plan.time_of_day)
    ends = dt.datetime.combine(plan.end_date or plan.date_for, plan.end_time)
    if ends <= starts:
        bad(END_BEFORE_START)


def plan_of(body: AppointmentIn) -> Plan:
    """What a create asks for, with its repeat resolved."""
    rtype, mask, interval, anchor, month_day, until = resolve_repeat(body.repeat, body.date_for)
    return Plan(
        title=body.title.strip(),
        notes=body.notes,
        location=body.location,
        all_day=body.all_day,
        # A repeat starts on its anchor, so the two can never disagree about
        # which day the series began.
        date_for=anchor if rtype is not None else body.date_for,
        end_date=body.end_date,
        time_of_day=body.time_of_day,
        end_time=body.end_time,
        repeat_type=rtype,
        repeat_days=mask,
        repeat_interval=interval,
        repeat_anchor=anchor,
        repeat_month_day=month_day,
        repeat_until=until,
    )


REPEAT_FIELDS = (
    "repeat_type",
    "repeat_days",
    "repeat_interval",
    "repeat_anchor",
    "repeat_month_day",
    "repeat_until",
)


def apply_plan(row: models.Appointment, plan: Plan) -> None:
    row.title = plan.title
    row.notes = plan.notes
    row.location = plan.location
    row.all_day = plan.all_day
    if plan.date_for is not None:
        row.date_for = plan.date_for
    row.end_date = plan.end_date
    row.time_of_day = plan.time_of_day
    row.end_time = plan.end_time
    row.repeat_type = plan.repeat_type
    row.repeat_days = plan.repeat_days
    row.repeat_interval = plan.repeat_interval
    row.repeat_anchor = plan.repeat_anchor
    row.repeat_month_day = plan.repeat_month_day
    row.repeat_until = plan.repeat_until
    row.updated_at = now_utc()


# Who may see what
# ----------------


def accepted_calendar_ids(db: Session, user_id: int) -> set[int]:
    return set(
        db.scalars(
            select(models.CalendarMember.calendar_id).where(
                models.CalendarMember.user_id == user_id,
                models.CalendarMember.accepted_at.is_not(None),
            )
        )
    )


def reachable_ids(db: Session, user: models.User) -> set[int]:
    """Every appointment this account can see that is not its own.

    Two ways in: published to a calendar they accepted, or an invitation they
    accepted. A pending invitation is on the invitations screen and nowhere
    else, and a declined one is nowhere at all.
    """
    published = set(
        db.scalars(
            select(models.AppointmentCalendar.appointment_id).where(
                models.AppointmentCalendar.calendar_id.in_(
                    accepted_calendar_ids(db, user.id)
                )
            )
        )
    )
    invited = set(
        db.scalars(
            select(models.AppointmentInvite.appointment_id).where(
                models.AppointmentInvite.user_id == user.id,
                models.AppointmentInvite.status == ACCEPTED,
            )
        )
    )
    return published | invited


def visible_appointments(
    db: Session, user: models.User, first: dt.date, last: dt.date
) -> list[models.Appointment]:
    """Everything visible to this account that could land inside a window.

    A repeat is in play whenever its anchor is behind the end of the window and
    its end, if it has one, is not behind the start. A one-off is in play when
    its span touches the window at all.
    """
    return list(
        db.scalars(
            select(models.Appointment).where(
                or_(
                    models.Appointment.owner_id == user.id,
                    models.Appointment.id.in_(reachable_ids(db, user)),
                ),
                or_(
                    and_(
                        models.Appointment.repeat_type.is_not(None),
                        models.Appointment.repeat_anchor <= last,
                        or_(
                            models.Appointment.repeat_until.is_(None),
                            models.Appointment.repeat_until >= first,
                        ),
                    ),
                    and_(
                        models.Appointment.repeat_type.is_(None),
                        models.Appointment.date_for <= last,
                        func.coalesce(
                            models.Appointment.end_date, models.Appointment.date_for
                        )
                        >= first,
                    ),
                ),
            )
        )
    )


def gather(db: Session, user: models.User, rows: list[models.Appointment]) -> Sheet:
    """One fetch each for everything the payloads below read."""
    ids = [row.id for row in rows]
    calendars: dict[int, list[int]] = {}
    for appointment_id, calendar_id in db.execute(
        select(
            models.AppointmentCalendar.appointment_id,
            models.AppointmentCalendar.calendar_id,
        ).where(models.AppointmentCalendar.appointment_id.in_(ids))
    ):
        calendars.setdefault(appointment_id, []).append(calendar_id)

    invites: dict[int, list[models.AppointmentInvite]] = {}
    for invite in db.scalars(
        select(models.AppointmentInvite).where(
            models.AppointmentInvite.appointment_id.in_(ids)
        )
    ):
        invites.setdefault(invite.appointment_id, []).append(invite)

    skips: dict[int, set[dt.date]] = {}
    for appointment_id, day in db.execute(
        select(models.AppointmentSkip.appointment_id, models.AppointmentSkip.date_for).where(
            models.AppointmentSkip.appointment_id.in_(ids)
        )
    ):
        skips.setdefault(appointment_id, set()).add(day)

    marks = {
        (appointment_id, day): cancelled
        for appointment_id, day, cancelled in db.execute(
            select(
                models.AppointmentMark.appointment_id,
                models.AppointmentMark.date_for,
                models.AppointmentMark.cancelled,
            ).where(models.AppointmentMark.appointment_id.in_(ids))
        )
    }

    shelf_ids = {calendar_id for held in calendars.values() for calendar_id in held}
    shelves = {
        shelf.id: shelf
        for shelf in db.scalars(
            select(models.Calendar).where(models.Calendar.id.in_(shelf_ids))
        )
    }
    people = {row.owner_id for row in rows} | {
        invite.user_id for held in invites.values() for invite in held
    }
    named = {
        member.id: member
        for member in db.scalars(select(models.User).where(models.User.id.in_(people)))
    }
    return Sheet(
        calendars=calendars,
        invites=invites,
        skips=skips,
        marks=marks,
        named=named,
        shelves=shelves,
        accepted=accepted_calendar_ids(db, user.id),
    )


def editable_by(row: models.Appointment, sheet: Sheet, user: models.User) -> bool:
    """The owner, or anybody on a calendar it is published to.

    A calendar is a working agreement rather than a subscription: everybody who
    accepted one may move what is on it, which is the point of sharing it.
    """
    if row.owner_id == user.id:
        return True
    return bool(set(sheet.calendars.get(row.id, [])) & sheet.accepted)


def role_of(row: models.Appointment, sheet: Sheet, user: models.User) -> str:
    if row.owner_id == user.id:
        return "organizer"
    return "member" if editable_by(row, sheet, user) else "invitee"


def repeat_out(row: models.Appointment) -> dict[str, object] | None:
    if row.repeat_type is None:
        return None
    return {
        "type": row.repeat_type,
        "days": days_from_mask(row.repeat_days),
        "interval": row.repeat_interval,
        "month_day": row.repeat_month_day,
        "anchor": iso(row.repeat_anchor),
        "until": iso(row.repeat_until),
    }


def calendars_out(row: models.Appointment, sheet: Sheet) -> list[dict[str, object]]:
    return [
        {"id": shelf.id, "name": shelf.name, "color": shelf.color}
        for shelf in (
            sheet.shelves.get(calendar_id) for calendar_id in sheet.calendars.get(row.id, [])
        )
        if shelf is not None
    ]


def invitee_list(
    row: models.Appointment, sheet: Sheet, statuses: bool
) -> list[dict[str, object]]:
    """Who was asked. Only the organizer is ever told what anybody answered."""
    listed = []
    for invite in sheet.invites.get(row.id, []):
        shown = named_member(sheet.named.get(invite.user_id))
        if statuses:
            shown["status"] = invite.status
        listed.append(shown)
    return sorted(listed, key=lambda shown: str(shown["display_name"]).lower())


def my_invitation(
    row: models.Appointment, sheet: Sheet, user: models.User
) -> dict[str, object] | None:
    """The viewer's own invitation to this one, if they were asked at all."""
    for invite in sheet.invites.get(row.id, []):
        if invite.user_id == user.id:
            return {"id": invite.id, "status": invite.status}
    return None


# Where an occurrence lands, and what time it reads as
# ---------------------------------------------------


def lands_on(row: models.Appointment, skips: set[dt.date], day: dt.date) -> bool:
    """Whether this appointment really has an occurrence on one of its days."""
    if row.repeat_type is None:
        return row.date_for <= day <= (row.end_date or row.date_for)
    if day in skips or day < (row.repeat_anchor or row.date_for):
        return False
    return recurrence.occurs_on(
        row.repeat_type,
        row.repeat_days,
        row.repeat_interval,
        row.repeat_anchor,
        row.repeat_month_day,
        row.repeat_until,
        day,
    )


def occurrence_days(
    row: models.Appointment, skips: set[dt.date], first: dt.date, last: dt.date
) -> list[dt.date]:
    """Which of its own days this appointment starts on inside a window.

    A one-off has a single occurrence however many days it covers, so the day
    it starts on is the only one here; a repeat is walked a day at a time.
    """
    if row.repeat_type is None:
        covers = row.date_for <= last and (row.end_date or row.date_for) >= first
        return [row.date_for] if covers else []
    day = max(first, row.repeat_anchor or row.date_for)
    found = []
    while day <= last:
        if lands_on(row, skips, day):
            found.append(day)
        day += ONE_DAY
    return found


def window(
    row: models.Appointment, day: dt.date, viewer: dt.tzinfo
) -> tuple[dt.date, dt.date, str | None, str | None]:
    """One occurrence as the reader's own calendar shows it.

    The stored zone says which moments it really covers, and those moments are
    then read in the viewer's zone, which is how a nine o'clock in Phoenix is a
    midday in New York and can land on the day before or the day after. An
    all-day one is dates only and is never converted: it is the whole day
    wherever it is read.
    """
    span = (row.end_date - row.date_for).days if row.end_date is not None else 0
    if row.all_day or row.time_of_day is None or row.end_time is None:
        return day, day + dt.timedelta(days=span), None, None
    here = clock.zone(row.timezone)
    starts = dt.datetime.combine(day, row.time_of_day, here).astimezone(viewer)
    ends = dt.datetime.combine(
        day + dt.timedelta(days=span), row.end_time, here
    ).astimezone(viewer)
    # The last instant it covers rather than the first it does not, so one
    # ending at midnight is listed on the day it ran through.
    return starts.date(), (ends - A_MOMENT).date(), clock_text(starts), clock_text(ends)


def instants(
    row: models.Appointment, day: dt.date
) -> tuple[dt.datetime, dt.datetime] | None:
    """The moment one occurrence starts and the moment it ends.

    Nothing at all for an all-day one: a day with no times on it cannot clash
    with anything, because nobody said when it is.
    """
    if row.all_day or row.time_of_day is None or row.end_time is None:
        return None
    here = clock.zone(row.timezone)
    span = (row.end_date - row.date_for).days if row.end_date is not None else 0
    return (
        dt.datetime.combine(day, row.time_of_day, here),
        dt.datetime.combine(day + dt.timedelta(days=span), row.end_time, here),
    )


def next_occurrence(row: models.Appointment, skips: set[dt.date], today: dt.date) -> dt.date:
    """The first day of this appointment on or after today, or else its last.

    An invitation is worth showing whichever way round it is: one arriving for
    next week should say next week, and one arriving after the last occurrence
    should still say which appointment it was.
    """
    if row.repeat_type is None:
        return row.date_for
    anchor = row.repeat_anchor or row.date_for
    day = max(today, anchor)
    for _ in range(LOOK_AHEAD):
        if row.repeat_until is not None and day > row.repeat_until:
            break
        if lands_on(row, skips, day):
            return day
        day += ONE_DAY
    day = min(today, row.repeat_until) if row.repeat_until is not None else today
    for _ in range(LOOK_AHEAD):
        if day < anchor:
            break
        if lands_on(row, skips, day):
            return day
        day -= ONE_DAY
    return anchor


def base_of(row: models.Appointment, sheet: Sheet, user: models.User) -> dict[str, object]:
    """Everything about one appointment that is the same on every day it is on."""
    return {
        "id": row.id,
        "title": row.title,
        "all_day": row.all_day,
        "location": row.location,
        "notes": row.notes,
        "owner": named_member(sheet.named.get(row.owner_id)),
        "calendars": calendars_out(row, sheet),
        "mine": row.owner_id == user.id,
        "editable": editable_by(row, sheet, user),
        "role": role_of(row, sheet, user),
        "invitees": invitee_list(row, sheet, True) if row.owner_id == user.id else [],
        "invitation": my_invitation(row, sheet, user),
        "repeat": repeat_out(row),
        "detached": row.detached,
        "timezone": row.timezone,
    }


def occurrence_of(
    row: models.Appointment,
    sheet: Sheet,
    user: models.User,
    day: dt.date,
    shown: dt.date,
    viewer: dt.tzinfo,
) -> dict[str, object]:
    """One occurrence as it is drawn on one of the viewer's days."""
    begins, ends, starts, finishes = window(row, day, viewer)
    item = base_of(row, sheet, user)
    item.update(
        {
            "occurrence_date": day.isoformat(),
            "date": begins.isoformat(),
            "end_date": ends.isoformat(),
            "start": starts,
            "end": finishes,
            "continues_from_previous": begins < shown,
            "continues_to_next": ends > shown,
            "cancelled": sheet.marks.get((row.id, day), False),
        }
    )
    return item


def time_text(at: dt.time | None) -> str | None:
    return None if at is None else at.strftime("%H:%M")


def detail_of(db: Session, user: models.User, row: models.Appointment) -> dict[str, object]:
    """One appointment as its own form reads it, in the fields it is stored in."""
    sheet = gather(db, user, [row])
    mine = row.owner_id == user.id
    return {
        "id": row.id,
        "title": row.title,
        "notes": row.notes,
        "location": row.location,
        "all_day": row.all_day,
        "date_for": iso(row.date_for),
        "end_date": iso(row.end_date),
        "time_of_day": time_text(row.time_of_day),
        "end_time": time_text(row.end_time),
        "repeat": repeat_out(row),
        "calendars": calendars_out(row, sheet),
        "invitees": invitee_list(row, sheet, mine),
        "invitation": my_invitation(row, sheet, user),
        "owner": named_member(sheet.named.get(row.owner_id)),
        "mine": mine,
        "editable": editable_by(row, sheet, user),
        "role": role_of(row, sheet, user),
        "detached": row.detached,
        "timezone": row.timezone,
    }


def day_order(item: dict[str, object]) -> tuple[int, str, str]:
    """All-day first, then by when it starts, then by name."""
    return (0 if item["all_day"] else 1, str(item["start"] or ""), str(item["title"]).lower())


# Reading one appointment, and being allowed to
# ---------------------------------------------


def visible_one(
    db: Session, user: models.User, appointment_id: int
) -> tuple[models.Appointment, Sheet]:
    row = db.get(models.Appointment, appointment_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_APPOINTMENT)
    sheet = gather(db, user, [row])
    answered = any(
        invite.user_id == user.id and invite.status == ACCEPTED
        for invite in sheet.invites.get(row.id, [])
    )
    if not editable_by(row, sheet, user) and not answered:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_APPOINTMENT)
    return row, sheet


def require_edit(row: models.Appointment, sheet: Sheet, user: models.User) -> None:
    if not editable_by(row, sheet, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, OWNER_ONLY_EDIT)


def require_owner(row: models.Appointment, user: models.User, sentence: str) -> None:
    if row.owner_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, sentence)


def checked_calendars(db: Session, owner: models.User, ids: list[int]) -> list[int]:
    """The calendars an appointment may be published to: the owner's own.

    Read against the owner rather than the caller, so a member moving somebody
    else's appointment cannot quietly put it somewhere the owner is not."""
    wanted = list(dict.fromkeys(ids))
    if not wanted:
        return []
    mine = accepted_calendar_ids(db, owner.id)
    if any(calendar_id not in mine for calendar_id in wanted):
        bad(NOT_YOUR_CALENDAR)
    return wanted


def checked_friends(db: Session, owner: models.User, ids: list[int]) -> list[int]:
    """Who may be asked: the owner's friends, and never the owner."""
    wanted = [member_id for member_id in dict.fromkeys(ids) if member_id != owner.id]
    if wanted and any(member_id not in friend_ids(db, owner) for member_id in wanted):
        bad(FRIENDS_ONLY)
    return wanted


def publish(db: Session, row: models.Appointment, calendar_ids: list[int]) -> None:
    """The calendars this appointment is on, as they should now stand."""
    held = {
        link.calendar_id: link
        for link in db.scalars(
            select(models.AppointmentCalendar).where(
                models.AppointmentCalendar.appointment_id == row.id
            )
        )
    }
    for calendar_id, link in held.items():
        if calendar_id not in calendar_ids:
            db.delete(link)
    for calendar_id in calendar_ids:
        if calendar_id not in held:
            db.add(
                models.AppointmentCalendar(appointment_id=row.id, calendar_id=calendar_id)
            )


def held_invites(db: Session, row: models.Appointment) -> dict[int, models.AppointmentInvite]:
    return {
        invite.user_id: invite
        for invite in db.scalars(
            select(models.AppointmentInvite).where(
                models.AppointmentInvite.appointment_id == row.id
            )
        )
    }


def replace_invites(
    db: Session, row: models.Appointment, owner: models.User, ids: list[int]
) -> None:
    """The invitation list as it should now stand, keeping what people said."""
    wanted = checked_friends(db, owner, ids)
    if len(wanted) > MAX_INVITEES:
        bad(INVITE_CAP)
    held = held_invites(db, row)
    for user_id, invite in held.items():
        if user_id not in wanted:
            db.delete(invite)
    for user_id in wanted:
        if user_id not in held:
            db.add(
                models.AppointmentInvite(
                    appointment_id=row.id,
                    user_id=user_id,
                    invited_by=owner.id,
                    status=PENDING,
                )
            )


def withdraw_pending(db: Session, one_id: int, other_id: int) -> None:
    """Take back what neither side answered, when two members stop sharing.

    Only what was still waiting: an appointment two people both said yes to is
    an arrangement they made, and it is not undone by a friend list.
    """
    both = (one_id, other_id)
    db.execute(
        delete(models.AppointmentInvite).where(
            models.AppointmentInvite.status == PENDING,
            models.AppointmentInvite.user_id.in_(both),
            models.AppointmentInvite.invited_by.in_(both),
            models.AppointmentInvite.user_id != models.AppointmentInvite.invited_by,
        )
    )
    db.execute(
        delete(models.CalendarMember).where(
            models.CalendarMember.accepted_at.is_(None),
            models.CalendarMember.user_id.in_(both),
            models.CalendarMember.invited_by.in_(both),
            models.CalendarMember.user_id != models.CalendarMember.invited_by,
        )
    )


# The calendar itself
# -------------------


@router.get("/days")
def read_days(
    start: str = "",
    end: str = "",
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Every day of a range, with what is on each of them.

    Empty days are in the answer too, so a month can be drawn from one call.
    The fetch reaches a day either side of the range and trims afterwards: an
    appointment that starts late on the day before the range can still be
    running on its first day once it is read in the viewer's zone.
    """
    first = asked_date(start, user)
    last = asked_date(end, user)
    if last < first:
        bad(BAD_END_DATE)
    if last - first > dt.timedelta(days=RANGE_DAYS):
        bad(RANGE_TOO_WIDE)

    viewer = clock.user_tz(user)
    rows = visible_appointments(db, user, first - ONE_DAY, last + ONE_DAY)
    sheet = gather(db, user, rows)
    by_day: dict[dt.date, list[dict[str, object]]] = {day: [] for day in date_range(first, last)}
    for row in rows:
        for day in occurrence_days(
            row, sheet.skips.get(row.id, set()), first - ONE_DAY, last + ONE_DAY
        ):
            begins, ends, _, _ = window(row, day, viewer)
            for shown in date_range(max(begins, first), min(ends, last)):
                by_day[shown].append(occurrence_of(row, sheet, user, day, shown, viewer))
    days = []
    for day in date_range(first, last):
        by_day[day].sort(key=day_order)
        days.append({"date": day.isoformat(), "items": by_day[day]})
    return {"start": first.isoformat(), "end": last.isoformat(), "days": days}


@router.get("/appointments/{appointment_id}")
def read_appointment(
    appointment_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    row, _ = visible_one(db, user, appointment_id)
    return detail_of(db, user, row)


@router.post("/appointments", status_code=status.HTTP_201_CREATED)
def create_appointment(
    body: AppointmentIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Write something down. The zone it is written in is kept with it."""
    if throttle.appointments_limiter.hit(str(user.id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY)
    plan = plan_of(body)
    validate(plan)
    calendar_ids = checked_calendars(db, user, body.calendar_ids)
    # The zone is the owner's as it stands now, and it is never moved again:
    # a time means the moment it was arranged for, not wherever they are next.
    row = models.Appointment(owner_id=user.id, timezone=user.timezone)
    apply_plan(row, plan)
    db.add(row)
    db.flush()
    publish(db, row, calendar_ids)
    replace_invites(db, row, user, body.invitee_ids)
    db.commit()
    return {"appointment": detail_of(db, user, row)}


def patched_plan(row: models.Appointment, body: AppointmentPatch, sent: set[str]) -> Plan:
    """What the appointment becomes: what is stored, with what was sent over it."""
    date_for = body.date_for if "date_for" in sent else row.date_for
    if "repeat" in sent:
        rtype, mask, interval, anchor, month_day, until = resolve_repeat(body.repeat, date_for)
    else:
        rtype, mask, interval = row.repeat_type, row.repeat_days, row.repeat_interval
        month_day, until = row.repeat_month_day, row.repeat_until
        # Moving the first day of a series moves the pattern with it, so the
        # anchor and the date can never disagree about where it began.
        anchor = date_for if rtype is not None and "date_for" in sent else row.repeat_anchor
    return Plan(
        title=(body.title or "").strip() if "title" in sent else row.title,
        notes=(body.notes or "") if "notes" in sent else row.notes,
        location=body.location if "location" in sent else row.location,
        all_day=bool(body.all_day) if "all_day" in sent else row.all_day,
        date_for=anchor if rtype is not None else date_for,
        end_date=body.end_date if "end_date" in sent else row.end_date,
        time_of_day=body.time_of_day if "time_of_day" in sent else row.time_of_day,
        end_time=body.end_time if "end_time" in sent else row.end_time,
        repeat_type=rtype,
        repeat_days=mask,
        repeat_interval=interval,
        repeat_anchor=anchor,
        repeat_month_day=month_day,
        repeat_until=until,
    )


@router.patch("/appointments/{appointment_id}")
def change_appointment(
    appointment_id: int,
    body: AppointmentPatch,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Change one. Anybody on one of its calendars may, except for who it is
    shared with and who was asked, which stay the owner's."""
    row, sheet = visible_one(db, user, appointment_id)
    require_edit(row, sheet, user)
    sent = body.model_fields_set
    if row.owner_id != user.id and {"calendar_ids", "invitee_ids"} & sent:
        bad(OWNER_ONLY_FIELD)
    owner = db.get(models.User, row.owner_id) or user
    was = tuple(getattr(row, field) for field in REPEAT_FIELDS)
    plan = patched_plan(row, body, sent)
    validate(plan)
    if "calendar_ids" in sent:
        publish(db, row, checked_calendars(db, owner, body.calendar_ids or []))
    if "invitee_ids" in sent:
        replace_invites(db, row, owner, body.invitee_ids or [])
    apply_plan(row, plan)
    if tuple(getattr(row, field) for field in REPEAT_FIELDS) != was:
        # The pattern moved, so the days carved out of the old one mean nothing
        # against the new one, and a stale skip is a hole in the series nobody
        # can see or undo. A day already detached is its own appointment and
        # stays where it is.
        db.execute(
            delete(models.AppointmentSkip).where(
                models.AppointmentSkip.appointment_id == row.id
            )
        )
    db.commit()
    return {"appointment": detail_of(db, user, row)}


@router.delete("/appointments/{appointment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_appointment(
    appointment_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    row, _ = visible_one(db, user, appointment_id)
    require_owner(row, user, OWNER_ONLY_DELETE)
    for table in (
        models.AppointmentCalendar,
        models.AppointmentInvite,
        models.AppointmentSkip,
        models.AppointmentMark,
    ):
        db.execute(delete(table).where(table.appointment_id == row.id))
    db.delete(row)
    db.commit()


@router.delete(
    "/appointments/{appointment_id}/occurrence", status_code=status.HTTP_204_NO_CONTENT
)
def drop_occurrence(
    appointment_id: int,
    date: str = "",
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    """Take one day out of a series for good, marks and all."""
    row, sheet = visible_one(db, user, appointment_id)
    require_edit(row, sheet, user)
    day = asked_date(date, user)
    if row.repeat_type is None:
        bad(NOT_A_SERIES)
    if not lands_on(row, sheet.skips.get(row.id, set()), day):
        bad(NO_OCCURRENCE)
    carve(db, row, day)
    db.execute(
        delete(models.AppointmentMark).where(
            models.AppointmentMark.appointment_id == row.id,
            models.AppointmentMark.date_for == day,
        )
    )
    db.commit()


def carve(db: Session, row: models.Appointment, day: dt.date) -> None:
    """Carve one day out of a series, inside a savepoint.

    Two screens can both find the day still there before either writes. The one
    that loses the race hits the pair constraint, and by then the day really is
    gone, which is what it is told.
    """
    try:
        with db.begin_nested():
            db.add(models.AppointmentSkip(appointment_id=row.id, date_for=day))
            db.flush()
    except IntegrityError:
        db.expire_all()
        bad(NO_OCCURRENCE)


@router.post("/appointments/{appointment_id}/occurrence", status_code=status.HTTP_201_CREATED)
def detach_occurrence(
    appointment_id: int,
    body: AppointmentIn,
    date: str = "",
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Change one day of a series: that day becomes its own appointment.

    The copy keeps everybody the series was shared with and everything they
    answered, and it keeps no link back: a later change to the series is about
    the series, and a day somebody moved on purpose must not move again.
    """
    if throttle.appointments_limiter.hit(str(user.id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY)
    row, sheet = visible_one(db, user, appointment_id)
    require_edit(row, sheet, user)
    day = asked_date(date, user)
    if row.repeat_type is None:
        bad(NOT_A_SERIES)
    if body.repeat is not None:
        bad(DETACHED_NO_REPEAT)
    if not lands_on(row, sheet.skips.get(row.id, set()), day):
        bad(NO_OCCURRENCE)
    plan = plan_of(body)
    validate(plan)
    carve(db, row, day)
    # The series' own zone rather than whoever is moving the day: the
    # arrangement was made in one zone and the day it came out of is still it.
    copy = models.Appointment(
        owner_id=row.owner_id, timezone=row.timezone, detached=True
    )
    apply_plan(copy, plan)
    db.add(copy)
    db.flush()
    for calendar_id in sheet.calendars.get(row.id, []):
        db.add(models.AppointmentCalendar(appointment_id=copy.id, calendar_id=calendar_id))
    for invite in sheet.invites.get(row.id, []):
        db.add(
            models.AppointmentInvite(
                appointment_id=copy.id,
                user_id=invite.user_id,
                invited_by=invite.invited_by,
                status=invite.status,
                created_at=invite.created_at,
                responded_at=invite.responded_at,
            )
        )
    # A day called off before it was moved is still called off afterwards.
    db.execute(
        update(models.AppointmentMark)
        .where(
            models.AppointmentMark.appointment_id == row.id,
            models.AppointmentMark.date_for == day,
        )
        .values(appointment_id=copy.id, date_for=copy.date_for)
    )
    db.commit()
    return {"appointment": detail_of(db, user, copy)}


def mark_day(row: models.Appointment, sheet: Sheet, raw: str, user: models.User) -> dt.date:
    """Which day a call-off is written against.

    A one-off has one, whatever day of its span the client was looking at. A
    series has the day itself, and only a day it really lands on.
    """
    if row.repeat_type is None:
        return row.date_for
    day = asked_date(raw, user)
    if not lands_on(row, sheet.skips.get(row.id, set()), day):
        bad(NO_OCCURRENCE)
    return day


@router.post("/appointments/{appointment_id}/cancel")
def cancel_occurrence(
    appointment_id: int,
    date: str = "",
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Call one day off. It stays on the calendar, struck through, because
    everybody it was arranged with has it written down too."""
    row, sheet = visible_one(db, user, appointment_id)
    require_edit(row, sheet, user)
    day = mark_day(row, sheet, date, user)
    mark = db.scalar(
        select(models.AppointmentMark).where(
            models.AppointmentMark.appointment_id == row.id,
            models.AppointmentMark.date_for == day,
        )
    )
    if mark is None:
        try:
            with db.begin_nested():
                db.add(
                    models.AppointmentMark(
                        appointment_id=row.id, date_for=day, cancelled=True
                    )
                )
                db.flush()
        except IntegrityError:
            db.expire_all()
            made = db.scalar(
                select(models.AppointmentMark).where(
                    models.AppointmentMark.appointment_id == row.id,
                    models.AppointmentMark.date_for == day,
                )
            )
            if made is None:
                raise
            made.cancelled = True
    else:
        mark.cancelled = True
    db.commit()
    return {"cancelled": True, "date": day.isoformat()}


@router.delete("/appointments/{appointment_id}/cancel")
def uncancel_occurrence(
    appointment_id: int,
    date: str = "",
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """It is back on."""
    row, sheet = visible_one(db, user, appointment_id)
    require_edit(row, sheet, user)
    day = mark_day(row, sheet, date, user)
    db.execute(
        delete(models.AppointmentMark).where(
            models.AppointmentMark.appointment_id == row.id,
            models.AppointmentMark.date_for == day,
        )
    )
    db.commit()
    return {"cancelled": False, "date": day.isoformat()}


@router.delete(
    "/appointments/{appointment_id}/calendars/{calendar_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def unpublish(
    appointment_id: int,
    calendar_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    """Take one appointment off one calendar.

    A member of that calendar may, which is how somebody clears their own
    shared calendar without asking whoever wrote the appointment.
    """
    row, sheet = visible_one(db, user, appointment_id)
    if calendar_id not in sheet.calendars.get(row.id, []):
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_ON_CALENDAR)
    if row.owner_id != user.id and calendar_id not in sheet.accepted:
        raise HTTPException(status.HTTP_403_FORBIDDEN, OWNER_ONLY_EDIT)
    db.execute(
        delete(models.AppointmentCalendar).where(
            models.AppointmentCalendar.appointment_id == row.id,
            models.AppointmentCalendar.calendar_id == calendar_id,
        )
    )
    db.commit()


@router.post("/appointments/{appointment_id}/invites")
def add_invites(
    appointment_id: int,
    body: InvitesIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Ask a few more people. One invitation covers the whole series."""
    if throttle.calendar_invites_limiter.hit(str(user.id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY)
    row, sheet = visible_one(db, user, appointment_id)
    require_owner(row, user, OWNER_ONLY_FIELD)
    wanted = checked_friends(db, user, body.user_ids)
    if not wanted:
        bad(PICK_FRIENDS)
    held = held_invites(db, row)
    if len(set(held) | set(wanted)) > MAX_INVITEES:
        bad(INVITE_CAP)
    for user_id in wanted:
        if user_id not in held:
            db.add(
                models.AppointmentInvite(
                    appointment_id=row.id,
                    user_id=user_id,
                    invited_by=user.id,
                    status=PENDING,
                )
            )
    db.commit()
    return {"invitees": invitee_list(row, gather(db, user, [row]), True)}


@router.delete(
    "/appointments/{appointment_id}/invites/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def drop_invite(
    appointment_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    """The owner uninvites somebody, or an invitee shows themselves out."""
    row, _ = visible_one(db, user, appointment_id)
    if user_id != user.id:
        require_owner(row, user, OWNER_ONLY_FIELD)
    invite = db.scalar(
        select(models.AppointmentInvite).where(
            models.AppointmentInvite.appointment_id == row.id,
            models.AppointmentInvite.user_id == user_id,
        )
    )
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_INVITATION)
    db.delete(invite)
    db.commit()


# Shared calendars
# ----------------


def calendar_members(db: Session, calendar_ids: list[int]) -> dict[int, list[models.CalendarMember]]:
    held: dict[int, list[models.CalendarMember]] = {}
    for row in db.scalars(
        select(models.CalendarMember).where(
            models.CalendarMember.calendar_id.in_(calendar_ids)
        )
    ):
        held.setdefault(row.calendar_id, []).append(row)
    return held


def people(db: Session, ids: set[int]) -> dict[int, models.User]:
    return {
        member.id: member
        for member in db.scalars(select(models.User).where(models.User.id.in_(ids)))
    }


def calendar_out(
    shelf: models.Calendar,
    members: list[models.CalendarMember],
    named: dict[int, models.User],
    user: models.User,
) -> dict[str, object]:
    return {
        "id": shelf.id,
        "name": shelf.name,
        "color": shelf.color,
        "created_by": shelf.created_by,
        "members": sorted(
            (
                {
                    "id": row.user_id,
                    "display_name": display_name(named.get(row.user_id)),
                    "accepted": row.accepted_at is not None,
                }
                for row in members
            ),
            key=lambda shown: str(shown["display_name"]).lower(),
        ),
        "mine_pending": any(
            row.user_id == user.id and row.accepted_at is None for row in members
        ),
    }


def my_calendar(
    db: Session, user: models.User, calendar_id: int
) -> tuple[models.Calendar, list[models.CalendarMember]]:
    """One calendar this account has any row on, and everybody else's rows.

    A calendar somebody is not on at all answers the way one that is not there
    answers: the list of who shares what is nobody else's to walk.
    """
    shelf = db.get(models.Calendar, calendar_id)
    if shelf is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_CALENDAR)
    members = calendar_members(db, [calendar_id]).get(calendar_id, [])
    if not any(row.user_id == user.id for row in members):
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_CALENDAR)
    return shelf, members


def require_accepted(members: list[models.CalendarMember], user: models.User) -> None:
    mine = next((row for row in members if row.user_id == user.id), None)
    if mine is None or mine.accepted_at is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_CALENDAR)


def checked_name(raw: str) -> str:
    name = raw.strip()
    if not name or len(name) > MAX_NAME:
        bad(NO_NAME)
    return name


def checked_color(raw: str) -> str:
    if raw not in PALETTE:
        bad(BAD_COLOR)
    return raw


@router.get("/calendars")
def read_calendars(
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> list[dict[str, object]]:
    """Every calendar this account is on, waiting ones included."""
    mine = list(
        db.scalars(
            select(models.CalendarMember.calendar_id).where(
                models.CalendarMember.user_id == user.id
            )
        )
    )
    shelves = list(
        db.scalars(select(models.Calendar).where(models.Calendar.id.in_(mine)))
    )
    members = calendar_members(db, [shelf.id for shelf in shelves])
    named = people(
        db, {row.user_id for held in members.values() for row in held}
    )
    return sorted(
        (
            calendar_out(shelf, members.get(shelf.id, []), named, user)
            for shelf in shelves
        ),
        key=lambda shown: str(shown["name"]).lower(),
    )


@router.post("/calendars", status_code=status.HTTP_201_CREATED)
def create_calendar(
    body: CalendarIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Start a shared calendar with one friend.

    Nobody keeps one alone: a calendar with a single member is a list, and the
    list is the rest of the app.
    """
    if throttle.calendar_invites_limiter.hit(str(user.id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY)
    name = checked_name(body.name)
    color = checked_color(body.color)
    if body.friend_id == user.id or body.friend_id not in friend_ids(db, user):
        bad(PICK_FRIEND)
    shelf = models.Calendar(name=name, color=color, created_by=user.id)
    db.add(shelf)
    db.flush()
    db.add(
        models.CalendarMember(
            calendar_id=shelf.id,
            user_id=user.id,
            invited_by=user.id,
            accepted_at=now_utc(),
        )
    )
    db.add(
        models.CalendarMember(
            calendar_id=shelf.id, user_id=body.friend_id, invited_by=user.id
        )
    )
    db.commit()
    members = calendar_members(db, [shelf.id]).get(shelf.id, [])
    return calendar_out(shelf, members, people(db, {user.id, body.friend_id}), user)


@router.patch("/calendars/{calendar_id}")
def change_calendar(
    calendar_id: int,
    body: CalendarPatch,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Rename or recolour one. Anybody who accepted it may: it is theirs too."""
    shelf, members = my_calendar(db, user, calendar_id)
    require_accepted(members, user)
    sent = body.model_fields_set
    if "name" in sent:
        shelf.name = checked_name(body.name or "")
    if "color" in sent:
        shelf.color = checked_color(body.color or "")
    db.commit()
    named = people(db, {row.user_id for row in members})
    return calendar_out(shelf, members, named, user)


@router.post("/calendars/{calendar_id}/members")
def add_member(
    calendar_id: int,
    body: MemberIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Ask one more person onto a calendar, out of the asker's own friends."""
    if throttle.calendar_invites_limiter.hit(str(user.id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY)
    shelf, members = my_calendar(db, user, calendar_id)
    require_accepted(members, user)
    if body.user_id == user.id or body.user_id not in friend_ids(db, user):
        bad(PICK_FRIEND)
    if any(row.user_id == body.user_id for row in members):
        bad(ALREADY_MEMBER)
    try:
        with db.begin_nested():
            db.add(
                models.CalendarMember(
                    calendar_id=shelf.id, user_id=body.user_id, invited_by=user.id
                )
            )
            db.flush()
    except IntegrityError:
        # Two members can ask the same person at once. Whoever loses the race
        # is told what is already true rather than handed a failure.
        db.expire_all()
        bad(ALREADY_MEMBER)
    db.commit()
    members = calendar_members(db, [shelf.id]).get(shelf.id, [])
    return calendar_out(shelf, members, people(db, {row.user_id for row in members}), user)


@router.delete(
    "/calendars/{calendar_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT
)
def drop_member(
    calendar_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    """Leave a calendar, or, as the one who started it, show somebody out.

    What leaves with them is their own publications: an appointment they own
    comes off the calendar, and everybody else's stays. A calendar nobody has
    accepted any more is deleted rather than left standing empty.
    """
    shelf, members = my_calendar(db, user, calendar_id)
    if user_id != user.id and shelf.created_by != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, CREATOR_ONLY)
    going = next((row for row in members if row.user_id == user_id), None)
    if going is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_A_MEMBER)

    theirs = select(models.Appointment.id).where(models.Appointment.owner_id == user_id)
    db.execute(
        delete(models.AppointmentCalendar).where(
            models.AppointmentCalendar.calendar_id == shelf.id,
            models.AppointmentCalendar.appointment_id.in_(theirs),
        )
    )
    db.delete(going)
    left = [
        row
        for row in members
        if row.user_id != user_id and row.accepted_at is not None
    ]
    if not left:
        # The rows are cleared here rather than left to the foreign keys, so
        # the answer is the same whatever the database is asked to enforce.
        db.execute(
            delete(models.AppointmentCalendar).where(
                models.AppointmentCalendar.calendar_id == shelf.id
            )
        )
        db.execute(
            delete(models.CalendarMember).where(
                models.CalendarMember.calendar_id == shelf.id
            )
        )
        db.delete(shelf)
    db.commit()


# Invitations
# -----------


def appointment_intervals(
    row: models.Appointment, skips: set[dt.date], from_day: dt.date
) -> list[tuple[dt.datetime, dt.datetime]]:
    """The moments one appointment takes up, from a day onwards."""
    if row.all_day:
        return []
    if row.repeat_type is None:
        pair = instants(row, row.date_for)
        return [] if pair is None else [pair]
    found = []
    day = max(from_day, row.repeat_anchor or row.date_for)
    for _ in range(CONFLICT_DAYS):
        if lands_on(row, skips, day):
            pair = instants(row, day)
            if pair is not None:
                found.append(pair)
            if len(found) >= CONFLICT_OCCURRENCES:
                break
        day += ONE_DAY
    return found


@dataclass
class Clash:
    """One occurrence that overlaps what was asked about."""

    row: models.Appointment
    day: dt.date
    start: dt.datetime
    end: dt.datetime


def accepted_invitees(row: models.Appointment, sheet: Sheet) -> set[int]:
    return {
        invite.user_id
        for invite in sheet.invites.get(row.id, [])
        if invite.status == ACCEPTED
    }


def clashes(
    db: Session,
    user: models.User,
    intervals: list[tuple[dt.datetime, dt.datetime]],
    exclude_id: int | None,
) -> tuple[list[Clash], Sheet]:
    """Everything the caller can already see that overlaps those moments.

    Only ever the caller's own visible set, which is what keeps this from
    becoming a way to read somebody else's calendar one hour at a time. An
    all-day entry never clashes: nobody said when it is.
    """
    if not intervals:
        return [], gather(db, user, [])
    first = min(start for start, _ in intervals).astimezone(dt.timezone.utc).date() - ONE_DAY
    last = max(end for _, end in intervals).astimezone(dt.timezone.utc).date() + ONE_DAY
    rows = [
        row for row in visible_appointments(db, user, first, last) if row.id != exclude_id
    ]
    sheet = gather(db, user, rows)
    found = []
    for row in rows:
        if row.all_day:
            continue
        for day in occurrence_days(row, sheet.skips.get(row.id, set()), first, last):
            if sheet.marks.get((row.id, day), False):
                continue
            pair = instants(row, day)
            if pair is None:
                continue
            start, end = pair
            if any(start < other_end and other_start < end for other_start, other_end in intervals):
                found.append(Clash(row=row, day=day, start=start, end=end))
    found.sort(key=lambda clash: clash.start)
    return found, sheet


def hit_of(
    clash: Clash, sheet: Sheet, user: models.User, viewer: dt.tzinfo
) -> dict[str, object]:
    """One clash, in the reader's own zone and in their own words."""
    starts = clash.start.astimezone(viewer)
    ends = clash.end.astimezone(viewer)
    shelf = next(
        (
            sheet.shelves[calendar_id]
            for calendar_id in sheet.calendars.get(clash.row.id, [])
            if calendar_id in sheet.accepted and calendar_id in sheet.shelves
        ),
        None,
    )
    return {
        "appointment_id": clash.row.id,
        "date": starts.date().isoformat(),
        "start": clock_text(starts),
        "end": clock_text(ends),
        "title": clash.row.title,
        "who": "You"
        if clash.row.owner_id == user.id
        else display_name(sheet.named.get(clash.row.owner_id)),
        "calendar": None if shelf is None else shelf.name,
    }


@router.post("/conflicts")
def read_conflicts(
    body: ConflictIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """What a proposed time would run into, for the caller and for each guest.

    A guest's bucket is drawn from what the caller can already see and nothing
    else, so this answers "you and I are both busy then" without ever being a
    way to read somebody's day.
    """
    rtype, mask, interval, anchor, month_day, until = resolve_repeat(
        body.repeat, body.date_for
    )
    plan = Plan(
        title="",
        notes="",
        location=None,
        all_day=body.all_day,
        date_for=anchor if rtype is not None else body.date_for,
        end_date=body.end_date,
        time_of_day=body.time_of_day,
        end_time=body.end_time,
        repeat_type=rtype,
        repeat_days=mask,
        repeat_interval=interval,
        repeat_anchor=anchor,
        repeat_month_day=month_day,
        repeat_until=until,
    )
    validate_when(plan)
    viewer = clock.user_tz(user)
    found, sheet = clashes(
        db, user, proposal_intervals(plan, body.timezone or user.timezone), body.exclude_id
    )
    mine = [hit_of(clash, sheet, user, viewer) for clash in found[:MAX_HITS]]
    invitees: dict[str, object] = {}
    for member_id in dict.fromkeys(body.invitee_ids):
        theirs = [
            clash
            for clash in found
            if clash.row.owner_id == member_id
            or member_id in accepted_invitees(clash.row, sheet)
        ]
        invitees[str(member_id)] = [
            hit_of(clash, sheet, user, viewer) for clash in theirs[:MAX_HITS]
        ]
    return {"mine": mine, "invitees": invitees}


def proposal_intervals(
    plan: Plan, zone_name: str
) -> list[tuple[dt.datetime, dt.datetime]]:
    """The moments a proposal would take up, in the zone it was proposed in."""
    if plan.all_day or plan.date_for is None:
        return []
    if plan.time_of_day is None or plan.end_time is None:
        return []
    here = clock.zone(zone_name)
    span = (plan.end_date - plan.date_for).days if plan.end_date is not None else 0
    if plan.repeat_type is None:
        return [
            (
                dt.datetime.combine(plan.date_for, plan.time_of_day, here),
                dt.datetime.combine(
                    plan.date_for + dt.timedelta(days=span), plan.end_time, here
                ),
            )
        ]
    found = []
    day = plan.repeat_anchor or plan.date_for
    for _ in range(CONFLICT_DAYS):
        if recurrence.occurs_on(
            plan.repeat_type,
            plan.repeat_days,
            plan.repeat_interval,
            plan.repeat_anchor,
            plan.repeat_month_day,
            plan.repeat_until,
            day,
        ):
            found.append(
                (
                    dt.datetime.combine(day, plan.time_of_day, here),
                    dt.datetime.combine(day, plan.end_time, here),
                )
            )
            if len(found) >= CONFLICT_OCCURRENCES:
                break
        day += ONE_DAY
    return found


@router.get("/invitations")
def read_invitations(
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """What is waiting on an answer: appointments asked to, and calendars."""
    waiting = list(
        db.scalars(
            select(models.AppointmentInvite).where(
                models.AppointmentInvite.user_id == user.id,
                models.AppointmentInvite.status == PENDING,
            )
        )
    )
    rows = list(
        db.scalars(
            select(models.Appointment).where(
                models.Appointment.id.in_([invite.appointment_id for invite in waiting])
            )
        )
    )
    by_id = {row.id: row for row in rows}
    sheet = gather(db, user, rows)
    viewer = clock.user_tz(user)
    today = clock.user_today(user)
    meetings = []
    for invite in waiting:
        row = by_id.get(invite.appointment_id)
        if row is None:
            continue
        skips = sheet.skips.get(row.id, set())
        day = next_occurrence(row, skips, today)
        begins, _, _, _ = window(row, day, viewer)
        found, hit_sheet = clashes(
            db, user, appointment_intervals(row, skips, today), row.id
        )
        meetings.append(
            {
                "invite_id": invite.id,
                "appointment": occurrence_of(row, sheet, user, day, begins, viewer),
                "from": named_member(sheet.named.get(invite.invited_by)),
                "conflicts": [
                    hit_of(clash, hit_sheet, user, viewer) for clash in found[:MAX_HITS]
                ],
            }
        )

    pending = list(
        db.scalars(
            select(models.CalendarMember).where(
                models.CalendarMember.user_id == user.id,
                models.CalendarMember.accepted_at.is_(None),
            )
        )
    )
    shelves = {
        shelf.id: shelf
        for shelf in db.scalars(
            select(models.Calendar).where(
                models.Calendar.id.in_([row.calendar_id for row in pending])
            )
        )
    }
    members = calendar_members(db, list(shelves))
    named = people(
        db,
        {row.invited_by for row in pending}
        | {row.user_id for held in members.values() for row in held},
    )
    calendars = []
    for standing in pending:
        shelf = shelves.get(standing.calendar_id)
        if shelf is None:
            continue
        calendars.append(
            {
                "calendar_id": shelf.id,
                "name": shelf.name,
                "color": shelf.color,
                "from": named_member(named.get(standing.invited_by)),
                "members": sorted(
                    display_name(named.get(member.user_id))
                    for member in members.get(shelf.id, [])
                    if member.accepted_at is not None
                ),
            }
        )
    return {"meetings": meetings, "calendars": calendars}


@router.post("/invitations/{invite_id}/accept")
def accept_invitation(
    invite_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    return answer_invitation(db, user, invite_id, ACCEPTED)


@router.post("/invitations/{invite_id}/decline")
def decline_invitation(
    invite_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    return answer_invitation(db, user, invite_id, DECLINED)


def answer_invitation(
    db: Session, user: models.User, invite_id: int, answer: str
) -> dict[str, object]:
    """Say yes or no. A declined invitation keeps its row and shows nothing."""
    invite = db.get(models.AppointmentInvite, invite_id)
    if invite is None or invite.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_INVITATION)
    invite.status = answer
    invite.responded_at = now_utc()
    db.commit()
    return {"status": answer}


@router.post("/calendars/{calendar_id}/accept")
def accept_calendar(
    calendar_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    _, members = my_calendar(db, user, calendar_id)
    mine = next((row for row in members if row.user_id == user.id), None)
    if mine is None or mine.accepted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_INVITATION)
    mine.accepted_at = now_utc()
    db.commit()
    return {"status": ACCEPTED}


@router.post("/calendars/{calendar_id}/decline")
def decline_calendar(
    calendar_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Turn a calendar down, which is simply not being on it."""
    _, members = my_calendar(db, user, calendar_id)
    mine = next((row for row in members if row.user_id == user.id), None)
    if mine is None or mine.accepted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_INVITATION)
    db.delete(mine)
    db.commit()
    return {"status": DECLINED}


@router.get("/badge")
def read_badge(
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """How many things are waiting on an answer, for the dot on the tab."""
    meetings = db.scalar(
        select(func.count())
        .select_from(models.AppointmentInvite)
        .where(
            models.AppointmentInvite.user_id == user.id,
            models.AppointmentInvite.status == PENDING,
        )
    )
    calendars = db.scalar(
        select(func.count())
        .select_from(models.CalendarMember)
        .where(
            models.CalendarMember.user_id == user.id,
            models.CalendarMember.accepted_at.is_(None),
        )
    )
    return {"invitations": (meetings or 0) + (calendars or 0)}
