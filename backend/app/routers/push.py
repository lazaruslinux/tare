"""The devices a member has turned notifications on for.

A subscription is minted by the browser and handed here; this server keeps the
address and the two keys and nothing else about the device. The endpoint is
what identifies it, so the same browser subscribing again takes its own row
back rather than leaving a trail of dead ones behind.
"""

from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, notifications, throttle, webpush
from app.db import get_db
from app.deps import require_user
from app.notifications import TEST

router = APIRouter(prefix="/push", tags=["push"])

BAD_SUBSCRIPTION = "That is not a push subscription."
NO_DEVICES = "Turn notifications on for a device first."
MISSING_DEVICE = "There is no such device."

MAX_ENDPOINT = 1024
MAX_LABEL = 60

# What a device is called on the list, worked out from what the browser says
# it is. The plainest word for the thing in somebody's hand, never a version.
DEVICES = (
    ("iPhone", "iPhone"),
    ("iPad", "iPad"),
    ("Android", "Android"),
    ("Macintosh", "Mac"),
    ("Mac OS X", "Mac"),
    ("Windows", "Windows"),
    ("Linux", "Linux"),
)
BROWSERS = (
    ("Edg/", "Edge"),
    ("OPR/", "Opera"),
    ("Firefox", "Firefox"),
    ("Chrome", "Chrome"),
    ("Safari", "Safari"),
)


class SubscriptionIn(BaseModel):
    endpoint: str
    keys: dict[str, str]


def checked_subscription(body: SubscriptionIn) -> tuple[str, str, str]:
    """The three values, or a refusal.

    The endpoint is checked as strictly as the keys are: this server posts to
    whatever address it is handed, and an address that is not a push service
    on the public internet would make it a way to reach anything it can.
    """
    endpoint = body.endpoint.strip()
    parts = urlsplit(endpoint)
    host = parts.hostname or ""
    if parts.scheme != "https" or not endpoint or len(endpoint) > MAX_ENDPOINT:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_SUBSCRIPTION)
    if "." not in host:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_SUBSCRIPTION)
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_SUBSCRIPTION)

    p256dh = (body.keys.get("p256dh") or "").strip()
    auth = (body.keys.get("auth") or "").strip()
    try:
        point = webpush.b64url_decode(p256dh)
        secret = webpush.b64url_decode(auth)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_SUBSCRIPTION) from None
    if len(point) != 65 or point[0] != 0x04 or len(secret) != 16:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_SUBSCRIPTION)
    return endpoint, p256dh, auth


def label_of(user_agent: str) -> str:
    """What to call this device on the member's own list."""
    device = next((word for mark, word in DEVICES if mark in user_agent), "Device")
    browser = next((word for mark, word in BROWSERS if mark in user_agent), "")
    label = f"{device} ({browser})" if browser else device
    return label[:MAX_LABEL]


def device_out(row: models.PushSubscription) -> dict[str, object]:
    return {
        "id": row.id,
        "endpoint": row.endpoint,
        "label": row.label,
        "created_at": row.created_at.isoformat(),
        "last_ok_at": None if row.last_ok_at is None else row.last_ok_at.isoformat(),
    }


@router.get("/key")
def read_key(user: models.User = Depends(require_user)) -> dict[str, object]:
    """The application server key the browser subscribes with."""
    if not webpush.configured():
        raise HTTPException(status.HTTP_404_NOT_FOUND, webpush.NOT_SET_UP)
    return {"key": webpush.public_key()}


@router.get("/subscriptions")
def read_subscriptions(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> dict[str, object]:
    rows = db.scalars(
        select(models.PushSubscription)
        .where(models.PushSubscription.user_id == user.id)
        .order_by(models.PushSubscription.created_at, models.PushSubscription.id)
    )
    return {"devices": [device_out(row) for row in rows]}


@router.post("/subscriptions")
def save_subscription(
    body: SubscriptionIn,
    request: Request,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Turn this device on, or take an existing row over.

    A browser hands out the same endpoint to whoever is signed in, so a shared
    computer means the row moves to the member who turned it on last rather
    than two accounts both sending to it.
    """
    if throttle.push_subscribe_limiter.hit(str(user.id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY)
    endpoint, p256dh, auth = checked_subscription(body)
    label = label_of(request.headers.get("user-agent", ""))
    row = db.scalar(
        select(models.PushSubscription).where(models.PushSubscription.endpoint == endpoint)
    )
    if row is None:
        row = models.PushSubscription(user_id=user.id, endpoint=endpoint)
        db.add(row)
    row.user_id = user.id
    row.p256dh = p256dh
    row.auth = auth
    row.label = label
    row.failures = 0
    db.commit()
    return device_out(row)


@router.delete("/subscriptions/{subscription_id}", status_code=status.HTTP_204_NO_CONTENT)
def drop_subscription(
    subscription_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    row = db.get(models.PushSubscription, subscription_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_DEVICE)
    db.delete(row)
    db.commit()


@router.post("/test")
def send_test(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> dict[str, object]:
    """One notification, now. The member is looking at the screen waiting for
    it, so this waits for the send rather than handing it to the background."""
    if throttle.push_test_limiter.hit(str(user.id)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, throttle.TOO_MANY)
    if not webpush.configured():
        raise HTTPException(status.HTTP_404_NOT_FOUND, webpush.NOT_SET_UP)
    held = db.scalar(
        select(models.PushSubscription.id).where(models.PushSubscription.user_id == user.id)
    )
    if held is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_DEVICES)
    sent = notifications.deliver(
        db,
        user,
        notifications.compose(notifications.Event(TEST), user),
        ttl=notifications.TTL[TEST],
        topic=None,
    )
    return {"sent": sent}
