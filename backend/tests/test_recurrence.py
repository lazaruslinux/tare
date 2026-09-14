"""Which days a repeat lands on.

Plain date arithmetic with no database behind it, so every branch is worth a
case of its own: the two clamped ones in particular, where the 31st and the
29th of February have to land somewhere in the months that have neither.
"""

import datetime as dt

from app import recurrence

MONDAY = 1 << 0
WEDNESDAY = 1 << 2
SUNDAY = 1 << 6


def lands(
    repeat_type,
    on,
    days=None,
    interval=1,
    anchor=None,
    month_day=None,
    until=None,
):
    return recurrence.occurs_on(
        repeat_type, days, interval, anchor, month_day, until, dt.date.fromisoformat(on)
    )


# Weekly
# ------


def test_a_weekly_repeat_lands_on_the_days_it_names():
    assert lands("weekly", "2026-09-14", days=MONDAY) is True
    assert lands("weekly", "2026-09-15", days=MONDAY) is False


def test_all_seven_days_is_a_daily_repeat():
    week = [f"2026-09-{day}" for day in range(14, 21)]
    assert all(lands("weekly", day, days=recurrence.ALL_WEEKDAYS) for day in week)


def test_a_weekly_repeat_with_no_days_lands_nowhere():
    assert lands("weekly", "2026-09-14", days=0) is False
    assert lands("weekly", "2026-09-14", days=None) is False


def test_every_other_week_is_phased_on_the_anchors_week():
    twice = {"days": MONDAY, "interval": 2, "anchor": dt.date(2026, 9, 14)}
    assert lands("weekly", "2026-09-14", **twice) is True
    assert lands("weekly", "2026-09-21", **twice) is False
    assert lands("weekly", "2026-09-28", **twice) is True


def test_the_phase_is_the_week_rather_than_the_day_counted_off():
    # Anchored on a Sunday, so the Monday two days later is a different week
    # and the pattern has to skip it.
    twice = {"days": MONDAY, "interval": 2, "anchor": dt.date(2026, 9, 13)}
    assert lands("weekly", "2026-09-14", **twice) is False
    assert lands("weekly", "2026-09-21", **twice) is True


def test_a_weekly_repeat_holds_more_than_one_day():
    both = {"days": WEDNESDAY | SUNDAY}
    assert lands("weekly", "2026-09-16", **both) is True
    assert lands("weekly", "2026-09-20", **both) is True
    assert lands("weekly", "2026-09-17", **both) is False


# Monthly
# -------


def test_a_monthly_repeat_lands_on_its_day_of_the_month():
    assert lands("monthly", "2026-09-15", month_day=15) is True
    assert lands("monthly", "2026-09-16", month_day=15) is False


def test_the_thirty_first_lands_on_the_last_day_of_a_shorter_month():
    assert lands("monthly", "2026-02-28", month_day=31) is True
    assert lands("monthly", "2026-04-30", month_day=31) is True
    assert lands("monthly", "2026-03-31", month_day=31) is True
    assert lands("monthly", "2026-04-29", month_day=31) is False


def test_a_monthly_repeat_with_no_day_of_the_month_lands_nowhere():
    assert lands("monthly", "2026-09-15", month_day=None) is False


def test_every_other_month_is_phased_on_the_anchors_month():
    twice = {"month_day": 15, "interval": 2, "anchor": dt.date(2026, 9, 15)}
    assert lands("monthly", "2026-09-15", **twice) is True
    assert lands("monthly", "2026-10-15", **twice) is False
    assert lands("monthly", "2026-11-15", **twice) is True


# Yearly
# ------


def test_a_yearly_repeat_lands_on_the_anchors_month_and_day():
    anchor = dt.date(2026, 9, 15)
    assert lands("yearly", "2027-09-15", anchor=anchor) is True
    assert lands("yearly", "2027-09-16", anchor=anchor) is False
    assert lands("yearly", "2027-10-15", anchor=anchor) is False


def test_the_twenty_ninth_of_february_lands_on_the_twenty_eighth_between_leaps():
    anchor = dt.date(2024, 2, 29)
    assert lands("yearly", "2027-02-28", anchor=anchor) is True
    assert lands("yearly", "2028-02-29", anchor=anchor) is True
    assert lands("yearly", "2028-02-28", anchor=anchor) is False


def test_every_other_year_is_phased_on_the_anchors_year():
    twice = {"interval": 2, "anchor": dt.date(2026, 9, 15)}
    assert lands("yearly", "2027-09-15", **twice) is False
    assert lands("yearly", "2028-09-15", **twice) is True


def test_a_yearly_repeat_without_an_anchor_lands_nowhere():
    assert lands("yearly", "2027-09-15", anchor=None) is False


# The end of a repeat
# -------------------


def test_the_last_day_of_a_repeat_still_counts():
    until = dt.date(2026, 9, 21)
    assert lands("weekly", "2026-09-21", days=MONDAY, until=until) is True
    assert lands("weekly", "2026-09-28", days=MONDAY, until=until) is False


def test_a_type_the_calendar_does_not_have_lands_nowhere():
    assert lands(None, "2026-09-14", days=MONDAY) is False
    assert lands("hourly", "2026-09-14", days=MONDAY) is False
