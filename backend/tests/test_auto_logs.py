"""A food that logs itself into the same meal every day.

The whole of it turns on one rule: a day is filled in once. Every case here is
a way of asking whether that held, including the two ways it would be most
annoying if it did not, which are a day read twice and an entry somebody threw
away on purpose.
"""

import datetime as dt

import pytest

from app import models
from app.routers.diary import AUTO_LOG_CLASH, BAD_SLOT, MISSING_AUTO_LOG
from app.routers.foods import MISSING_FOOD
from tests.conftest import PASSWORD

TODAY = dt.datetime.now(dt.timezone.utc).date()


def iso(day):
    return day.isoformat()


@pytest.fixture()
def oats(client, signed_in):
    """Weighed, with a serving that is not a round hundred."""
    return client.post(
        "/api/foods",
        json={
            "name": "Porridge oats",
            "base_unit": "g",
            "calories": 379,
            "protein_g": 13.2,
            "carbs_g": 67.7,
            "fat_g": 6.5,
            "servings": [{"name": "1 scoop", "amount": 40, "unit": "g", "position": 0}],
        },
    ).json()


def set_auto(client, food, *, amount=50, unit="g", slot="breakfast"):
    return client.post(
        "/api/diary/auto-logs",
        json={"food_id": food["id"], "amount": amount, "unit": unit, "slot": slot},
    )


def day(client, when=None):
    return client.get("/api/diary/day", params={"date": iso(when or TODAY)}).json()


def entries(read, slot="breakfast"):
    return read["slots"][slot]["entries"]


def backdate(db_session, auto_log_id, when):
    """Move a standing auto-log's first day, which is the only way a case can
    have one that has been running for a week."""
    row = db_session.get(models.AutoLog, auto_log_id)
    row.started_on = when
    db_session.commit()


def test_a_new_auto_log_fills_today_once_however_often_the_day_is_read(
    client, signed_in, oats
):
    created = set_auto(client, oats)
    assert created.status_code == 201
    assert created.json()["name"] == "Porridge oats"
    assert created.json()["slot"] == "breakfast"

    first = entries(day(client))
    assert len(first) == 1
    assert first[0]["name"] == "Porridge oats"
    assert first[0]["auto_log_id"] == created.json()["id"]

    # The day read again is the same day, not a second breakfast.
    assert len(entries(day(client))) == 1


def test_an_entry_deleted_on_one_day_does_not_come_back_for_that_day(
    client, signed_in, oats
):
    set_auto(client, oats)
    written = entries(day(client))[0]

    assert client.delete(f"/api/diary/{written['id']}").status_code == 204
    assert entries(day(client)) == []


def test_a_completed_day_receives_nothing(client, signed_in, oats):
    assert client.put("/api/diary/complete", json={"date": iso(TODAY)}).status_code == 200
    set_auto(client, oats)
    assert entries(day(client)) == []

    # And the day it is opened again is the day it is owed.
    assert client.delete(f"/api/diary/complete/{iso(TODAY)}").status_code == 204
    assert len(entries(day(client))) == 1


def test_a_day_that_has_not_happened_is_never_filled(client, signed_in, oats):
    set_auto(client, oats)
    tomorrow = day(client, TODAY + dt.timedelta(days=1))
    assert entries(tomorrow) == []


def test_a_run_of_days_fills_every_day_since_it_started(
    client, signed_in, oats, db_session
):
    created = set_auto(client, oats)
    started = TODAY - dt.timedelta(days=3)
    backdate(db_session, created.json()["id"], started)

    run = client.get("/api/diary/days", params={"days": 7}).json()["days"]
    logged = [row for row in run if row["logged"]]
    assert [row["date"] for row in logged] == [
        iso(started + dt.timedelta(days=step)) for step in range(4)
    ]
    # The day before it started is still an empty day.
    assert entries(day(client, started - dt.timedelta(days=1))) == []


