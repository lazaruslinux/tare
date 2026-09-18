"""The switches: forgiving on the way out, strict on the way in."""

import pytest

from app import notify_prefs
from app.notify_prefs import BAD_NOTIFY


def test_a_fresh_account_is_told_everything_at_the_usual_hours():
    assert notify_prefs.default() == {
        "morning": {"on": True, "time": "08:00"},
        "evening": {"on": True, "time": "20:00"},
        "weekly": {"on": True},
        "weigh_in": {"on": True, "weekday": 0},
        "reminders": {"on": True, "minutes": 30},
        "calendar": True,
    }


def test_nothing_stored_reads_back_as_the_default():
    assert notify_prefs.normalize({}) == notify_prefs.default()
    assert notify_prefs.normalize(None) == notify_prefs.default()
    assert notify_prefs.normalize("morning") == notify_prefs.default()


def test_what_is_stored_survives_and_only_the_rest_is_filled_in():
    kept = notify_prefs.normalize({"morning": {"on": False, "time": "06:30"}})
    assert kept["morning"] == {"on": False, "time": "06:30"}
    assert kept["evening"] == {"on": True, "time": "20:00"}
    assert kept["calendar"] is True


def test_a_time_that_is_not_a_time_falls_back_to_the_hour_tare_picked():
    assert notify_prefs.normalize({"evening": {"on": True, "time": "8pm"}})["evening"] == {
        "on": True,
        "time": "20:00",
    }
    assert notify_prefs.normalize({"morning": {"time": "24:00"}})["morning"]["time"] == "08:00"


def test_a_weekday_out_of_the_week_falls_back_to_monday():
    assert notify_prefs.normalize({"weigh_in": {"on": True, "weekday": 9}})["weigh_in"] == {
        "on": True,
        "weekday": 0,
    }
    # True is an int in Python and is not a weekday anybody chose.
    assert notify_prefs.normalize({"weigh_in": {"weekday": True}})["weigh_in"]["weekday"] == 0


def test_a_junk_switch_reads_back_as_a_bool():
    prefs = notify_prefs.normalize({"calendar": "yes", "weekly": {"on": 0}})
    assert prefs["calendar"] is True
    assert prefs["weekly"]["on"] is False


def test_a_lead_time_nobody_offers_falls_back_to_half_an_hour():
    assert notify_prefs.normalize({"reminders": {"on": True, "minutes": 20}})[
        "reminders"
    ] == {"on": True, "minutes": 30}
    assert notify_prefs.normalize({"reminders": {"minutes": 15}})["reminders"] == {
        "on": True,
        "minutes": 15,
    }
    # True is an int in Python and is not a lead time anybody chose.
    assert (
        notify_prefs.normalize({"reminders": {"minutes": True}})["reminders"]["minutes"]
        == 30
    )


def test_a_switch_that_is_gone_is_dropped_rather_than_carried():
    """An account last saved when invitations had a switch of its own reads
    back under the shape that folded it into the calendar."""
    stored = notify_prefs.normalize({"calendar": True, "invitations": False})
    assert "invitations" not in stored
    assert set(stored) == set(notify_prefs.KEYS)
    # And it cannot be sent again.
    refuses({**notify_prefs.default(), "invitations": True})


def refuses(raw):
    with pytest.raises(ValueError) as raised:
        notify_prefs.checked(raw)
    assert str(raised.value) == BAD_NOTIFY


def test_the_whole_answer_is_saved_or_none_of_it_is():
    notify_prefs.checked(notify_prefs.default())
    refuses({**notify_prefs.default(), "extra": True})
    refuses({key: value for key, value in notify_prefs.default().items() if key != "calendar"})
    refuses("morning")


def test_a_half_written_slot_is_refused():
    refuses({**notify_prefs.default(), "morning": {"on": True}})
    refuses({**notify_prefs.default(), "morning": {"on": True, "time": "8:00"}})
    refuses({**notify_prefs.default(), "evening": {"on": "yes", "time": "20:00"}})
    refuses({**notify_prefs.default(), "weigh_in": {"on": True, "weekday": True}})
    refuses({**notify_prefs.default(), "weigh_in": {"on": True, "weekday": 7}})
    refuses({**notify_prefs.default(), "calendar": "yes"})
    refuses({**notify_prefs.default(), "weekly": {"on": True, "time": "08:00"}})
    refuses({**notify_prefs.default(), "weekly": True})
    refuses({**notify_prefs.default(), "reminders": {"on": True}})
    refuses({**notify_prefs.default(), "reminders": {"on": True, "minutes": 20}})
    refuses({**notify_prefs.default(), "reminders": {"on": True, "minutes": True}})
    refuses({**notify_prefs.default(), "reminders": {"on": True, "minutes": "30"}})


def test_what_passes_comes_back_normalized():
    saved = notify_prefs.checked(
        {
            "morning": {"on": False, "time": "07:15"},
            "evening": {"on": True, "time": "19:45"},
            "weekly": {"on": False},
            "weigh_in": {"on": True, "weekday": 6},
            "reminders": {"on": True, "minutes": 15},
            "calendar": False,
        }
    )
    assert saved["morning"] == {"on": False, "time": "07:15"}
    assert saved["weekly"] == {"on": False}
    assert saved["weigh_in"] == {"on": True, "weekday": 6}
    assert saved["reminders"] == {"on": True, "minutes": 15}
    assert saved["calendar"] is False
