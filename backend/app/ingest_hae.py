"""Reading one health export into rows.

The shape is the one the iPhone exporter posts: {"data": {"metrics": [...],
"workouts": [...]}}. The Android dialect is turned into the same shape before it
gets here (app.ingest_hc), so there is one reader rather than two.

Three rules run through the whole file.

Every metric is kept, whether or not anything draws it. What is thrown away on
the way in can never be shown later, and the point of this round is that the
data is on disk when a screen for it is written.

Nothing is refused for looking wrong. A reading past what a body does is stored
and counted as flagged; only a reading that cannot be read at all is skipped.
The phone is reporting what it measured, and this app is not the arbiter of
whether somebody's morning happened.

A weigh-in somebody typed in always wins its day. The sync fills days that are
empty and blanks that are blank, and overwrites nothing.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import clock, models, routemaps, samples
from app.fitness_catalog import (
    BODY_FAT_METRIC,
    INTRADAY,
    TILE_FOR_METRIC,
    UNIT_FOR_TILE,
    WEIGHT_METRIC,
    combine,
    headline,
    normal_unit,
    quantity,
    read_time,
    rollup,
    to_kcal,
    to_metres,
)

log = logging.getLogger("tare.ingest")

# What one export may carry. Counted before anything is parsed, so a payload
# claiming a million readings costs a length check rather than a million rows.
MAX_METRICS = 200
MAX_WORKOUTS = 2000
MAX_POINTS_PER_METRIC = 100_000

# How far before the account was opened a sync may reach. A health app is worth
# having because it knows what last year looked like, so the window is generous;
# it is anchored to the account rather than to today so that a member offline
# for a month still syncs every day of it.
BACKFILL_DAYS = 365

# What is stored without comment. Past any of these the row is still written and
# still counted, and the flag is what says it looked odd.
MAX_PLAUSIBLE_STEPS = 100_000
RESTING_HR_RANGE = (25.0, 150.0)
WEIGHT_KG_RANGE = (20.0, 400.0)
# Minutes per mile, under which nothing on foot goes.
MIN_FOOT_PACE_MIN_PER_MILE = 4.0
# Miles an hour, over which nothing on a bicycle goes.
MAX_CYCLING_MPH = 40.0

# And what is refused outright, because the number cannot be describing what it
# says it is. Counted as skipped, with the item named in the log.
MAX_DURATION_S = 24 * 3600
MAX_DISTANCE_M = 1_000_000.0
MAX_KCAL = 50_000.0

MILE_M = 1609.344
LB_KG = 0.45359237

# The words in an activity name that say what it was done with.
_ON_FOOT = ("walk", "run", "hike", "jog")
_CYCLING = ("cycl", "bike", "biking")


@dataclass
class Counts:
    """What one sync did, which is what the phone is told and what the log keeps."""

    days: int = 0
    workouts: int = 0
    flagged: int = 0
    skipped: int = 0
    items: int = 0
    # The first thing that could not be read, and why. One line, never a body.
    error: str | None = None

    def refuse(self, name: str, reason: str) -> None:
        self.skipped += 1
        if self.error is None:
            self.error = f"{name}: {reason}"[:200]


@dataclass
class _DayPoints:
    """A metric's readings for one day, before they are rolled up."""

    values: list[float] = field(default_factory=list)
    # The day's last many-figured reading, kept whole. A night's sleep is not a
    # number, and neither is a blood pressure.
    fields: dict[str, Any] | None = None
    at: dt.datetime | None = None


def envelope(payload: dict[str, Any]) -> tuple[list[Any], list[Any]]:
    """The metrics and the workouts out of an export, whatever else it holds."""
    data = payload.get("data")
    if not isinstance(data, dict):
        return [], []
    metrics = data.get("metrics")
    workouts = data.get("workouts")
    return (
        metrics if isinstance(metrics, list) else [],
        workouts if isinstance(workouts, list) else [],
    )


def too_big(metrics: list[Any], workouts: list[Any]) -> str | None:
    """The sentence for an export that is past a cap, or nothing."""
    if len(metrics) > MAX_METRICS:
        return "That export carries too many kinds of reading for one sync."
    if len(workouts) > MAX_WORKOUTS:
        return "That export carries too many workouts for one sync."
    for entry in metrics:
        points = entry.get("data") if isinstance(entry, dict) else None
        if isinstance(points, list) and len(points) > MAX_POINTS_PER_METRIC:
            return "That export carries too many readings of one kind for one sync."
    return None


