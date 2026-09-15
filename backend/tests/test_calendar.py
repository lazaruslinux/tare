"""The shared calendar: what it shows, who it shows it to, and what it refuses.

Two rules are worth more than the rest here. Nothing reaches anybody who has
not accepted either the calendar it is on or the invitation to it, and a time
means the moment it was arranged for however far away it is read.
"""

from sqlalchemy import select

from app import models, throttle
from app.models import now_utc
from tests.test_feed import befriend, sign_in

MONDAY = "2026-09-14"
TUESDAY = "2026-09-15"


def shelf_for(db_session, owner, friend, name="Home", color="blue", accepted=True):
    """A shared calendar both of them are on, without the invitation dance."""
    shelf = models.Calendar(
        name=name, color=color, created_by=owner.id, created_at=now_utc()
    )
    db_session.add(shelf)
    db_session.flush()
    db_session.add(
        models.CalendarMember(
            calendar_id=shelf.id,
            user_id=owner.id,
            invited_by=owner.id,
            invited_at=now_utc(),
            accepted_at=now_utc(),
        )
    )
    db_session.add(
        models.CalendarMember(
            calendar_id=shelf.id,
            user_id=friend.id,
            invited_by=owner.id,
            invited_at=now_utc(),
            accepted_at=now_utc() if accepted else None,
        )
    )
    db_session.commit()
    return shelf


def written(client, **fields):
    """One appointment through the front door, with the answer as it came."""
    body = {
        "title": "Dentist",
        "date_for": TUESDAY,
        "time_of_day": "09:00",
        "end_time": "10:00",
    }
    body.update(fields)
    return client.post("/api/calendar/appointments", json=body)


def kept(client, **fields):
    response = written(client, **fields)
    assert response.status_code == 201, response.json()
    return response.json()["appointment"]


def days(client, start, end=None):
    response = client.get(f"/api/calendar/days?start={start}&end={end or start}")
    assert response.status_code == 200, response.json()
    return response.json()["days"]


def items_on(client, day):
    return days(client, day)[0]["items"]


def titles_on(client, day):
    return [item["title"] for item in items_on(client, day)]


# Writing one down
# ----------------


def test_an_appointment_comes_back_on_the_day_it_was_written_for(client, signed_in):
    made = kept(client)

    assert made["title"] == "Dentist"
    assert made["date_for"] == TUESDAY
    assert made["time_of_day"] == "09:00"
    assert made["end_time"] == "10:00"
    assert made["timezone"] == "UTC"
    assert made["role"] == "organizer"
    assert made["editable"] is True

    item = items_on(client, TUESDAY)[0]
    assert item["id"] == made["id"]
    assert item["occurrence_date"] == TUESDAY
    assert item["start"] == "09:00"
    assert item["end"] == "10:00"
    assert item["mine"] is True
    assert item["cancelled"] is False
    assert item["detached"] is False
    assert item["repeat"] is None


def test_every_day_of_the_range_comes_back_even_the_empty_ones(client, signed_in):
    kept(client)

    listed = days(client, "2026-09-14", "2026-09-16")

    assert [day["date"] for day in listed] == ["2026-09-14", "2026-09-15", "2026-09-16"]
    assert [len(day["items"]) for day in listed] == [0, 1, 0]


def test_an_all_day_appointment_is_listed_first(client, signed_in):
    kept(client, title="Dentist")
    kept(client, title="Birthday", all_day=True, time_of_day=None, end_time=None)

    assert titles_on(client, TUESDAY) == ["Birthday", "Dentist"]


def test_a_span_is_listed_on_every_day_it_covers(client, signed_in):
    kept(client, title="Trip", date_for="2026-09-14", end_date="2026-09-16")

    listed = days(client, "2026-09-14", "2026-09-16")
    assert [len(day["items"]) for day in listed] == [1, 1, 1]
    first, middle, last = (day["items"][0] for day in listed)
    assert first["continues_from_previous"] is False
    assert first["continues_to_next"] is True
    assert middle["continues_from_previous"] is True
    assert middle["continues_to_next"] is True
    assert last["continues_from_previous"] is True
    assert last["continues_to_next"] is False


def test_the_form_reads_back_what_was_stored(client, signed_in):
    made = kept(client, notes="Bring the card", location="High Street")

    read = client.get(f"/api/calendar/appointments/{made['id']}")

    assert read.status_code == 200
    assert read.json()["notes"] == "Bring the card"
    assert read.json()["location"] == "High Street"
    assert read.json()["invitees"] == []


def test_a_change_touches_only_what_was_sent(client, signed_in):
    made = kept(client, notes="Bring the card")

    response = client.patch(
        f"/api/calendar/appointments/{made['id']}", json={"title": "Hygienist"}
    )

    assert response.status_code == 200
    changed = response.json()["appointment"]
    assert changed["title"] == "Hygienist"
    assert changed["notes"] == "Bring the card"
    assert changed["time_of_day"] == "09:00"


def test_an_owner_deletes_their_own(client, signed_in):
    made = kept(client)

    assert client.delete(f"/api/calendar/appointments/{made['id']}").status_code == 204
    assert items_on(client, TUESDAY) == []


