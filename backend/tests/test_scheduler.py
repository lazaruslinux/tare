"""When a check-in is due, and what it says when it goes.

The rules are a pure function of a moment and a handful of facts, so most of
this freezes both and asserts the one kind that comes back. The last few run
the tick itself against a database and a fake push service.
"""

import datetime as dt
from zoneinfo import ZoneInfo

import httpx
import pytest

from app import models, notifications, notify_prefs, scheduler, webpush
from app.config import settings
from app.models import now_utc
from app.notifications import EVENING, MORNING, QUIET, WEIGH_IN
from tests.test_webpush import AS_PRIVATE, AUTH_SECRET, UA_PUBLIC

PHOENIX = ZoneInfo("America/Phoenix")
NEW_YORK = ZoneInfo("America/New_York")

# A Tuesday, so a Monday weigh-in has to be asked for by day rather than by
# whichever day the suite happens to run on.
MONDAY = dt.date(2026, 9, 14)
TUESDAY = dt.date(2026, 9, 15)


def moment(day=TUESDAY, hour=8, minute=5, zone=PHOENIX):
    return dt.datetime.combine(day, dt.time(hour, minute), zone)


def facts(**over):
    """One member's day, with nothing going on until a case says otherwise."""
    fields = {
        "prefs": notify_prefs.default(),
        "sent_today": frozenset(),
        "last_quiet_day": None,
        "last_entry_day": TUESDAY,
        "created_day": TUESDAY - dt.timedelta(days=60),
        "entries_today": 0,
        "dinner_today": 0,
        "completed_today": False,
        "last_weigh_day": TUESDAY - dt.timedelta(days=10),
    }
    prefs = over.pop("prefs", None)
    if prefs is not None:
        fields["prefs"] = prefs
    fields.update(over)
    return scheduler.Facts(**fields)


def prefs_with(**over):
    prefs = notify_prefs.default()
    for key, value in over.items():
        if isinstance(value, dict):
            prefs[key] = {**prefs[key], **value}
        else:
            prefs[key] = value
    return prefs


# The morning slot
# ----------------


def test_the_morning_check_in_goes_out_inside_its_window():
    assert scheduler.due(moment(hour=8, minute=0), facts()) == MORNING
    assert scheduler.due(moment(hour=9, minute=29), facts()) == MORNING


def test_a_slot_missed_by_more_than_ninety_minutes_is_missed_for_the_day():
    assert scheduler.due(moment(hour=9, minute=31), facts()) is None
    assert scheduler.due(moment(hour=7, minute=59), facts()) is None


def test_a_kind_already_sent_today_is_not_sent_again():
    assert scheduler.due(moment(), facts(sent_today=frozenset({MORNING}))) is None


def test_the_morning_note_keeps_its_slot_on_the_weigh_in_day():
    """The ask moved into the morning note, so the note is still what goes."""
    due = scheduler.due(
        moment(day=MONDAY), facts(last_weigh_day=MONDAY - dt.timedelta(days=4))
    )
    assert due == MORNING


def test_the_weigh_in_only_lands_on_the_day_that_was_chosen():
    assert scheduler.due(moment(day=TUESDAY), facts()) == MORNING


def test_somebody_who_weighed_in_yesterday_gets_the_ordinary_morning():
    due = scheduler.due(
        moment(day=MONDAY), facts(last_weigh_day=MONDAY - dt.timedelta(days=1))
    )
    assert due == MORNING


def test_the_weigh_in_still_goes_out_with_the_morning_check_in_off():
    due = scheduler.due(
        moment(day=MONDAY),
        facts(prefs=prefs_with(morning={"on": False}), last_weigh_day=None),
    )
    assert due == WEIGH_IN


def test_the_morning_slot_is_silent_once_the_weigh_in_has_used_it():
    assert scheduler.due(moment(), facts(sent_today=frozenset({WEIGH_IN}))) is None


# The evening slot
# ----------------


def test_the_evening_check_in_goes_out_when_the_day_is_empty():
    assert scheduler.due(moment(hour=20, minute=10), facts()) == EVENING


def test_a_day_with_food_but_no_dinner_still_gets_the_evening_check_in():
    assert scheduler.due(moment(hour=20), facts(entries_today=2, dinner_today=0)) == EVENING


def test_a_day_with_dinner_in_it_gets_nothing():
    assert scheduler.due(moment(hour=20), facts(entries_today=3, dinner_today=1)) is None


