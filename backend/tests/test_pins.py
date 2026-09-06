"""Pins, and the list of what to offer before anybody searches."""

import pytest

from app import models
from app.routers.foods import MISSING_FOOD
from tests.conftest import PASSWORD

PANEL = {"calories": 165, "protein_g": 31, "carbs_g": 0, "fat_g": 3.6}


def sign_in(client, username):
    response = client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200


@pytest.fixture()
def make_food(client, signed_in):
    def build(name):
        made = client.post("/api/foods", json={"name": name, "base_unit": "g", **PANEL})
        assert made.status_code == 201
        return made.json()

    return build


def log(client, **body):
    sent = {"date": "2026-09-01", "slot": "breakfast"}
    sent.update(body)
    response = client.post("/api/diary", json=sent)
    assert response.status_code == 201
    return response.json()


def test_a_pin_is_the_same_however_many_times_it_is_made(client, db_session, make_food):
    food = make_food("Rolled oats")
    assert client.post(f"/api/foods/{food['id']}/pin").status_code == 204
    assert client.post(f"/api/foods/{food['id']}/pin").status_code == 204
    assert db_session.query(models.SavedFood).count() == 1

    assert client.delete(f"/api/foods/{food['id']}/pin").status_code == 204
    assert client.delete(f"/api/foods/{food['id']}/pin").status_code == 204
    assert db_session.query(models.SavedFood).count() == 0


def test_the_food_itself_says_whether_it_is_kept(client, make_food):
    food = make_food("Rolled oats")
    assert client.get(f"/api/foods/{food['id']}").json()["pinned"] is False
    client.post(f"/api/foods/{food['id']}/pin")
    assert client.get(f"/api/foods/{food['id']}").json()["pinned"] is True


def test_the_repeat_list_is_the_pinned_first_and_then_the_lately_eaten(client, make_food):
    oats = make_food("Rolled oats")
    yoghurt = make_food("Greek yoghurt")
    bread = make_food("Rye bread")

    client.post(f"/api/foods/{oats['id']}/pin")
    client.post(f"/api/foods/{yoghurt['id']}/pin")
    # Eaten after both pins were made, and the oats eaten last of all: a pin
    # outranks that, and a food is never offered twice.
    log(client, food_id=bread["id"], amount=100, unit="g")
    log(client, food_id=oats["id"], amount=100, unit="g")

    rows = client.get("/api/foods/repeat").json()
    assert [row["name"] for row in rows] == ["Greek yoghurt", "Rolled oats", "Rye bread"]
    assert [row["pinned"] for row in rows] == [True, True, False]


def test_a_food_eaten_every_day_is_one_row_and_a_quick_add_is_none(client, make_food):
    oats = make_food("Rolled oats")
    for date in ("2026-08-30", "2026-08-31", "2026-09-01"):
        log(client, date=date, food_id=oats["id"], amount=100, unit="g")
    log(client, name="Flat white", calories=120)

    assert [row["name"] for row in client.get("/api/foods/repeat").json()] == ["Rolled oats"]


def test_the_lately_eaten_part_stops_at_ten(client, make_food):
    for n in range(12):
        log(client, food_id=make_food(f"Bean number {n}")["id"], amount=100, unit="g")

    rows = client.get("/api/foods/repeat").json()
    assert len(rows) == 10
    assert rows[0]["name"] == "Bean number 11"


def test_a_pinned_food_still_counts_beside_ten_lately_eaten(client, make_food):
    kept = make_food("Rolled oats")
    client.post(f"/api/foods/{kept['id']}/pin")
    for n in range(12):
        log(client, food_id=make_food(f"Bean number {n}")["id"], amount=100, unit="g")

    rows = client.get("/api/foods/repeat").json()
    assert len(rows) == 11
    assert rows[0]["name"] == "Rolled oats"


def test_deleting_a_food_takes_its_pin_with_it(client, db_session, make_food):
    food = make_food("Rolled oats")
    client.post(f"/api/foods/{food['id']}/pin")
    assert client.delete(f"/api/foods/{food['id']}").status_code == 204

    assert client.get("/api/foods/repeat").json() == []
    assert db_session.query(models.SavedFood).count() == 0