def first_day(user: models.User) -> dt.date:
    """The earliest day this account may import, which is fixed to the day it
    was opened rather than to today: a member who joined this morning cannot
    import a decade of somebody else's exports."""
    zone = clock.user_tz(user)
    return (user.created_at.astimezone(zone) - dt.timedelta(days=BACKFILL_DAYS)).date()


# Writing a day
# -------------


def upsert_daily(
    db: Session,
    user_id: int,
    day: dt.date,
    metric: str,
    value: float | None,
    unit: str,
    fields: dict[str, Any] | None = None,
    origin: str = "sync",
) -> bool:
    """One metric's figure for one day. Answers whether a row was created.

    An upsert rather than an insert, because a resend of the same window is the
    ordinary case: a phone posts the last few days every time it runs.
    """
    row = db.scalar(
        select(models.FitnessDaily).where(
            models.FitnessDaily.user_id == user_id,
            models.FitnessDaily.date_for == day,
            models.FitnessDaily.metric == metric,
        )
    )
    fresh = row is None
    if row is None:
        row = models.FitnessDaily(user_id=user_id, date_for=day, metric=metric)
        db.add(row)
    row.value = None if value is None else round(value, 3)
    row.unit = unit[:20]
    row.fields = fields
    row.source = origin
    return fresh


def upsert_intraday(
    db: Session,
    user_id: int,
    day: dt.date,
    hour: int,
    metric: str,
    value: float,
    unit: str,
    origin: str = "sync",
) -> None:
    row = db.scalar(
        select(models.FitnessIntraday).where(
            models.FitnessIntraday.user_id == user_id,
            models.FitnessIntraday.date_for == day,
            models.FitnessIntraday.metric == metric,
            models.FitnessIntraday.hour == hour,
        )
    )
    if row is None:
        row = models.FitnessIntraday(
            user_id=user_id, date_for=day, metric=metric, hour=hour
        )
        db.add(row)
    row.value = round(value, 3)
    row.unit = unit[:20]
    row.source = origin


# Reading the metrics
# -------------------


def _point_fields(point: dict[str, Any]) -> dict[str, Any]:
    """Everything a reading said apart from when it was and what it measured.

    A night's sleep arrives as its stages, a blood pressure as two numbers and
    an all-day heart rate as a low, a mean and a high. None of them is one
    figure, so all of them are kept as they came.
    """
    return {
        key: value
        for key, value in point.items()
        if key not in ("date", "qty", "units", "source")
        and isinstance(value, (int, float, str, bool))
    }


def _tile_value(metric: str, point: Any, unit: str) -> float | None:
    """A tile's reading in the unit the tile is drawn in.

    Only the four the screen shows are converted. A phone set to kilojoules
    would otherwise put its number under a label that says calories.
    """
    if metric == "active_energy":
        return to_kcal(point, unit)
    return quantity(point)