# What a type cannot settle
# -------------------------


def test_an_appointment_needs_a_title(client, signed_in):
    response = written(client, title="   ")

    assert response.status_code == 400
    assert response.json()["detail"] == "Give it a title."


def test_an_appointment_needs_a_date(client, signed_in):
    response = written(client, date_for=None)

    assert response.status_code == 400
    assert response.json()["detail"] == "Appointments need a date."


def test_a_span_cannot_end_before_it_starts(client, signed_in):
    response = written(client, date_for=TUESDAY, end_date=MONDAY)

    assert response.status_code == 400
    assert response.json()["detail"] == "The end date must be on or after the start date."


def test_a_span_is_capped_at_ninety_days(client, signed_in):
    response = written(client, date_for="2026-01-01", end_date="2026-05-01")

    assert response.status_code == 400
    assert response.json()["detail"] == "An appointment can span up to 90 days."


def test_a_timed_appointment_needs_both_times(client, signed_in):
    response = written(client, end_time=None)

    assert response.status_code == 400
    assert (
        response.json()["detail"]
        == "Appointments need a start and end time, or mark them all-day."
    )


def test_an_all_day_appointment_carries_no_times(client, signed_in):
    response = written(client, all_day=True)

    assert response.status_code == 400
    assert response.json()["detail"] == "An all-day appointment has no times."


def test_the_end_time_comes_after_the_start_time(client, signed_in):
    response = written(client, time_of_day="10:00", end_time="09:00")

    assert response.status_code == 400
    assert response.json()["detail"] == "End time must be after the start time."


def test_an_evening_that_ends_after_midnight_is_allowed(client, signed_in):
    made = kept(
        client,
        title="Film night",
        date_for=MONDAY,
        end_date=TUESDAY,
        time_of_day="22:00",
        end_time="01:00",
    )

    assert made["end_date"] == TUESDAY


