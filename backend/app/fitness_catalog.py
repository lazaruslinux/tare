"""The exporter's vocabulary: what a metric is called, what it is measured in,
how a day of it adds up, and how to read one point of it.

Two jobs. The first is the four readings the Fitness screen draws, which need a
stable key of their own because the exporter's name for one of them is an Apple
word and the screen's is a plain one.

The second is everything else, which is most of it. A phone exports sleep,
oxygen, variability, breathing rate, blood pressure and a dozen more, and none
of that is drawn this round. It is all stored anyway, under the exporter's own
name, because a reading thrown away on the way in can never be shown later. So
what is needed for the rest is not a list of names, it is a rule for reading a
name nobody wrote down: the unit says whether a day's points are added up or
averaged, and a point that is not a single number keeps its fields as they came.
"""

from __future__ import annotations

import datetime as dt
import math
import re
from dataclasses import dataclass
from typing import Any

# The four the screen draws, as (its key, the exporter's name, the unit stored,
# how a day of points combines).
TILES = (
    ("steps", "step_count", "count", "sum"),
    ("active_kcal", "active_energy", "kcal", "sum"),
    ("exercise_minutes", "apple_exercise_time", "min", "sum"),
    ("resting_hr", "resting_heart_rate", "count/min", "avg"),
)

# The screen's key for each, and the exporter's name for each, both ways round.
TILE_KEYS = tuple(key for key, _, _, _ in TILES)
METRIC_FOR_TILE = {key: name for key, name, _, _ in TILES}
TILE_FOR_METRIC = {name: key for key, name, _, _ in TILES}
UNIT_FOR_TILE = {key: unit for key, _, unit, _ in TILES}

# The exporter's names for the two readings that are not a fitness number at
# all: they belong on the weigh-in the member already keeps, so they are
# written there as well as here.
WEIGHT_METRIC = "weight_body_mass"
BODY_FAT_METRIC = "body_fat_percentage"

# Which metrics also get an hour-by-hour breakdown, and under which short name.
# Only the four the hour bars are drawn from: keeping every metric by the hour
# would be a table of readings nothing reads.
INTRADAY = {
    "step_count": ("steps", "sum"),
    "active_energy": ("active_kcal", "sum"),
    "walking_running_distance": ("distance", "sum"),
    "heart_rate": ("hr", "avg"),
}

# Units where a day is the total of its points: each point is a quantity of
# something that happened, and two of them are twice as much.
SUM_UNITS = frozenset(
    {
        "count",
        "steps",
        "kcal",
        "cal",
        "kj",
        "m",
        "km",
        "mi",
        "ft",
        "yd",
        "min",
        "hr",
        "s",
        "l",
        "ml",
        "floz",
        "mg",
        "g",
    }
)

# Units where a day is the average of its points: each point is a rate or a
# level, and two readings of one are not twice the other.
AVG_UNITS = frozenset(
    {
        "bpm",
        "count/min",
        "%",
        "ms",
        "ml/min·kg",
        "ml/min/kg",
        "mmhg",
        "degc",
        "degf",
        "kg",
        "lb",
        "mmol/l",
        "mg/dl",
        "db",
        "dbaspl",
    }
)


def normal_unit(raw: str | None) -> str:
    """The unit as this file spells it: trimmed and lower case, nothing else.

    Deliberately not a conversion table. What a phone said its numbers were in
    is stored beside them, because a figure whose unit was quietly rewritten is
    a figure nobody can check.
    """
    return (raw or "").strip().lower()


def rollup(unit: str) -> str:
    """How a day's points for a metric in this unit combine.

    An unknown unit averages. That is the safer of the two guesses: a rate
    added up reads as a wildly large number, while a total averaged reads as a
    small one, and the second is easier to recognise as wrong.
    """
    clean = normal_unit(unit)
    if clean in SUM_UNITS:
        return "sum"
    return "avg"


def combine(values: list[float], rule: str) -> float | None:
    if not values:
        return None
    if rule == "sum":
        return sum(values)
    return sum(values) / len(values)


# Reading one point
# -----------------
# A phone writes the same measurement four ways depending on its version and
# its owner's locale, so everything below reads a value rather than a spelling.

