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
from app.routers.fitness import (
    BAD_MINUTES_GOAL,
    BAD_STEP_GOAL,
    FUTURE_MEASUREMENT,
    MAX_MINUTES_GOAL,
    MAX_STEP_GOAL,
    MIN_MINUTES_GOAL,
    MIN_STEP_GOAL,
    day_exercise,
    workouts_on,
)

router = APIRouter(prefix="/health", tags=["health"])

MISSING_ENTRY = "There is no such exercise entry."
MISSING_MEASUREMENT = "Nothing is recorded on that day."
BAD_DATE = "That is not a date."
BAD_ACTIVITY = "That is not an activity Tare knows."
BAD_EFFORT = "That effort is not offered for this activity."
NO_GRAMS = "Setting the grams yourself needs calories, protein, carbs and fat."
NO_PCT = "A percentage split needs all three numbers."
PCT_RANGE = f"Each percentage has to be between {health.PCT_MIN} and {health.PCT_MAX}."
PCT_SUM = f"The three percentages have to add up to {health.PCT_TOTAL}."
BAD_PRESET = "That is not a starting point Tare offers."
BAD_RATE = "That is not a goal rate Tare offers."
BAD_MODE = "That is not a way to set targets."
NOTHING_RECORDED = "Nothing to record."

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
    "muscle_pct": (5.0, 90.0),
    "bone_pct": (0.5, 20.0),
}

# The fields a scale can add to a weight, in the order they are shown.
EXTRA_FIELDS = ("body_fat_pct", "body_water_pct", "muscle_pct", "bone_pct")

# Everything one day can hold, weight first, which is the order the form
# asks for them and the order they are checked in.
MEASURED = ("weight_kg", *EXTRA_FIELDS)

# The short name each share is drawn under on the chart, which is what its
# line and its chip are keyed on.
TREND_KEYS = {
    "body_fat_pct": "fat",
    "body_water_pct": "water",
    "muscle_pct": "muscle",
    "bone_pct": "bone",
}

MIN_HEIGHT_CM = 90.0
MAX_HEIGHT_CM = 250.0
MAX_MINUTES = 720
BAD_MINUTES = f"Minutes must be between 1 and {MAX_MINUTES}."

# The plain sentences behind app.health's note keys. The words are the doc's,
# and no formula name appears in any of them (decision 29).
NOTE_TEXT = {
    "cap": "Highest recommended deficit.",
    "floor": "Lowest recommended intake.",
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

# What a starting point says about itself. Only the losing one has anything to
# add, and it is the reason its protein figure stops where it does.
PRESET_NOTE = {"lose": "Protein is held at the top of the recommended range."}

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
    "high_weight": "A clinician can help plan safely at this weight. Tare is only an estimate.",
}


class ProfileIn(BaseModel):
    """A change to the profile. A field left out is left alone, and null is a
    value here: it is how a height or a goal weight is cleared."""

    sex: str | None = None
    height_cm: float | None = None
    location: str | None = None
    pregnant_or_breastfeeding: bool | None = None
    activity_level: str | None = None
    rate_kg_per_week: float | None = None
    goal_weight_kg: float | None = None
    exercise_minutes_goal: int | None = None
    step_goal: int | None = None


class TargetsIn(BaseModel):
    """How the daily split is set: worked out, by percentages, or in grams."""

    mode: str
    # A starting point by name, which fills the three percentages from the
    # table rather than asking the screen to know them.
    preset: str | None = None
    calories: float | None = Field(default=None, gt=0)
    protein_g: float | None = Field(default=None, gt=0)
    carbs_g: float | None = Field(default=None, gt=0)
    fat_g: float | None = Field(default=None, gt=0)
    protein_pct: int | None = None
    carbs_pct: int | None = None
    fat_pct: int | None = None


class MeasurementIn(BaseModel):
    """One day's reading, merged into whatever the day already holds.

    Every field is optional, and a field left out is left alone. Null is a
    value here rather than an absence: it is how a reading is cleared, which is
    why what was sent is read from model_fields_set rather than from what is
    None.
    """

    weight_kg: float | None = None
    body_fat_pct: float | None = None
    body_water_pct: float | None = None
    muscle_pct: float | None = None
    bone_pct: float | None = None


