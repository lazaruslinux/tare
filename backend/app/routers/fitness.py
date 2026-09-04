"""What a phone sent, read back for the Fitness screen.

A day's readings are private without qualification, the way the diary is: no
address here answers for somebody else's day, and an administrator is nobody
special. One session is the exception, and only the one the member shared: a
workout the feed carries reads for every member, minus whatever its owner
keeps to themselves.

The other half of the file is the seam: the diary and the targets both need to
know what was imported for a day, and the rule for counting a day's exercise
once lives here so the two of them cannot drift apart.
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import clock, fitness_catalog, health, models
from app.db import get_db
from app.deps import require_user

router = APIRouter(prefix="/fitness", tags=["fitness"])
workouts_router = APIRouter(prefix="/workouts", tags=["fitness"])

BAD_DATE = "That is not a date."
BAD_METRIC = "That is not something Tare keeps."
MISSING_WORKOUT = "There is no such workout."

# The three parts of a shared session a member may keep back, by the names the
# account's own list holds. Anything else is a name Tare has never had.
HIDEABLE = ("avg_hr", "kcal", "route")
BAD_HIDDEN = "That is not something Tare can hide."

# How much history a screen may ask for at once, and what it gets by default.
DEFAULT_DAYS = 30
MAX_DAYS = 365

# How many workouts one page of the list carries.
PAGE = 30

# The four the hour bars are drawn from.
INTRADAY_METRICS = ("steps", "active_kcal", "distance", "hr")


def asked_day(raw: str, user: models.User) -> dt.date:
    if not raw:
        return clock.user_today(user)
    try:
        return dt.date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_DATE) from None


# The seam
# --------


def workouts_on(db: Session, user: models.User, day: dt.date) -> list[models.Workout]:
    """The sessions that arrived from a phone for one day, oldest first."""
    return list(
        db.execute(
            select(models.Workout)
            .where(models.Workout.user_id == user.id, models.Workout.date_for == day)
            .order_by(models.Workout.started_at)
        ).scalars()
    )


def workout_minutes(row: models.Workout) -> int:
    return round(row.duration_s / 60)


def day_exercise(
    manual: list[models.ExerciseEntry], imported: list[models.Workout]
) -> tuple[float, int]:
    """One day's exercise counted once: its calories and its minutes.

    Decision 7 says a manual entry and an imported workout that overlap count
    once and the imported one wins. A manual entry carries a day and a length
    and no clock time, so whether two of them overlap cannot be asked. What is
    left of the rule at the resolution the data has is this: the larger of the
    two sides stands for the day, and the two are never added together. The
    imported figure wins every time it is the larger, which is the case the
    rule exists for, and a day of manual work the phone never saw is not
    thrown away.
    """
    manual_kcal = sum(row.kcal for row in manual)
    manual_minutes = sum(row.minutes for row in manual)
    imported_kcal = sum(row.kcal or 0.0 for row in imported)
    imported_minutes = sum(workout_minutes(row) for row in imported)
    return max(manual_kcal, imported_kcal), max(manual_minutes, imported_minutes)


def steps_on(db: Session, user: models.User, days: list[dt.date]) -> dict[dt.date, int]:
    """The step count for each of a run of days, missing where none arrived."""
    if not days:
        return {}
    rows = db.execute(
        select(models.FitnessDaily.date_for, models.FitnessDaily.value).where(
            models.FitnessDaily.user_id == user.id,
            models.FitnessDaily.metric == fitness_catalog.METRIC_FOR_TILE["steps"],
            models.FitnessDaily.date_for.in_(days),
        )
    )
    return {row.date_for: round(row.value) for row in rows if row.value is not None}


def imported_row(row: models.Workout) -> dict[str, object]:
    """One imported session as the Journal's exercise list reads it.

    No id of the kind a manual entry carries, because there is nothing to
    delete: what arrived from a phone is corrected on the phone.
    """
    return {
        "id": None,
        "workout_id": row.id,
        "date": row.date_for.isoformat(),
        "activity": row.activity,
        "name": row.activity,
        "effort": None,
        "minutes": workout_minutes(row),
        "kcal": None if row.kcal is None else health.round_for_display(row.kcal, "calories"),
        "source": row.source,
    }


# What the screen reads
# ---------------------


def workout_row(row: models.Workout) -> dict[str, object]:
    return {
        "id": row.id,
        "activity": row.activity,
        "date": row.date_for.isoformat(),
        "started_at": row.started_at.isoformat(),
        "duration_s": row.duration_s,
        "kcal": None if row.kcal is None else health.round_for_display(row.kcal, "calories"),
        "distance_m": row.distance_m,
        "avg_hr": row.avg_hr,
        "max_hr": row.max_hr,
        "elevation_gain_m": row.elevation_gain_m,
        "indoor": row.indoor,
        "source": row.source,
        # Whether the owner has kept this one out of the community feed.
        "hidden_from_feed": row.hidden_from_feed,
        # What looked odd about it, so a screen can say so rather than quietly
        # showing a number nobody could have run.
        "flags": sorted(row.flags or {}),
    }


def _tile_values(
    db: Session, user: models.User, first: dt.date, last: dt.date
) -> dict[tuple[dt.date, str], float]:
    """Every tile's figure across a run of days, in one query."""
    wanted = {name: key for key, name, _, _ in fitness_catalog.TILES}
    rows = db.execute(
        select(
            models.FitnessDaily.date_for,
            models.FitnessDaily.metric,
            models.FitnessDaily.value,
        ).where(
            models.FitnessDaily.user_id == user.id,
            models.FitnessDaily.metric.in_(list(wanted)),
            models.FitnessDaily.date_for >= first,
            models.FitnessDaily.date_for <= last,
        )
    )
    return {
        (row.date_for, wanted[row.metric]): row.value
        for row in rows
        if row.value is not None
    }


