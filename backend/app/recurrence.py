"""When a repeating appointment lands, as plain date arithmetic.

No database and no ORM: the stored repeat columns go in and a yes or no comes
out, which is the one question the calendar asks over and over. Monday is bit 0
and Sunday is bit 6, the same way date.weekday() counts, so all seven bits set
is a daily repeat and there is no separate daily kind to keep in step.
"""

from __future__ import annotations

import calendar
import datetime as dt

WEEKLY = "weekly"
MONTHLY = "monthly"
YEARLY = "yearly"
REPEAT_TYPES = (WEEKLY, MONTHLY, YEARLY)

# Every weekday at once, which is what a daily repeat is stored as.
ALL_WEEKDAYS = 0b1111111


def week_start(day: dt.date) -> dt.date:
    """The Monday of that day's week."""
    return day - dt.timedelta(days=day.weekday())


def month_length(day: dt.date) -> int:
    """How many days that day's month has."""
    return calendar.monthrange(day.year, day.month)[1]


def occurs_on(
    repeat_type: str | None,
    repeat_days: int | None,
    repeat_interval: int | None,
    repeat_anchor: dt.date | None,
    repeat_month_day: int | None,
    repeat_until: dt.date | None,
    date: dt.date,
) -> bool:
    """Whether a repeat described by these fields lands on one date.

    The interval is phased against the anchor rather than against the date
    asked about, so every day the question is put gets the same answer: the
    Monday of the anchor's week for a weekly one, the anchor's month for a
    monthly one, and its year for a yearly one.
    """
    if repeat_until is not None and date > repeat_until:
        return False
    interval = repeat_interval or 1

    if repeat_type == WEEKLY:
        if not repeat_days or not repeat_days & (1 << date.weekday()):
            return False
        if interval > 1:
            weeks = (week_start(date) - week_start(repeat_anchor or date)).days // 7
            if weeks % interval != 0:
                return False
        return True

    if repeat_type == MONTHLY:
        if not repeat_month_day:
            return False
        # Clamped, so "the 31st" lands on the last day of a shorter month
        # rather than skipping that month altogether.
        if date.day != min(repeat_month_day, month_length(date)):
            return False
        if interval > 1:
            anchor = repeat_anchor or date
            months = (date.year - anchor.year) * 12 + (date.month - anchor.month)
            if months % interval != 0:
                return False
        return True

    if repeat_type == YEARLY:
        # The anchor is the whole pattern here: its month and its day, clamped
        # the same way, which is how the 29th of February lands on the 28th in
        # the years that have no 29th.
        if repeat_anchor is None or date.month != repeat_anchor.month:
            return False
        if date.day != min(repeat_anchor.day, month_length(date)):
            return False
        return (date.year - repeat_anchor.year) % interval == 0

    return False