class ExerciseIn(BaseModel):
    date_for: dt.date | None = None
    activity: str
    effort: str
    minutes: int


def refuse_if_complete(db: Session, user: models.User, day: dt.date) -> None:
    """The diary's own lock, asked from here.

    Imported inside the call rather than at the top: app.routers.diary reads
    this module, and reading it back would be a circle.
    """
    from app.routers.diary import refuse_if_complete as refuse

    refuse(db, user, day)


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


def weighed_days(rows: list[models.WeightEntry]) -> list[tuple[dt.date, float]]:
    """The days a weight was actually read on, which is what a weight trend is
    drawn from. A day holding a body fat alone is not one of them."""
    return [(row.date_for, row.weight_kg) for row in rows if row.weight_kg is not None]


def read_days(rows: list[models.WeightEntry], field: str) -> list[tuple[dt.date, float]]:
    """The days one share was actually read on, which is what its line is drawn
    from. A day that holds nothing for it is not one of them."""
    return [
        (row.date_for, value)
        for row in rows
        if (value := getattr(row, field)) is not None
    ]


def latest_weight_kg(db: Session, user: models.User) -> float | None:
    """The newest weigh-in there is, which is the weight a direction is read
    against. None until somebody has stood on a scale."""
    weighed = [row.weight_kg for row in readings(db, user) if row.weight_kg is not None]
    return weighed[-1] if weighed else None


def weight_on(db: Session, user: models.User, day: dt.date) -> float | None:
    """The newest weigh-in on or before a day, which is the weight that day is
    worked out at. A day that holds a body fat and nothing else is not one."""
    return db.execute(
        select(models.WeightEntry.weight_kg)
        .where(
            models.WeightEntry.user_id == user.id,
            models.WeightEntry.date_for <= day,
            models.WeightEntry.weight_kg.is_not(None),
        )
        .order_by(models.WeightEntry.date_for.desc())
        .limit(1)
    ).scalars().first()


def lean_kg(row: models.WeightEntry) -> float | None:
    """What is left of the weight once the fat is taken off it. Null when no
    body fat was recorded, which is not none of it, and null on a day that
    holds a body fat without a weight to take it off."""
    if row.body_fat_pct is None or row.weight_kg is None:
        return None
    return health.round_for_display(row.weight_kg * (1.0 - row.body_fat_pct / 100.0), "kg")


def share_kg(row: models.WeightEntry, pct: float | None) -> float | None:
    """A share of the day's weight as a mass, for showing beside the percent."""
    if pct is None or row.weight_kg is None:
        return None
    return health.round_for_display(row.weight_kg * pct / 100.0, "kg")


def measurement_row(row: models.WeightEntry) -> dict[str, object]:
    return {
        "date": row.date_for.isoformat(),
        "weight_kg": (
            None if row.weight_kg is None else health.round_for_display(row.weight_kg, "kg")
        ),
        "body_fat_pct": row.body_fat_pct,
        "body_water_pct": row.body_water_pct,
        "muscle_pct": row.muscle_pct,
        "bone_pct": row.bone_pct,
        "muscle_kg": share_kg(row, row.muscle_pct),
        "bone_kg": share_kg(row, row.bone_pct),
        "lean_kg": lean_kg(row),
        "source": row.source,
    }


def latest_by_field(rows: list[models.WeightEntry]) -> dict[str, object]:
    """The newest reading of each number and the day it was taken, so a screen
    can say how old each one is. Rows arrive oldest first."""
    out: dict[str, object] = {"weight_kg": None}
    for field in EXTRA_FIELDS:
        out[field] = None
    for row in reversed(rows):
        if out["weight_kg"] is None and row.weight_kg is not None:
            out["weight_kg"] = {
                "value": health.round_for_display(row.weight_kg, "kg"),
                "date": row.date_for.isoformat(),
            }
        for field in EXTRA_FIELDS:
            value = getattr(row, field)
            if out[field] is None and value is not None:
                stamp: dict[str, object] = {"value": value, "date": row.date_for.isoformat()}
                if field in ("muscle_pct", "bone_pct"):
                    stamp["mass_kg"] = share_kg(row, value)
                out[field] = stamp
    return out