def test_a_day_somebody_finished_gets_nothing_even_when_it_is_empty():
    assert scheduler.due(moment(hour=20), facts(completed_today=True)) is None


def test_the_evening_check_in_can_be_turned_off_on_its_own():
    off = facts(prefs=prefs_with(evening={"on": False}))
    assert scheduler.due(moment(hour=20), off) is None


# A quiet week
# ------------


def quiet_facts(**over):
    return facts(last_entry_day=TUESDAY - dt.timedelta(days=9), **over)


def test_a_week_without_an_entry_pauses_the_dailies_and_asks_once():
    assert scheduler.due(moment(hour=8), quiet_facts()) == QUIET
    # And nothing in the evening: the dailies are paused, not moved.
    assert scheduler.due(moment(hour=20), quiet_facts()) is None


def test_the_quiet_note_waits_a_week_before_it_asks_again():
    asked_yesterday = quiet_facts(last_quiet_day=TUESDAY - dt.timedelta(days=3))
    assert scheduler.due(moment(hour=8), asked_yesterday) is None
    a_week_on = quiet_facts(last_quiet_day=TUESDAY - dt.timedelta(days=7))
    assert scheduler.due(moment(hour=8), a_week_on) == QUIET


def test_the_weekly_switch_is_what_decides_the_quiet_note():
    off = quiet_facts(prefs=prefs_with(weekly={"on": False}))
    assert scheduler.due(moment(hour=8), off) is None
    # And the dailies stay paused regardless: a switch turned off buys silence,
    # not a morning check-in in its place.
    assert scheduler.due(moment(hour=20), off) is None


def test_the_quiet_note_does_not_need_either_daily_switch():
    """The weekly check-in is a switch of its own, so it stands on its own."""
    silent = quiet_facts(prefs=prefs_with(morning={"on": False}, evening={"on": False}))
    assert scheduler.due(moment(hour=8), silent) == QUIET


def test_a_new_account_with_nothing_in_it_yet_gets_the_dailies():
    fresh = facts(last_entry_day=None, created_day=TUESDAY - dt.timedelta(days=3))
    assert scheduler.due(moment(hour=8), fresh) == MORNING


def test_an_account_that_has_never_logged_anything_goes_quiet_on_its_own_age():
    old = facts(last_entry_day=None, created_day=TUESDAY - dt.timedelta(days=30))
    assert scheduler.due(moment(hour=8), old) == QUIET


# The tick, end to end
# --------------------


@pytest.fixture()
def rig(db_session, monkeypatch):
    """One member with a device turned on, and a push service that answers.

    A case that also wants the client asks for it first: the application reads
    whether this instance has keys as it starts, and the real schedule task
    must not run against the one session the suite shares.
    """
    monkeypatch.setattr(settings, "vapid_private_key", AS_PRIVATE)
    monkeypatch.setattr(settings, "vapid_subject", "mailto:admin@example.com")
    monkeypatch.setattr(scheduler, "SessionLocal", lambda: _Kept(db_session))
    monkeypatch.setattr(notifications, "SessionLocal", lambda: _Kept(db_session))
    return db_session


class _Kept:
    """The one test session, handed out as if it were a fresh one.

    The scheduler opens its own session because it runs outside a request. In
    the suite there is one in-memory database and one session on it, so this
    lends it out without letting the with block close it.
    """

    def __init__(self, session):
        self.session = session

    def __enter__(self):
        return self.session

    def __exit__(self, *failure):
        return False


def answers(monkeypatch, status=201, seen=None):
    def handler(request):
        if seen is not None:
            seen.append(request)
        return httpx.Response(status)

    monkeypatch.setattr(
        webpush, "session", lambda: httpx.Client(transport=httpx.MockTransport(handler))
    )


def device(db_session, user, endpoint="https://push.example.net/push/one"):
    row = models.PushSubscription(
        user_id=user.id, endpoint=endpoint, p256dh=UA_PUBLIC, auth=AUTH_SECRET, label="Phone"
    )
    db_session.add(row)
    db_session.commit()
    return row


