"""Who is told when something on a shared calendar moves.

The seam itself is stubbed for most of this: what matters is that the right
people are named, that whoever made the change is never one of them, and that
the audience is worked out before the rows it is read from are deleted. The
last few cases let the real seam run against a fake push service.
"""

import datetime as dt

import httpx
import pytest

from app import models, notifications, webpush
from app.config import settings
from app.notifications import (
    APPOINTMENT_ADDED,
    APPOINTMENT_CHANGED,
    APPOINTMENT_DELETED,
    CALENDAR_OFFERED,
    INVITATION_ACCEPTED,
    INVITATION_DECLINED,
    INVITED,
    MEMBER_JOINED,
    OCCURRENCE_CANCELLED,
)
from tests.test_calendar import TUESDAY, kept, shelf_for
from tests.test_feed import befriend, sign_in
from tests.test_webpush import AS_PRIVATE, AUTH_SECRET, UA_PUBLIC


@pytest.fixture()
def seen(monkeypatch):
    """Every call to the seam, in order, without anything going out."""
    told: list[tuple[list[int], notifications.Event]] = []
    monkeypatch.setattr(
        notifications, "notify", lambda ids, event: told.append((list(ids), event))
    )
    return told


def kinds(told):
    return [event.kind for _, event in told]


def for_kind(told, kind):
    return next((pair for pair in told if pair[1].kind == kind), None)


def pair(client, db_session, make_user, signed_in, name="other", accepted=True):
    """Two friends on one shared calendar, the second already on it."""
    other = make_user(name)
    befriend(db_session, signed_in, other)
    shelf = shelf_for(db_session, signed_in, other, accepted=accepted)
    return other, shelf


def test_writing_one_down_tells_the_calendar_and_never_the_writer(
    client, db_session, make_user, signed_in, seen
):
    other, shelf = pair(client, db_session, make_user, signed_in)
    kept(client, calendar_ids=[shelf.id])

    assert kinds(seen) == [APPOINTMENT_ADDED]
    ids, event = seen[0]
    assert ids == [other.id]
    assert event.title == "Dentist"
    assert event.calendar == "Home"
    assert event.who == "member"


def test_somebody_asked_along_hears_that_rather_than_the_calendar(
    client, db_session, make_user, signed_in, seen
):
    other, shelf = pair(client, db_session, make_user, signed_in)
    third = make_user("third")
    befriend(db_session, signed_in, third)
    kept(client, calendar_ids=[shelf.id], invitee_ids=[third.id])

    assert set(kinds(seen)) == {APPOINTMENT_ADDED, INVITED}
    assert for_kind(seen, APPOINTMENT_ADDED)[0] == [other.id]
    invited_ids, invited = for_kind(seen, INVITED)
    assert invited_ids == [third.id]
    # The name of a calendar they are not on is not theirs to be told.
    assert invited.calendar == ""


def test_a_calendar_nobody_has_accepted_yet_is_told_nothing(
    client, db_session, make_user, signed_in, seen
):
    _, shelf = pair(client, db_session, make_user, signed_in, accepted=False)
    kept(client, calendar_ids=[shelf.id])
    assert seen == []


def test_moving_an_appointment_tells_everybody_holding_it(
    client, db_session, make_user, signed_in, seen
):
    other, shelf = pair(client, db_session, make_user, signed_in)
    made = kept(client, calendar_ids=[shelf.id])
    seen.clear()

    assert client.patch(
        f"/api/calendar/appointments/{made['id']}",
        json={"time_of_day": "11:00", "end_time": "12:00"},
    ).status_code == 200
    assert kinds(seen) == [APPOINTMENT_CHANGED]
    ids, event = seen[0]
    assert ids == [other.id]
    assert event.at == dt.time(11, 0)


def test_a_note_or_a_location_on_its_own_tells_nobody(
    client, db_session, make_user, signed_in, seen
):
    _, shelf = pair(client, db_session, make_user, signed_in)
    made = kept(client, calendar_ids=[shelf.id])
    seen.clear()

    assert client.patch(
        f"/api/calendar/appointments/{made['id']}",
        json={"notes": "Bring the card", "location": "Main Street"},
    ).status_code == 200
    assert seen == []