def exercise_row(row: models.ExerciseEntry) -> dict[str, object]:
    """One workout as a screen reads it. The value it was credited at stays in
    the database (decision 29 keeps its name off every screen).

    `source` is what tells a screen whether the row can be deleted: a typed-in
    entry can, and one that arrived from a phone is corrected on the phone.
    """
    named = health.ACTIVITY_BY_KEY.get(row.activity)
    return {
        "id": row.id,
        "workout_id": None,
        "date": row.date_for.isoformat(),
        "activity": row.activity,
        "name": named.name if named is not None else row.activity,
        "effort": row.effort,
        "minutes": row.minutes,
        "kcal": health.round_for_display(row.kcal, "calories"),
        "source": "manual",
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
        # A day can hold a body fat and no weight, so the weight everything is
        # worked out from is the newest day that has one.
        self.latest = next(
            (row for row in reversed(self.rows) if row.weight_kg is not None), None
        )
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
        # Decision: which way the member is going is read off the two weights
        # rather than stored, so nothing can disagree with what they can see.
        self.direction = health.direction(self.kg, self.profile.goal_weight_kg)
        self.bmi = (
            health.bmi(self.kg, self.cm)
            if self.kg is not None and self.cm is not None and self.cm > 0
            else None
        )
        # A value a calendar day at a time, so a fortnight off the scale reads
        # as a fortnight rather than closing up (decision 19).
        self.trend_days = health.trend_by_day(weighed_days(self.rows))
        self.trend_kg = self.trend_days[-1][1] if self.trend_days else None

    def missing(self) -> list[str]:
        """What a personal number is still waiting on, in the order it is asked
        for. Empty once all four are in."""
        absent = []
        if self.sex is None:
            absent.append("sex")
        if self.cm is None:
            absent.append("height")
        if self.kg is None:
            absent.append("weight")
        if self.age is None:
            absent.append("birthdate")
        return absent

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


def rate_options(state: Reckoning, maintenance_kcal: float | None) -> list[dict[str, object]]:
    """Every step for the direction, worked out as if it were the one chosen.

    The screen shows what each step asks for and where the cap or the floor
    holds it, so two steps that land on the same budget say why.
    """
    if maintenance_kcal is None or state.sex is None:
        return []
    options: list[dict[str, object]] = []
    for step in health.steps_for(state.direction):
        worked = health.budget(
            maintenance_kcal,
            state.direction,
            step,
            state.sex,
            state.profile.pregnant_or_breastfeeding,
        )
        options.append(
            {
                "rate_kg_per_week": step,
                "calories": health.round_for_display(worked.calories, "calories"),
                # The gap is the real figure, to the calorie: a pound a week
                # is 500, and a quarter pound more is 625, not 630.
                "asked": round(step * health.KCAL_PER_DAY_PER_KG_WEEK),
                "change": round(abs(maintenance_kcal - worked.calories)),
                "notes": list(worked.notes),
            }
        )
    return options


def auto_budget(state: Reckoning) -> tuple[dict[str, float], list[str], float]:
    """The worked-out day, its note keys, and the pace it really achieves."""
    maintenance_kcal = state.maintenance()
    if maintenance_kcal is None or state.sex is None or state.kg is None or state.age is None:
        # Decision 9: the fixed guideline targets, said to be general. Only the
        # added sugars ceiling knows the member, because it is a figure by sex
        # rather than a share of a budget nobody has yet.
        general = dict(health.DEFAULTS_2000)
        general["sugar_g_max"] = health.added_sugars_max(state.sex)
        return general, ["defaults"], 0.0

    worked = health.budget(
        maintenance_kcal,
        state.direction,
        state.profile.rate_kg_per_week,
        state.sex,
        state.profile.pregnant_or_breastfeeding,
    )
    assert state.bmi is not None
    split = health.macros(worked.calories, state.kg, state.direction, state.age, state.bmi)
    limits = health.ceilings(worked.calories, state.sex)
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


def with_ceilings(
    calories: float, split: health.Macros, sex: str | None
) -> dict[str, float]:
    """A budget and its split, with the guideline limits worked from them.

    The ceilings stay automatic whichever way the split was set: they are
    limits rather than a target anybody picks for themselves.
    """
    limits = health.ceilings(calories, sex)
    return {
        "calories": calories,
        "protein_g": split.protein_g,
        "carbs_g": split.carbs_g,
        "fat_g": split.fat_g,
        "fiber_g": limits.fiber_g,
        "saturated_fat_g_max": limits.saturated_fat_g_max,
        "sugar_g_max": limits.sugar_g_max,
        "sodium_mg_max": limits.sodium_mg_max,
        "cholesterol_mg_max": limits.cholesterol_mg_max,
    }


def manual_figures(
    profile: models.HealthProfile, sex: str | None
) -> dict[str, float] | None:
    """The four numbers somebody typed in grams, kept whatever mode is on."""
    if profile.manual_calories is None:
        return None
    split = health.Macros(
        profile.manual_protein_g or 0.0,
        profile.manual_carbs_g or 0.0,
        profile.manual_fat_g or 0.0,
        False,
    )
    return with_ceilings(profile.manual_calories, split, sex)


def typed_figures(state: Reckoning, auto_calories: float) -> dict[str, float] | None:
    """The budget as this member set it, or nothing while it is worked out.

    A percentage split rides on the automatic calories: the member chose how to
    divide the day, not how big it is.
    """
    profile = state.profile
    if profile.targets_mode == "grams":
        return manual_figures(profile, state.sex)
    if profile.targets_mode == "pct" and profile.manual_protein_pct is not None:
        split = health.macros_from_percentages(
            auto_calories,
            profile.manual_protein_pct,
            profile.manual_carbs_pct or 0,
            profile.manual_fat_pct or 0,
        )
        return with_ceilings(auto_calories, split, state.sex)
    return None


def percentages(
    figures: dict[str, float], profile: models.HealthProfile
) -> dict[str, float]:
    """What share of the day each of the three is, for the rows that say so.

    A split somebody set by percentage reports the numbers they set, not the
    numbers read back out of the rounded grams.
    """
    if profile.targets_mode == "pct" and profile.manual_protein_pct is not None:
        return {
            "protein_pct": profile.manual_protein_pct,
            "carbs_pct": profile.manual_carbs_pct or 0,
            "fat_pct": profile.manual_fat_pct or 0,
        }
    calories = figures["calories"] or 1.0

    def share(grams: float, per_gram: float) -> float:
        return health.round_for_display(grams * per_gram / calories * 100.0, "percent")

    return {
        "protein_pct": share(figures["protein_g"], health.KCAL_PER_G_PROTEIN),
        "carbs_pct": share(figures["carbs_g"], health.KCAL_PER_G_CARBS),
        "fat_pct": share(figures["fat_g"], health.KCAL_PER_G_FAT),
    }


def day_budget(state: Reckoning) -> dict[str, float]:
    """The four figures a day is read against, worked out or set by hand."""
    figures, _, _ = auto_budget(state)
    typed = typed_figures(state, figures["calories"])
    return shown(figures if typed is None else typed)


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
        # Derived from the two weights, never stored.
        "goal": state.direction,
        # What is stored, where null means the first step of that direction.
        "rate_kg_per_week": profile.rate_kg_per_week,
        "rate_steps": list(health.steps_for(state.direction)),
        "goal_weight_kg": profile.goal_weight_kg,
        "exercise_minutes_goal": profile.exercise_minutes_goal,
        "step_goal": profile.step_goal,
        "complete": state.complete,
        # Which of the four a personal number is still waiting on, worked out
        # here so no screen has to know the rule.
        "missing": state.missing(),
        "latest_weight_kg": (
            None if state.kg is None else health.round_for_display(state.kg, "kg")
        ),
        "latest_weight_date": (
            None if state.latest is None else state.latest.date_for.isoformat()
        ),
        # Shown on the Profile screen as a plain number, never a category
        # (decision 23). Null until there is both a height and a weigh-in.
        "bmi": None if state.bmi is None else round(state.bmi, 1),
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
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That is not a height Tare can use.")
        profile.height_cm = body.height_cm

    if "location" in sent:
        user.location = clean_location(body.location)

    if "pregnant_or_breastfeeding" in sent:
        profile.pregnant_or_breastfeeding = bool(body.pregnant_or_breastfeeding)

    if "activity_level" in sent:
        if body.activity_level not in models.ACTIVITY_LEVELS:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That is not an activity level.")
        profile.activity_level = body.activity_level

    # The goal weight is taken first, because a goal rate sent with it belongs
    # to the direction the new goal weight points in.
    weighed = (
        latest_weight_kg(db, user)
        if {"goal_weight_kg", "rate_kg_per_week"} & sent
        else None
    )
    if "goal_weight_kg" in sent:
        low, high = LIMITS["weight_kg"]
        if body.goal_weight_kg is not None and not (low <= body.goal_weight_kg <= high):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That is not a weight Tare can use.")
        was = health.direction(weighed, profile.goal_weight_kg)
        profile.goal_weight_kg = body.goal_weight_kg
        # A goal rate belongs to the direction it was picked under, so a goal
        # weight that turns the direction around drops it back to that
        # direction's own first step.
        turned = health.direction(weighed, body.goal_weight_kg) != was
        if turned and "rate_kg_per_week" not in sent:
            profile.rate_kg_per_week = None

    if "rate_kg_per_week" in sent:
        if body.rate_kg_per_week is not None:
            steps = health.steps_for(health.direction(weighed, profile.goal_weight_kg))
            if body.rate_kg_per_week not in steps:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_RATE)
        profile.rate_kg_per_week = body.rate_kg_per_week

    if "exercise_minutes_goal" in sent:
        minutes = body.exercise_minutes_goal
        if minutes is None or not (MIN_MINUTES_GOAL <= minutes <= MAX_MINUTES_GOAL):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_MINUTES_GOAL)
        profile.exercise_minutes_goal = minutes

    if "step_goal" in sent:
        steps_a_day = body.step_goal
        if steps_a_day is None or not (MIN_STEP_GOAL <= steps_a_day <= MAX_STEP_GOAL):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_STEP_GOAL)
        profile.step_goal = steps_a_day

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
    auto_calories = figures["calories"]
    set_by_hand = typed_figures(state, auto_calories)
    if set_by_hand is not None:
        figures = set_by_hand
        note_keys = ["manual"]

    goal_bmi = (
        health.bmi(profile.goal_weight_kg, state.cm)
        if profile.goal_weight_kg is not None and state.cm is not None and state.cm > 0
        else None
    )
    dismissed = set(profile.dismissed_nudges)
    waiting = [
        {"key": key, "text": NUDGE_TEXT[key]}
        for key in health.nudges(state.bmi, state.direction, goal_bmi)
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
    if set_by_hand is None and state.complete and state.sex is not None:
        window = state.today - dt.timedelta(days=REESTIMATE_WINDOW - 1)
        series = [value for day, value in state.trend_days if day >= window]
        delta = health.reestimate(
            series, logged_days(db, user, window), weekly_rate, state.direction
        )
        maintenance_kcal = state.maintenance()
        if delta is not None and maintenance_kcal is not None:
            corrected = health.clamp_budget(
                figures["calories"] + delta, maintenance_kcal, state.sex, state.direction
            )
            offer = {
                "delta_calories": health.round_for_display(
                    corrected - figures["calories"], "calories"
                ),
                "calories": health.round_for_display(corrected, "calories"),
            }
            if offer["delta_calories"] == 0:
                offer = None

    resting = state.rmr()
    maintenance_now = state.maintenance()
    # Where the worked-out day came from, whichever way the split is set: the
    # screen that shows a typed-in budget hides this rather than contradicting
    # itself, and the percentages screen divides this number.
    breakdown = (
        None
        if maintenance_now is None
        else {
            "use": health.round_for_display(maintenance_now, "calories"),
            "adjustment": health.round_for_display(
                auto_calories - maintenance_now, "calories"
            ),
            "budget": health.round_for_display(auto_calories, "calories"),
        }
    )
    kept = manual_figures(profile, state.sex)

    db.commit()
    return {
        "mode": profile.targets_mode,
        "complete": state.complete,
        "budget": shown(figures),
        "manual": None if kept is None else shown(kept),
        "percentages": percentages(figures, profile),
        "presets": {
            goal: {"protein_pct": split[0], "carbs_pct": split[1], "fat_pct": split[2]}
            for goal, split in health.MACRO_PRESETS.items()
        },
        "preset_notes": PRESET_NOTE,
        "resting": None if resting is None else health.round_for_display(resting, "calories"),
        # What that resting figure was worked out from, so the screen can say
        # it back in the member's own units. Unrounded: the screen formats.
        "resting_inputs": (
            None
            if not state.complete
            else {
                "age": state.age,
                "sex": state.sex,
                "height_cm": state.cm,
                "weight_kg": state.kg,
                # The reading really used, and null when the weight-based
                # estimate was.
                "body_fat_pct": state.fresh_body_fat(),
            }
        ),
        # Only true when it is really what the resting figure was worked out
        # from, so a screen never says it about a number that is not there.
        "uses_body_fat": resting is not None and state.fresh_body_fat() is not None,
        "activity_options": [
            {
                "level": row.level,
                "adds": None if row.adds is None else health.round_for_display(row.adds, "calories"),
                "total": (
                    None if row.total is None else health.round_for_display(row.total, "calories")
                ),
            }
            for row in health.activity_options(resting)
        ],
        "breakdown": breakdown,
        # Imported sessions counted the same way the diary counts them, so the
        # Activity Levels ring and the Journal never disagree about a day.
        "exercise_today": round(
            day_exercise(
                exercise_on(db, user, state.today), workouts_on(db, user, state.today)
            )[0]
            / 10
        )
        * 10,
        "activity_level": profile.activity_level,
        # The way the two weights point, which is what the old stored goal
        # used to say. The key is kept so the screens read the same word.
        "goal": state.direction,
        "rate_kg_per_week": (
            None
            if not health.steps_for(state.direction)
            else health.snap_rate(profile.rate_kg_per_week, health.steps_for(state.direction))
        ),
        "rate_steps": list(health.steps_for(state.direction)),
        "rate_options": rate_options(state, maintenance_now),
        "goal_weight_kg": profile.goal_weight_kg,
        "exercise_minutes_goal": profile.exercise_minutes_goal,
        "step_goal": profile.step_goal,
        "weekly_rate": round(weekly_rate, 2),
        "notes": [NOTE_TEXT[key] for key in note_keys],
        # The same sentences by their keys, in the same order, so a screen can
        # put the ones about the pace beside the pace and the ones about the
        # split beside the split.
        "note_keys": note_keys,
        "nudges": waiting,
        "projection": None if month is None else {"date": month},
        "trend_kg": (
            None if state.trend_kg is None else health.round_for_display(state.trend_kg, "kg")
        ),
        "reestimate": offer,
        "disclaimer_seen": profile.disclaimer_seen_at is not None,
    }


def asked_split(body: TargetsIn) -> tuple[int, int, int]:
    """The three percentages, from a starting point by name or from the fields.

    Decision 10b: a starting point is a way to fill the fields, not a mode of
    its own, so what is stored either way is three numbers.
    """
    if body.preset is not None:
        if body.preset not in health.MACRO_PRESETS:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_PRESET)
        return health.MACRO_PRESETS[body.preset]

    share = (body.protein_pct, body.carbs_pct, body.fat_pct)
    if any(value is None for value in share):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_PCT)
    split = (int(share[0] or 0), int(share[1] or 0), int(share[2] or 0))
    if any(not (health.PCT_MIN <= value <= health.PCT_MAX) for value in split):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, PCT_RANGE)
    if sum(split) != health.PCT_TOTAL:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, PCT_SUM)
    return split