def test_a_second_auto_log_for_the_same_food_and_meal_is_refused(client, signed_in, oats):
    assert set_auto(client, oats).status_code == 201
    clash = set_auto(client, oats)
    assert clash.status_code == 409
    assert clash.json()["detail"] == AUTO_LOG_CLASH.format(slot="breakfast")
    # Another meal is another instruction, and that one is allowed.
    assert set_auto(client, oats, slot="dinner").status_code == 201


def test_stopping_it_leaves_today_and_writes_no_more_days(
    client, signed_in, oats, db_session
):
    created = set_auto(client, oats).json()
    written = entries(day(client))[0]

    assert client.delete(f"/api/diary/auto-logs/{created['id']}").status_code == 204
    # What it already wrote was eaten. It stays.
    assert [row["id"] for row in entries(day(client))] == [written["id"]]
    # And nothing is owed tomorrow, which is read as the next day arriving.
    assert client.get("/api/diary/auto-logs").json() == []


def test_the_numbers_match_a_manual_log_of_the_same_amount(client, signed_in, oats):
    manual = client.post(
        "/api/diary",
        json={
            "date": iso(TODAY),
            "slot": "lunch",
            "food_id": oats["id"],
            "amount": 1,
            "unit": f"serving:{oats['servings'][0]['id']}",
        },
    ).json()

    set_auto(client, oats, amount=1, unit=f"serving:{oats['servings'][0]['id']}")
    written = entries(day(client))[0]

    for field in ("calories", "protein_g", "carbs_g", "fat_g"):
        assert written[field] == pytest.approx(manual[field])
    assert written["serving_label"] == "1 scoop"
    assert written["unit"] == "serving"


def test_setting_one_up_after_eating_it_today_does_not_log_it_twice(
    client, signed_in, oats
):
    client.post(
        "/api/diary",
        json={
            "date": iso(TODAY),
            "slot": "breakfast",
            "food_id": oats["id"],
            "amount": 50,
            "unit": "g",
        },
    )
    set_auto(client, oats)
    assert len(entries(day(client))) == 1


def test_the_list_reads_what_was_set_and_a_change_lands_on_it(client, signed_in, oats):
    created = set_auto(client, oats).json()
    listed = client.get("/api/diary/auto-logs").json()
    assert len(listed) == 1
    assert listed[0]["amount"] == 50
    assert listed[0]["unit"] == "g"
    assert listed[0]["serving_label"] is None

    changed = client.patch(
        f"/api/diary/auto-logs/{created['id']}", json={"amount": 80, "slot": "dinner"}
    )
    assert changed.status_code == 200
    assert changed.json()["amount"] == 80
    assert changed.json()["slot"] == "dinner"


def test_a_manual_entry_carries_no_auto_log_and_a_bad_meal_is_refused(
    client, signed_in, oats
):
    manual = client.post(
        "/api/diary",
        json={
            "date": iso(TODAY),
            "slot": "snack",
            "food_id": oats["id"],
            "amount": 20,
            "unit": "g",
        },
    ).json()
    assert manual["auto_log_id"] is None

    refused = set_auto(client, oats, slot="elevenses")
    assert refused.status_code == 400
    assert refused.json()["detail"] == BAD_SLOT


def test_somebody_elses_auto_log_and_food_are_both_absent(
    client, signed_in, oats, make_user
):
    mine = set_auto(client, oats).json()
    make_user("other")
    assert (
        client.post("/api/auth/login", json={"username": "other", "password": PASSWORD})
    ).status_code == 200

    assert client.get("/api/diary/auto-logs").json() == []
    missing = client.patch(f"/api/diary/auto-logs/{mine['id']}", json={"amount": 10})
    assert missing.status_code == 404
    assert missing.json()["detail"] == MISSING_AUTO_LOG
    assert client.delete(f"/api/diary/auto-logs/{mine['id']}").status_code == 404

    hidden = client.post(
        "/api/diary/auto-logs",
        json={"food_id": oats["id"], "amount": 10, "unit": "g", "slot": "lunch"},
    )
    assert hidden.status_code == 404
    assert hidden.json()["detail"] == MISSING_FOOD
