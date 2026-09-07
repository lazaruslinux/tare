"""What an export says about a workout minute by minute.

A workout entry carries an array per reading it took during the session: how
far, how many steps, what the heart was doing, what it burned. This folds them
into one row a minute. Every reading here is something to look at on a screen:
no budget, no credit and no target reads any of it.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from app import models
from app.fitness_catalog import plain_name, quantity, read_time, to_kcal, to_metres

log = logging.getLogger("tare.samples")

# The per-minute arrays worth reading, and the spellings each has been seen
# under. Everything else in an entry is left alone.
PER_MINUTE = {
    "distance": frozenset(
        {"walkingandrunningdistance", "walkingrunningdistance", "distancewalkingrunning"}
    ),
    "steps": frozenset({"stepcount", "steps"}),
    # Only the array. An entry's "heartRate" is a summary of the whole session
    # and is read as one, further down.
    "heart": frozenset({"heartratedata"}),
    # Active energy only. The basal array beside it is the body ticking over
    # rather than the session.
    "energy": frozenset({"activeenergy", "activeenergyburned"}),
}

# A day of minutes, which is well past any session and short of a table nobody
# will draw.
MAX_SAMPLES = 1440

# What one minute can plausibly hold. Past any of these and the reading is not
# describing the minute it claims to, so it is dropped rather than invented at
# some clamped value.
MAX_SAMPLE_DISTANCE_M = 2000.0
MAX_SAMPLE_STEPS = 400.0
MAX_SAMPLE_KCAL = 60.0
MIN_HR = 20.0
MAX_HR = 250.0

# What a whole session can plausibly climb, in metres.
MAX_ELEVATION_M = 10000.0

# The metres in a foot, for an export that declares its climb in them.
_METRES_PER_FOOT = 0.3048


@dataclass
class Sample:
    """One minute of a session, as the export described it.

    Every reading is optional: the arrays are independent of each other, and a
    strap that slipped sends heart rate for half a walk and distance for all
    of it.
    """

    minute: int
    distance_m: float | None = None
    hr_min: int | None = None
    hr_avg: int | None = None
    hr_max: int | None = None
    steps: int | None = None
    kcal: float | None = None


@dataclass
class Details:
    """One entry's detail: its minutes, and the summaries for the whole of it."""

    minutes: list[Sample] = field(default_factory=list)
    elevation_gain_m: float | None = None
    max_hr: int | None = None


def keyed(item: dict[str, Any]) -> dict[str, Any]:
    """One object's fields under one spelling of each name, so the readers below
    ask for a field rather than for a spelling."""
    return {plain_name(str(key)): value for key, value in item.items()}


def _bounded(value: Any, low: float, high: float) -> float | None:
    number = quantity(value)
    if number is None or number < low or number > high:
        return None
    return number


def _when(item: dict[str, Any], zone: dt.tzinfo) -> dt.datetime | None:
    moment = read_time(item.get("date") or item.get("start") or item.get("startDate"), zone)
    return None if moment is None else moment.instant


def _arrays(entry: dict[str, Any]) -> dict[str, list[Any]]:
    """The per-minute arrays this entry carries, under the names above."""
    found: dict[str, list[Any]] = {}
    for key, value in entry.items():
        if not isinstance(value, list):
            continue
        plain = plain_name(str(key))
        for name, spellings in PER_MINUTE.items():
            if plain in spellings:
                found.setdefault(name, value)
    return found


def _heart(fields: dict[str, Any], name: str) -> int | None:
    reading = _bounded(fields.get(name), MIN_HR, MAX_HR)
    return round(reading) if reading is not None else None