def test_putting_one_on_another_calendar_reads_as_added_there(
    client, db_session, make_user, signed_in, seen
):
    other, shelf = pair(client, db_session, make_user, signed_in)
    third = make_user("third")
    befriend(db_session, signed_in, third)
    second = shelf_for(db_session, signed_in, third, name="Weekend", color="green")
    made = kept(client, calendar_ids=[shelf.id])
    seen.clear()

    assert client.patch(
        f"/api/calendar/appointments/{made['id']}",
        json={
            "calendar_ids": [shelf.id, second.id],
            "time_of_day": "11:00",
            "end_time": "12:00",
        },
    ).status_code == 200
    # The one who already had it hears that it moved; the one who is seeing it
    # for the first time hears that it was added.
    assert for_kind(seen, APPOINTMENT_CHANGED)[0] == [other.id]
    assert for_kind(seen, APPOINTMENT_ADDED)[0] == [third.id]


def test_deleting_one_is_worked_out_before_the_rows_go(
    client, db_session, make_user, signed_in, seen
):
    other, shelf = pair(client, db_session, make_user, signed_in)
    made = kept(client, calendar_ids=[shelf.id])
    seen.clear()

    assert client.delete(f"/api/calendar/appointments/{made['id']}").status_code == 204
    ids, event = seen[0]
    assert event.kind == APPOINTMENT_DELETED
    assert ids == [other.id]
    assert event.whole_series is False


def test_deleting_a_repeating_one_says_all_dates(
    client, db_session, make_user, signed_in, seen
):
    other, shelf = pair(client, db_session, make_user, signed_in)
    made = kept(
        client,
        calendar_ids=[shelf.id],
        repeat={"type": "weekly", "days": [1], "interval": 1},
    )
    seen.clear()

    client.delete(f"/api/calendar/appointments/{made['id']}")
    _, event = seen[0]
    assert event.whole_series is True
    assert notifications.compose(event, other).body.startswith("All dates, by member.")


def test_calling_a_day_off_names_that_day(client, db_session, make_user, signed_in, seen):
    other, shelf = pair(client, db_session, make_user, signed_in)
    made = kept(client, calendar_ids=[shelf.id])
    seen.clear()

    assert client.post(
        f"/api/calendar/appointments/{made['id']}/cancel?date={TUESDAY}"
    ).status_code == 200
    ids, event = seen[0]
    assert event.kind == OCCURRENCE_CANCELLED
    assert ids == [other.id]
    assert event.day == dt.date(2026, 9, 15)


def test_taking_a_day_out_of_a_series_says_it_was_cancelled(
    client, db_session, make_user, signed_in, seen
):
    other, shelf = pair(client, db_session, make_user, signed_in)
    made = kept(
        client,
        calendar_ids=[shelf.id],
        repeat={"type": "weekly", "days": [1], "interval": 1},
    )
    seen.clear()

    assert client.delete(
        f"/api/calendar/appointments/{made['id']}/occurrence?date=2026-09-22"
    ).status_code == 204
    ids, event = seen[0]
    assert event.kind == OCCURRENCE_CANCELLED
    assert ids == [other.id]
    assert event.day == dt.date(2026, 9, 22)


def test_moving_one_day_of_a_series_reads_as_a_change(
    client, db_session, make_user, signed_in, seen
):
    other, shelf = pair(client, db_session, make_user, signed_in)
    made = kept(
        client,
        calendar_ids=[shelf.id],
        repeat={"type": "weekly", "days": [1], "interval": 1},
    )
    seen.clear()

    response = client.post(
        f"/api/calendar/appointments/{made['id']}/occurrence?date=2026-09-22",
        json={
            "title": "Dentist",
            "date_for": "2026-09-23",
            "time_of_day": "14:00",
            "end_time": "15:00",
            "calendar_ids": [shelf.id],
        },
    )
    assert response.status_code == 201
    ids, event = seen[0]
    assert event.kind == APPOINTMENT_CHANGED
    assert ids == [other.id]
    assert event.day == dt.date(2026, 9, 23)


