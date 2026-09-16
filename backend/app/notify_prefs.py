"""What a member has asked to be told about, and when.

One object on the account rather than a column per switch, the way the
Dashboard's cards are kept: the screen saves the lot in one call, and a kind
added later turns up on an old account already answered with its default.
Everything stored is read back through normalize, so nothing downstream ever
has to wonder whether a key is there.
"""

from __future__ import annotations

import re
from typing import Any

BAD_NOTIFY = "That is not a notification setting."

# A time of day as the screen sends it, on the 24-hour clock whatever clock the
# member reads. The zone is the account's own.
TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

KEYS = ("morning", "evening", "weigh_in", "calendar", "invitations")

MORNING_TIME = "08:00"
EVENING_TIME = "20:00"
# Monday, counted the way date.weekday counts.
WEIGH_IN_WEEKDAY = 0


def default() -> dict[str, Any]:
    """Everything on, at the hours most people would pick.

    On rather than off because nothing is sent until a device is turned on:
    the switches say what would arrive, and the device is the consent.
    """
    return {
        "morning": {"on": True, "time": MORNING_TIME},
        "evening": {"on": True, "time": EVENING_TIME},
        "weigh_in": {"on": True, "weekday": WEIGH_IN_WEEKDAY},
        "calendar": True,
        "invitations": True,
    }


def _slot(raw: Any, time_of_day: str) -> dict[str, Any]:
    stored = raw if isinstance(raw, dict) else {}
    at = stored.get("time")
    return {
        "on": bool(stored.get("on", True)),
        "time": at if isinstance(at, str) and TIME.match(at) else time_of_day,
    }


def normalize(raw: Any) -> dict[str, Any]:
    """The stored answer, repaired. Anything missing or wrong takes its default."""
    stored = raw if isinstance(raw, dict) else {}
    held = stored.get("weigh_in")
    weigh_in: dict[str, Any] = held if isinstance(held, dict) else {}
    weekday = weigh_in.get("weekday")
    return {
        "morning": _slot(stored.get("morning"), MORNING_TIME),
        "evening": _slot(stored.get("evening"), EVENING_TIME),
        "weigh_in": {
            "on": bool(weigh_in.get("on", True)),
            "weekday": (
                weekday
                if isinstance(weekday, int)
                and not isinstance(weekday, bool)
                and 0 <= weekday <= 6
                else WEIGH_IN_WEEKDAY
            ),
        },
        "calendar": bool(stored.get("calendar", True)),
        "invitations": bool(stored.get("invitations", True)),
    }


def _checked_slot(raw: Any, extra: str) -> None:
    if not isinstance(raw, dict) or set(raw) != {"on", extra}:
        raise ValueError(BAD_NOTIFY)
    if not isinstance(raw["on"], bool):
        raise ValueError(BAD_NOTIFY)
    if extra == "time":
        if not isinstance(raw["time"], str) or not TIME.match(raw["time"]):
            raise ValueError(BAD_NOTIFY)
        return
    weekday = raw["weekday"]
    if isinstance(weekday, bool) or not isinstance(weekday, int) or not 0 <= weekday <= 6:
        raise ValueError(BAD_NOTIFY)


def checked(raw: Any) -> dict[str, Any]:
    """The same answer, held to the shape. What a member sends is refused rather
    than quietly repaired: a switch that saves as something else is a switch
    that lies about what will arrive."""
    if not isinstance(raw, dict) or set(raw) != set(KEYS):
        raise ValueError(BAD_NOTIFY)
    _checked_slot(raw["morning"], "time")
    _checked_slot(raw["evening"], "time")
    _checked_slot(raw["weigh_in"], "weekday")
    for key in ("calendar", "invitations"):
        if not isinstance(raw[key], bool):
            raise ValueError(BAD_NOTIFY)
    return normalize(raw)