@router.put("/targets")
def write_targets(
    body: TargetsIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    if body.mode not in models.TARGET_MODES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_MODE)
    profile = profile_of(db, user)

    if body.mode == "grams":
        typed = (body.calories, body.protein_g, body.carbs_g, body.fat_g)
        if any(value is None for value in typed):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_GRAMS)
        profile.manual_calories = body.calories
        profile.manual_protein_g = body.protein_g
        profile.manual_carbs_g = body.carbs_g
        profile.manual_fat_g = body.fat_g

    if body.mode == "pct":
        profile.manual_protein_pct, profile.manual_carbs_pct, profile.manual_fat_pct = (
            asked_split(body)
        )

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
    line = health.trend_by_day(weighed_days(rows))
    # Muscle and bone are lined as the stored share, not the mass they work out
    # to, so a day with no weight on it does not step the line.
    trends = {
        name: [
            {"date": day.isoformat(), "pct": round(value, 1)}
            for day, value in health.trend_by_day(read_days(rows, field))
        ]
        for field, name in TREND_KEYS.items()
    }
    db.commit()
    return {
        "days": window,
        "latest": latest_by_field(rows),
        "measurements": [measurement_row(row) for row in reversed(rows)],
        "trend": [
            {"date": day.isoformat(), "kg": health.round_for_display(value, "kg")}
            for day, value in line
        ],
        "trends": trends,
    }


