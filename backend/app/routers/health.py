"""The member's own numbers: the profile behind them, the measurements they are
read from, the workouts credited against them, and the targets that come out.

Everything here is private without qualification. There is no id in any of
these addresses that belongs to somebody else, and the one that takes an id
answers for a stranger's row exactly what an id that was never used answers.
An administrator is nobody special here (decision 27).

The arithmetic is not in this file. It is in app.health, which knows no session
and no account, and this router is what feeds it and what turns its keys into
the sentences docs/HEALTH-MATH.md asks for.
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import clock, health, models
from app.db import get_db
from app.deps import require_user
from app.models import now_utc
from app.routers.account import clean_location

router = APIRouter(prefix="/health", tags=["health"])

MISSING_ENTRY = "There is no such exercise entry."
MISSING_MEASUREMENT = "There is no measurement on that day."
BAD_DATE = "That is not a date."
BAD_ACTIVITY = "That is not an activity tare knows."
BAD_EFFORT = "That effort is not offered for this activity."
NO_MANUAL = "Manual targets need calories, protein, carbs and fat."
FUTURE_MEASUREMENT = "A measurement cannot be in the future."

# How far back a measurement list reaches by default, and the furthest it will.
DEFAULT_DAYS = 90
MAX_DAYS = 3650

# Decision 2: older than this and the weight-based estimate is the better one.
BODY_FAT_FRESH_DAYS = 90

# Decision 20: the window the offer is worked out over.
REESTIMATE_WINDOW = 28

# The bounds a measurement is held to. Wide enough to be wrong about, narrow
# enough to catch a decimal point in the wrong place.
LIMITS = {
    "weight_kg": (20.0, 500.0),
    "body_fat_pct": (2.0, 70.0),
    "body_water_pct": (20.0, 80.0),
    "visceral_fat": (1.0, 59.0),
}

MIN_HEIGHT_CM = 90.0
MAX_HEIGHT_CM = 250.0
MAX_MINUTES = 720
BAD_MINUTES = f"Minutes must be between 1 and {MAX_MINUTES}."

# The plain sentences behind app.health's note keys. The words are the doc's,
# and no formula name appears in any of them (decision 29).
NOTE_TEXT = {
    "cap": (
        "That pace would move you further from what you use than tare will set, "
        "so it has been eased back."
    ),
    "floor": (
        "This is the lowest budget tare will set, so reaching your goal will take "
        "longer than the pace you picked."
    ),
    "gate": (
        "The two faster paces are offered only when your details suggest they suit "
        "you. Steady is the fastest pace tare offers you right now."
    ),
    "pregnancy": (
        "Energy needs change during pregnancy and breastfeeding. Ask your clinician "
        "what is right for you."
    ),
    "carbs_low": (
        "This budget leaves fewer carbs than most adults are advised to eat. You can "
        "set your own numbers below."
    ),
    "defaults": (
        "These are general targets for an adult. Add your details for a personal "
        "number."
    ),
    "manual": "You set these numbers yourself. Switch back to automatic at any time.",
}

# Decision 22, word for word.
NUDGE_TEXT = {
    "below_range": (
        "Your details put you below the healthy weight range. Talk to a clinician "
        "before aiming lower."
    ),
    "goal_below_range": (
        "Your details put you below the healthy weight range. Talk to a clinician "
        "before aiming lower."
    ),
    "high_weight": "A clinician can help plan safely at this weight. tare is only an estimate.",
}


class ProfileIn(BaseModel):
    """A change to the profile. A field left out is left alone, and null is a
    value here: it is how a height or a goal weight is cleared."""

    sex: str | None = None
    height_cm: float | None = None
    location: str | None = None
    pregnant_or_breastfeeding: bool | None = None
    activity_level: str | None = None
    goal: str | None = None
    rate: str | None = None
    goal_weight_kg: float | None = None


class TargetsIn(BaseModel):
    mode: str
    calories: float | None = Field(default=None, gt=0)
    protein_g: float | None = Field(default=None, gt=0)
    carbs_g: float | None = Field(default=None, gt=0)
    fat_g: float | None = Field(default=None, gt=0)


class MeasurementIn(BaseModel):
    """One day's reading. The weight is the only one that has to be there."""

    weight_kg: float
    body_fat_pct: float | None = None
    body_water_pct: float | None = None
    muscle_kg: float | None = None
    bone_kg: float | None = None
    visceral_fat: int | None = None