def minutes_of(entry: dict[str, Any], zone: dt.tzinfo) -> list[Sample]:
    """The entry's arrays merged into one row per minute.

    The arrays are read against each other rather than one at a time: they
    start at different moments, skip minutes the phone was not recording, and
    come in different lengths, so each reading is placed by the moment it names
    rather than by its position, counted in whole minutes from the earliest
    moment any of them names.
    """
    arrays = _arrays(entry)
    if not arrays:
        return []

    earliest: dt.datetime | None = None
    for items in arrays.values():
        for item in items:
            if not isinstance(item, dict):
                continue
            when = _when(item, zone)
            if when is not None and (earliest is None or when < earliest):
                earliest = when

    rows: dict[int, Sample] = {}
    for name, items in arrays.items():
        for order, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            when = _when(item, zone)
            minute = order if when is None or earliest is None else int(
                (when - earliest).total_seconds() // 60
            )
            if minute < 0:
                continue
            # A minute already described is left as it was found: one reading
            # a minute is what an export sends, and a second is it repeating
            # itself.
            row = rows.setdefault(minute, Sample(minute=minute))
            if name == "distance":
                if row.distance_m is None:
                    metres = to_metres(item)
                    row.distance_m = (
                        metres if metres is not None and 0 <= metres <= MAX_SAMPLE_DISTANCE_M
                        else None
                    )
            elif name == "steps":
                if row.steps is None:
                    steps = _bounded(item, 0.0, MAX_SAMPLE_STEPS)
                    row.steps = round(steps) if steps is not None else None
            elif name == "energy":
                if row.kcal is None:
                    kcal = to_kcal(item)
                    row.kcal = kcal if kcal is not None and 0 <= kcal <= MAX_SAMPLE_KCAL else None
            elif row.hr_avg is None and row.hr_min is None and row.hr_max is None:
                fields = keyed(item)
                row.hr_min = _heart(fields, "min")
                row.hr_avg = _heart(fields, "avg")
                row.hr_max = _heart(fields, "max")

    ordered = sorted(rows.values(), key=lambda row: row.minute)
    return ordered[:MAX_SAMPLES]


def _elevation(value: Any) -> float | None:
    """How much a session climbed, in metres. Going down is not a climb."""
    number = quantity(value)
    if number is None or number < 0:
        return None
    unit = plain_name(str(value.get("units", "m"))) if isinstance(value, dict) else "m"
    metres = number * (_METRES_PER_FOOT if unit in ("ft", "foot", "feet") else 1.0)
    return metres if metres <= MAX_ELEVATION_M else None


def _max_hr(fields: dict[str, Any]) -> int | None:
    """The highest beat the session saw.

    An entry says this twice: as its own summary, and inside the heart rate
    object beside it. The summary is read first, and the duplicate stands in
    for an export that carries only the object.
    """
    reading = _bounded(fields.get("maxheartrate"), MIN_HR, MAX_HR)
    if reading is None:
        heart = fields.get("heartrate")
        if isinstance(heart, dict):
            reading = _bounded(keyed(heart).get("max"), MIN_HR, MAX_HR)
    return round(reading) if reading is not None else None


def parse(entry: Any, zone: dt.tzinfo) -> Details:
    """Read one entry's detail. Never raises and never refuses.

    Anything absent, malformed, or past what a body produces comes back as
    nothing, field by field. An entry with none of it reads as empty detail
    rather than as a problem.
    """
    if not isinstance(entry, dict):
        return Details()
    fields = keyed(entry)
    return Details(
        minutes=minutes_of(entry, zone),
        elevation_gain_m=_elevation(fields.get("elevationup")),
        max_hr=_max_hr(fields),
    )


def store(db: Session, workout_id: int, minutes: list[Sample]) -> int:
    """Write one workout's per-minute rows. Answers how many were written.

    Only ever called for a workout that has none. The unique key on the table
    is what makes that a rule rather than a hope: a second sync of a session
    already described is refused by the database.
    """
    if not minutes:
        return 0
    db.add_all(
        [
            models.WorkoutSample(
                workout_id=workout_id,
                minute=row.minute,
                distance_m=row.distance_m,
                hr_min=row.hr_min,
                hr_avg=row.hr_avg,
                hr_max=row.hr_max,
                kcal=row.kcal,
                steps=row.steps,
            )
            for row in minutes
        ]
    )
    db.flush()
    return len(minutes)


def record(db: Session, workout: models.Workout, entry: Any, zone: dt.tzinfo) -> int:
    """Everything a newly arrived workout's entry said beyond its own numbers.

    The summaries go onto the workout row, the minutes into their own table.
    Never raises: the savepoint means a refused row rolls back the minutes
    alone, and the two summaries are read off the entry rather than out of the
    database, so they cannot be what the write objected to.
    """
    try:
        details = parse(entry, zone)
        if workout.elevation_gain_m is None:
            workout.elevation_gain_m = details.elevation_gain_m
        if workout.max_hr is None:
            workout.max_hr = details.max_hr
        if not details.minutes:
            return 0
        with db.begin_nested():
            return store(db, workout.id, details.minutes)
    except Exception:
        log.warning("Could not read the detail on workout %s", workout.id, exc_info=True)
        return 0