@router.put("/measurements/{date}")
def write_measurement(
    date: str,
    body: MeasurementIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """One day's reading, typed in, merged into whatever the day holds.

    A field left out is left alone, so logging a weight keeps the body fat that
    was read that morning and logging a body fat keeps the weight.
    """
    day = asked_day(date, user)
    if day > clock.user_today(user):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, FUTURE_MEASUREMENT)
    refuse_if_complete(db, user, day)

    sent = body.model_fields_set
    for field in MEASURED:
        value = getattr(body, field)
        low, high = LIMITS[field]
        if value is not None and not (low <= value <= high):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"That is not a {_name(field)}.")

    row = db.execute(
        select(models.WeightEntry).where(
            models.WeightEntry.user_id == user.id, models.WeightEntry.date_for == day
        )
    ).scalar_one_or_none()
    kept = {field: None if row is None else getattr(row, field) for field in MEASURED}
    merged = {
        field: getattr(body, field) if field in sent else kept[field] for field in MEASURED
    }
    # A day is the readings on it. One that would be left holding none of them
    # is refused rather than kept as an empty row, and a day is taken back off
    # by deleting it.
    if all(value is None for value in merged.values()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NOTHING_RECORDED)
    if row is None:
        row = models.WeightEntry(user_id=user.id, date_for=day)
        db.add(row)
    for field, value in merged.items():
        setattr(row, field, value)
    # Typed in always wins the day. An import that arrives later leaves this
    # standing rather than overwriting somebody's own reading.
    row.source = "manual"
    db.commit()
    return measurement_row(row)


def _name(field: str) -> str:
    """What a refused number is called in the sentence that refuses it."""
    return {
        "weight_kg": "weight Tare can use",
        "body_fat_pct": "body fat percentage Tare can use",
        "body_water_pct": "body water percentage Tare can use",
        "muscle_pct": "muscle percentage Tare can use",
        "bone_pct": "bone percentage Tare can use",
    }[field]


@router.delete("/measurements/{date}", status_code=status.HTTP_204_NO_CONTENT)
def delete_measurement(
    date: str, db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> None:
    day = asked_day(date, user)
    refuse_if_complete(db, user, day)
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
    refuse_if_complete(db, user, day)
    if body.activity not in health.ACTIVITY_BY_KEY:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_ACTIVITY)
    met = health.met_for(body.activity, body.effort)
    if met is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_EFFORT)

    weighed = weight_on(db, user, day)
    # Decision 7: without a weigh-in the credit is worked out at an assumed
    # weight, and the screen says so rather than pretending.
    kg = weighed if weighed is not None else health.ASSUMED_WEIGHT_KG
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
    refuse_if_complete(db, user, row.date_for)
    db.delete(row)
    db.commit()
