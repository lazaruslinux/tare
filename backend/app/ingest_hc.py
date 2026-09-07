"""The Android dialect, written out as the one the reader already speaks.

Android has no Health Auto Export, so a bridge reads Health Connect and posts a
flat envelope of arrays rather than one shape per workout. This turns that into
the shape app.ingest_hae already reads, so there is one reader and not two: a
session's detail is the slice of each array inside its own window, folded to one
reading a minute, on the member's own clock rather than UTC.
"""

from __future__ import annotations

import datetime as dt
from bisect import bisect_left, bisect_right
from typing import Any

from app.fitness_catalog import quantity, read_time

# The session lists, and every array read beside them.
SESSIONS = ("exercise_sessions", "exercise")
ARRAYS = ("steps", "active_calories", "exercise_sessions", "exercise", "heart_rate", "distance")


def looks_like(payload: Any) -> bool:
    """Whether this export came from the bridge rather than from a phone's own
    exporter.

    An export the Apple reader can already read is never translated, whatever
    else it happens to carry: that is what the envelope test is for.
    """
    if not isinstance(payload, dict):
        return False
    if isinstance(payload.get("data"), dict):
        return False
    if "app_version" in payload:
        return True
    return any(isinstance(payload.get(key), list) for key in ARRAYS)


def _objects(payload: dict[str, Any], key: str) -> list[dict[str, Any]]:
    value = payload.get(key)
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _moment(item: dict[str, Any], zone: dt.tzinfo) -> dt.datetime | None:
    """When a record says it happened, as an instant.

    An interval record names a start and an instant record names a time, and
    both are read here so a spelling only one bridge uses is understood once.
    """
    raw = item.get("start_time")
    if raw is None:
        raw = item.get("time")
    if raw is None:
        raw = item.get("date")
    moment = read_time(raw, dt.timezone.utc)
    return None if moment is None else moment.instant


def _stamp(when: dt.datetime, zone: dt.tzinfo) -> str:
    """One instant as the wall time where the member is, offset and all.

    The offset is kept rather than dropped so the reader is never guessing at
    which zone a bare local time belongs to.
    """
    return when.astimezone(zone).isoformat()


def _in_order(
    items: list[dict[str, Any]], zone: dt.tzinfo
) -> tuple[list[dt.datetime], list[dict[str, Any]]]:
    """The records that name a moment, in order, with their moments beside them.

    Sorted once for the whole export rather than scanned once per session: a
    long catch-up is thousands of sessions against tens of thousands of
    readings, and the windows below are found by bisecting this instead.
    """
    dated = []
    for item in items:
        when = _moment(item, zone)
        if when is not None:
            dated.append((when, item))
    dated.sort(key=lambda pair: pair[0])
    return [when for when, _ in dated], [item for _, item in dated]


def _window(
    ordered: tuple[list[dt.datetime], list[dict[str, Any]]],
    start: dt.datetime,
    end: dt.datetime,
) -> list[tuple[dt.datetime, dict[str, Any]]]:
    moments, items = ordered
    if not moments:
        return []
    low, high = bisect_left(moments, start), bisect_right(moments, end)
    return list(zip(moments[low:high], items[low:high]))


def _folded(
    inside: list[tuple[dt.datetime, dict[str, Any]]],
    field: str,
    rule: str,
    zone: dt.tzinfo,
) -> list[dict[str, Any]]:
    """One reading per minute out of however many the bridge sent for it."""
    buckets: dict[dt.datetime, list[float]] = {}
    for when, item in inside:
        value = quantity(item.get(field))
        if value is None:
            continue
        minute = when.replace(second=0, microsecond=0)
        buckets.setdefault(minute, []).append(value)
    out = []
    for minute in sorted(buckets):
        values = buckets[minute]
        total = sum(values) if rule == "sum" else sum(values) / len(values)
        out.append({"date": _stamp(minute, zone), "qty": total})
    return out


def _metric(
    name: str,
    records: list[dict[str, Any]],
    field: str,
    units: str,
    zone: dt.tzinfo,
) -> dict[str, Any] | None:
    points = []
    for item in records:
        when = _moment(item, zone)
        value = quantity(item.get(field))
        if when is None or value is None:
            continue
        points.append({"date": _stamp(when, zone), "qty": value})
    if not points:
        return None
    return {"name": name, "units": units, "data": points}


