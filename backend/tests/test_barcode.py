"""Resolving a scanned code, and the order the answers are looked for in.

The order is the whole design: the shared database, then your own foods, then
what this instance already fetched, then the network. Every case here is about
one step of it not being skipped, and about the network being the last resort
rather than the first.
"""

import datetime as dt

import httpx
import pytest

from app import foods_api, models, throttle
from app.models import now_utc
from app.routers.barcode import CACHE_DAYS
from tests.conftest import PASSWORD

CODE = "034000002405"

PANEL = {
    "calories": 535,
    "protein_g": 7,
    "carbs_g": 58.1,
    "fat_g": 32.6,
    "saturated_fat_g": 18.6,
    "trans_fat_g": 0,
    "cholesterol_mg": 23,
    "sodium_mg": 81,
    "fiber_g": 2.3,
    "sugar_g": 51.2,
}

OFF_PRODUCT = {
    "status": 1,
    "product": {
        "product_name": "Milk chocolate bar",
        "brands": "Hershey's",
        "serving_size": "1 bar (43 g)",
        "serving_quantity": 43,
        "serving_quantity_unit": "g",
        "ingredients_text": "Sugar, milk, chocolate.",
        "nutriments": {
            "energy-kcal_100g": 535,
            "proteins_100g": 7,
            "carbohydrates_100g": 58.1,
            "fat_100g": 32.6,
            "saturated-fat_100g": 18.6,
            "trans-fat_100g": 0,
            "cholesterol_100g": 0.023,
            "sodium_100g": 0.081,
            "fiber_100g": 2.3,
            "sugars_100g": 51.2,
        },
    },
}


@pytest.fixture()
def network(monkeypatch):
    """Put a transport where the client is built, and count what went out.

    A case that expects no request at all gets a handler that fails outright,
    so "the network was never touched" is proved rather than assumed.
    """

    def install(handler):
        seen: list[str] = []

        def watched(request):
            seen.append(str(request.url))
            return handler(request)

        monkeypatch.setattr(
            foods_api, "session", lambda: httpx.Client(transport=httpx.MockTransport(watched))
        )
        return seen

    return install


def off(payload):
    def handler(request):
        return httpx.Response(200, json=payload)

    return handler


def nothing_goes_out(request):
    raise AssertionError(f"a request went out to {request.url}")


def sign_in(client, username):
    assert (
        client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    ).status_code == 200


def put_food(db, owner, *, status, barcode=CODE, name="Milk chocolate bar"):
    food = models.Food(
        status=status,
        owner_id=None if owner is None else owner.id,
        barcode=barcode,
        name=name,
        base_unit="g",
        **PANEL,
    )
    db.add(food)
    db.commit()
    return food


def put_cache(db, *, fetched_at, name="Cached bar"):
    food = models.Food(
        status="cache",
        barcode=CODE,
        name=name,
        base_unit="g",
        source="off",
        source_id=CODE,
        fetched_at=fetched_at,
        **PANEL,
    )
    db.add(food)
    db.commit()
    return food


def test_the_shared_database_answers_before_anything_else(
    client, db_session, signed_in, network
):
    network(nothing_goes_out)
    put_food(db_session, None, status="approved")
    put_food(db_session, signed_in, status="custom", name="My own bar")
    put_cache(db_session, fetched_at=now_utc())

    body = client.get(f"/api/barcode/{CODE}").json()
    assert body["state"] == "approved"
    assert body["food"]["name"] == "Milk chocolate bar"


def test_your_own_food_answers_before_a_cached_reading(
    client, db_session, signed_in, network
):
    network(nothing_goes_out)
    put_food(db_session, signed_in, status="custom", name="My own bar")
    put_cache(db_session, fetched_at=now_utc())

    body = client.get(f"/api/barcode/{CODE}").json()
    assert body["state"] == "mine"
    assert body["food"]["name"] == "My own bar"
    assert body["food"]["mine"] is True


def test_a_food_still_waiting_on_the_queue_is_still_yours(
    client, db_session, signed_in, network
):
    network(nothing_goes_out)
    put_food(db_session, signed_in, status="pending", name="Offered bar")

    body = client.get(f"/api/barcode/{CODE}").json()
    assert body["state"] == "mine"
    assert body["food"]["status"] == "pending"


def test_somebody_else_s_private_food_does_not_answer_your_scan(
    client, db_session, make_user, signed_in, network
):
    stranger = make_user("stranger")
    put_food(db_session, stranger, status="custom", name="Their bar")
    seen = network(off({"status": 0}))

    assert client.get(f"/api/barcode/{CODE}").json() == {"state": "blank", "barcode": CODE}
    # It fell all the way through to a lookup, which is the proof it was not
    # merely refused on the way past.
    assert len(seen) == 1