def test_a_repeating_appointment_cannot_span_days(client, signed_in):
    response = written(
        client, end_date="2026-09-16", repeat={"type": "weekly", "days": [1]}
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "A repeating appointment cannot span days."


def test_a_repeating_appointment_may_be_all_day(client, signed_in):
    made = kept(
        client,
        all_day=True,
        time_of_day=None,
        end_time=None,
        repeat={"type": "weekly", "days": [1]},
    )

    assert made["all_day"] is True
    assert made["repeat"]["type"] == "weekly"


def test_a_weekly_repeat_needs_a_day(client, signed_in):
    response = written(client, repeat={"type": "weekly", "days": []})

    assert response.status_code == 400
    assert response.json()["detail"] == "Weekly repeat needs at least one day."


def test_a_monthly_repeat_needs_a_day_of_the_month(client, signed_in):
    response = written(client, repeat={"type": "monthly"})

    assert response.status_code == 400
    assert response.json()["detail"] == "Monthly repeat needs a day of the month."


def test_a_repeat_interval_is_at_least_one(client, signed_in):
    response = written(client, repeat={"type": "weekly", "days": [1], "interval": 0})

    assert response.status_code == 400
    assert response.json()["detail"] == "Repeat interval must be at least 1."


def test_a_repeat_ends_one_way_or_the_other(client, signed_in):
    response = written(
        client,
        repeat={"type": "weekly", "days": [1], "until": "2026-12-01", "count": 4},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "A repeat ends by date or after a count, not both."


def test_a_count_becomes_a_last_day(client, signed_in):
    made = kept(client, repeat={"type": "weekly", "days": [1], "count": 3})

    # The third Tuesday counting from the anchor, which is the start date.
    assert made["repeat"]["until"] == "2026-09-29"
    assert made["repeat"]["anchor"] == TUESDAY


def test_a_count_on_a_pattern_that_never_lands_is_refused(client, signed_in):
    response = written(
        client,
        date_for="2026-09-15",
        repeat={"type": "yearly", "interval": 10, "count": 500},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "That repeat ends too far out."


def test_a_repeat_starts_on_its_anchor(client, signed_in):
    made = kept(
        client,
        date_for=TUESDAY,
        repeat={"type": "weekly", "days": [1], "anchor": "2026-09-22"},
    )

    assert made["date_for"] == "2026-09-22"
    assert titles_on(client, TUESDAY) == []
    assert titles_on(client, "2026-09-22") == ["Dentist"]


def test_a_range_wider_than_forty_five_days_is_refused(client, signed_in):
    response = client.get("/api/calendar/days?start=2026-09-01&end=2026-11-01")

    assert response.status_code == 400
    assert response.json()["detail"] == "That range is too wide."


def test_a_range_that_ends_before_it_starts_is_refused(client, signed_in):
    response = client.get("/api/calendar/days?start=2026-09-15&end=2026-09-14")

    assert response.status_code == 400
    assert response.json()["detail"] == "The end date must be on or after the start date."


# Who sees it
# -----------


def test_a_calendar_member_sees_what_is_published_to_it(client, db_session, make_user, signed_in):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    shelf = shelf_for(db_session, signed_in, other)
    kept(client, calendar_ids=[shelf.id])

    sign_in(client, "other")

    item = items_on(client, TUESDAY)[0]
    assert item["title"] == "Dentist"
    assert item["mine"] is False
    assert item["role"] == "member"
    assert item["editable"] is True
    assert item["calendars"] == [{"id": shelf.id, "name": "Home", "color": "blue"}]
    # On it through the calendar, not through an invitation.
    assert item["invitation"] is None


def test_somebody_who_has_not_accepted_the_calendar_sees_nothing(
    client, db_session, make_user, signed_in
):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    shelf = shelf_for(db_session, signed_in, other, accepted=False)
    made = kept(client, calendar_ids=[shelf.id])

    sign_in(client, "other")

    assert items_on(client, TUESDAY) == []
    assert client.get(f"/api/calendar/appointments/{made['id']}").status_code == 404


def test_a_stranger_is_told_there_is_no_such_appointment(
    client, db_session, make_user, signed_in
):
    made = kept(client)
    make_user("stranger")

    sign_in(client, "stranger")

    response = client.get(f"/api/calendar/appointments/{made['id']}")
    assert response.status_code == 404
    assert response.json()["detail"] == "There is no such appointment."


def test_an_invitation_shows_nothing_until_it_is_accepted(
    client, db_session, make_user, signed_in
):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    made = kept(client, invitee_ids=[other.id])

    # The organizer was not invited to their own appointment.
    assert items_on(client, TUESDAY)[0]["invitation"] is None

    sign_in(client, "other")
    assert items_on(client, TUESDAY) == []
    assert client.get(f"/api/calendar/appointments/{made['id']}").status_code == 404

    waiting = client.get("/api/calendar/invitations").json()["meetings"]
    assert [row["appointment"]["title"] for row in waiting] == ["Dentist"]
    assert waiting[0]["from"]["display_name"] == "member"
    assert client.get("/api/calendar/badge").json()["invitations"] == 1

    response = client.post(f"/api/calendar/invitations/{waiting[0]['invite_id']}/accept")
    assert response.status_code == 200
    assert response.json()["status"] == "accepted"

    item = items_on(client, TUESDAY)[0]
    assert item["title"] == "Dentist"
    assert item["role"] == "invitee"
    assert item["editable"] is False
    assert item["invitation"] == {"id": waiting[0]["invite_id"], "status": "accepted"}
    assert client.get("/api/calendar/badge").json()["invitations"] == 0


def test_declining_an_invitation_hides_it_for_good(client, db_session, make_user, signed_in):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    kept(client, invitee_ids=[other.id])

    sign_in(client, "other")
    invite_id = client.get("/api/calendar/invitations").json()["meetings"][0]["invite_id"]
    assert client.post(f"/api/calendar/invitations/{invite_id}/decline").status_code == 200

    assert items_on(client, TUESDAY) == []
    assert client.get("/api/calendar/invitations").json()["meetings"] == []


def test_an_accepted_guest_may_still_decline(client, db_session, make_user, signed_in):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    made = kept(client, invitee_ids=[other.id])

    sign_in(client, "other")
    invite_id = client.get("/api/calendar/invitations").json()["meetings"][0]["invite_id"]
    assert client.post(f"/api/calendar/invitations/{invite_id}/accept").status_code == 200

    response = client.post(f"/api/calendar/invitations/{invite_id}/decline")
    assert response.status_code == 200
    assert response.json()["status"] == "declined"
    assert items_on(client, TUESDAY) == []

    # The organizer is told they backed out, rather than losing the name.
    sign_in(client, "member")
    listed = client.get(f"/api/calendar/appointments/{made['id']}").json()["invitees"]
    assert listed == [{"id": other.id, "display_name": "other", "status": "declined"}]


def test_the_organizer_sees_what_everybody_answered(client, db_session, make_user, signed_in):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    made = kept(client, invitee_ids=[other.id])

    listed = client.get(f"/api/calendar/appointments/{made['id']}").json()["invitees"]

    assert listed == [{"id": other.id, "display_name": "other", "status": "pending"}]


def test_a_guest_sees_the_names_and_not_the_answers(client, db_session, make_user, signed_in):
    other = make_user("other")
    third = make_user("third")
    befriend(db_session, signed_in, other)
    befriend(db_session, signed_in, third)
    made = kept(client, invitee_ids=[other.id, third.id])

    sign_in(client, "other")
    invite_id = client.get("/api/calendar/invitations").json()["meetings"][0]["invite_id"]
    client.post(f"/api/calendar/invitations/{invite_id}/accept")

    listed = client.get(f"/api/calendar/appointments/{made['id']}").json()["invitees"]
    assert listed == [
        {"id": other.id, "display_name": "other"},
        {"id": third.id, "display_name": "third"},
    ]
    assert items_on(client, TUESDAY)[0]["invitees"] == []


# Who may change it
# -----------------


def test_a_calendar_member_may_change_it(client, db_session, make_user, signed_in):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    shelf = shelf_for(db_session, signed_in, other)
    made = kept(client, calendar_ids=[shelf.id])

    sign_in(client, "other")
    response = client.patch(
        f"/api/calendar/appointments/{made['id']}", json={"title": "Hygienist"}
    )

    assert response.status_code == 200
    assert response.json()["appointment"]["title"] == "Hygienist"


def test_a_member_cannot_change_who_it_is_shared_with(
    client, db_session, make_user, signed_in
):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    shelf = shelf_for(db_session, signed_in, other)
    made = kept(client, calendar_ids=[shelf.id])

    sign_in(client, "other")
    response = client.patch(
        f"/api/calendar/appointments/{made['id']}", json={"calendar_ids": []}
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Only the owner can change that."


def test_a_member_may_take_it_off_their_own_calendar(
    client, db_session, make_user, signed_in
):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    shelf = shelf_for(db_session, signed_in, other)
    made = kept(client, calendar_ids=[shelf.id])

    sign_in(client, "other")
    response = client.delete(
        f"/api/calendar/appointments/{made['id']}/calendars/{shelf.id}"
    )

    assert response.status_code == 204
    assert items_on(client, TUESDAY) == []
    sign_in(client, "member")
    assert items_on(client, TUESDAY)[0]["calendars"] == []


def test_taking_it_off_a_calendar_it_is_not_on_is_a_refusal(
    client, db_session, make_user, signed_in
):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    shelf = shelf_for(db_session, signed_in, other)
    made = kept(client)

    response = client.delete(
        f"/api/calendar/appointments/{made['id']}/calendars/{shelf.id}"
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "It is not on that calendar."


def test_only_the_owner_deletes_it(client, db_session, make_user, signed_in):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    shelf = shelf_for(db_session, signed_in, other)
    made = kept(client, calendar_ids=[shelf.id])

    sign_in(client, "other")
    response = client.delete(f"/api/calendar/appointments/{made['id']}")

    assert response.status_code == 403
    assert response.json()["detail"] == "Only the owner can delete this appointment."


def test_an_appointment_goes_only_on_the_owners_own_calendars(
    client, db_session, make_user, signed_in
):
    other = make_user("other")
    third = make_user("third")
    shelf = shelf_for(db_session, other, third, name="Theirs")

    response = written(client, calendar_ids=[shelf.id])

    assert response.status_code == 400
    assert response.json()["detail"] == "That is not one of your calendars."


# Invitations
# -----------


def test_only_friends_may_be_asked(client, db_session, make_user, signed_in):
    stranger = make_user("stranger")

    response = written(client, invitee_ids=[stranger.id])

    assert response.status_code == 400
    assert response.json()["detail"] == "You can only invite your friends."


def test_an_empty_invitation_is_refused(client, signed_in):
    made = kept(client)

    response = client.post(
        f"/api/calendar/appointments/{made['id']}/invites",
        json={"user_ids": [signed_in.id]},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Pick friends to invite."


def test_twenty_one_guests_is_too_many(client, db_session, make_user, signed_in):
    friends = []
    for number in range(21):
        friend = make_user(f"friend{number}")
        befriend(db_session, signed_in, friend)
        friends.append(friend.id)

    response = written(client, invitee_ids=friends)

    assert response.status_code == 400
    assert response.json()["detail"] == "You can invite up to 20 people."


def test_a_guest_can_show_themselves_out(client, db_session, make_user, signed_in):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    made = kept(client, invitee_ids=[other.id])

    sign_in(client, "other")
    invite_id = client.get("/api/calendar/invitations").json()["meetings"][0]["invite_id"]
    client.post(f"/api/calendar/invitations/{invite_id}/accept")
    response = client.delete(
        f"/api/calendar/appointments/{made['id']}/invites/{other.id}"
    )

    assert response.status_code == 204
    assert items_on(client, TUESDAY) == []


def test_a_guest_cannot_uninvite_anybody_else(client, db_session, make_user, signed_in):
    other = make_user("other")
    third = make_user("third")
    befriend(db_session, signed_in, other)
    befriend(db_session, signed_in, third)
    made = kept(client, invitee_ids=[other.id, third.id])

    sign_in(client, "other")
    response = client.delete(
        f"/api/calendar/appointments/{made['id']}/invites/{third.id}"
    )

    assert response.status_code in (403, 404)


def test_more_guests_can_be_asked_afterwards(client, db_session, make_user, signed_in):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    made = kept(client)

    response = client.post(
        f"/api/calendar/appointments/{made['id']}/invites", json={"user_ids": [other.id]}
    )

    assert response.status_code == 200
    assert response.json()["invitees"] == [
        {"id": other.id, "display_name": "other", "status": "pending"}
    ]


# Shared calendars
# ----------------


def make_calendar(client, friend_id, name="Home", color="blue"):
    return client.post(
        "/api/calendar/calendars",
        json={"name": name, "color": color, "friend_id": friend_id},
    )


def test_a_calendar_starts_out_shared_with_one_friend(
    client, db_session, make_user, signed_in
):
    other = make_user("other")
    befriend(db_session, signed_in, other)

    response = make_calendar(client, other.id)

    assert response.status_code == 201
    made = response.json()
    assert made["name"] == "Home"
    assert made["color"] == "blue"
    assert made["mine_pending"] is False
    assert sorted(row["display_name"] for row in made["members"]) == ["member", "other"]
    assert [row["accepted"] for row in made["members"] if row["id"] == other.id] == [False]


def test_a_calendar_cannot_be_started_with_a_stranger(client, make_user, signed_in):
    stranger = make_user("stranger")

    response = make_calendar(client, stranger.id)

    assert response.status_code == 400
    assert response.json()["detail"] == "Pick a friend to share with."


def test_a_calendar_needs_a_name_and_a_colour(client, db_session, make_user, signed_in):
    other = make_user("other")
    befriend(db_session, signed_in, other)

    blank = make_calendar(client, other.id, name="  ")
    assert blank.status_code == 400
    assert blank.json()["detail"] == "Give it a name."

    painted = make_calendar(client, other.id, color="chartreuse")
    assert painted.status_code == 400
    assert painted.json()["detail"] == "Pick a color."


def test_a_waiting_calendar_shows_nothing_until_it_is_accepted(
    client, db_session, make_user, signed_in
):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    shelf = make_calendar(client, other.id).json()
    kept(client, calendar_ids=[shelf["id"]])

    sign_in(client, "other")
    assert items_on(client, TUESDAY) == []
    waiting = client.get("/api/calendar/invitations").json()["calendars"]
    assert waiting[0]["name"] == "Home"
    assert waiting[0]["from"]["display_name"] == "member"
    assert waiting[0]["members"] == ["member"]
    assert client.get("/api/calendar/badge").json()["invitations"] == 1

    assert client.post(f"/api/calendar/calendars/{shelf['id']}/accept").status_code == 200

    assert titles_on(client, TUESDAY) == ["Dentist"]
    assert client.get("/api/calendar/calendars").json()[0]["mine_pending"] is False


def test_declining_a_calendar_leaves_it_alone(client, db_session, make_user, signed_in):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    shelf = make_calendar(client, other.id).json()

    sign_in(client, "other")
    assert client.post(f"/api/calendar/calendars/{shelf['id']}/decline").status_code == 200

    assert client.get("/api/calendar/calendars").json() == []
    sign_in(client, "member")
    assert len(client.get("/api/calendar/calendars").json()) == 1


def test_any_member_may_rename_or_recolour_one(client, db_session, make_user, signed_in):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    shelf = shelf_for(db_session, signed_in, other)

    sign_in(client, "other")
    response = client.patch(
        f"/api/calendar/calendars/{shelf.id}", json={"name": "Ours", "color": "teal"}
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Ours"
    assert response.json()["color"] == "teal"


def test_a_member_may_ask_one_of_their_own_friends_on(
    client, db_session, make_user, signed_in
):
    other = make_user("other")
    third = make_user("third")
    befriend(db_session, signed_in, other)
    befriend(db_session, other, third)
    shelf = shelf_for(db_session, signed_in, other)

    sign_in(client, "other")
    response = client.post(
        f"/api/calendar/calendars/{shelf.id}/members", json={"user_id": third.id}
    )

    assert response.status_code == 200
    assert sorted(row["display_name"] for row in response.json()["members"]) == [
        "member",
        "other",
        "third",
    ]
    again = client.post(
        f"/api/calendar/calendars/{shelf.id}/members", json={"user_id": third.id}
    )
    assert again.status_code == 400
    assert again.json()["detail"] == "They are already on this calendar."


def test_leaving_takes_my_own_publications_with_me(
    client, db_session, make_user, signed_in
):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    shelf = shelf_for(db_session, signed_in, other)
    kept(client, calendar_ids=[shelf.id])

    response = client.delete(
        f"/api/calendar/calendars/{shelf.id}/members/{signed_in.id}"
    )

    assert response.status_code == 204
    assert db_session.scalars(select(models.AppointmentCalendar)).all() == []
    assert db_session.get(models.Calendar, shelf.id) is not None
    sign_in(client, "other")
    assert items_on(client, TUESDAY) == []


def test_the_last_member_out_takes_the_calendar_with_them(
    client, db_session, make_user, signed_in
):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    shelf = shelf_for(db_session, signed_in, other)

    sign_in(client, "other")
    client.delete(f"/api/calendar/calendars/{shelf.id}/members/{other.id}")
    sign_in(client, "member")
    client.delete(f"/api/calendar/calendars/{shelf.id}/members/{signed_in.id}")

    assert db_session.get(models.Calendar, shelf.id) is None
    assert db_session.scalars(select(models.CalendarMember)).all() == []


def test_the_one_who_started_it_may_show_somebody_out(
    client, db_session, make_user, signed_in
):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    shelf = shelf_for(db_session, signed_in, other)

    response = client.delete(f"/api/calendar/calendars/{shelf.id}/members/{other.id}")

    assert response.status_code == 204
    sign_in(client, "other")
    assert client.get("/api/calendar/calendars").json() == []


def test_nobody_else_may_show_a_member_out(client, db_session, make_user, signed_in):
    other = make_user("other")
    third = make_user("third")
    befriend(db_session, signed_in, other)
    befriend(db_session, signed_in, third)
    shelf = shelf_for(db_session, signed_in, other)
    db_session.add(
        models.CalendarMember(
            calendar_id=shelf.id,
            user_id=third.id,
            invited_by=signed_in.id,
            invited_at=now_utc(),
            accepted_at=now_utc(),
        )
    )
    db_session.commit()

    sign_in(client, "other")
    response = client.delete(f"/api/calendar/calendars/{shelf.id}/members/{third.id}")

    assert response.status_code == 403
    assert response.json()["detail"] == "Only the calendar's creator can remove a member."


def test_unfriending_takes_back_only_what_was_never_answered(
    client, db_session, make_user, signed_in
):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    kept(client, title="Waiting", invitee_ids=[other.id])
    agreed = kept(client, title="Agreed", invitee_ids=[other.id])
    make_calendar(client, other.id)

    sign_in(client, "other")
    for row in client.get("/api/calendar/invitations").json()["meetings"]:
        if row["appointment"]["title"] == "Agreed":
            client.post(f"/api/calendar/invitations/{row['invite_id']}/accept")

    sign_in(client, "member")
    assert client.delete(f"/api/feed/friends/{other.id}").status_code == 204

    left = db_session.scalars(select(models.AppointmentInvite)).all()
    assert [(row.appointment_id, row.status) for row in left] == [
        (agreed["id"], "accepted")
    ]
    assert (
        db_session.scalars(
            select(models.CalendarMember).where(models.CalendarMember.user_id == other.id)
        ).all()
        == []
    )


# One day of a series
# -------------------


def weekly(client, **fields):
    """A Tuesday repeat, landing on the 15th, the 22nd and the 29th."""
    return kept(client, repeat={"type": "weekly", "days": [1]}, **fields)


def test_a_repeat_is_listed_on_every_day_it_lands_on(client, signed_in):
    weekly(client)

    listed = days(client, "2026-09-15", "2026-09-29")

    assert [day["date"] for day in listed if day["items"]] == [
        "2026-09-15",
        "2026-09-22",
        "2026-09-29",
    ]


def test_one_day_can_be_taken_out_of_a_series(client, signed_in):
    made = weekly(client)

    response = client.delete(
        f"/api/calendar/appointments/{made['id']}/occurrence?date=2026-09-22"
    )

    assert response.status_code == 204
    assert titles_on(client, "2026-09-22") == []
    assert titles_on(client, "2026-09-29") == ["Dentist"]

    again = client.delete(
        f"/api/calendar/appointments/{made['id']}/occurrence?date=2026-09-22"
    )
    assert again.status_code == 400
    assert again.json()["detail"] == "No occurrence on that day."


def test_a_one_off_has_no_occurrence_to_take_out(client, signed_in):
    made = kept(client)

    response = client.delete(
        f"/api/calendar/appointments/{made['id']}/occurrence?date={TUESDAY}"
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "That appointment does not repeat."


def test_changing_the_pattern_drops_the_days_carved_out_of_the_old_one(client, signed_in):
    made = weekly(client)
    client.delete(f"/api/calendar/appointments/{made['id']}/occurrence?date=2026-09-22")

    response = client.patch(
        f"/api/calendar/appointments/{made['id']}",
        json={"repeat": {"type": "weekly", "days": [1, 3]}},
    )

    assert response.status_code == 200
    assert titles_on(client, "2026-09-22") == ["Dentist"]
    assert titles_on(client, "2026-09-17") == ["Dentist"]


def test_a_content_change_keeps_the_days_carved_out(client, signed_in):
    made = weekly(client)
    client.delete(f"/api/calendar/appointments/{made['id']}/occurrence?date=2026-09-22")

    client.patch(f"/api/calendar/appointments/{made['id']}", json={"title": "Hygienist"})

    assert titles_on(client, "2026-09-22") == []
    assert titles_on(client, "2026-09-29") == ["Hygienist"]


def test_one_day_can_be_moved_out_into_its_own_appointment(
    client, db_session, make_user, signed_in
):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    shelf = shelf_for(db_session, signed_in, other)
    made = weekly(client, calendar_ids=[shelf.id], invitee_ids=[other.id])

    sign_in(client, "other")
    invite_id = client.get("/api/calendar/invitations").json()["meetings"][0]["invite_id"]
    client.post(f"/api/calendar/invitations/{invite_id}/accept")
    sign_in(client, "member")

    response = client.post(
        f"/api/calendar/appointments/{made['id']}/occurrence?date=2026-09-22",
        json={
            "title": "Dentist",
            "date_for": "2026-09-22",
            "time_of_day": "11:00",
            "end_time": "12:00",
        },
    )

    assert response.status_code == 201
    copy = response.json()["appointment"]
    assert copy["id"] != made["id"]
    assert copy["detached"] is True
    assert copy["repeat"] is None
    assert [shelf_row["id"] for shelf_row in copy["calendars"]] == [shelf.id]
    assert copy["invitees"] == [
        {"id": other.id, "display_name": "other", "status": "accepted"}
    ]

    moved = items_on(client, "2026-09-22")
    assert [item["start"] for item in moved] == ["11:00"]
    assert titles_on(client, "2026-09-29") == ["Dentist"]


def test_a_day_moved_out_of_a_series_does_not_repeat(client, signed_in):
    made = weekly(client)

    response = client.post(
        f"/api/calendar/appointments/{made['id']}/occurrence?date=2026-09-22",
        json={
            "title": "Dentist",
            "date_for": "2026-09-22",
            "time_of_day": "11:00",
            "end_time": "12:00",
            "repeat": {"type": "weekly", "days": [1]},
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "A detached appointment doesn't repeat."


def test_one_day_of_a_series_can_be_called_off_and_put_back(client, signed_in):
    made = weekly(client)

    response = client.post(
        f"/api/calendar/appointments/{made['id']}/cancel?date=2026-09-22"
    )

    assert response.status_code == 200
    assert response.json() == {"cancelled": True, "date": "2026-09-22"}
    assert items_on(client, "2026-09-22")[0]["cancelled"] is True
    assert items_on(client, "2026-09-29")[0]["cancelled"] is False

    back = client.delete(f"/api/calendar/appointments/{made['id']}/cancel?date=2026-09-22")
    assert back.status_code == 200
    assert items_on(client, "2026-09-22")[0]["cancelled"] is False


def test_a_one_off_can_be_called_off(client, signed_in):
    made = kept(client)

    client.post(f"/api/calendar/appointments/{made['id']}/cancel?date={TUESDAY}")

    assert items_on(client, TUESDAY)[0]["cancelled"] is True


def test_a_day_a_series_does_not_land_on_cannot_be_called_off(client, signed_in):
    made = weekly(client)

    response = client.post(
        f"/api/calendar/appointments/{made['id']}/cancel?date=2026-09-23"
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "No occurrence on that day."


# What a proposed time would run into
# ----------------------------------


def asking(client, **fields):
    body = {"date_for": TUESDAY, "time_of_day": "09:30", "end_time": "10:30"}
    body.update(fields)
    response = client.post("/api/calendar/conflicts", json=body)
    assert response.status_code == 200, response.json()
    return response.json()


def test_a_proposal_says_what_of_mine_it_runs_into(client, signed_in):
    made = kept(client)

    answer = asking(client)

    assert answer["mine"] == [
        {
            "appointment_id": made["id"],
            "date": TUESDAY,
            "start": "09:00",
            "end": "10:00",
            "title": "Dentist",
            "who": "You",
            "calendar": None,
        }
    ]


def test_a_proposal_that_misses_everything_says_so(client, signed_in):
    kept(client)

    assert asking(client, time_of_day="11:00", end_time="12:00")["mine"] == []


def test_an_appointment_never_clashes_with_itself(client, signed_in):
    made = kept(client)

    assert asking(client, exclude_id=made["id"])["mine"] == []


def test_an_all_day_entry_is_never_a_clash(client, signed_in):
    kept(client, all_day=True, time_of_day=None, end_time=None)

    assert asking(client)["mine"] == []


def test_an_all_day_proposal_never_clashes(client, signed_in):
    kept(client)

    answer = asking(client, all_day=True, time_of_day=None, end_time=None)

    assert answer["mine"] == []


def test_something_called_off_is_not_a_clash(client, signed_in):
    made = kept(client)
    client.post(f"/api/calendar/appointments/{made['id']}/cancel?date={TUESDAY}")

    assert asking(client)["mine"] == []


def test_a_guests_bucket_holds_what_the_asker_can_already_see(
    client, db_session, make_user, signed_in
):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    shelf = shelf_for(db_session, signed_in, other)
    sign_in(client, "other")
    theirs = kept(client, title="Standup", calendar_ids=[shelf.id])
    sign_in(client, "member")

    answer = asking(client, invitee_ids=[other.id])

    assert [hit["appointment_id"] for hit in answer["mine"]] == [theirs["id"]]
    assert answer["invitees"][str(other.id)] == [
        {
            "appointment_id": theirs["id"],
            "date": TUESDAY,
            "start": "09:00",
            "end": "10:00",
            "title": "Standup",
            "who": "other",
            "calendar": "Home",
        }
    ]


def test_a_guest_with_nothing_the_asker_can_see_has_an_empty_bucket(
    client, db_session, make_user, signed_in
):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    sign_in(client, "other")
    kept(client, title="Private")
    sign_in(client, "member")

    answer = asking(client, invitee_ids=[other.id])

    assert answer["mine"] == []
    assert answer["invitees"][str(other.id)] == []


def test_a_repeating_proposal_is_checked_over_its_first_weeks(client, signed_in):
    made = kept(client, date_for="2026-09-29")

    answer = asking(
        client, date_for=TUESDAY, repeat={"type": "weekly", "days": [1]}
    )

    assert [hit["appointment_id"] for hit in answer["mine"]] == [made["id"]]
    assert answer["mine"][0]["date"] == "2026-09-29"


def test_a_proposal_that_makes_no_sense_is_refused(client, signed_in):
    response = client.post(
        "/api/calendar/conflicts",
        json={"date_for": TUESDAY, "time_of_day": "10:00", "end_time": "09:00"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "End time must be after the start time."


# Zones
# -----


def two_zones(db_session, make_user):
    """An owner in Phoenix, a reader in New York, and a calendar between them."""
    phoenix = make_user("phoenix", timezone="America/Phoenix")
    york = make_user("york", timezone="America/New_York")
    befriend(db_session, phoenix, york)
    return phoenix, york, shelf_for(db_session, phoenix, york)


def test_a_time_stays_the_moment_it_was_arranged_for(client, db_session, make_user):
    _, _, shelf = two_zones(db_session, make_user)
    sign_in(client, "phoenix")
    kept(
        client,
        title="Standup",
        date_for="2026-10-28",
        time_of_day="09:00",
        end_time="09:30",
        calendar_ids=[shelf.id],
        repeat={"type": "weekly", "days": [2]},
    )

    sign_in(client, "york")
    before = items_on(client, "2026-10-28")[0]
    after = items_on(client, "2026-11-04")[0]

    # Phoenix keeps one clock all year and New York does not, so the same
    # nine o'clock is read an hour earlier once the clocks go back.
    assert (before["start"], before["end"]) == ("12:00", "12:30")
    assert (after["start"], after["end"]) == ("11:00", "11:30")
    assert before["timezone"] == "America/Phoenix"
    assert before["occurrence_date"] == "2026-10-28"


def test_an_overnight_span_lands_on_the_reader_own_days(client, db_session, make_user):
    _, _, shelf = two_zones(db_session, make_user)
    sign_in(client, "phoenix")
    kept(
        client,
        title="Film night",
        date_for="2026-11-02",
        end_date="2026-11-03",
        time_of_day="22:00",
        end_time="02:00",
        calendar_ids=[shelf.id],
    )

    own = items_on(client, "2026-11-02")[0]
    assert own["start"] == "22:00"
    assert own["continues_to_next"] is True

    sign_in(client, "york")
    assert titles_on(client, "2026-11-02") == []
    read = items_on(client, "2026-11-03")[0]
    assert (read["start"], read["end"]) == ("00:00", "04:00")
    assert read["occurrence_date"] == "2026-11-02"
    assert read["continues_from_previous"] is False
    assert read["continues_to_next"] is False


def test_an_all_day_appointment_is_the_same_day_in_every_zone(
    client, db_session, make_user
):
    _, _, shelf = two_zones(db_session, make_user)
    sign_in(client, "phoenix")
    kept(
        client,
        title="Birthday",
        date_for="2026-11-02",
        all_day=True,
        time_of_day=None,
        end_time=None,
        calendar_ids=[shelf.id],
    )

    sign_in(client, "york")

    assert titles_on(client, "2026-11-02") == ["Birthday"]
    assert items_on(client, "2026-11-02")[0]["start"] is None


# Waiting a few minutes
# ---------------------


def test_the_hundred_and_twenty_first_appointment_in_an_hour_waits(client, signed_in):
    for _ in range(120):
        throttle.appointments_limiter.hit(str(signed_in.id))

    response = written(client)

    assert response.status_code == 429
    assert response.json()["detail"] == throttle.TOO_MANY


def test_the_sixty_first_invitation_in_an_hour_waits(
    client, db_session, make_user, signed_in
):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    for _ in range(60):
        throttle.calendar_invites_limiter.hit(str(signed_in.id))

    response = make_calendar(client, other.id)

    assert response.status_code == 429
    assert response.json()["detail"] == throttle.TOO_MANY


def test_a_guest_may_answer_and_leave_and_nothing_else(
    client, db_session, make_user, signed_in
):
    other = make_user("other")
    befriend(db_session, signed_in, other)
    made = weekly(client, invitee_ids=[other.id])

    sign_in(client, "other")
    invite_id = client.get("/api/calendar/invitations").json()["meetings"][0]["invite_id"]
    client.post(f"/api/calendar/invitations/{invite_id}/accept")

    changed = client.patch(
        f"/api/calendar/appointments/{made['id']}", json={"title": "Mine now"}
    )
    assert changed.status_code == 403
    assert changed.json()["detail"] == "Only the owner or a member of its calendars can change this."
    assert (
        client.delete(
            f"/api/calendar/appointments/{made['id']}/occurrence?date=2026-09-22"
        ).status_code
        == 403
    )
    assert (
        client.post(f"/api/calendar/appointments/{made['id']}/cancel?date=2026-09-22").status_code
        == 403
    )


def test_a_bucket_carries_five_clashes_at_the_most(client, signed_in):
    for hour in range(9, 16):
        kept(
            client,
            title=f"Call {hour}",
            time_of_day=f"{hour:02d}:00",
            end_time=f"{hour:02d}:30",
        )

    answer = asking(client, time_of_day="09:00", end_time="16:00")

    assert [hit["title"] for hit in answer["mine"]] == [
        "Call 9",
        "Call 10",
        "Call 11",
        "Call 12",
        "Call 13",
    ]