def test_one_tick_sends_one_check_in_and_writes_it_down(rig, make_user, monkeypatch):
    user = make_user("member", timezone="America/Phoenix")
    device(rig, user)
    seen: list[httpx.Request] = []
    answers(monkeypatch, seen=seen)

    assert scheduler.tick(moment().astimezone(dt.timezone.utc)) == 1
    assert len(seen) == 1
    rows = rig.query(models.PushSend).all()
    assert [(row.kind, row.day) for row in rows] == [(MORNING, TUESDAY)]

    # And a second tick in the same window sends nothing.
    assert scheduler.tick(moment(minute=30).astimezone(dt.timezone.utc)) == 0
    assert len(seen) == 1


def test_a_weigh_in_books_the_morning_slot_as_well(rig, make_user, monkeypatch):
    user = make_user("member", timezone="America/Phoenix")
    user.notify = {**notify_prefs.default(), "morning": {"on": False, "time": "08:00"}}
    device(rig, user)
    rig.commit()
    answers(monkeypatch)

    assert scheduler.tick(moment(day=MONDAY).astimezone(dt.timezone.utc)) == 1
    kinds = {row.kind for row in rig.query(models.PushSend).all()}
    assert kinds == {WEIGH_IN, MORNING}


def test_a_device_the_service_says_is_gone_is_removed(rig, make_user, monkeypatch):
    user = make_user("member", timezone="America/Phoenix")
    device(rig, user)
    answers(monkeypatch, status=410)

    scheduler.tick(moment().astimezone(dt.timezone.utc))
    assert rig.query(models.PushSubscription).count() == 0


def test_a_service_that_refuses_counts_a_failure_against_the_device(
    rig, make_user, monkeypatch
):
    user = make_user("member", timezone="America/Phoenix")
    row = device(rig, user)
    answers(monkeypatch, status=500)

    scheduler.tick(moment().astimezone(dt.timezone.utc))
    rig.refresh(row)
    assert row.failures == 1
    assert row.last_ok_at is None


def test_two_zones_at_one_instant_are_not_both_due(rig, make_user, monkeypatch):
    here = make_user("phoenix", timezone="America/Phoenix")
    there = make_user("newyork", timezone="America/New_York")
    device(rig, here, "https://push.example.net/push/here")
    device(rig, there, "https://push.example.net/push/there")
    answers(monkeypatch)

    # Eight in the morning in Phoenix is eleven in New York.
    assert scheduler.tick(moment().astimezone(dt.timezone.utc)) == 1
    sent = rig.query(models.PushSend).all()
    assert {row.user_id for row in sent} == {here.id}


def test_records_older_than_a_month_are_swept_up(rig, make_user, monkeypatch):
    user = make_user("member", timezone="America/Phoenix")
    device(rig, user)
    answers(monkeypatch)
    rig.add(
        models.PushSend(
            user_id=user.id, kind=MORNING, day=TUESDAY - dt.timedelta(days=45), sent_at=now_utc()
        )
    )
    rig.commit()

    scheduler.tick(moment().astimezone(dt.timezone.utc))
    assert [row.day for row in rig.query(models.PushSend).all()] == [TUESDAY]


# What the words say
# ------------------


def body_of(rig, user, monkeypatch, kind, when):
    answers(monkeypatch)
    said: list[notifications.Message] = []
    real = notifications.deliver

    def watching(db, member, message, **rest):
        said.append(message)
        return real(db, member, message, **rest)

    monkeypatch.setattr(notifications, "deliver", watching)
    monkeypatch.setattr(scheduler.notifications, "deliver", watching)
    scheduler.tick(when.astimezone(dt.timezone.utc))
    assert said, f"nothing was sent for {kind}"
    return said[0]


def test_the_morning_check_in_carries_the_days_budget(client, rig, signed_in, monkeypatch):
    device(rig, signed_in)
    signed_in.timezone = "America/Phoenix"
    rig.commit()
    assert client.put(
        "/api/health/profile", json={"sex": "male", "height_cm": 178}
    ).status_code == 200
    assert client.put(
        f"/api/health/measurements/{TUESDAY.isoformat()}", json={"weight_kg": 90}
    ).status_code in (200, 201)

    message = body_of(rig, signed_in, monkeypatch, MORNING, moment())
    assert message.title == "Good morning"
    assert message.body.startswith("Your budget today is ")
    assert message.body.endswith(" cal.")
    assert message.url == "/?open=journal"
    assert message.tag == MORNING


def test_a_member_with_no_numbers_gets_the_line_without_one(rig, make_user, monkeypatch):
    user = make_user("member", timezone="America/Phoenix")
    device(rig, user)
    message = body_of(rig, user, monkeypatch, MORNING, moment())
    assert message.body == "A new day in your journal."