def test_a_fresh_cached_reading_answers_without_a_request(
    client, db_session, signed_in, network
):
    network(nothing_goes_out)
    put_cache(db_session, fetched_at=now_utc() - dt.timedelta(days=CACHE_DAYS - 1))

    body = client.get(f"/api/barcode/{CODE}").json()
    assert body["state"] == "prefill"
    assert body["prefill"]["name"] == "Cached bar"
    assert body["prefill"]["sodium_mg"] == 81
    assert body["prefill"]["source"] == "Open Food Facts"


def test_a_reading_past_its_month_is_fetched_again(client, db_session, signed_in, network):
    put_cache(db_session, fetched_at=now_utc() - dt.timedelta(days=CACHE_DAYS + 1))
    seen = network(off(OFF_PRODUCT))

    body = client.get(f"/api/barcode/{CODE}").json()
    assert len(seen) == 1
    assert body["state"] == "prefill"
    assert body["prefill"]["name"] == "Milk chocolate bar"


def test_a_lookup_is_written_down_once_however_often_it_is_scanned(
    client, db_session, signed_in, network
):
    seen = network(off(OFF_PRODUCT))
    assert client.get(f"/api/barcode/{CODE}").json()["state"] == "prefill"

    # The second scan is answered from the row the first one wrote.
    assert client.get(f"/api/barcode/{CODE}").json()["state"] == "prefill"
    assert len(seen) == 1

    rows = db_session.query(models.Food).filter(models.Food.status == "cache").all()
    assert len(rows) == 1
    assert rows[0].barcode == CODE
    assert len(rows[0].servings) == 1
    assert rows[0].servings[0].base_amount == 43
    # A source states a serving in the base unit, so that is what it was typed in.
    assert (rows[0].servings[0].amount, rows[0].servings[0].unit) == (43, "g")


def test_an_out_of_date_reading_beats_a_network_that_is_not_there(
    client, db_session, signed_in, network
):
    put_cache(db_session, fetched_at=now_utc() - dt.timedelta(days=CACHE_DAYS + 1))

    def refuse(request):
        raise httpx.ConnectError("no route to host")

    network(refuse)
    body = client.get(f"/api/barcode/{CODE}")
    assert body.status_code == 200
    assert body.json()["prefill"]["name"] == "Cached bar"


def test_a_network_that_is_not_there_with_nothing_kept_is_one_sentence(
    client, signed_in, network
):
    def refuse(request):
        raise httpx.ConnectError("no route to host")

    network(refuse)
    response = client.get(f"/api/barcode/{CODE}")
    assert response.status_code == 502
    assert list(response.json()) == ["detail"]
    assert response.json()["detail"].endswith(".")


def test_a_code_nobody_has_heard_of_answers_with_the_code(client, signed_in, network):
    network(off({"status": 0}))
    assert client.get("/api/barcode/00000000").json() == {"state": "blank", "barcode": "00000000"}


def test_something_that_is_not_a_barcode_is_refused_in_one_sentence(client, signed_in, network):
    network(nothing_goes_out)
    for code in ("1234567", "123456789012345", "abcdefgh"):
        response = client.get(f"/api/barcode/{code}")
        assert response.status_code == 400
        assert response.json() == {"detail": "That is not a barcode."}


def test_a_cached_reading_is_not_a_food_anybody_can_reach(
    client, db_session, admin_client, network
):
    """The one thing a cache row must never do is look like a food."""
    network(nothing_goes_out)
    cached = put_cache(db_session, fetched_at=now_utc())

    # Not by its id, not even for an administrator, who reads everything else.
    missing = admin_client.get(f"/api/foods/{cached.id}")
    assert missing.status_code == 404
    assert missing.json() == {"detail": "There is no such food."}

    # Not by searching for its name, and not in anybody's own list.
    assert admin_client.get("/api/foods/search?q=cached").json() == []
    assert admin_client.get("/api/foods/mine").json() == []
    assert admin_client.get("/api/foods/repeat").json() == []


def test_a_scan_needs_a_session(client):
    assert client.get(f"/api/barcode/{CODE}").status_code == 401


def test_a_member_may_only_scan_so_often(client, db_session, signed_in, network):
    """The one route that may leave the machine, held to a scan a shopping trip."""
    network(nothing_goes_out)
    put_food(db_session, None, status="approved")
    assert throttle.barcode_limiter.max_attempts == 30

    for _ in range(throttle.barcode_limiter.max_attempts):
        assert client.get(f"/api/barcode/{CODE}").status_code == 200

    refused = client.get(f"/api/barcode/{CODE}")
    assert refused.status_code == 429
    assert refused.json()["detail"] == throttle.TOO_MANY_SCANS
