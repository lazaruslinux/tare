"""Marking a day complete, and the lock that comes with it.

The mark is one row and the lock is one helper, so the cases worth writing are
the ones that prove every way of writing onto a day goes through it: a food, a
meal, a workout, a weigh-in, and taking any of them back off again.
"""

import datetime as dt

import pytest

from app.routers.diary import DAY_COMPLETE, FUTURE_DAY

TODAY = dt.datetime.now(dt.timezone.utc).date()
YESTERDAY = TODAY - dt.timedelta(days=1)


def iso(day):
    return day.isoformat()


@pytest.fixture()
def bread(client, signed_in):
    return client.post(
        "/api/foods",
        json={
            "name": "Sourdough",
            "base_unit": "g",
            "calories": 260,
            "protein_g": 9,
            "carbs_g": 48,
            "fat_g": 2,
        },
    ).json()


def complete(client, day=TODAY):
    return client.put("/api/diary/complete", json={"date": iso(day)})


def log(client, food, day=TODAY):
    return client.post(
        "/api/diary",
        json={"date": iso(day), "slot": "breakfast", "food_id": food["id"], "amount": 50, "unit": "g"},
    )


def test_completing_a_day_answers_with_the_stamp_and_asking_twice_is_the_same(
    client, signed_in
):
    first = complete(client)
    assert first.status_code == 200
    assert first.json()["date"] == iso(TODAY)
    stamp = first.json()["completed_at"]
    assert stamp is not None

    again = complete(client)
    assert again.status_code == 200
    # The same row, not a second one, and the moment it was first said.
    assert again.json()["completed_at"] == stamp

    read = client.get("/api/diary/day", params={"date": iso(TODAY)}).json()
    assert read["completed"] is True
    assert read["completed_at"] == stamp


def test_a_day_that_has_not_happened_cannot_be_finished(client, signed_in):
    ahead = client.put("/api/diary/complete", json={"date": iso(TODAY + dt.timedelta(days=1))})
    assert ahead.status_code == 400
    assert ahead.json() == {"detail": FUTURE_DAY}


def test_unlocking_is_idempotent_and_takes_the_mark_off(client, signed_in):
    complete(client)
    assert client.delete(f"/api/diary/complete/{iso(TODAY)}").status_code == 204
    assert client.delete(f"/api/diary/complete/{iso(TODAY)}").status_code == 204
    assert client.get("/api/diary/day", params={"date": iso(TODAY)}).json()["completed"] is False


def test_a_run_of_days_says_which_of_them_are_complete(client, signed_in):
    complete(client, YESTERDAY)
    days = client.get("/api/diary/days", params={"days": 7}).json()["days"]
    marked = {row["date"]: row["completed"] for row in days}
    assert marked[iso(YESTERDAY)] is True
    assert marked[iso(TODAY)] is False


def test_a_completed_day_refuses_every_way_of_logging_food(client, bread):
    logged = log(client, bread)
    assert logged.status_code == 201
    entry = logged.json()["id"]
    complete(client)

    blocked = log(client, bread)
    assert blocked.status_code == 409
    assert blocked.json() == {"detail": DAY_COMPLETE}

    moved = client.patch(f"/api/diary/{entry}", json={"amount": 80})
    assert moved.status_code == 409
    assert moved.json() == {"detail": DAY_COMPLETE}

    gone = client.delete(f"/api/diary/{entry}")
    assert gone.status_code == 409

    # Unlocked, the same three requests are ordinary again.
    assert client.delete(f"/api/diary/complete/{iso(TODAY)}").status_code == 204
    assert log(client, bread).status_code == 201
    assert client.patch(f"/api/diary/{entry}", json={"amount": 80}).status_code == 200
    assert client.delete(f"/api/diary/{entry}").status_code == 204


def test_an_entry_cannot_be_moved_onto_a_completed_day(client, bread):
    entry = log(client, bread, YESTERDAY).json()["id"]
    complete(client, TODAY)
    moved = client.patch(f"/api/diary/{entry}", json={"date": iso(TODAY)})
    assert moved.status_code == 409
    assert moved.json() == {"detail": DAY_COMPLETE}


def test_a_completed_day_refuses_a_meal(client, bread):
    meal = client.post(
        "/api/meals",
        json={
            "name": "Toast",
            "items": [{"food_id": bread["id"], "amount": 50, "unit": "g"}],
        },
    ).json()
    complete(client)
    blocked = client.post(
        f"/api/meals/{meal['id']}/log", json={"date": iso(TODAY), "slot": "breakfast"}
    )
    assert blocked.status_code == 409
    assert blocked.json() == {"detail": DAY_COMPLETE}


def test_a_completed_day_refuses_exercise_and_takes_it_again_after_unlocking(
    client, signed_in
):
    body = {"date_for": iso(TODAY), "activity": "walking", "effort": "moderate", "minutes": 30}
    first = client.post("/api/health/exercise", json=body)
    assert first.status_code == 201
    entry = first.json()["id"]
    complete(client)

    blocked = client.post("/api/health/exercise", json=body)
    assert blocked.status_code == 409
    assert blocked.json() == {"detail": DAY_COMPLETE}
    assert client.delete(f"/api/health/exercise/{entry}").status_code == 409

    assert client.delete(f"/api/diary/complete/{iso(TODAY)}").status_code == 204
    assert client.post("/api/health/exercise", json=body).status_code == 201
    assert client.delete(f"/api/health/exercise/{entry}").status_code == 204


def test_a_completed_day_refuses_a_weigh_in(client, signed_in):
    weight = {"weight_kg": 82.0}
    assert client.put(f"/api/health/measurements/{iso(TODAY)}", json=weight).status_code == 200
    complete(client)

    blocked = client.put(f"/api/health/measurements/{iso(TODAY)}", json=weight)
    assert blocked.status_code == 409
    assert blocked.json() == {"detail": DAY_COMPLETE}
    assert client.delete(f"/api/health/measurements/{iso(TODAY)}").status_code == 409

    assert client.delete(f"/api/diary/complete/{iso(TODAY)}").status_code == 204
    assert client.delete(f"/api/health/measurements/{iso(TODAY)}").status_code == 204


def test_one_members_mark_leaves_another_members_day_alone(client, make_user, signed_in):
    from tests.conftest import PASSWORD

    make_user("other")
    complete(client)
    client.post("/api/auth/login", json={"username": "other", "password": PASSWORD})
    read = client.get("/api/diary/day", params={"date": iso(TODAY)}).json()
    assert read["completed"] is False