class ExerciseIn(BaseModel):
    date_for: dt.date | None = None
    activity: str
    effort: str
    minutes: int


def profile_of(db: Session, user: models.User) -> models.HealthProfile:
    """This account's profile, made on first sight.

    Written rather than returned unsaved, because every route below either
    reads it or changes it, and a row that exists only sometimes is a null
    check in a dozen places.
    """
    row = db.get(models.HealthProfile, user.id)
    if row is None:
        row = models.HealthProfile(user_id=user.id, dismissed_nudges=[])
        db.add(row)
        db.flush()
    return row


def asked_day(date: str, user: models.User) -> dt.date:
    if not date:
        return clock.user_today(user)
    try:
        return dt.date.fromisoformat(date)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_DATE) from None


def readings(
    db: Session, user: models.User, since: dt.date | None = None
) -> list[models.WeightEntry]:
    """Every weigh-in, oldest first, which is the order a trend is built in."""
    query = select(models.WeightEntry).where(models.WeightEntry.user_id == user.id)
    if since is not None:
        query = query.where(models.WeightEntry.date_for >= since)
    return list(db.execute(query.order_by(models.WeightEntry.date_for)).scalars())


def weight_on(db: Session, user: models.User, day: dt.date) -> models.WeightEntry | None:
    """The newest weigh-in on or before a day, which is the weight that day is
    worked out at."""
    return db.execute(
        select(models.WeightEntry)
        .where(models.WeightEntry.user_id == user.id, models.WeightEntry.date_for <= day)
        .order_by(models.WeightEntry.date_for.desc())
        .limit(1)
    ).scalars().first()


def lean_kg(row: models.WeightEntry) -> float | None:
    """What is left of the weight once the fat is taken off it. Null when no
    body fat was recorded, which is not none of it."""
    if row.body_fat_pct is None:
        return None
    return health.round_for_display(row.weight_kg * (1.0 - row.body_fat_pct / 100.0), "kg")


def measurement_row(row: models.WeightEntry) -> dict[str, object]:
    return {
        "date": row.date_for.isoformat(),
        "weight_kg": health.round_for_display(row.weight_kg, "kg"),
        "body_fat_pct": row.body_fat_pct,
        "body_water_pct": row.body_water_pct,
        "muscle_kg": row.muscle_kg,
        "bone_kg": row.bone_kg,
        "visceral_fat": row.visceral_fat,
        "lean_kg": lean_kg(row),
        "source": row.source,
    }


def exercise_row(row: models.ExerciseEntry) -> dict[str, object]:
    """One workout as a screen reads it. The value it was credited at stays in
    the database (decision 29 keeps its name off every screen)."""
    named = health.ACTIVITY_BY_KEY.get(row.activity)
    return {
        "id": row.id,
        "date": row.date_for.isoformat(),
        "activity": row.activity,
        "name": named.name if named is not None else row.activity,
        "effort": row.effort,
        "minutes": row.minutes,
        "kcal": health.round_for_display(row.kcal, "calories"),
    }


def exercise_on(db: Session, user: models.User, day: dt.date) -> list[models.ExerciseEntry]:
    return list(
        db.execute(
            select(models.ExerciseEntry)
            .where(
                models.ExerciseEntry.user_id == user.id,
                models.ExerciseEntry.date_for == day,
            )
            .order_by(models.ExerciseEntry.id)
        ).scalars()
    )