def test_the_quiet_note_says_a_week_and_then_a_while(rig, make_user, monkeypatch):
    user = make_user("member", timezone="America/Phoenix")
    user.created_at = dt.datetime.combine(
        TUESDAY - dt.timedelta(days=9), dt.time(12, 0), PHOENIX
    ).astimezone(dt.timezone.utc)
    device(rig, user)
    rig.commit()

    message = body_of(rig, user, monkeypatch, QUIET, moment())
    assert message.title == "How's it going?"
    assert message.body == "Your journal has been quiet for a week. Log one meal to pick it back up."

    rig.query(models.PushSend).delete()
    user.created_at = dt.datetime.combine(
        TUESDAY - dt.timedelta(days=20), dt.time(12, 0), PHOENIX
    ).astimezone(dt.timezone.utc)
    rig.commit()
    later = body_of(rig, user, monkeypatch, QUIET, moment())
    assert later.body == "Your journal has been quiet for a while. Log one meal to pick it back up."


def test_the_weigh_in_note_reads_differently_before_the_first_one(rig, make_user, monkeypatch):
    user = make_user("member", timezone="America/Phoenix")
    # Its own note only goes to somebody with no morning check-in to carry it.
    user.notify = {**notify_prefs.default(), "morning": {"on": False, "time": "08:00"}}
    device(rig, user)
    rig.commit()
    message = body_of(rig, user, monkeypatch, WEIGH_IN, moment(day=MONDAY))
    assert message.title == "Weigh-in day"
    assert message.body == (
        "Your first weigh-in starts the progress chart. Log it under Biometrics."
    )
    assert message.url == "/?open=biometrics"


def test_the_evening_check_in_says_which_gap_it_found(client, rig, signed_in, monkeypatch):
    signed_in.timezone = "America/Phoenix"
    rig.commit()
    device(rig, signed_in)
    message = body_of(rig, signed_in, monkeypatch, EVENING, moment(hour=20))
    assert message.title == "How did today go?"
    assert message.body == "Your journal is empty today. Add what you ate, even roughly."


def test_a_member_with_no_device_is_never_looked_at(rig, make_user, monkeypatch):
    make_user("member", timezone="America/Phoenix")
    answers(monkeypatch)
    assert scheduler.tick(moment().astimezone(dt.timezone.utc)) == 0
    assert rig.query(models.PushSend).count() == 0


# Reminders before an appointment
# -------------------------------


@pytest.fixture()
def diary(client, rig, signed_in, monkeypatch):
    """A member in Phoenix with a device on and a push service that answers."""
    signed_in.timezone = "America/Phoenix"
    device(rig, signed_in)
    rig.commit()
    answers(monkeypatch)
    return signed_in


def an_appointment(client, **fields):
    """One of this member's own, in the afternoon so the morning slot is shut."""
    body = {
        "title": "Dentist",
        "date_for": TUESDAY.isoformat(),
        "time_of_day": "14:00",
        "end_time": "15:00",
    }
    body.update(fields)
    response = client.post("/api/calendar/appointments", json=body)
    assert response.status_code == 201, response.json()
    return response.json()["appointment"]


def reminders_of(rig):
    return sorted(
        (row.kind, row.day)
        for row in rig.query(models.PushSend).all()
        if row.kind.startswith("appt-")
    )


def lead(rig, member, minutes):
    member.notify = {
        **notify_prefs.default(),
        "reminders": {"on": True, "minutes": minutes},
    }
    rig.commit()


def test_a_reminder_goes_out_the_chosen_number_of_minutes_before(client, rig, diary):
    made = an_appointment(client)

    assert scheduler.tick(moment(hour=13, minute=29).astimezone(dt.timezone.utc)) == 0
    assert reminders_of(rig) == []

    assert scheduler.tick(moment(hour=13, minute=30).astimezone(dt.timezone.utc)) == 1
    assert reminders_of(rig) == [(f"appt-{made['id']}", TUESDAY)]


def test_a_reminder_is_written_down_so_it_only_goes_once(client, rig, diary):
    an_appointment(client)

    assert scheduler.tick(moment(hour=13, minute=35).astimezone(dt.timezone.utc)) == 1
    assert scheduler.tick(moment(hour=13, minute=45).astimezone(dt.timezone.utc)) == 0
    assert scheduler.tick(moment(hour=13, minute=59).astimezone(dt.timezone.utc)) == 0
    assert len(reminders_of(rig)) == 1


