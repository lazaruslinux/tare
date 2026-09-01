"""Which day it is where somebody is.

The moment is frozen and the zones are real, so every figure here is one the
zone database has to agree with rather than one the code worked out for itself.
"""

import datetime as dt

import pytest

from app import clock, models

UTC = dt.timezone.utc


def person(timezone):
    return models.User(username="somebody", password_hash="x", timezone=timezone)


def frozen(monkeypatch, moment):
    monkeypatch.setattr(clock, "now_utc", lambda: moment)


def test_two_accounts_at_one_moment_are_on_different_days(monkeypatch):
    # Half past ten at night in London: already tomorrow in Auckland, still
    # teatime in Phoenix.
    frozen(monkeypatch, dt.datetime(2026, 9, 1, 22, 30, tzinfo=UTC))
    assert clock.user_today(person("Pacific/Auckland")) == dt.date(2026, 9, 2)
    assert clock.user_today(person("America/Phoenix")) == dt.date(2026, 9, 1)


@pytest.mark.parametrize(
    ("moment", "day"),
    [
        # Half past four in the morning UTC, either side of the clocks going
        # forward. New York is five hours back in January and four in July, so
        # the same time of day lands on two different dates there.
        (dt.datetime(2026, 1, 15, 4, 30, tzinfo=UTC), dt.date(2026, 1, 14)),
        (dt.datetime(2026, 7, 15, 4, 30, tzinfo=UTC), dt.date(2026, 7, 15)),
    ],
)
def test_a_zone_that_moves_carries_the_day_boundary_with_it(monkeypatch, moment, day):
    frozen(monkeypatch, moment)
    assert clock.user_today(person("America/New_York")) == day


def test_the_hour_that_never_happened_still_has_a_date(monkeypatch):
    # 2026-03-08: New York goes from 01:59 standard straight to 03:00 summer
    # time, so seven in the morning UTC is three in the morning there.
    frozen(monkeypatch, dt.datetime(2026, 3, 8, 7, 0, tzinfo=UTC))
    assert clock.user_today(person("America/New_York")) == dt.date(2026, 3, 8)


def test_the_hour_that_happened_twice_still_has_a_date(monkeypatch):
    # 2026-11-01: New York runs 01:00 to 02:00 twice. Both of them are that
    # Sunday, and neither is the day before.
    frozen(monkeypatch, dt.datetime(2026, 11, 1, 5, 30, tzinfo=UTC))
    assert clock.user_today(person("America/New_York")) == dt.date(2026, 11, 1)
    frozen(monkeypatch, dt.datetime(2026, 11, 1, 6, 30, tzinfo=UTC))
    assert clock.user_today(person("America/New_York")) == dt.date(2026, 11, 1)


@pytest.mark.parametrize(
    ("timezone", "day"),
    [
        # Three quarters of an hour off the hour, fourteen hours ahead, eleven
        # behind, and the odd one that is both offset and quarter-houred. At one
        # instant these are two different dates.
        ("Asia/Kathmandu", dt.date(2026, 9, 2)),
        ("Pacific/Kiritimati", dt.date(2026, 9, 2)),
        ("Pacific/Chatham", dt.date(2026, 9, 2)),
        ("Pacific/Niue", dt.date(2026, 9, 1)),
    ],
)
def test_the_odd_zones_are_read_off_the_database_rather_than_guessed(monkeypatch, timezone, day):
    frozen(monkeypatch, dt.datetime(2026, 9, 1, 19, 0, tzinfo=UTC))
    assert clock.user_today(person(timezone)) == day


@pytest.mark.parametrize("timezone", ["Mars/Olympus", "Not a zone at all", ""])
def test_a_zone_this_machine_has_never_heard_of_falls_back_to_utc(monkeypatch, timezone):
    # A stored zone can outlive the database it was chosen from, and somebody
    # should still be told what day it is.
    frozen(monkeypatch, dt.datetime(2026, 9, 1, 23, 30, tzinfo=UTC))
    assert clock.user_tz(person(timezone)) is dt.timezone.utc
    assert clock.user_today(person(timezone)) == dt.date(2026, 9, 1)