class Reckoning:
    """Everything one member's numbers are worked out from, gathered once.

    Held as an object rather than passed around as eight arguments, because the
    day's budget, the Targets page and the diary all need the same eight and
    would otherwise each fetch them their own way.
    """

    def __init__(self, db: Session, user: models.User) -> None:
        self.user = user
        self.today = clock.user_today(user)
        self.profile = profile_of(db, user)
        self.rows = readings(db, user)
        self.latest = self.rows[-1] if self.rows else None
        self.age = (
            None if user.birthdate is None else health.age_on(user.birthdate, self.today)
        )
        self.kg = None if self.latest is None else self.latest.weight_kg
        self.cm = self.profile.height_cm
        self.sex = self.profile.sex
        # Decision 25: without all four the fixed guideline targets stand.
        self.complete = (
            self.sex is not None
            and self.cm is not None
            and self.kg is not None
            and self.age is not None
        )
        self.bmi = (
            health.bmi(self.kg, self.cm)
            if self.kg is not None and self.cm is not None and self.cm > 0
            else None
        )
        # A value a calendar day at a time, so a fortnight off the scale reads
        # as a fortnight rather than closing up (decision 19).
        self.trend_days = health.trend_by_day(
            [(row.date_for, row.weight_kg) for row in self.rows]
        )
        self.trend_kg = self.trend_days[-1][1] if self.trend_days else None

    def fresh_body_fat(self) -> float | None:
        """Decision 2: a body-fat reading is used only while it is recent."""
        cutoff = self.today - dt.timedelta(days=BODY_FAT_FRESH_DAYS)
        for row in reversed(self.rows):
            if row.body_fat_pct is None:
                continue
            return row.body_fat_pct if row.date_for >= cutoff else None
        return None

    def rmr(self) -> float | None:
        if not self.complete:
            return None
        assert self.sex is not None and self.cm is not None
        assert self.kg is not None and self.age is not None
        body_fat = self.fresh_body_fat()
        if body_fat is not None:
            return health.rmr_cunningham(self.kg, body_fat)
        return health.rmr_mifflin(self.sex, self.kg, self.cm, self.age)

    def maintenance(self) -> float | None:
        resting = self.rmr()
        if resting is None:
            return None
        return health.maintenance(resting, self.profile.activity_level)


def auto_budget(state: Reckoning) -> tuple[dict[str, float], list[str], float]:
    """The worked-out day, its note keys, and the pace it really achieves."""
    maintenance_kcal = state.maintenance()
    if maintenance_kcal is None or state.sex is None or state.kg is None or state.age is None:
        # Decision 9: the fixed guideline targets, said to be general.
        return dict(health.DEFAULTS_2000), ["defaults"], 0.0

    worked = health.budget(
        maintenance_kcal,
        state.profile.goal,
        state.profile.rate,
        state.sex,
        state.bmi,
        state.profile.pregnant_or_breastfeeding,
    )
    assert state.bmi is not None
    split = health.macros(worked.calories, state.kg, state.profile.goal, state.age, state.bmi)
    limits = health.ceilings(worked.calories)
    notes = list(worked.notes)
    if split.carbs_low:
        notes.append("carbs_low")
    return (
        {
            "calories": worked.calories,
            "protein_g": split.protein_g,
            "carbs_g": split.carbs_g,
            "fat_g": split.fat_g,
            "fiber_g": limits.fiber_g,
            "saturated_fat_g_max": limits.saturated_fat_g_max,
            "sugar_g_max": limits.sugar_g_max,
            "sodium_mg_max": limits.sodium_mg_max,
            "cholesterol_mg_max": limits.cholesterol_mg_max,
        },
        notes,
        worked.weekly_rate_kg,
    )


def shown(figures: dict[str, float]) -> dict[str, float]:
    """Decision 28: nothing leaves here claiming more precision than it has.

    Calories to the nearest ten and everything else to the nearest one, which
    covers the grams and the two figures counted in milligrams alike.
    """
    return {
        key: health.round_for_display(value, "calories" if key == "calories" else "grams")
        for key, value in figures.items()
    }


def manual_figures(profile: models.HealthProfile) -> dict[str, float] | None:
    """The four numbers somebody typed, with the ceilings worked from them.

    The ceilings stay automatic on purpose: they are guideline limits rather
    than a target anybody sets for themselves.
    """
    if profile.manual_calories is None:
        return None
    limits = health.ceilings(profile.manual_calories)
    return {
        "calories": profile.manual_calories,
        "protein_g": profile.manual_protein_g or 0.0,
        "carbs_g": profile.manual_carbs_g or 0.0,
        "fat_g": profile.manual_fat_g or 0.0,
        "fiber_g": limits.fiber_g,
        "saturated_fat_g_max": limits.saturated_fat_g_max,
        "sugar_g_max": limits.sugar_g_max,
        "sodium_mg_max": limits.sodium_mg_max,
        "cholesterol_mg_max": limits.cholesterol_mg_max,
    }