def test_nothing_is_sent_once_the_appointment_has_started(client, rig, diary):
    an_appointment(client)

    assert scheduler.tick(moment(hour=14).astimezone(dt.timezone.utc)) == 0
    assert scheduler.tick(moment(hour=14, minute=30).astimezone(dt.timezone.utc)) == 0
    assert reminders_of(rig) == []


def test_a_shorter_lead_time_is_honoured(client, rig, diary):
    lead(rig, diary, 15)
    an_appointment(client)

    assert scheduler.tick(moment(hour=13, minute=40).astimezone(dt.timezone.utc)) == 0
    assert scheduler.tick(moment(hour=13, minute=45).astimezone(dt.timezone.utc)) == 1


def test_reminders_can_be_turned_off_on_their_own(client, rig, diary):
    diary.notify = {
        **notify_prefs.default(),
        "reminders": {"on": False, "minutes": 30},
    }
    rig.commit()
    an_appointment(client)

    assert scheduler.tick(moment(hour=13, minute=35).astimezone(dt.timezone.utc)) == 0
    assert reminders_of(rig) == []


def test_an_all_day_appointment_is_never_reminded_about(client, rig, diary):
    an_appointment(client, all_day=True, time_of_day=None, end_time=None)

    for hour, minute in ((8, 5), (13, 35), (23, 40)):
        scheduler.tick(moment(hour=hour, minute=minute).astimezone(dt.timezone.utc))
    assert reminders_of(rig) == []


def test_a_cancelled_day_is_not_reminded_about(client, rig, diary):
    made = an_appointment(client)
    assert (
        client.post(
            f"/api/calendar/appointments/{made['id']}/cancel?date={TUESDAY.isoformat()}"
        ).status_code
        == 200
    )

    assert scheduler.tick(moment(hour=13, minute=35).astimezone(dt.timezone.utc)) == 0
    assert reminders_of(rig) == []


def test_a_day_carved_out_of_a_series_is_not_reminded_about(client, rig, diary):
    made = an_appointment(client, repeat={"type": "weekly", "days": [1]})
    assert (
        client.delete(
            f"/api/calendar/appointments/{made['id']}/occurrence"
            f"?date={TUESDAY.isoformat()}"
        ).status_code
        == 204
    )

    assert scheduler.tick(moment(hour=13, minute=35).astimezone(dt.timezone.utc)) == 0
    assert reminders_of(rig) == []


def test_every_day_of_a_series_gets_its_own_reminder(client, rig, diary):
    made = an_appointment(client, repeat={"type": "weekly", "days": [1]})
    next_week = TUESDAY + dt.timedelta(days=7)

    assert scheduler.tick(moment(hour=13, minute=35).astimezone(dt.timezone.utc)) == 1
    assert (
        scheduler.tick(
            moment(day=next_week, hour=13, minute=35).astimezone(dt.timezone.utc)
        )
        == 1
    )
    assert reminders_of(rig) == [
        (f"appt-{made['id']}", TUESDAY),
        (f"appt-{made['id']}", next_week),
    ]


def test_an_appointment_nobody_showed_this_member_is_not_reminded_about(
    client, rig, db_session, make_user, diary, monkeypatch
):
    stranger = make_user("stranger", timezone="America/Phoenix")
    row = models.Appointment(
        owner_id=stranger.id,
        title="Theirs",
        timezone="America/Phoenix",
        date_for=TUESDAY,
        time_of_day=dt.time(14, 0),
        end_time=dt.time(15, 0),
    )
    db_session.add(row)
    db_session.commit()

    assert scheduler.tick(moment(hour=13, minute=35).astimezone(dt.timezone.utc)) == 0
    assert reminders_of(rig) == []


def test_a_member_in_another_zone_is_reminded_on_their_own_clock(
    client, rig, db_session, signed_in, monkeypatch
):
    signed_in.timezone = "America/New_York"
    device(rig, signed_in)
    rig.commit()
    answers(monkeypatch)
    an_appointment(client)

    # Two in the afternoon in New York is half past ten in Phoenix, so the
    # reminder is owed at ten to one Phoenix time and not at half past one.
    assert scheduler.tick(moment(hour=13, minute=35).astimezone(dt.timezone.utc)) == 0
    assert scheduler.tick(moment(hour=10, minute=35).astimezone(dt.timezone.utc)) == 1