def import_metrics(
    db: Session,
    user: models.User,
    metrics: list[Any],
    zone: dt.tzinfo,
    counts: Counts,
    origin: str = "sync",
) -> None:
    earliest = first_day(user)
    body_fat: list[tuple[dt.date, dt.datetime, float]] = []
    weights: list[tuple[dt.date, dt.datetime, float]] = []

    for entry in metrics[:MAX_METRICS]:
        if not isinstance(entry, dict):
            counts.refuse("a reading", "it is not a reading this can read.")
            continue
        name = entry.get("name")
        if not isinstance(name, str) or not name.strip():
            counts.refuse("a reading", "it did not say what it measured.")
            continue
        name = name.strip()[:60]
        points = entry.get("data")
        points = points if isinstance(points, list) else []
        counts.items += len(points)

        tile = TILE_FOR_METRIC.get(name)
        unit = UNIT_FOR_TILE[tile] if tile else normal_unit(entry.get("units"))
        rule = rollup(unit)
        by_day: dict[dt.date, _DayPoints] = {}

        for point in points[:MAX_POINTS_PER_METRIC]:
            if not isinstance(point, dict):
                counts.refuse(name, "one reading was not readable.")
                continue
            moment = read_time(point.get("date"), zone)
            if moment is None:
                counts.refuse(name, "one reading had no time on it.")
                continue
            if moment.day < earliest:
                counts.refuse(name, "it is older than this account reaches back.")
                continue
            value = _tile_value(name, point, unit)
            extras = _point_fields(point)
            bucket = by_day.setdefault(moment.day, _DayPoints())
            if value is not None:
                bucket.values.append(value)
                if not extras:
                    continue
            if bucket.at is None or moment.instant >= bucket.at:
                bucket.at = moment.instant
                bucket.fields = extras or None
                if value is None:
                    bucket.values = []

        for day, gathered in by_day.items():
            value = combine(gathered.values, rule)
            if value is None and gathered.fields is not None:
                value = headline(gathered.fields)
            if upsert_daily(db, user.id, day, name, value, unit, gathered.fields, origin):
                counts.days += 1
            if value is not None and _implausible(name, value):
                counts.flagged += 1

        if name in INTRADAY:
            _store_intraday(db, user, name, unit, points, zone, earliest, origin)
        if name == WEIGHT_METRIC:
            weights.extend(_weigh_ins(points, unit, zone, earliest))
        if name == BODY_FAT_METRIC:
            body_fat.extend(_body_fats(points, zone, earliest))

    _write_weights(db, user, weights, counts, origin)
    _write_body_fat(db, user, body_fat)


def _implausible(metric: str, value: float) -> bool:
    """Whether a day's figure is past what a body does. Never a refusal."""
    if metric == "step_count":
        return value > MAX_PLAUSIBLE_STEPS
    if metric == "resting_heart_rate":
        return not (RESTING_HR_RANGE[0] <= value <= RESTING_HR_RANGE[1])
    return False


def _store_intraday(
    db: Session,
    user: models.User,
    name: str,
    unit: str,
    points: list[Any],
    zone: dt.tzinfo,
    earliest: dt.date,
    origin: str = "sync",
) -> None:
    """The hour bars: a metric's readings bucketed to the hour they landed in.

    An export that sends one point a day files the whole day under that point's
    hour, which is coarse but true. A finer export draws a finer picture without
    anything here changing.
    """
    key, rule = INTRADAY[name]
    stored_unit = "m" if key == "distance" else unit
    buckets: dict[tuple[dt.date, int], list[float]] = {}
    for point in points[:MAX_POINTS_PER_METRIC]:
        if not isinstance(point, dict):
            continue
        moment = read_time(point.get("date"), zone)
        if moment is None or moment.day < earliest:
            continue
        if key == "distance":
            value = to_metres(point, unit)
        elif key == "active_kcal":
            value = to_kcal(point, unit)
        else:
            value = quantity(point)
        if value is None:
            # An all-day heart rate arrives as a low, a mean and a high rather
            # than one number, so the mean is the reading the hour is drawn at.
            value = headline(point)
        if value is None:
            continue
        buckets.setdefault((moment.day, moment.hour), []).append(value)
    for (day, hour), values in buckets.items():
        rolled = combine(values, rule)
        if rolled is not None:
            upsert_intraday(db, user.id, day, hour, key, rolled, stored_unit, origin)


def _weigh_ins(
    points: list[Any], unit: str, zone: dt.tzinfo, earliest: dt.date
) -> list[tuple[dt.date, dt.datetime, float]]:
    """The scale readings in one metric, in kilograms, newest per day kept."""
    out: list[tuple[dt.date, dt.datetime, float]] = []
    for point in points[:MAX_POINTS_PER_METRIC]:
        if not isinstance(point, dict):
            continue
        moment = read_time(point.get("date"), zone)
        value = quantity(point.get("qty"))
        if moment is None or value is None or moment.day < earliest:
            continue
        kg = value * LB_KG if normal_unit(unit).startswith("lb") else value
        out.append((moment.day, moment.instant, kg))
    return out