def _session(
    entry: dict[str, Any],
    zone: dt.tzinfo,
    heart: tuple[list[dt.datetime], list[dict[str, Any]]],
    energy: tuple[list[dt.datetime], list[dict[str, Any]]],
    steps: tuple[list[dt.datetime], list[dict[str, Any]]],
    distance: tuple[list[dt.datetime], list[dict[str, Any]]],
) -> dict[str, Any]:
    """One exercise session as a workout entry, detail and all.

    A session whose times cannot be read is handed over as it is, so the reader
    refuses it by its own rules and names it in the log. Deciding here which
    sessions are worth passing on would put a second, quieter set of refusal
    rules in the codebase.
    """
    kind = entry.get("type")
    name = kind.replace("_", " ").strip().title() if isinstance(kind, str) else ""
    workout: dict[str, Any] = {"name": name}
    start = _moment(entry, zone)
    end_raw = read_time(entry.get("end_time"), dt.timezone.utc)
    end = None if end_raw is None else end_raw.instant
    if start is None or end is None or end < start:
        workout["start"] = entry.get("start_time")
        return workout

    seconds = quantity(entry.get("duration_seconds"))
    workout["start"] = _stamp(start, zone)
    workout["end"] = _stamp(end, zone)
    workout["duration"] = seconds if seconds is not None else (end - start).total_seconds()

    # Distance but no path: Health Connect exports no route, so an Android
    # workout draws no line.
    metres = quantity(entry.get("distance_meters"))
    if metres is not None:
        workout["distance"] = {"qty": metres, "units": "m"}

    beats = [
        value
        for value in (quantity(item.get("bpm")) for _, item in _window(heart, start, end))
        if value is not None
    ]
    if beats:
        workout["heartRate"] = {
            "min": min(beats),
            "avg": sum(beats) / len(beats),
            "max": max(beats),
        }

    # Health Connect usually sends no energy for a session, so a workout
    # without any keeps its calories blank rather than claiming nil.
    burned = _window(energy, start, end)
    calories = [value for _, item in burned if (value := quantity(item.get("calories")))]
    if calories:
        workout["activeEnergyBurned"] = {"qty": sum(calories), "units": "kcal"}
        workout["activeEnergy"] = [
            {**point, "units": "kcal"} for point in _folded(burned, "calories", "sum", zone)
        ]

    per_minute = _folded(_window(heart, start, end), "bpm", "avg", zone)
    if per_minute:
        workout["heartRateData"] = [
            {"date": point["date"], "Avg": point["qty"]} for point in per_minute
        ]

    counted = _folded(_window(steps, start, end), "count", "sum", zone)
    if counted:
        workout["stepCount"] = counted

    covered = _folded(_window(distance, start, end), "meters", "sum", zone)
    if covered:
        workout["walkingAndRunningDistance"] = [{**point, "units": "m"} for point in covered]

    return workout


def translate(payload: dict[str, Any], zone: dt.tzinfo) -> dict[str, Any]:
    """The export, rewritten as the metrics and workouts the reader takes.

    Nothing is capped here. The endpoint counts what comes out of this and
    refuses an export that is past its caps, which is the one place that
    decision belongs.
    """
    sessions = [row for key in SESSIONS for row in _objects(payload, key)]
    heart = _in_order(_objects(payload, "heart_rate"), zone)
    energy = _in_order(_objects(payload, "active_calories"), zone)
    steps = _in_order(_objects(payload, "steps"), zone)
    distance = _in_order(_objects(payload, "distance"), zone)

    workouts = [_session(entry, zone, heart, energy, steps, distance) for entry in sessions]

    # Health Connect keeps no daily exercise total of its own, so the minutes
    # are the sessions' own lengths added up, filed under the same name the
    # iPhone dialect uses so one tile reads one metric on either platform.
    minutes: list[dict[str, Any]] = []
    for entry in sessions:
        start = _moment(entry, zone)
        seconds = quantity(entry.get("duration_seconds"))
        if start is None or seconds is None or seconds <= 0:
            continue
        minutes.append({"date": _stamp(start, zone), "qty": seconds / 60.0})

    metrics = [
        entry
        for entry in (
            _metric("step_count", _objects(payload, "steps"), "count", "count", zone),
            _metric(
                "active_energy", _objects(payload, "active_calories"), "calories", "kcal", zone
            ),
            _metric(
                "walking_running_distance", _objects(payload, "distance"), "meters", "m", zone
            ),
            _metric(
                "resting_heart_rate",
                _objects(payload, "resting_heart_rate"),
                "bpm",
                "count/min",
                zone,
            ),
            _metric("weight_body_mass", _objects(payload, "weight"), "kilograms", "kg", zone),
            _metric(
                "body_fat_percentage", _objects(payload, "body_fat"), "percentage", "%", zone
            ),
            _heart_rate_metric(_objects(payload, "heart_rate"), zone),
            {"name": "apple_exercise_time", "units": "min", "data": minutes} if minutes else None,
        )
        if entry is not None
    ]

    return {"data": {"metrics": metrics, "workouts": workouts}}


def _heart_rate_metric(
    records: list[dict[str, Any]], zone: dt.tzinfo
) -> dict[str, Any] | None:
    """All-day heart rate, written the way the iPhone dialect writes it: a
    reading with a mean on it rather than a bare number."""
    points = []
    for item in records:
        when = _moment(item, zone)
        bpm = quantity(item.get("bpm"))
        if when is None or bpm is None:
            continue
        points.append({"date": _stamp(when, zone), "Avg": bpm})
    if not points:
        return None
    return {"name": "heart_rate", "units": "count/min", "data": points}
