"""What a phone sent, read back for the Fitness screen.

A day's readings are private, the way the diary is, and an administrator is
nobody special; the one exception is a workout its owner shares, which reads
for that owner's friends minus whatever they keep back. The rule for counting
a day's exercise once also lives here, so the diary and the targets agree.
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import clock, fitness_catalog, health, models, splits
from app.db import get_db
from app.deps import require_user
from app.friends import friend_ids

router = APIRouter(prefix="/fitness", tags=["fitness"])
workouts_router = APIRouter(prefix="/workouts", tags=["fitness"])

BAD_DATE = "That is not a date."
BAD_METRIC = "That is not something Tare keeps."
MISSING_WORKOUT = "There is no such workout."

# The two things a member may keep back on a shared session, by the names the
# account's own list holds: the whole breakdown, and the route with the climb
# that goes with it. Anything else is a name Tare has never had.
HIDEABLE = ("details", "route")
BAD_HIDDEN = "That is not something Tare can hide."

# What a day of movement may be aimed at. Wide enough for anybody's day and
# narrow enough to catch a figure typed with a digit too many. The bounds sit
# here rather than beside the two profile fields they were written for, because
# a day's own goal is held to the same ones and this is the module the profile
# can read them from.
MIN_MINUTES_GOAL = 5
MAX_MINUTES_GOAL = 600
MIN_STEP_GOAL = 1000
MAX_STEP_GOAL = 50000
BAD_MINUTES_GOAL = f"Pick a goal between {MIN_MINUTES_GOAL} and {MAX_MINUTES_GOAL} minutes."
BAD_STEP_GOAL = f"Pick a goal between {MIN_STEP_GOAL:,} and {MAX_STEP_GOAL:,} steps."
DEFAULT_MINUTES_GOAL = 30
DEFAULT_STEP_GOAL = 8000

# A day that has not happened yet is not one to aim at, or to weigh on.
FUTURE_MEASUREMENT = "That day is in the future."

# How much history a screen may ask for at once, and what it gets by default.
DEFAULT_DAYS = 30
MAX_DAYS = 365

# The longest run of whole days one answer carries, which is the six months the
# Dashboard reads over with a little room over it.
MAX_RUN_DAYS = 190
BAD_SPAN = f"Ask for between 1 and {MAX_RUN_DAYS} days."

# How many workouts one page of the list carries.
PAGE = 30

# The four the hour bars are drawn from.
INTRADAY_METRICS = ("steps", "active_kcal", "distance", "hr")

# What a history may be asked for: the four tiles, and the distance walked,
# which is added up from the hour rows rather than stored a day at a time.
DAILY_METRICS = fitness_catalog.TILE_KEYS + ("distance",)

# The two windows a trend compares: the week just gone against the four weeks
# before it.
RECENT_DAYS = 7
PRIOR_DAYS = 28

# How far either way a figure has to move before it is a direction rather than
# the same week said again.
TREND_BAND = 0.05


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

    A manual entry and an imported workout that overlap count once, and a
    manual entry has no clock time to test overlap with, so the larger side
    stands for the day and the two are never added (decision 7).
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


def goals_over(
    db: Session, user: models.User, days: list[dt.date]
) -> dict[dt.date, tuple[int, int]]:
    """The steps and the exercise minutes in force on each of a run of days.

    The profile carries the pair a day is read against unless the member set
    that one day apart, and a null column on a day's own row means that figure
    is still the profile's. One query for the whole run rather than one a day,
    for the same reason the tile figures are read in one.
    """
    profile = db.get(models.HealthProfile, user.id)
    steps = DEFAULT_STEP_GOAL if profile is None else profile.step_goal
    minutes = DEFAULT_MINUTES_GOAL if profile is None else profile.exercise_minutes_goal
    apart = {
        row.date: row
        for row in db.execute(
            select(models.DayGoal).where(
                models.DayGoal.user_id == user.id, models.DayGoal.date.in_(days)
            )
        ).scalars()
    }
    found = {}
    for day in days:
        own = apart.get(day)
        found[day] = (
            steps if own is None or own.step_goal is None else own.step_goal,
            minutes
            if own is None or own.exercise_minutes_goal is None
            else own.exercise_minutes_goal,
        )
    return found


def goals_on(db: Session, user: models.User, day: dt.date) -> tuple[int, int]:
    """One day's goals: the steps, then the exercise minutes. Every reader of a
    day's goals goes through here, so an override is the truth everywhere."""
    return goals_over(db, user, [day])[day]


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
    week_workouts = (
        db.execute(
            select(func.count(models.Workout.id)).where(
                models.Workout.user_id == user.id,
                models.Workout.date_for >= first,
                models.Workout.date_for <= day,
            )
        ).scalar_one()
        or 0
    )
    token = db.get(models.IngestToken, user.id)
    step_goal, minutes_goal = goals_on(db, user, day)

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
        # The figures in force on this day, which are the usual pair unless
        # the member set this one day apart.
        "goals": {"exercise_minutes": minutes_goal, "steps": step_goal},
        # How many sessions the same seven days hold. The member's own count,
        # so one they keep out of the feed is still one they did.
        "week_workouts": week_workouts,
        "workouts": [workout_row(row) for row in workouts_on(db, user, day)],
    }