def _body_fats(
    points: list[Any], zone: dt.tzinfo, earliest: dt.date
) -> list[tuple[dt.date, dt.datetime, float]]:
    out: list[tuple[dt.date, dt.datetime, float]] = []
    for point in points[:MAX_POINTS_PER_METRIC]:
        if not isinstance(point, dict):
            continue
        moment = read_time(point.get("date"), zone)
        value = quantity(point.get("qty"))
        if moment is None or value is None or moment.day < earliest:
            continue
        # A phone stores this as a fraction and its exporter has shipped it both
        # ways. Nobody is at one percent body fat, so at or under 1.0 it can
        # only be a fraction.
        pct = value * 100.0 if value <= 1.0 else value
        if not (1.0 < pct <= 75.0):
            continue
        out.append((moment.day, moment.instant, pct))
    return out


def _write_weights(
    db: Session,
    user: models.User,
    weights: list[tuple[dt.date, dt.datetime, float]],
    counts: Counts,
    origin: str = "sync",
) -> None:
    """The scale's readings onto the weigh-in log, and only onto empty days.

    A weigh-in somebody typed in is a deliberate act and always wins its day.
    """
    newest: dict[dt.date, tuple[dt.datetime, float]] = {}
    for day, at, kg in weights:
        if day not in newest or at > newest[day][0]:
            newest[day] = (at, kg)
    for day, (_, kg) in newest.items():
        if not (WEIGHT_KG_RANGE[0] <= kg <= WEIGHT_KG_RANGE[1]):
            # Kept in the fitness table with everything else, and left out of
            # the log the calorie budget is worked out from: a scale that read
            # five kilograms would move every number on the Targets screen.
            counts.flagged += 1
            continue
        existing = db.scalar(
            select(models.WeightEntry).where(
                models.WeightEntry.user_id == user.id, models.WeightEntry.date_for == day
            )
        )
        if existing is not None:
            continue
        db.add(
            models.WeightEntry(
                user_id=user.id,
                date_for=day,
                weight_kg=round(kg, 2),
                source="ingest",
                # The source stays what it is. This is the mark that says a
                # file brought it, and it is the only thing a wipe reads.
                via="upload" if origin == "upload" else None,
            )
        )


def _write_body_fat(
    db: Session, user: models.User, readings: list[tuple[dt.date, dt.datetime, float]]
) -> None:
    """Body fat onto the day's weigh-in, and only into a blank."""
    newest: dict[dt.date, tuple[dt.datetime, float]] = {}
    for day, at, pct in readings:
        if day not in newest or at > newest[day][0]:
            newest[day] = (at, pct)
    if not newest:
        return
    # This payload's own weigh-ins are usually still pending inserts, and the
    # session does not autoflush: make them queryable first.
    db.flush()
    for day, (_, pct) in newest.items():
        entry = db.scalar(
            select(models.WeightEntry).where(
                models.WeightEntry.user_id == user.id, models.WeightEntry.date_for == day
            )
        )
        if entry is None or entry.body_fat_pct is not None:
            continue
        entry.body_fat_pct = round(pct, 1)


# Reading the workouts
# --------------------


def _pace_flags(activity: str, duration_s: int, distance_m: float | None) -> dict[str, Any]:
    """What looks wrong about how fast a session went. Never a refusal."""
    if not distance_m or distance_m <= 0 or duration_s <= 0:
        return {}
    name = activity.lower()
    miles = distance_m / MILE_M
    minutes = duration_s / 60.0
    if any(word in name for word in _ON_FOOT) and minutes / miles < MIN_FOOT_PACE_MIN_PER_MILE:
        return {"impossible_pace": True}
    if any(word in name for word in _CYCLING) and miles / (duration_s / 3600.0) > MAX_CYCLING_MPH:
        return {"impossible_pace": True}
    return {}


def _existing_workout(
    db: Session, user_id: int, external_id: str | None, started: dt.datetime, duration_s: int
) -> models.Workout | None:
    """The row this session is already stored as, if it is.

    The exporter's own id first. Without one, the same moment and the same
    length, with a second of slack on the length: a duration rounded one way in
    one version of an export and the other way in the next must land on the row
    it already has rather than beside it.
    """
    if external_id:
        found = db.scalar(
            select(models.Workout).where(
                models.Workout.user_id == user_id,
                models.Workout.external_id == external_id,
            )
        )
        if found is not None:
            return found
    return db.scalar(
        select(models.Workout).where(
            models.Workout.user_id == user_id,
            models.Workout.started_at == started,
            models.Workout.duration_s.between(duration_s - 1, duration_s + 1),
        )
    )


