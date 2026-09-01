"""Which day it is where somebody is.

Only ever the default. Every route takes the day it is told, because the client
knows what somebody is looking at; this is what fills the answer in when the
request did not say. A stored zone can outlive the zone database it was chosen
from, so an unknown one falls back to UTC rather than refusing to name the day.
"""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app import models
from app.models import now_utc


def user_tz(user: models.User) -> dt.tzinfo:
    try:
        return ZoneInfo(user.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        return dt.timezone.utc


def user_today(user: models.User) -> dt.date:
    """Today's date in the account's own zone.

    Taken from an aware UTC moment and moved, rather than read off the machine
    the process happens to run on: the server's clock is not anybody's day.
    """
    return now_utc().astimezone(user_tz(user)).date()