def _run(first: dt.date, last: dt.date) -> list[dt.date]:
    return [first + dt.timedelta(days=step) for step in range((last - first).days + 1)]


@router.get("/summary")
def read_summary(
    date: str = "",
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """One day's four figures, the week behind it, and that day's workouts.

    The week rides along rather than being asked for four times over: the
    screen draws a small bar chart under every tile, and four requests for one
    screen would show three quarters of it while the last was still out.
    """
    day = asked_day(date, user)
    first = day - dt.timedelta(days=6)
    values = _tile_values(db, user, first, day)
    token = db.get(models.IngestToken, user.id)
    profile = db.get(models.HealthProfile, user.id)

    return {
        "date": day.isoformat(),
        "connected": token is not None,
        "last_sync": None if token is None or token.last_used_at is None
        else token.last_used_at.isoformat(),
        "today": {key: values.get((day, key)) for key in fitness_catalog.TILE_KEYS},
        "week": [
            {
                "date": each.isoformat(),
                **{key: values.get((each, key)) for key in fitness_catalog.TILE_KEYS},
            }
            for each in _run(first, day)
        ],
        "goals": {
            "exercise_minutes": 30 if profile is None else profile.exercise_minutes_goal,
            "steps": 8000 if profile is None else profile.step_goal,
        },
        "workouts": [workout_row(row) for row in workouts_on(db, user, day)],
    }


@router.get("/daily")
def read_daily(
    metric: str = "steps",
    days: int = DEFAULT_DAYS,
    date: str = "",
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """One tile's history, a row per calendar day rather than per day that has
    a reading: a gap is part of the picture."""
    if metric not in fitness_catalog.TILE_KEYS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_METRIC)
    last = asked_day(date, user)
    span = max(1, min(days, MAX_DAYS))
    first = last - dt.timedelta(days=span - 1)
    name = fitness_catalog.METRIC_FOR_TILE[metric]
    found = {
        row.date_for: row.value
        for row in db.execute(
            select(models.FitnessDaily.date_for, models.FitnessDaily.value).where(
                models.FitnessDaily.user_id == user.id,
                models.FitnessDaily.metric == name,
                models.FitnessDaily.date_for >= first,
                models.FitnessDaily.date_for <= last,
            )
        )
    }
    return {
        "metric": metric,
        "unit": fitness_catalog.UNIT_FOR_TILE[metric],
        "days": [
            {"date": each.isoformat(), "value": found.get(each)} for each in _run(first, last)
        ],
    }


@router.get("/intraday")
def read_intraday(
    metric: str = "steps",
    date: str = "",
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """One day by the hour: twenty-four slots, empty where nothing landed."""
    if metric not in INTRADAY_METRICS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_METRIC)
    day = asked_day(date, user)
    hours: list[float | None] = [None] * 24
    for row in db.execute(
        select(models.FitnessIntraday.hour, models.FitnessIntraday.value).where(
            models.FitnessIntraday.user_id == user.id,
            models.FitnessIntraday.date_for == day,
            models.FitnessIntraday.metric == metric,
        )
    ):
        if 0 <= row.hour < 24:
            hours[row.hour] = row.value
    return {"date": day.isoformat(), "metric": metric, "hours": hours}


@router.get("/workouts")
def read_workouts(
    cursor: int = 0,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """The member's own sessions, newest first, a page at a time."""
    query = (
        select(models.Workout)
        .where(models.Workout.user_id == user.id)
        .order_by(models.Workout.started_at.desc(), models.Workout.id.desc())
        .limit(PAGE + 1)
    )
    if cursor:
        anchor = db.get(models.Workout, cursor)
        if anchor is None or anchor.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_WORKOUT)
        query = query.where(models.Workout.started_at < anchor.started_at)
    rows = list(db.execute(query).scalars())
    more = len(rows) > PAGE
    rows = rows[:PAGE]
    return {
        "workouts": [workout_row(row) for row in rows],
        "cursor": rows[-1].id if more and rows else None,
    }


def kept_back(owner: models.User) -> set[str]:
    """What this account keeps to itself on a workout somebody else is reading.

    Read through the three names Tare knows rather than trusted as stored: a
    list is JSON, and a name nothing recognises must not quietly widen what is
    shown.
    """
    held = owner.feed_hidden or []
    return {name for name in HIDEABLE if name in held}


def readable_workout(db: Session, workout_id: int, user: models.User) -> models.Workout:
    """One session this account may read: its own, or one a member shared.

    A workout that is not there, one somebody kept out of the feed, and one
    that never existed all answer the same sentence.
    """
    row = db.get(models.Workout, workout_id)
    if row is None or (row.user_id != user.id and row.hidden_from_feed):
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_WORKOUT)
    return row