def import_workouts(
    db: Session,
    user: models.User,
    workouts: list[Any],
    zone: dt.tzinfo,
    source: str,
    counts: Counts,
) -> None:
    earliest = first_day(user)
    for entry in workouts[:MAX_WORKOUTS]:
        counts.items += 1
        if not isinstance(entry, dict):
            counts.refuse("a workout", "it is not a workout this can read.")
            continue
        name = entry.get("name")
        if not isinstance(name, str) or not name.strip():
            counts.refuse("a workout", "it did not say what it was.")
            continue
        activity = name.strip()[:80]
        started = read_time(entry.get("start"), zone)
        if started is None:
            counts.refuse(activity, "its start time could not be read.")
            continue
        if started.day < earliest:
            counts.refuse(activity, "it is older than this account reaches back.")
            continue
        ended = read_time(entry.get("end"), zone)

        seconds = quantity(entry.get("duration"))
        if seconds is None and ended is not None:
            seconds = (ended.instant - started.instant).total_seconds()
        if seconds is None or seconds < 0 or seconds > MAX_DURATION_S:
            counts.refuse(activity, "its length is not a length.")
            continue
        duration_s = int(seconds)

        kcal = to_kcal(entry.get("activeEnergyBurned"), "kcal")
        if kcal is not None and (kcal < 0 or kcal > MAX_KCAL):
            counts.refuse(activity, "its calories are not calories.")
            continue
        distance_m = to_metres(entry.get("distance"))
        if distance_m is not None and (distance_m < 0 or distance_m > MAX_DISTANCE_M):
            counts.refuse(activity, "its distance is not a distance.")
            continue

        if _existing_workout(db, user.id, _external(entry), started.instant, duration_s):
            counts.skipped += 1
            continue

        heart = entry.get("heartRate")
        heart_fields = samples.keyed(heart) if isinstance(heart, dict) else {}
        workout = models.Workout(
            user_id=user.id,
            external_id=_external(entry),
            activity=activity,
            started_at=started.instant,
            ended_at=None if ended is None else ended.instant,
            date_for=started.day,
            duration_s=duration_s,
            kcal=None if kcal is None else round(kcal, 1),
            distance_m=None if distance_m is None else round(distance_m, 1),
            avg_hr=_beats(heart_fields.get("avg")),
            max_hr=_beats(heart_fields.get("max")),
            elevation_gain_m=None,
            indoor=bool(entry.get("isIndoor")),
            # A file can carry a year of somebody else's mornings, so nothing
            # out of one is put in front of anybody until they say so.
            hidden_from_feed=source == "upload",
            source=source,
            flags=_pace_flags(activity, duration_s, distance_m),
            created_at=models.now_utc(),
        )
        try:
            # A savepoint each, so one workout the database objects to rolls
            # back alone rather than taking the whole export with it.
            with db.begin_nested():
                db.add(workout)
                db.flush()
        except IntegrityError:
            counts.skipped += 1
            continue

        counts.workouts += 1
        if workout.flags:
            counts.flagged += 1
        routemaps.store_route(db, workout.id, entry.get("route"))
        samples.record(db, workout, entry, zone)


def _external(entry: dict[str, Any]) -> str | None:
    value = entry.get("id")
    return value.strip()[:64] if isinstance(value, str) and value.strip() else None


def _beats(value: Any) -> int | None:
    number = quantity(value)
    if number is None or not (samples.MIN_HR <= number <= samples.MAX_HR):
        return None
    return round(number)


def import_payload(
    db: Session, user: models.User, payload: dict[str, Any], source: str = "apple"
) -> Counts:
    """One export, read whole. The caller has already checked its size.

    `source` says which way in this was: a phone's own exporter, the Android
    bridge, or a file somebody picked. Everything else here reads it as the one
    question that matters later, which is whether a wipe should take this row.
    """
    zone = clock.user_tz(user)
    origin = "upload" if source == "upload" else "sync"
    metrics, workouts = envelope(payload)
    counts = Counts()
    import_metrics(db, user, metrics, zone, counts, origin)
    import_workouts(db, user, workouts, zone, source, counts)
    return counts