def test_asking_a_few_more_people_tells_only_the_new_ones(
    client, db_session, make_user, signed_in, seen
):
    other = make_user("other")
    third = make_user("third")
    befriend(db_session, signed_in, other)
    befriend(db_session, signed_in, third)
    made = kept(client, invitee_ids=[other.id])
    seen.clear()

    response = client.post(
        f"/api/calendar/appointments/{made['id']}/invites",
        json={"user_ids": [other.id, third.id]},
    )
    assert response.status_code == 200
    assert kinds(seen) == [INVITED]
    assert seen[0][0] == [third.id]


def test_an_answer_goes_to_whoever_wrote_it_down(
    client, db_session, make_user, signed_in, seen
):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    made = kept(client, invitee_ids=[other.id])
    seen.clear()

    sign_in(client, "other")
    invite_id = client.get("/api/calendar/invitations").json()["meetings"][0]["invite_id"]
    assert client.post(f"/api/calendar/invitations/{invite_id}/accept").status_code == 200
    ids, event = seen[0]
    assert event.kind == INVITATION_ACCEPTED
    assert ids == [signed_in.id]
    assert event.who == "other"
    assert event.title == "Dentist"

    seen.clear()
    assert client.post(f"/api/calendar/invitations/{invite_id}/decline").status_code == 200
    assert kinds(seen) == [INVITATION_DECLINED]
    assert made["id"] is not None


def test_sharing_a_calendar_and_joining_one_are_both_said(
    client, db_session, make_user, signed_in, seen
):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    response = client.post(
        "/api/calendar/calendars", json={"name": "Home", "color": "blue", "friend_id": other.id}
    )
    assert response.status_code == 201
    shelf_id = response.json()["id"]
    ids, event = seen[0]
    assert event.kind == CALENDAR_OFFERED
    assert ids == [other.id]
    assert event.title == "Home"

    seen.clear()
    sign_in(client, "other")
    assert client.post(f"/api/calendar/calendars/{shelf_id}/accept").status_code == 200
    ids, event = seen[0]
    assert event.kind == MEMBER_JOINED
    assert ids == [signed_in.id]
    assert event.who == "other"


def test_adding_a_member_offers_them_the_calendar(
    client, db_session, make_user, signed_in, seen
):
    other, shelf = pair(client, db_session, make_user, signed_in)
    third = make_user("third")
    befriend(db_session, signed_in, third)
    seen.clear()

    assert client.post(
        f"/api/calendar/calendars/{shelf.id}/members", json={"user_id": third.id}
    ).status_code == 200
    ids, event = seen[0]
    assert event.kind == CALENDAR_OFFERED
    assert ids == [third.id]


def test_turning_a_calendar_down_tells_nobody(client, db_session, make_user, signed_in, seen):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    response = client.post(
        "/api/calendar/calendars", json={"name": "Home", "color": "blue", "friend_id": other.id}
    )
    shelf_id = response.json()["id"]
    seen.clear()

    sign_in(client, "other")
    assert client.post(f"/api/calendar/calendars/{shelf_id}/decline").status_code == 200
    assert seen == []


# The seam itself
# ---------------


@pytest.fixture()
def with_push(db_session, monkeypatch):
    """A configured instance, a push service that answers, and one session."""
    monkeypatch.setattr(settings, "vapid_private_key", AS_PRIVATE)
    monkeypatch.setattr(settings, "vapid_subject", "mailto:admin@example.com")
    posted: list[httpx.Request] = []

    def handler(request):
        posted.append(request)
        return httpx.Response(201)

    monkeypatch.setattr(
        webpush, "session", lambda: httpx.Client(transport=httpx.MockTransport(handler))
    )

    class Kept:
        def __enter__(self):
            return db_session

        def __exit__(self, *failure):
            return False

    monkeypatch.setattr(notifications, "SessionLocal", Kept)
    return posted


def device(db_session, user, endpoint="https://push.example.net/push/one"):
    db_session.add(
        models.PushSubscription(
            user_id=user.id,
            endpoint=endpoint,
            p256dh=UA_PUBLIC,
            auth=AUTH_SECRET,
            label="Phone",
        )
    )
    db_session.commit()