def test_a_food_that_is_not_visible_cannot_be_pinned(client, make_user, make_food):
    food = make_food("Rolled oats")
    make_user("stranger")
    sign_in(client, "stranger")

    refused = client.post(f"/api/foods/{food['id']}/pin")
    absent = client.post("/api/foods/999999/pin")
    assert refused.status_code == absent.status_code == 404
    assert refused.json() == absent.json() == {"detail": MISSING_FOOD}
    assert client.delete(f"/api/foods/{food['id']}/pin").status_code == 404
    assert client.get("/api/foods/repeat").json() == []


def test_pins_need_a_session(client):
    assert client.get("/api/foods/repeat").status_code == 401
    assert client.post("/api/foods/1/pin").status_code == 401
    assert client.delete("/api/foods/1/pin").status_code == 401


def test_a_food_taken_off_repeat_stays_off_even_when_eaten_again(client, db_session, make_food):
    oats = make_food("Rolled oats")
    log(client, food_id=oats["id"], amount=40, unit="g")
    assert [row["id"] for row in client.get("/api/foods/repeat").json()] == [oats["id"]]

    assert client.delete(f"/api/foods/{oats['id']}/repeat").status_code == 204
    assert client.delete(f"/api/foods/{oats['id']}/repeat").status_code == 204
    assert db_session.query(models.RepeatHidden).count() == 1
    assert client.get("/api/foods/repeat").json() == []

    log(client, food_id=oats["id"], amount=40, unit="g", date="2026-09-02")
    assert client.get("/api/foods/repeat").json() == []


def test_a_food_put_back_on_repeat_shows_again_once_eaten(client, db_session, make_food):
    oats = make_food("Rolled oats")
    log(client, food_id=oats["id"], amount=40, unit="g")
    client.delete(f"/api/foods/{oats['id']}/repeat")

    assert client.post(f"/api/foods/{oats['id']}/repeat").status_code == 204
    assert client.post(f"/api/foods/{oats['id']}/repeat").status_code == 204
    assert db_session.query(models.RepeatHidden).count() == 0
    assert [row["id"] for row in client.get("/api/foods/repeat").json()] == [oats["id"]]


def test_pinning_brings_a_hidden_food_back(client, db_session, make_food):
    oats = make_food("Rolled oats")
    log(client, food_id=oats["id"], amount=40, unit="g")
    client.delete(f"/api/foods/{oats['id']}/repeat")

    assert client.post(f"/api/foods/{oats['id']}/pin").status_code == 204
    assert db_session.query(models.RepeatHidden).count() == 0
    rows = client.get("/api/foods/repeat").json()
    assert [(row["id"], row["pinned"]) for row in rows] == [(oats["id"], True)]


def test_a_food_that_is_not_visible_cannot_be_taken_off_repeat(client, make_user, make_food):
    food = make_food("Rolled oats")
    make_user("stranger")
    sign_in(client, "stranger")

    refused = client.delete(f"/api/foods/{food['id']}/repeat")
    absent = client.post("/api/foods/999999/pin")
    assert refused.status_code == absent.status_code == 404
    assert refused.json() == absent.json() == {"detail": MISSING_FOOD}
    assert client.delete(f"/api/foods/{food['id']}/pin").status_code == 404
    assert client.get("/api/foods/repeat").json() == []


def test_a_food_of_my_own_waiting_for_review_can_be_favorited(client, db_session, make_food):
    """Theirs to eat while it waits, so theirs to keep to hand while it waits."""
    food = make_food("Rolled oats")
    db_session.get(models.Food, food["id"]).status = "pending"
    db_session.commit()

    assert client.post(f"/api/foods/{food['id']}/pin").status_code == 204
    assert client.get(f"/api/foods/{food['id']}").json()["pinned"] is True
    assert [row["name"] for row in client.get("/api/foods/repeat").json()] == ["Rolled oats"]


def test_somebody_else_s_food_waiting_for_review_cannot_be_favorited(
    client, db_session, make_user, make_food
):
    food = make_food("Rolled oats")
    db_session.get(models.Food, food["id"]).status = "pending"
    db_session.commit()
    make_user("stranger")
    sign_in(client, "stranger")

    refused = client.post(f"/api/foods/{food['id']}/pin")
    assert refused.status_code == 404
    assert refused.json() == {"detail": MISSING_FOOD}
    assert db_session.query(models.SavedFood).count() == 0