def goals_payload(db: Session, user: models.User, day: dt.date) -> dict[str, object]:
    """One day's goals as a screen reads them: the figures in force, the usual
    pair behind them, and whether this day was set apart from it."""
    profile = db.get(models.HealthProfile, user.id)
    steps, minutes = goals_on(db, user, day)
    own = db.get(models.DayGoal, (user.id, day))
    return {
        "date": day.isoformat(),
        "steps": steps,
        "exercise_minutes": minutes,
        "defaults": {
            "steps": DEFAULT_STEP_GOAL if profile is None else profile.step_goal,
            "exercise_minutes": (
                DEFAULT_MINUTES_GOAL if profile is None else profile.exercise_minutes_goal
            ),
        },
        "overridden": own is not None
        and (own.step_goal is not None or own.exercise_minutes_goal is not None),
    }


class GoalsIn(BaseModel):
    """What one day is aimed at. Either key may be left out, which leaves that
    one as it was, and either may be sent as null, which is how a figure is put
    back to the usual one."""

    steps: int | None = None
    exercise_minutes: int | None = None


@router.get("/goals")
def read_goals(
    date: str = "",
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """What one day is aimed at, and what it would be aimed at by default."""
    return goals_payload(db, user, asked_day(date, user))


@router.put("/goals/{date}")
def write_goals(
    date: str,
    body: GoalsIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Set one day apart from the usual goals, or put it back.

    The row is the difference and nothing else: a day left with neither figure
    on it is deleted rather than kept as a copy of the profile, so a later
    change to the usual goals carries that day with it.
    """
    day = asked_day(date, user)
    if day > clock.user_today(user):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, FUTURE_MEASUREMENT)
    sent = body.model_fields_set
    if body.steps is not None and not (MIN_STEP_GOAL <= body.steps <= MAX_STEP_GOAL):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_STEP_GOAL)
    if body.exercise_minutes is not None and not (
        MIN_MINUTES_GOAL <= body.exercise_minutes <= MAX_MINUTES_GOAL
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_MINUTES_GOAL)

    row = db.get(models.DayGoal, (user.id, day))
    steps = None if row is None else row.step_goal
    minutes = None if row is None else row.exercise_minutes_goal
    if "steps" in sent:
        steps = body.steps
    if "exercise_minutes" in sent:
        minutes = body.exercise_minutes

    if steps is None and minutes is None:
        if row is not None:
            db.delete(row)
    elif row is None:
        # Two screens can set the same day at once. The insert goes in a
        # savepoint: the one that loses the race writes onto the row the other
        # one made instead of failing.
        try:
            with db.begin_nested():
                db.add(
                    models.DayGoal(
                        user_id=user.id, date=day, step_goal=steps, exercise_minutes_goal=minutes
                    )
                )
                db.flush()
        except IntegrityError:
            db.expire_all()
            made = db.get(models.DayGoal, (user.id, day))
            if made is None:
                raise
            # Only what this request actually sent goes onto the row the other
            # one made, so the figure it set is not written over by a default.
            if "steps" in sent:
                made.step_goal = body.steps
            if "exercise_minutes" in sent:
                made.exercise_minutes_goal = body.exercise_minutes
    else:
        row.step_goal = steps
        row.exercise_minutes_goal = minutes
    db.commit()
    return goals_payload(db, user, day)


def _distance_by_day(
    db: Session, user: models.User, first: dt.date, last: dt.date
) -> dict[dt.date, float]:
    """How far the member walked or ran on each day of a run, in metres.

    Added up from the hour rows rather than read off a daily one. The catalogue
    maps no daily distance tile, and the row the exporter writes for a day
    keeps whatever unit the phone declared, so the hour rows are the only
    distance already normalised to metres.
    """
    rows = db.execute(
        select(models.FitnessIntraday.date_for, func.sum(models.FitnessIntraday.value))
        .where(
            models.FitnessIntraday.user_id == user.id,
            models.FitnessIntraday.metric == "distance",
            models.FitnessIntraday.date_for >= first,
            models.FitnessIntraday.date_for <= last,
        )
        .group_by(models.FitnessIntraday.date_for)
    )
    return {day: float(total) for day, total in rows if total is not None}


def _daily_average(
    db: Session, user: models.User, name: str, first: dt.date, last: dt.date
) -> float | None:
    """A stored metric's average day across a window.

    Days nothing arrived for are not part of the average: a week the phone was
    off for four days averages the three it saw, rather than reading as though
    the member sat still. Nothing at all in the window is nothing, not zero.
    """
    values = [
        row.value
        for row in db.execute(
            select(models.FitnessDaily.value).where(
                models.FitnessDaily.user_id == user.id,
                models.FitnessDaily.metric == name,
                models.FitnessDaily.date_for >= first,
                models.FitnessDaily.date_for <= last,
            )
        )
        if row.value is not None
    ]
    return sum(values) / len(values) if values else None


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _workouts_a_week(
    db: Session, user: models.User, first: dt.date, last: dt.date
) -> float:
    """Sessions in a window, said per week.

    Counted over the whole window rather than over the days that carry one: a
    week with no session did have none, which is the fact being compared.
    """
    count = (
        db.execute(
            select(func.count(models.Workout.id)).where(
                models.Workout.user_id == user.id,
                models.Workout.date_for >= first,
                models.Workout.date_for <= last,
            )
        ).scalar_one()
        or 0
    )
    return count / ((last - first).days + 1) * 7


def _direction(recent: float | None, prior: float | None) -> str | None:
    """Which way a figure moved, or nothing when there is not enough to say."""
    if recent is None or prior is None:
        return None
    if recent > prior * (1 + TREND_BAND):
        return "up"
    if recent < prior * (1 - TREND_BAND):
        return "down"
    return "flat"


@router.get("/trends")
def read_trends(
    date: str = "",
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """The last seven days against the twenty-eight before them, four ways."""
    day = asked_day(date, user)
    recent_first = day - dt.timedelta(days=RECENT_DAYS - 1)
    prior_last = recent_first - dt.timedelta(days=1)
    prior_first = prior_last - dt.timedelta(days=PRIOR_DAYS - 1)

    def stored(key: str) -> tuple[float | None, float | None]:
        name = fitness_catalog.METRIC_FOR_TILE[key]
        return (
            _daily_average(db, user, name, recent_first, day),
            _daily_average(db, user, name, prior_first, prior_last),
        )

    steps_recent, steps_prior = stored("steps")
    minutes_recent, minutes_prior = stored("exercise_minutes")
    pairs: list[tuple[str, str, float | None, float | None]] = [
        ("steps", "steps/day", steps_recent, steps_prior),
        ("exercise_minutes", "min/day", minutes_recent, minutes_prior),
        (
            "distance",
            "m/day",
            _mean(list(_distance_by_day(db, user, recent_first, day).values())),
            _mean(list(_distance_by_day(db, user, prior_first, prior_last).values())),
        ),
        (
            "workouts",
            "workouts/week",
            _workouts_a_week(db, user, recent_first, day),
            _workouts_a_week(db, user, prior_first, prior_last),
        ),
    ]
    return {
        "rows": [
            {
                "key": key,
                "recent": recent,
                "prior": prior,
                "unit": unit,
                "direction": _direction(recent, prior),
            }
            for key, unit, recent, prior in pairs
        ]
    }


@router.get("/days")
def read_days(
    days: int = DEFAULT_DAYS,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """A run of days ending today: the three figures a day is read by, and what
    was worked on it.

    One answer rather than one request a metric, because the card that draws it
    reads all three off the same bar. A span outside what a screen asks for is
    refused rather than quietly cut down: a number nobody meant is a bug
    somewhere else, and answering it hides that.
    """
    if not 1 <= days <= MAX_RUN_DAYS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_SPAN)
    last = clock.user_today(user)
    first = last - dt.timedelta(days=days - 1)
    values = _tile_values(db, user, first, last)

    # Every session across the run in one query, newest first within its day.
    worked: dict[dt.date, list[models.Workout]] = {}
    for row in db.execute(
        select(models.Workout)
        .where(
            models.Workout.user_id == user.id,
            models.Workout.date_for >= first,
            models.Workout.date_for <= last,
        )
        .order_by(models.Workout.started_at.desc(), models.Workout.id.desc())
    ).scalars():
        worked.setdefault(row.date_for, []).append(row)

    run = _run(first, last)
    # Each day's own goals, so a run of days carries what each was aimed at
    # rather than what today is.
    goals = goals_over(db, user, run)

    return {
        "days": [
            {
                "date": each.isoformat(),
                "steps": values.get((each, "steps")),
                "exercise_minutes": values.get((each, "exercise_minutes")),
                "active_kcal": values.get((each, "active_kcal")),
                "step_goal": goals[each][0],
                "exercise_minutes_goal": goals[each][1],
                # Hidden sessions included: this is the owner reading their own
                # days, and the feed is the only place hiding one means
                # anything.
                "workouts": [
                    {
                        "id": row.id,
                        "activity": row.activity,
                        "distance_m": row.distance_m,
                        "duration_s": row.duration_s,
                    }
                    for row in worked.get(each, [])
                ],
            }
            for each in run
        ]
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
    if metric not in DAILY_METRICS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_METRIC)
    last = asked_day(date, user)
    span = max(1, min(days, MAX_DAYS))
    first = last - dt.timedelta(days=span - 1)
    found: dict[dt.date, float | None]
    if metric == "distance":
        found = dict(_distance_by_day(db, user, first, last))
        unit = "m"
    else:
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
        unit = fitness_catalog.UNIT_FOR_TILE[metric]
    return {
        "metric": metric,
        "unit": unit,
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

    Read through the names Tare knows rather than trusted as stored: a list is
    JSON, and a name nothing recognises must not quietly widen what is shown.
    """
    held = owner.feed_hidden or []
    return {name for name in HIDEABLE if name in held}


def readable_workout(db: Session, workout_id: int, user: models.User) -> models.Workout:
    """One session this account may read: its own, or one a friend shared.

    A workout that is not there, one somebody kept out of the feed, one whose
    owner shares none, one whose owner keeps the breakdown to themselves, and
    one belonging to somebody this account never added all answer the same
    sentence. Details are held by default, so most sessions open for their
    owner alone.
    """
    row = db.get(models.Workout, workout_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_WORKOUT)
    if row.user_id != user.id:
        owner = db.get(models.User, row.user_id)
        if (
            row.hidden_from_feed
            or owner is None
            or not owner.share_workouts
            or "details" in kept_back(owner)
            or owner.id not in friend_ids(db, user)
        ):
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
    """One session, whole: its numbers, its minutes, its line and its splits.

    The owner reads all of it, whatever their own switches say. A friend only
    gets here when the owner opened the details, and then reads the same
    breakdown minus the route if that is held: what is held back is left out of
    the answer rather than sent as null, so nothing on the far side has to tell
    a hidden number from a missing one. The splits are worked out here rather
    than drawn from the minutes; they are measured in whoever is reading's own
    miles or kilometres.
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
    if "route" in hidden:
        # The climb is read off the route, so it goes with it.
        detail.pop("elevation_gain_m", None)
    else:
        detail["route"] = None if route is None else route.points
    detail["samples"] = samples
    parts = splits.splits_of(minutes, user.units)
    detail["splits"] = parts
    # Which of them was quickest, which the table marks in colour.
    detail["fastest"] = splits.fastest_of(parts)
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