class HidePatch(BaseModel):
    hidden_from_feed: bool


@workouts_router.get("/{workout_id}")
def read_workout(
    workout_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """One session, whole: its numbers, its minutes and its line.

    The owner reads all of it. Another member reads what was shared: the parts
    the owner holds back are left out of the answer rather than sent as null,
    so nothing on the far side has to tell a hidden number from a missing one.
    """
    row = readable_workout(db, workout_id, user)
    mine = row.user_id == user.id
    owner = user if mine else db.get(models.User, row.user_id)
    assert owner is not None
    minutes = list(
        db.execute(
            select(models.WorkoutSample)
            .where(models.WorkoutSample.workout_id == row.id)
            .order_by(models.WorkoutSample.minute)
        ).scalars()
    )
    route = db.get(models.WorkoutRoute, row.id)

    detail: dict[str, object] = {
        **workout_row(row),
        "user_id": row.user_id,
        "display_name": owner.display_name or owner.username,
        "mine": mine,
    }
    samples = [
        {
            "minute": sample.minute,
            "distance_m": sample.distance_m,
            "hr_min": sample.hr_min,
            "hr_avg": sample.hr_avg,
            "hr_max": sample.hr_max,
            "kcal": sample.kcal,
            "steps": sample.steps,
        }
        for sample in minutes
    ]
    hidden = set() if mine else kept_back(owner)
    if not mine:
        # What Tare thought of the numbers is between Tare and whoever ran it.
        detail.pop("flags", None)
    if "avg_hr" in hidden:
        detail.pop("avg_hr", None)
        detail.pop("max_hr", None)
        for sample in samples:
            for beat in ("hr_min", "hr_avg", "hr_max"):
                sample.pop(beat, None)
    if "kcal" in hidden:
        detail.pop("kcal", None)
        for sample in samples:
            sample.pop("kcal", None)
    if "route" in hidden:
        detail.pop("elevation_gain_m", None)
    else:
        detail["route"] = None if route is None else route.points
    detail["samples"] = samples
    return detail


@workouts_router.patch("/{workout_id}")
def update_workout(
    workout_id: int,
    body: HidePatch,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Whether one session is in the community feed. The owner's call alone."""
    row = db.get(models.Workout, workout_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_WORKOUT)
    row.hidden_from_feed = body.hidden_from_feed
    db.commit()
    return workout_row(row)
