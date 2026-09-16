"""The routes behind the Notifications screen.

Every one of them is an account's own: a device belongs to whoever turned it
on, and nothing here answers a caller who is not signed in.
"""

import httpx
import pytest

from app import models, webpush
from app.config import settings
from app.notify_prefs import BAD_NOTIFY
from app.routers.push import BAD_SUBSCRIPTION, MISSING_DEVICE, NO_DEVICES, label_of
from app.throttle import TOO_MANY
from tests.conftest import PASSWORD
from tests.test_webpush import AS_PRIVATE, AUTH_SECRET, UA_PUBLIC

ENDPOINT = "https://push.example.net/push/one"


def subscription(endpoint=ENDPOINT, p256dh=UA_PUBLIC, auth=AUTH_SECRET):
    return {"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}}


@pytest.fixture()
def with_keys(monkeypatch):
    monkeypatch.setattr(settings, "vapid_private_key", AS_PRIVATE)
    monkeypatch.setattr(settings, "vapid_subject", "mailto:admin@example.com")


def answers(monkeypatch, status=201, seen=None):
    def handler(request):
        if seen is not None:
            seen.append(request)
        return httpx.Response(status)

    monkeypatch.setattr(
        webpush, "session", lambda: httpx.Client(transport=httpx.MockTransport(handler))
    )


def test_every_route_needs_an_account(client):
    assert client.get("/api/push/key").status_code == 401
    assert client.get("/api/push/subscriptions").status_code == 401
    assert client.post("/api/push/subscriptions", json=subscription()).status_code == 401
    assert client.delete("/api/push/subscriptions/1").status_code == 401
    assert client.post("/api/push/test").status_code == 401


def test_an_instance_without_keys_has_no_key_to_hand_out(client, signed_in):
    response = client.get("/api/push/key")
    assert response.status_code == 404
    assert response.json()["detail"] == webpush.NOT_SET_UP


def test_the_key_is_the_public_half_of_the_configured_one(client, signed_in, with_keys):
    response = client.get("/api/push/key")
    assert response.status_code == 200
    assert response.json()["key"] == webpush.public_key()


@pytest.mark.parametrize(
    "body",
    [
        subscription(endpoint="http://push.example.net/push/one"),
        subscription(endpoint="https://203.0.113.9/push/one"),
        subscription(endpoint="https://localhost/push/one"),
        subscription(endpoint="https://push.example.net/" + "x" * 1100),
        subscription(p256dh="AAEC"),
        subscription(auth="AAEC"),
        subscription(p256dh="not base64 $$$"),
    ],
)
def test_a_subscription_that_is_not_one_is_refused(client, signed_in, body):
    response = client.post("/api/push/subscriptions", json=body)
    assert response.status_code == 400
    assert response.json()["detail"] == BAD_SUBSCRIPTION


def test_turning_a_device_on_answers_with_the_device(client, signed_in):
    response = client.post(
        "/api/push/subscriptions",
        json=subscription(),
        headers={"user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605.1"},
    )
    assert response.status_code == 200
    device = response.json()
    assert device["label"] == "iPhone (Safari)"
    assert device["endpoint"] == ENDPOINT
    assert device["last_ok_at"] is None


def test_the_same_browser_again_keeps_one_row(client, signed_in, db_session):
    assert client.post("/api/push/subscriptions", json=subscription()).status_code == 200
    again = client.post(
        "/api/push/subscriptions", json=subscription(auth=webpush.b64url_encode(b"0123456789abcdef"))
    )
    assert again.status_code == 200
    rows = db_session.query(models.PushSubscription).all()
    assert len(rows) == 1
    assert rows[0].auth == webpush.b64url_encode(b"0123456789abcdef")


def test_a_shared_browser_moves_to_whoever_turned_it_on_last(
    client, db_session, make_user, signed_in
):
    make_user("other")
    assert client.post("/api/push/subscriptions", json=subscription()).status_code == 200
    client.post("/api/auth/logout")
    assert client.post(
        "/api/auth/login", json={"username": "other", "password": PASSWORD}
    ).status_code == 200
    assert client.post("/api/push/subscriptions", json=subscription()).status_code == 200

    rows = db_session.query(models.PushSubscription).all()
    assert len(rows) == 1
    assert rows[0].user_id != signed_in.id


def test_the_list_is_this_accounts_own(client, db_session, make_user, signed_in):
    other = make_user("other")
    db_session.add(
        models.PushSubscription(
            user_id=other.id,
            endpoint="https://push.example.net/push/theirs",
            p256dh=UA_PUBLIC,
            auth=AUTH_SECRET,
            label="Mac (Firefox)",
        )
    )
    db_session.commit()
    client.post("/api/push/subscriptions", json=subscription())

    devices = client.get("/api/push/subscriptions").json()["devices"]
    assert [device["endpoint"] for device in devices] == [ENDPOINT]


def test_a_device_can_be_turned_off_and_nobody_elses_can(
    client, db_session, make_user, signed_in
):
    other = make_user("other")
    theirs = models.PushSubscription(
        user_id=other.id,
        endpoint="https://push.example.net/push/theirs",
        p256dh=UA_PUBLIC,
        auth=AUTH_SECRET,
        label="Mac",
    )
    db_session.add(theirs)
    db_session.commit()
    mine = client.post("/api/push/subscriptions", json=subscription()).json()

    missing = client.delete(f"/api/push/subscriptions/{theirs.id}")
    assert missing.status_code == 404
    assert missing.json()["detail"] == MISSING_DEVICE
    assert client.delete(f"/api/push/subscriptions/{mine['id']}").status_code == 204
    assert client.get("/api/push/subscriptions").json()["devices"] == []


def test_turning_devices_on_over_and_over_is_limited(client, signed_in):
    for index in range(20):
        body = subscription(endpoint=f"{ENDPOINT}-{index}")
        assert client.post("/api/push/subscriptions", json=body).status_code == 200
    refused = client.post("/api/push/subscriptions", json=subscription(endpoint=f"{ENDPOINT}-x"))
    assert refused.status_code == 429
    assert refused.json()["detail"] == TOO_MANY


def test_a_test_notification_needs_an_instance_that_can_send_one(client, signed_in):
    response = client.post("/api/push/test")
    assert response.status_code == 404
    assert response.json()["detail"] == webpush.NOT_SET_UP


def test_a_test_notification_needs_a_device(client, signed_in, with_keys):
    response = client.post("/api/push/test")
    assert response.status_code == 400
    assert response.json()["detail"] == NO_DEVICES


def test_a_test_goes_to_every_device_that_is_on(client, signed_in, with_keys, monkeypatch):
    seen: list[httpx.Request] = []
    answers(monkeypatch, seen=seen)
    client.post("/api/push/subscriptions", json=subscription())
    client.post("/api/push/subscriptions", json=subscription(endpoint=f"{ENDPOINT}-two"))

    response = client.post("/api/push/test")
    assert response.status_code == 200
    assert response.json() == {"sent": 2}
    assert len(seen) == 2


def test_a_device_that_answers_is_marked_as_reached(
    client, db_session, signed_in, with_keys, monkeypatch
):
    answers(monkeypatch)
    client.post("/api/push/subscriptions", json=subscription())
    client.post("/api/push/test")
    row = db_session.query(models.PushSubscription).one()
    assert row.last_ok_at is not None
    assert row.failures == 0


def test_a_handful_of_tests_an_hour_is_the_ceiling(client, signed_in, with_keys, monkeypatch):
    answers(monkeypatch)
    client.post("/api/push/subscriptions", json=subscription())
    for _ in range(5):
        assert client.post("/api/push/test").status_code == 200
    refused = client.post("/api/push/test")
    assert refused.status_code == 429
    assert refused.json()["detail"] == TOO_MANY


def test_what_a_device_is_called_is_read_off_the_browser():
    assert label_of("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605.1") == "iPhone (Safari)"
    assert label_of("Mozilla/5.0 (Linux; Android 14) Chrome/120") == "Android (Chrome)"
    assert label_of("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Firefox/121") == "Mac (Firefox)"
    assert label_of("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Edg/120") == "Windows (Edge)"
    assert label_of("") == "Device"
    assert len(label_of("iPhone " * 40)) <= 60


# The switches on the account
# ---------------------------


def test_a_fresh_account_is_handed_the_default_switches(client, signed_in):
    notify = client.get("/api/auth/me").json()["notify"]
    assert notify["morning"] == {"on": True, "time": "08:00"}
    assert notify["weigh_in"] == {"on": True, "weekday": 0}
    assert notify["invitations"] is True


def test_the_switches_are_saved_whole_and_read_back(client, signed_in):
    asked = {
        "morning": {"on": False, "time": "07:00"},
        "evening": {"on": True, "time": "21:30"},
        "weigh_in": {"on": True, "weekday": 3},
        "calendar": False,
        "invitations": True,
    }
    response = client.patch("/api/account", json={"notify": asked})
    assert response.status_code == 200
    assert response.json()["notify"] == asked
    assert client.get("/api/auth/me").json()["notify"] == asked


def test_a_switch_that_is_not_one_is_refused(client, signed_in):
    response = client.patch("/api/account", json={"notify": {"morning": {"on": True}}})
    assert response.status_code == 400
    assert response.json()["detail"] == BAD_NOTIFY