# What a reminder says
# --------------------


def reminder_body(rig, monkeypatch, when=None):
    said: list[notifications.Message] = []
    real = notifications.deliver

    def watching(db, member, message, **rest):
        said.append(message)
        return real(db, member, message, **rest)

    monkeypatch.setattr(notifications, "deliver", watching)
    monkeypatch.setattr(scheduler.notifications, "deliver", watching)
    scheduler.tick(
        (when or moment(hour=13, minute=35)).astimezone(dt.timezone.utc)
    )
    assert said, "nothing was sent"
    return said[0]


def test_a_reminder_names_the_hour_and_nothing_else(client, rig, diary, monkeypatch):
    made = an_appointment(client)
    message = reminder_body(rig, monkeypatch)

    assert message.title == "Dentist in 30 minutes"
    assert message.body == "2:00PM"
    assert message.url == f"/?open=calendar&day={TUESDAY.isoformat()}"
    assert message.tag == f"appt-{made['id']}"


def test_a_reminder_names_a_place_when_one_was_written_down(
    client, rig, diary, monkeypatch
):
    an_appointment(client, location="Dr Alvarez")
    assert reminder_body(rig, monkeypatch).body == "2:00PM at Dr Alvarez"


def test_a_reminder_prefers_the_calendar_it_is_shared_on(
    client, rig, db_session, make_user, diary, monkeypatch
):
    from tests.test_calendar import shelf_for
    from tests.test_feed import befriend

    other = make_user("other")
    befriend(db_session, diary, other)
    shelf = shelf_for(db_session, diary, other)
    an_appointment(client, location="Dr Alvarez", calendar_ids=[shelf.id])

    assert reminder_body(rig, monkeypatch).body == "2:00PM · Home"


def test_a_shorter_lead_time_says_so(client, rig, diary, monkeypatch):
    lead(rig, diary, 15)
    an_appointment(client)
    message = reminder_body(rig, monkeypatch, moment(hour=13, minute=50))
    assert message.title == "Dentist in 15 minutes"


# What the morning note says about the day ahead
# ----------------------------------------------


def test_the_morning_note_asks_for_the_weigh_in_on_its_day(rig, make_user, monkeypatch):
    user = make_user("member", timezone="America/Phoenix")
    device(rig, user)
    message = body_of(rig, user, monkeypatch, MORNING, moment(day=MONDAY))

    assert message.title == "Good morning"
    assert message.body.startswith("Weigh-in day: log it under Biometrics.")


def test_the_morning_note_leaves_the_weigh_in_out_when_the_scale_is_recent(
    rig, make_user, monkeypatch
):
    user = make_user("member", timezone="America/Phoenix")
    device(rig, user)
    rig.add(
        models.WeightEntry(
            user_id=user.id, date_for=MONDAY - dt.timedelta(days=1), weight_kg=90
        )
    )
    rig.commit()

    message = body_of(rig, user, monkeypatch, MORNING, moment(day=MONDAY))
    assert "Weigh-in day" not in message.body


def test_the_morning_note_names_the_first_appointment_still_to_come(
    client, rig, signed_in, monkeypatch
):
    signed_in.timezone = "America/Phoenix"
    device(rig, signed_in)
    rig.commit()
    an_appointment(client, title="Standup", time_of_day="09:00", end_time="09:15")
    an_appointment(client, title="Dentist")

    message = body_of(rig, signed_in, monkeypatch, MORNING, moment())
    assert message.body.endswith("First up, Standup at 9:00AM.")


def test_the_morning_note_skips_an_appointment_already_under_way(
    client, rig, signed_in, monkeypatch
):
    signed_in.timezone = "America/Phoenix"
    device(rig, signed_in)
    rig.commit()
    an_appointment(client, title="Standup", time_of_day="07:30", end_time="09:30")
    an_appointment(client, title="Dentist")

    message = body_of(rig, signed_in, monkeypatch, MORNING, moment())
    assert "Standup" not in message.body
    assert message.body.endswith("First up, Dentist at 2:00PM.")


def test_the_morning_note_says_nothing_of_a_day_with_nothing_in_it(
    client, rig, signed_in, monkeypatch
):
    signed_in.timezone = "America/Phoenix"
    device(rig, signed_in)
    rig.commit()

    message = body_of(rig, signed_in, monkeypatch, MORNING, moment())
    assert "First up" not in message.body