def day_budget(state: Reckoning) -> dict[str, float]:
    """The four figures a day is read against, worked out or typed in."""
    if state.profile.targets_mode == "manual":
        typed = manual_figures(state.profile)
        if typed is not None:
            return shown(typed)
    figures, _, _ = auto_budget(state)
    return shown(figures)


def logged_days(db: Session, user: models.User, since: dt.date) -> int:
    """How many days in the window carry any food at all."""
    return int(
        db.execute(
            select(func.count(func.distinct(models.DiaryEntry.date_for))).where(
                models.DiaryEntry.user_id == user.id, models.DiaryEntry.date_for >= since
            )
        ).scalar_one()
    )


@router.get("/profile")
def read_profile(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> dict[str, object]:
    state = Reckoning(db, user)
    db.commit()
    profile = state.profile
    return {
        "sex": profile.sex,
        "height_cm": profile.height_cm,
        "location": user.location,
        "birthdate": None if user.birthdate is None else user.birthdate.isoformat(),
        "pregnant_or_breastfeeding": profile.pregnant_or_breastfeeding,
        "activity_level": profile.activity_level,
        "goal": profile.goal,
        "rate": profile.rate,
        "goal_weight_kg": profile.goal_weight_kg,
        "complete": state.complete,
        "latest_weight_kg": (
            None if state.kg is None else health.round_for_display(state.kg, "kg")
        ),
        "latest_weight_date": (
            None if state.latest is None else state.latest.date_for.isoformat()
        ),
    }


@router.put("/profile")
def write_profile(
    body: ProfileIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    sent = body.model_fields_set
    profile = profile_of(db, user)

    if "sex" in sent:
        if body.sex is not None and body.sex not in models.SEXES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Sex must be female or male.")
        profile.sex = body.sex

    if "height_cm" in sent:
        if body.height_cm is not None and not (
            MIN_HEIGHT_CM <= body.height_cm <= MAX_HEIGHT_CM
        ):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That is not a height tare can use.")
        profile.height_cm = body.height_cm

    if "location" in sent:
        user.location = clean_location(body.location)

    if "pregnant_or_breastfeeding" in sent:
        profile.pregnant_or_breastfeeding = bool(body.pregnant_or_breastfeeding)

    if "activity_level" in sent:
        if body.activity_level not in models.ACTIVITY_LEVELS:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That is not an activity level.")
        profile.activity_level = body.activity_level

    if "goal" in sent:
        if body.goal not in models.GOALS:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That is not a goal.")
        profile.goal = body.goal
        # A pace belongs to the goal it was picked under, so changing the goal
        # drops it back to that goal's own default rather than carrying a
        # losing pace into a gaining plan.
        if "rate" not in sent:
            profile.rate = None

    if "rate" in sent:
        if body.rate is not None:
            state = Reckoning(db, user)
            offered = health.rates_offered(profile.goal, state.bmi)
            if body.rate not in offered:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, NOTE_TEXT["gate"])
        profile.rate = body.rate

    if "goal_weight_kg" in sent:
        low, high = LIMITS["weight_kg"]
        if body.goal_weight_kg is not None and not (low <= body.goal_weight_kg <= high):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That is not a weight tare can use.")
        profile.goal_weight_kg = body.goal_weight_kg

    profile.updated_at = now_utc()
    db.commit()
    return read_profile(db, user)


@router.get("/targets")
def read_targets(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> dict[str, object]:
    """Everything the Targets page says, worked out in one place."""
    state = Reckoning(db, user)
    profile = state.profile
    figures, note_keys, weekly_rate = auto_budget(state)
    typed = manual_figures(profile)
    manual_mode = profile.targets_mode == "manual" and typed is not None
    if manual_mode:
        assert typed is not None
        figures = typed
        note_keys = ["manual"]

    goal_bmi = (
        health.bmi(profile.goal_weight_kg, state.cm)
        if profile.goal_weight_kg is not None and state.cm is not None and state.cm > 0
        else None
    )
    dismissed = set(profile.dismissed_nudges)
    waiting = [
        {"key": key, "text": NUDGE_TEXT[key]}
        for key in health.nudges(state.bmi, profile.goal, goal_bmi)
        if key not in dismissed
    ]

    # Decision 22: a goal that lands below the healthy range is accepted, and
    # its date is not shown.
    below_range = goal_bmi is not None and goal_bmi < health.UNDERWEIGHT_BMI
    month = (
        None
        if state.trend_kg is None or below_range
        else health.projection(
            state.trend_kg, profile.goal_weight_kg, weekly_rate, state.today
        )
    )

    offer: dict[str, float] | None = None
    if not manual_mode and state.complete and state.sex is not None:
        window = state.today - dt.timedelta(days=REESTIMATE_WINDOW - 1)
        series = [value for day, value in state.trend_days if day >= window]
        delta = health.reestimate(
            series, logged_days(db, user, window), weekly_rate, profile.goal
        )
        maintenance_kcal = state.maintenance()
        if delta is not None and maintenance_kcal is not None:
            corrected = health.clamp_budget(
                figures["calories"] + delta, maintenance_kcal, state.sex, profile.goal
            )
            offer = {
                "delta_calories": health.round_for_display(
                    corrected - figures["calories"], "calories"
                ),
                "calories": health.round_for_display(corrected, "calories"),
            }
            if offer["delta_calories"] == 0:
                offer = None

    db.commit()
    return {
        "mode": profile.targets_mode,
        "complete": state.complete,
        "budget": shown(figures),
        "manual": None if typed is None else shown(typed),
        "activity_level": profile.activity_level,
        "goal": profile.goal,
        "rate": profile.rate or health.default_rate(profile.goal),
        "rates_offered": list(health.rates_offered(profile.goal, state.bmi)),
        "goal_weight_kg": profile.goal_weight_kg,
        "weekly_rate": round(weekly_rate, 2),
        "notes": [NOTE_TEXT[key] for key in note_keys],
        "nudges": waiting,
        "projection": None if month is None else {"month": month},
        "trend_kg": (
            None if state.trend_kg is None else health.round_for_display(state.trend_kg, "kg")
        ),
        "reestimate": offer,
        "disclaimer_seen": profile.disclaimer_seen_at is not None,
    }


@router.put("/targets")
def write_targets(
    body: TargetsIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    if body.mode not in models.TARGET_MODES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That is not a way to set targets.")
    profile = profile_of(db, user)

    if body.mode == "manual":
        typed = (body.calories, body.protein_g, body.carbs_g, body.fat_g)
        if any(value is None for value in typed):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_MANUAL)
        profile.manual_calories = body.calories
        profile.manual_protein_g = body.protein_g
        profile.manual_carbs_g = body.carbs_g
        profile.manual_fat_g = body.fat_g

    profile.targets_mode = body.mode
    profile.updated_at = now_utc()
    db.commit()
    return read_targets(db, user)


@router.post("/disclaimer", status_code=status.HTTP_204_NO_CONTENT)
def see_disclaimer(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> None:
    """Decision 30: said once, and reachable from the Guide afterwards."""
    profile = profile_of(db, user)
    if profile.disclaimer_seen_at is None:
        profile.disclaimer_seen_at = now_utc()
    db.commit()


@router.post("/nudges/{key}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
def dismiss_nudge(
    key: str, db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> None:
    if key not in NUDGE_TEXT:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "There is nothing at this address.")
    profile = profile_of(db, user)
    if key not in profile.dismissed_nudges:
        # Rebound rather than appended to: a JSON column is only written back
        # when the attribute itself is set.
        profile.dismissed_nudges = [*profile.dismissed_nudges, key]
    db.commit()


@router.get("/measurements")
def read_measurements(
    days: int = DEFAULT_DAYS,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """The recorded days, newest first, and the trend line under them."""
    window = max(1, min(days, MAX_DAYS))
    today = clock.user_today(user)
    rows = readings(db, user, today - dt.timedelta(days=window - 1))
    line = health.trend_by_day([(row.date_for, row.weight_kg) for row in rows])
    db.commit()
    return {
        "days": window,
        "measurements": [measurement_row(row) for row in reversed(rows)],
        "trend": [
            {"date": day.isoformat(), "kg": health.round_for_display(value, "kg")}
            for day, value in line
        ],
    }


@router.put("/measurements/{date}")
def write_measurement(
    date: str,
    body: MeasurementIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """One day's reading, typed in. A day already recorded is replaced."""
    day = asked_day(date, user)
    if day > clock.user_today(user):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, FUTURE_MEASUREMENT)

    for field in ("weight_kg", "body_fat_pct", "body_water_pct", "visceral_fat"):
        value = getattr(body, field)
        low, high = LIMITS[field]
        if value is not None and not (low <= value <= high):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"That is not a {_name(field)}.")
    for field in ("muscle_kg", "bone_kg"):
        value = getattr(body, field)
        if value is not None and not (0 < value < body.weight_kg):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Muscle and bone have to be more than nothing and less than your weight.",
            )

    row = db.execute(
        select(models.WeightEntry).where(
            models.WeightEntry.user_id == user.id, models.WeightEntry.date_for == day
        )
    ).scalar_one_or_none()
    if row is None:
        row = models.WeightEntry(user_id=user.id, date_for=day)
        db.add(row)
    row.weight_kg = body.weight_kg
    row.body_fat_pct = body.body_fat_pct
    row.body_water_pct = body.body_water_pct
    row.muscle_kg = body.muscle_kg
    row.bone_kg = body.bone_kg
    row.visceral_fat = body.visceral_fat
    # Typed in always wins the day. An import that arrives later leaves this
    # standing rather than overwriting somebody's own reading.
    row.source = "manual"
    db.commit()
    return measurement_row(row)


def _name(field: str) -> str:
    """What a refused number is called in the sentence that refuses it."""
    return {
        "weight_kg": "weight tare can use",
        "body_fat_pct": "body fat percentage tare can use",
        "body_water_pct": "body water percentage tare can use",
        "visceral_fat": "visceral fat rating tare can use",
    }[field]


@router.delete("/measurements/{date}", status_code=status.HTTP_204_NO_CONTENT)
def delete_measurement(
    date: str, db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> None:
    day = asked_day(date, user)
    row = db.execute(
        select(models.WeightEntry).where(
            models.WeightEntry.user_id == user.id, models.WeightEntry.date_for == day
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_MEASUREMENT)
    db.delete(row)
    db.commit()


@router.get("/activities")
def read_activities(user: models.User = Depends(require_user)) -> list[dict[str, object]]:
    """The catalogue in plain words. An activity offers only the efforts it has
    a published value for."""
    return [
        {
            "key": activity.key,
            "name": activity.name,
            "efforts": [
                {"effort": row.effort, "met": row.met} for row in activity.efforts
            ],
        }
        for activity in health.ACTIVITIES
    ]


@router.post("/exercise", status_code=status.HTTP_201_CREATED)
def add_exercise(
    body: ExerciseIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """One workout, credited at the weight that day was carried at."""
    if body.minutes < 1 or body.minutes > MAX_MINUTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_MINUTES)
    day = body.date_for or clock.user_today(user)
    if body.activity not in health.ACTIVITY_BY_KEY:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_ACTIVITY)
    met = health.met_for(body.activity, body.effort)
    if met is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_EFFORT)

    weighed = weight_on(db, user, day)
    # Decision 7: without a weigh-in the credit is worked out at an assumed
    # weight, and the screen says so rather than pretending.
    kg = weighed.weight_kg if weighed is not None else health.ASSUMED_WEIGHT_KG
    row = models.ExerciseEntry(
        user_id=user.id,
        date_for=day,
        activity=body.activity,
        effort=body.effort,
        minutes=body.minutes,
        met=met,
        weight_kg=kg,
        kcal=health.exercise_kcal(met, kg, body.minutes),
    )
    db.add(row)
    db.commit()
    return {**exercise_row(row), "estimated": weighed is None}


@router.delete("/exercise/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exercise(
    entry_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> None:
    row = db.get(models.ExerciseEntry, entry_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_ENTRY)
    db.delete(row)
    db.commit()