# What a distance is in metres, by the unit the phone declared. An unknown unit
# is read as metres, which is what a bare number from this exporter means.
_METRES_PER = {
    "m": 1.0,
    "meter": 1.0,
    "meters": 1.0,
    "metre": 1.0,
    "metres": 1.0,
    "km": 1000.0,
    "kilometer": 1000.0,
    "kilometers": 1000.0,
    "mi": 1609.344,
    "mile": 1609.344,
    "miles": 1609.344,
    "ft": 0.3048,
    "foot": 0.3048,
    "feet": 0.3048,
    "yd": 0.9144,
}

# And what an energy is in calories, which is the unit every screen speaks.
_KCAL_PER = {"kcal": 1.0, "cal": 1.0, "calories": 1.0, "kj": 0.239006, "kilojoules": 0.239006}

# The moment formats an export has been seen writing. The offset is the phone's
# own, and it is what says which day a reading belongs to.
_TIME_FORMATS = ("%Y-%m-%d %H:%M:%S %z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d")

_NOT_NAME = re.compile(r"[^a-z0-9]+")


def plain_name(raw: str) -> str:
    """A field name with everything but its letters and digits taken out.

    The same measurement arrives as "stepCount" from one version of an export
    and "step_count" from another, so names are compared like this rather than
    literally.
    """
    return _NOT_NAME.sub("", raw.lower())


def quantity(raw: Any) -> float | None:
    """A finite number out of a bare value or a {"qty": ..., "units": ...} pair.

    Never a boolean, which Python would otherwise hand over as one or zero, and
    never an infinity: a figure that is not a number is not a reading.
    """
    if isinstance(raw, dict):
        raw = raw.get("qty")
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    number = float(raw)
    return number if math.isfinite(number) else None


def unit_of(raw: Any, fallback: str = "") -> str:
    """The unit a point declared for itself, or the one passed in."""
    if isinstance(raw, dict) and isinstance(raw.get("units"), str):
        return raw["units"]
    return fallback


def to_metres(raw: Any, fallback_unit: str = "") -> float | None:
    value = quantity(raw)
    if value is None:
        return None
    return value * _METRES_PER.get(plain_name(unit_of(raw, fallback_unit)), 1.0)


def to_kcal(raw: Any, fallback_unit: str = "") -> float | None:
    value = quantity(raw)
    if value is None:
        return None
    return value * _KCAL_PER.get(plain_name(unit_of(raw, fallback_unit)), 1.0)


@dataclass(frozen=True)
class Moment:
    """One reading's moment, three ways: the instant it happened, the day it
    happened on where the member was, and the hour of that day.

    All three are needed and none can be worked out from the others here. The
    instant is what a row stores, because a timestamp with no zone means
    nothing. The day and the hour are what a diary and a bar chart are written
    in, and they are the phone's own clock rather than the server's.
    """

    instant: dt.datetime
    day: dt.date
    hour: int


def read_time(raw: Any, fallback: dt.tzinfo) -> Moment | None:
    """One export timestamp, or nothing when it cannot be read.

    The wall clock in the string is the member's day, so it is read off before
    the offset is applied: an evening walk still belongs to the evening. A
    string with no offset at all is taken to be in the member's own zone, which
    is the only reasonable reading of a bare local time.
    """
    if not isinstance(raw, str):
        return None
    text = raw.strip().replace("Z", "+00:00")
    parsed: dt.datetime | None = None
    for shape in _TIME_FORMATS:
        try:
            parsed = dt.datetime.strptime(text, shape)
            break
        except ValueError:
            continue
    if parsed is None:
        try:
            parsed = dt.datetime.fromisoformat(text)
        except ValueError:
            return None
    day, hour = parsed.date(), parsed.hour
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=fallback)
    return Moment(instant=parsed.astimezone(dt.timezone.utc), day=day, hour=hour)


# The field names a many-figured reading is drawn at, in the order they are
# tried: a night's sleep by the hours asleep, an all-day heart rate by its mean,
# a blood pressure by the systolic figure.
_HEADLINE_FIELDS = ("qty", "asleep", "avg", "average", "mean", "systolic", "value")


def headline(fields: dict[str, Any]) -> float | None:
    """The one figure to show for a reading that is not one figure.

    Nothing when none of the names is there, which is honest: the reading is
    kept whole either way, and a screen that understands it can read the rest.
    """
    lowered = {key.lower(): value for key, value in fields.items()}
    for name in _HEADLINE_FIELDS:
        number = quantity(lowered.get(name))
        if number is not None:
            return number
    return None