def an_event(kind=APPOINTMENT_ADDED, **over):
    fields = {
        "title": "Dentist",
        "who": "member",
        "day": dt.date(2026, 9, 15),
        "at": dt.time(9, 0),
        "zone": "America/Phoenix",
        "ref": 7,
        "calendar": "Home",
    }
    fields.update(over)
    return notifications.Event(kind, **fields)


def test_a_switch_that_is_off_stops_the_kinds_behind_it(db_session, make_user, with_push):
    user = make_user("member")
    device(db_session, user)
    user.notify = {
        "morning": {"on": True, "time": "08:00"},
        "evening": {"on": True, "time": "20:00"},
        "weigh_in": {"on": True, "weekday": 0},
        "calendar": False,
        "invitations": True,
    }
    db_session.commit()

    notifications.notify([user.id], an_event())
    assert with_push == []
    notifications.notify([user.id], an_event(INVITED, calendar=""))
    assert len(with_push) == 1


def test_a_time_arrives_in_the_readers_own_zone_and_clock(db_session, make_user):
    here = make_user("phoenix", timezone="America/Phoenix")
    there = make_user("newyork", timezone="America/New_York")
    there.clock = "24h"
    twelve = make_user("twelve", timezone="America/New_York")
    event = an_event(end_at=None)

    assert notifications.compose(event, here).body == "Tue, Sep 15 at 9:00AM, by member."
    assert notifications.compose(event, there).body == "Tue, Sep 15 at 12:00, by member."
    assert notifications.compose(event, twelve).body == "Tue, Sep 15 at 12:00PM, by member."


def test_the_words_of_every_calendar_kind(db_session, make_user):
    reader = make_user("reader", timezone="America/Phoenix")
    added = notifications.compose(an_event(), reader)
    assert added.title == "Added Dentist to Home"
    assert added.tag == "appt-7"
    assert added.url == "/?open=calendar&day=2026-09-15"

    span = notifications.compose(an_event(end_at=dt.time(10, 30)), reader)
    assert span.body == "Tue, Sep 15, 9:00 to 10:30AM, by member."

    all_day = notifications.compose(an_event(at=None, end_at=None), reader)
    assert all_day.body == "Tue, Sep 15, all day, by member."

    changed = notifications.compose(an_event(APPOINTMENT_CHANGED, calendar=""), reader)
    assert changed.title == "Updated Dentist"

    off = notifications.compose(an_event(OCCURRENCE_CANCELLED), reader)
    assert off.title == "Cancelled Dentist on Home"
    assert off.body == "Tue, Sep 15, by member."

    asked = notifications.compose(an_event(INVITED, calendar=""), reader)
    assert asked.title == "member invited you to Dentist"
    assert asked.body == "Tue, Sep 15 at 9:00AM. Tap to answer."
    assert asked.url == "/?open=invitations"

    yes = notifications.compose(an_event(INVITATION_ACCEPTED, calendar=""), reader)
    assert yes.title == "member accepted Dentist"
    assert yes.body == "Tue, Sep 15 at 9:00AM."

    offered = notifications.compose(
        notifications.Event(CALENDAR_OFFERED, title="Home", who="member", ref=3), reader
    )
    assert offered.title == "member shared a calendar with you"
    assert offered.body == "Home. Tap to answer."
    assert offered.tag == "cal-3"
    assert offered.url == "/?open=calendar"

    joined = notifications.compose(
        notifications.Event(MEMBER_JOINED, title="Home", who="other", ref=3), reader
    )
    assert joined.title == "other joined Home"
    assert joined.body == "They see everything on it now."


def test_an_instance_with_no_keys_sends_nothing_at_all(db_session, make_user, monkeypatch):
    user = make_user("member")
    device(db_session, user)
    monkeypatch.setattr(
        webpush,
        "session",
        lambda: (_ for _ in ()).throw(AssertionError("nothing should be sent")),
    )
    notifications.notify([user.id], an_event())
