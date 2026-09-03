"""Every number tare works out about a person, and nothing else.

Pure functions over plain numbers: no session, no request, no account. The
specification is docs/HEALTH-MATH.md, and each function below is named after
the decision it carries out. Nothing here invents a rule that document does not
state, and nothing here knows the words the screens use, which is why the notes
and nudges are keyed rather than written.
"""

from __future__ import annotations

import datetime as dt
from typing import NamedTuple

# Decision 5. Everyday movement without workouts, which are credited on their
# own so the same run is never counted twice.
ACTIVITY_MULTIPLIER = {
    "not_much": 1.2,
    "light": 1.375,
    "moderate": 1.55,
    "heavy": 1.725,
}

# Decisions 13 and 17: the goal rates on offer, in kilograms a week. Losing
# reads 1, 1.5 and 2 lb a week; gaining reads 0.5 and 1 lb.
LOSE_STEPS = (0.45, 0.7, 0.9)
GAIN_STEPS = (0.25, 0.45)

# What a kilogram a week costs or earns in a day, which is the pairing the two
# rate tables in decisions 13 and 17 are written with. Not the 7,700 kcal per
# kilogram of decision 20: that figure sizes a correction, not a pace.
KCAL_PER_DAY_PER_KG_WEEK = 1000.0

# Decisions 14 and 17: how far from maintenance a budget may sit.
DEFICIT_CAP = 0.25
SURPLUS_CAP = 0.20

# Decision 15.
FLOOR = {"female": 1200.0, "male": 1500.0}

# Decision 22.
UNDERWEIGHT_BMI = 18.5
CLINICIAN_BMI = 40.0

# Decision 10: protein in grams per kilogram of current weight, by goal, and
# the floor that applies from 65.
PROTEIN_PER_KG = {"maintain": 1.4, "lose": 1.6, "gain": 1.6}
OLDER_ADULT_AGE = 65
OLDER_ADULT_PROTEIN_PER_KG = 1.2

# Decision 10: the range the result is held inside, as a share of the budget.
PROTEIN_MIN_SHARE = 0.10
PROTEIN_MAX_SHARE = 0.35
FAT_SHARE = 0.30

# Decision 11: from here up, the share ceiling is taken before anything else.
HIGH_BMI = 30.0

# Decision 10: the carbohydrate recommended intake, under which the Targets
# page says one sentence.
CARBS_LOW_G = 130.0

# Decision 12.
FIBER_G_PER_1000 = 14.0
SATURATED_FAT_SHARE = 0.10
SODIUM_MG_MAX = 2300.0
CHOLESTEROL_MG_MAX = 300.0

# Decision 12: added sugars are a fixed figure by sex rather than a share of
# the budget, which is what the American Heart Association publishes. [31]
# Somebody who has not said gets the higher of the two, so tare never sets a
# lower ceiling than the member's own would be.
ADDED_SUGARS_G_MAX = {"female": 25.0, "male": 36.0}
ADDED_SUGARS_G_MAX_UNKNOWN = 36.0

# Decision 10b: the guide's own splits, offered as a starting point and never
# as the automatic answer. Protein is held at the top of the recommended range
# rather than above it.
PRESET_PROTEIN_MAX_PCT = 35
MACRO_PRESETS: dict[str, tuple[int, int, int]] = {
    "lose": (35, 35, 30),
    "maintain": (30, 40, 30),
    "gain": (35, 45, 20),
}

# Decision 10b: what a hand-set percentage may be, and what the three of them
# have to come to.
PCT_MIN = 5
PCT_MAX = 70
PCT_TOTAL = 100

# What a gram of each is worth.
KCAL_PER_G_PROTEIN = 4.0
KCAL_PER_G_CARBS = 4.0
KCAL_PER_G_FAT = 9.0

# Decision 19.
TREND_ALPHA = 0.1

# Decision 20.
REESTIMATE_DAYS = 28
REESTIMATE_LOGGED_DAYS = 20
REESTIMATE_DRIFT = 0.5
KCAL_PER_KG = 7700.0

# Decision 26.
KG_PER_LB = 0.45359237
CM_PER_INCH = 2.54

# Decision 7: one MET is about a kilocalorie per kilogram per hour, and the
# resting share is taken back out because the resting estimate already holds it.
MET_ML_PER_KG_MIN = 3.5
ML_O2_PER_KCAL = 200.0

# Decision 7: what a workout is credited against when nobody has weighed in.
ASSUMED_WEIGHT_KG = 70.0


class Budget(NamedTuple):
    """A day's calories, the pace that comes of them, and what to say about it."""

    calories: float
    weekly_rate_kg: float
    # Keys, not sentences. The router turns them into the doc's words.
    notes: tuple[str, ...]


class Macros(NamedTuple):
    protein_g: float
    carbs_g: float
    fat_g: float
    carbs_low: bool


class Ceilings(NamedTuple):
    fiber_g: float
    saturated_fat_g_max: float
    sugar_g_max: float
    sodium_mg_max: float
    cholesterol_mg_max: float


class ActivityOption(NamedTuple):
    """One level of everyday movement, and what picking it would do."""

    level: str
    # Null without a profile: no number is better than a made-up one.
    adds: float | None
    total: float | None


class Effort(NamedTuple):
    effort: str
    met: float


class Activity(NamedTuple):
    key: str
    name: str
    efforts: tuple[Effort, ...]


# Decision 9. Used whenever sex, height or a weight is missing, and not derived
# from anything below: these are the published label values, which is why the
# saturated fat and fiber figures differ slightly from ceilings() at 2,000.
DEFAULTS_2000 = {
    "calories": 2000.0,
    "protein_g": 100.0,
    "carbs_g": 250.0,
    "fat_g": 67.0,
    "fiber_g": 28.0,
    "saturated_fat_g_max": 20.0,
    # Decision 12's figure rather than the label's 50 g, which is the 10
    # percent basis the guidelines dropped.
    "sugar_g_max": ADDED_SUGARS_G_MAX_UNKNOWN,
    "sodium_mg_max": SODIUM_MG_MAX,
    "cholesterol_mg_max": CHOLESTEROL_MG_MAX,
}


def age_on(birthdate: dt.date, day: dt.date) -> int:
    """Whole years, counted the way a birthday is."""
    had_birthday = (day.month, day.day) >= (birthdate.month, birthdate.day)
    return day.year - birthdate.year - (0 if had_birthday else 1)


def rmr_mifflin(sex: str, kg: float, cm: float, age: int) -> float:
    """Decision 1: what the body uses at rest, from weight, height and age."""
    base = 10.0 * kg + 6.25 * cm - 5.0 * age
    return base - 161.0 if sex == "female" else base + 5.0


def rmr_cunningham(kg: float, body_fat_pct: float) -> float:
    """Decision 2: the same figure from lean mass, when body fat is known.

    Only ever called with a reading that is recent enough; how recent is
    decision 2's ninety days and the caller's business.
    """
    lean_kg = kg * (1.0 - body_fat_pct / 100.0)
    return 370.0 + 21.6 * lean_kg


def maintenance(rmr: float, activity_level: str) -> float:
    """Decision 5: about what the body uses in an ordinary day."""
    return rmr * ACTIVITY_MULTIPLIER.get(activity_level, ACTIVITY_MULTIPLIER["not_much"])


def bmi(kg: float, cm: float) -> float:
    """Computed for the guardrails in decision 22 and never shown (decision 23)."""
    metres = cm / 100.0
    return kg / (metres * metres)


def direction(latest_weight_kg: float | None, goal_weight_kg: float | None) -> str:
    """Which way the member is going, read off the two weights they can see.

    The latest weigh-in rather than the trend, so the answer matches the number
    on the screen. Without either weight, or with the two the same, there is
    nothing to aim at and the day is the day.
    """
    if latest_weight_kg is None or goal_weight_kg is None:
        return "maintain"
    if goal_weight_kg < latest_weight_kg:
        return "lose"
    if goal_weight_kg > latest_weight_kg:
        return "gain"
    return "maintain"


def steps_for(way: str) -> tuple[float, ...]:
    """Decisions 13 and 17: the goal rates offered for going that way."""
    if way == "lose":
        return LOSE_STEPS
    if way == "gain":
        return GAIN_STEPS
    return ()


def budget(
    maintenance_kcal: float,
    way: str,
    rate_kg_per_week: float | None,
    sex: str,
    pregnant: bool,
) -> Budget:
    """Decisions 13 to 17 and 24: the day's calories, and why they are that.

    The order is the order the sources impose: the goal rate is one of the
    steps, then it is held to a share of maintenance, and the floor is applied
    last because it is the one figure nothing may go under.
    """
    notes: list[str] = []

    if pregnant:
        # Decision 24: nothing taken off and nothing added on, and the number
        # handed to a clinician rather than adjusted here.
        notes.append("pregnancy")
        return Budget(_floored(maintenance_kcal, sex, notes), 0.0, tuple(notes))

    steps = steps_for(way)
    if not steps:
        return Budget(_floored(maintenance_kcal, sex, notes), 0.0, tuple(notes))
    # A stored rate belongs to the direction it was picked under, and a
    # weigh-in can turn that direction around. The direction's own first step
    # stands until the member picks again.
    chosen = rate_kg_per_week if rate_kg_per_week in steps else steps[0]

    change = chosen * KCAL_PER_DAY_PER_KG_WEEK
    cap = maintenance_kcal * (DEFICIT_CAP if way == "lose" else SURPLUS_CAP)
    if change > cap:
        change = cap
        notes.append("cap")

    raw = maintenance_kcal - change if way == "lose" else maintenance_kcal + change
    calories = _floored(raw, sex, notes)
    # What the budget actually asks of the body, once the cap and the floor
    # have had their say. Decision 15 recalculates the pace from what is left.
    achieved = abs(maintenance_kcal - calories)
    return Budget(calories, achieved / KCAL_PER_DAY_PER_KG_WEEK, tuple(notes))


def _floored(calories: float, sex: str, notes: list[str]) -> float:
    """Decision 15: the lowest budget tare will set, whatever the goal."""
    floor = FLOOR.get(sex, FLOOR["female"])
    if calories < floor:
        notes.append("floor")
        return floor
    return calories


def macros(calories: float, kg: float, goal: str, age: int, body_mass_index: float) -> Macros:
    """Decisions 10 and 11: protein for the member's size, then fat, then the rest.

    The clamp is what decision 11 asks for at a body mass index of 30 or more:
    a per-kilogram rule scaled to a high body weight is held inside the range
    before anything else is worked out from it.
    """
    per_kg = PROTEIN_PER_KG.get(goal, PROTEIN_PER_KG["maintain"])
    if age >= OLDER_ADULT_AGE:
        per_kg = max(per_kg, OLDER_ADULT_PROTEIN_PER_KG)

    low = calories * PROTEIN_MIN_SHARE / KCAL_PER_G_PROTEIN
    high = calories * PROTEIN_MAX_SHARE / KCAL_PER_G_PROTEIN
    # Decision 11: at a high body weight the ceiling is taken first, so the
    # per-kilogram rule cannot carry the target out of the range.
    protein_g = min(per_kg * kg, high) if body_mass_index >= HIGH_BMI else per_kg * kg
    protein_g = min(max(protein_g, low), high)

    fat_g = calories * FAT_SHARE / KCAL_PER_G_FAT
    left = calories - protein_g * KCAL_PER_G_PROTEIN - fat_g * KCAL_PER_G_FAT
    carbs_g = max(left / KCAL_PER_G_CARBS, 0.0)
    return Macros(protein_g, carbs_g, fat_g, carbs_g < CARBS_LOW_G)


def added_sugars_max(sex: str | None) -> float:
    """Decision 12: the added sugars ceiling, which is a figure and not a share."""
    if sex is None:
        return ADDED_SUGARS_G_MAX_UNKNOWN
    return ADDED_SUGARS_G_MAX.get(sex, ADDED_SUGARS_G_MAX_UNKNOWN)


def ceilings(calories: float, sex: str | None = None) -> Ceilings:
    """Decision 12: fibre to aim at, and the four figures to stay under."""
    return Ceilings(
        fiber_g=calories / 1000.0 * FIBER_G_PER_1000,
        saturated_fat_g_max=calories * SATURATED_FAT_SHARE / KCAL_PER_G_FAT,
        sugar_g_max=added_sugars_max(sex),
        sodium_mg_max=SODIUM_MG_MAX,
        cholesterol_mg_max=CHOLESTEROL_MG_MAX,
    )


def macros_from_percentages(
    calories: float, protein_pct: int, carbs_pct: int, fat_pct: int
) -> Macros:
    """Decision 10b: the same three numbers from shares somebody set themselves.

    Nothing is clamped here. These are the member's own percentages, already
    held to their bounds where they were accepted, and quietly moving them
    afterwards would make the screen disagree with itself.
    """
    protein_g = calories * protein_pct / 100.0 / KCAL_PER_G_PROTEIN
    carbs_g = calories * carbs_pct / 100.0 / KCAL_PER_G_CARBS
    fat_g = calories * fat_pct / 100.0 / KCAL_PER_G_FAT
    return Macros(protein_g, carbs_g, fat_g, carbs_g < CARBS_LOW_G)


def activity_options(resting: float | None) -> tuple[ActivityOption, ...]:
    """Decision 5: what each level would add to a day, and what it comes to.

    The added figure is the one the chooser shows, because the level is picked
    against the difference it makes rather than against a multiplier nobody is
    told the name of (decision 29).
    """
    return tuple(
        ActivityOption(
            level=level,
            adds=None if resting is None else resting * (multiplier - 1.0),
            total=None if resting is None else resting * multiplier,
        )
        for level, multiplier in ACTIVITY_MULTIPLIER.items()
    )


def exercise_kcal(met: float, kg: float, minutes: float) -> float:
    """Decision 7: what a workout adds back, over and above resting.

    The one MET taken off is tare's own step, not the Compendium's: it removes
    the energy the body would have spent lying still, which the resting
    estimate already holds.
    """
    return (met - 1.0) * MET_ML_PER_KG_MIN * kg / ML_O2_PER_KCAL * minutes


def trend(readings: list[float]) -> list[float]:
    """Decision 19: the smoothed weight, one value per reading, seeded by the first."""
    smoothed: list[float] = []
    running = 0.0
    for index, reading in enumerate(readings):
        running = reading if index == 0 else running + TREND_ALPHA * (reading - running)
        smoothed.append(running)
    return smoothed


def trend_by_day(readings: list[tuple[dt.date, float]]) -> list[tuple[dt.date, float]]:
    """The same trend laid out a day at a time, so a gap carries rather than closes.

    Readings come in oldest first. A day nobody weighed on keeps yesterday's
    value, which is what makes the line honest about a fortnight off the scale.
    """
    if not readings:
        return []
    by_day = dict(readings)
    smoothed: list[tuple[dt.date, float]] = []
    running = readings[0][1]
    day = readings[0][0]
    last = readings[-1][0]
    while day <= last:
        reading = by_day.get(day)
        if reading is not None and day != readings[0][0]:
            running = running + TREND_ALPHA * (reading - running)
        smoothed.append((day, running))
        day += dt.timedelta(days=1)
    return smoothed


def projection(
    trend_kg: float, goal_kg: float | None, weekly_rate_kg: float, today: dt.date
) -> str | None:
    """Decision 18: the day a goal is reached at this pace, or nothing.

    A plain linear estimate; the screen marks it as one beside this figure.
    """
    if goal_kg is None or weekly_rate_kg <= 0:
        return None
    gap = abs(trend_kg - goal_kg)
    if gap == 0:
        return None
    reached = today + dt.timedelta(days=round(gap / weekly_rate_kg * 7.0))
    return reached.isoformat()


def nudges(
    body_mass_index: float | None, goal: str, goal_bmi: float | None
) -> tuple[str, ...]:
    """Decision 22: the keys of the calm sentences a member may need to see."""
    found: list[str] = []
    if body_mass_index is None:
        return ()
    if body_mass_index < UNDERWEIGHT_BMI and goal == "lose":
        found.append("below_range")
    if goal_bmi is not None and goal_bmi < UNDERWEIGHT_BMI:
        found.append("goal_below_range")
    if body_mass_index >= CLINICIAN_BMI:
        found.append("high_weight")
    return tuple(found)


def reestimate(
    trend_series: list[float], logged_days: int, weekly_rate_kg: float, goal: str
) -> float | None:
    """Decision 20: a calorie correction offered from what actually happened.

    Never applied on its own, and never offered from too little: it needs four
    weeks of trend and food logged on five days a week, because a correction
    from a fortnight of half-logged days corrects the logging.
    """
    if goal == "maintain" or weekly_rate_kg <= 0:
        return None
    if len(trend_series) < REESTIMATE_DAYS or logged_days < REESTIMATE_LOGGED_DAYS:
        return None

    # The span the trend covers, which is one less than the number of days it
    # has a value for.
    days = len(trend_series) - 1
    observed = trend_series[-1] - trend_series[0]
    expected = (-weekly_rate_kg if goal == "lose" else weekly_rate_kg) * days / 7.0
    if abs(observed - expected) <= REESTIMATE_DRIFT * abs(expected):
        return None
    # The gap in kilograms over the period, priced at the rule of thumb decision
    # 20 names and spread back over the days it covers.
    return (expected - observed) * KCAL_PER_KG / days


def clamp_budget(calories: float, maintenance_kcal: float, sex: str, goal: str) -> float:
    """Hold a hand-corrected budget inside the same walls an automatic one has.

    Decision 20 says the offer never breaks the floor or the cap, and this is
    where that holds.
    """
    if goal == "lose":
        calories = max(calories, maintenance_kcal * (1.0 - DEFICIT_CAP))
    elif goal == "gain":
        calories = min(calories, maintenance_kcal * (1.0 + SURPLUS_CAP))
    return max(calories, FLOOR.get(sex, FLOOR["female"]))


# Decision 28: how far a computed number is allowed to claim it knows. A weight
# keeps two places, which is finer than a scale but coarser than a float.
DISPLAY_STEP = {"calories": 10, "grams": 1, "percent": 1}


def round_for_display(value: float, kind: str) -> float:
    if kind == "kg":
        return round(value, 2)
    step = DISPLAY_STEP[kind]
    return round(value / step) * step


# The catalogue, in plain words, with the value each row is credited at.
#
# Every value is from the 2024 Adult Compendium of Physical Activities
# (https://pacompendium.com/), and the five-digit code beside it is that
# Compendium's own. Where it publishes fewer than three rows for something, only
# the efforts it has are offered; nothing here is interpolated or invented.
ACTIVITIES: tuple[Activity, ...] = (
    Activity(
        "walking",
        "Walking",
        (
            Effort("light", 2.8),  # 17152, 2.0 to 2.4 mph, level, slow pace
            Effort("moderate", 3.8),  # 17190, 2.8 to 3.4 mph, level, moderate pace
            Effort("vigorous", 4.8),  # 17200, 3.5 to 3.9 mph, level, brisk
        ),
    ),
    Activity(
        "running",
        "Running",
        (
            Effort("light", 7.5),  # 12020, jogging, general, self-selected pace
            Effort("moderate", 9.3),  # 12050, 6 to 6.3 mph
            Effort("vigorous", 11.0),  # 12070, 7 mph
        ),
    ),
    Activity(
        "cycling",
        "Cycling",
        (
            Effort("light", 6.8),  # 01020, 10 to 11.9 mph, leisure, light effort
            Effort("moderate", 8.0),  # 01030, 12 to 13.9 mph, leisure, moderate effort
            Effort("vigorous", 10.0),  # 01040, 14 to 15.9 mph, fast, vigorous effort
        ),
    ),
    Activity(
        "stationary_bike",
        "Stationary bike",
        (
            Effort("light", 4.0),  # 01214, stationary, 50 watts, light effort
            Effort("moderate", 6.0),  # 01220, stationary, 90 to 100 watts
            Effort("vigorous", 8.0),  # 01228, stationary, 126 to 150 watts
        ),
    ),
    Activity(
        "swimming",
        "Swimming",
        (
            # No light row: the Compendium's slow freestyle is already the
            # light-to-moderate one, so it is offered once and not twice.
            Effort("moderate", 5.8),  # 18240, laps, freestyle, slow, light or moderate
            Effort("vigorous", 9.8),  # 18230, laps, freestyle, fast, vigorous effort
        ),
    ),
    Activity(
        "strength",
        "Strength training",
        (
            Effort("light", 3.5),  # 02054, multiple exercises, 8 to 15 reps
            Effort("moderate", 5.0),  # 02052, squats, deadlift, slow or explosive
            Effort("vigorous", 6.0),  # 02050, free weights or machines, vigorous effort
        ),
    ),
    Activity(
        "yoga",
        "Yoga",
        (
            Effort("light", 2.3),  # 02150, hatha
            Effort("moderate", 4.0),  # 02160, power
            Effort("vigorous", 8.0),  # 02153, hatha, high intensity
        ),
    ),
    Activity(
        "hiking",
        "Hiking",
        (
            Effort("light", 3.8),  # 17081, slowly or ambling through fields, no load
            Effort("moderate", 5.3),  # 17082, normal pace through fields, no load
            Effort("vigorous", 6.0),  # 17080, cross country
        ),
    ),
    Activity(
        "elliptical",
        "Elliptical",
        (
            # The Compendium publishes two rows for this machine.
            Effort("moderate", 5.0),  # 02048, elliptical trainer, moderate effort
            Effort("vigorous", 9.0),  # 02049, elliptical trainer, vigorous effort
        ),
    ),
    Activity(
        "rowing",
        "Rowing machine",
        (
            Effort("moderate", 5.0),  # 02071, stationary ergometer, under 100 watts
            Effort("vigorous", 7.5),  # 02072, stationary, 100 to 149 watts
        ),
    ),
    Activity(
        "stairs",
        "Stairs",
        (
            Effort("light", 4.5),  # 17133, stair climbing, slow pace
            Effort("moderate", 6.8),  # 17131, stair climbing, general
            Effort("vigorous", 9.3),  # 17134, stair climbing, fast pace
        ),
    ),
    Activity(
        "dancing",
        "Dancing",
        (
            Effort("light", 3.0),  # 03040, ballroom, slow
            Effort("moderate", 5.5),  # 03030, ballroom, fast
            Effort("vigorous", 7.3),  # 03029, aerobic dance
        ),
    ),
    Activity(
        "basketball",
        "Basketball",
        (
            Effort("light", 5.0),  # 15070, shooting baskets
            Effort("moderate", 7.5),  # 15055, general
            Effort("vigorous", 8.0),  # 15040, game
        ),
    ),
    Activity(
        "soccer",
        "Soccer",
        (
            Effort("moderate", 7.0),  # 15610, casual, general
            Effort("vigorous", 9.5),  # 15605, competitive
        ),
    ),
    Activity(
        "tennis",
        "Tennis",
        (
            Effort("moderate", 6.0),  # 15680, doubles
            Effort("vigorous", 8.0),  # 15690, singles
        ),
    ),
    Activity(
        "housework",
        "Housework",
        (
            Effort("light", 2.5),  # 05040, cleaning, general, light effort
            Effort("moderate", 3.3),  # 05030, cleaning, general, moderate effort
            Effort("vigorous", 4.3),  # 05027, multiple household tasks, vigorous effort
        ),
    ),
    Activity(
        "gardening",
        "Gardening",
        (
            Effort("light", 2.0),  # 08066, gardening, general, light effort
            Effort("moderate", 4.5),  # 08240, weeding, cultivating, moderate effort
            Effort("vigorous", 5.0),  # 08050, digging, spading, composting
        ),
    ),
)

ACTIVITY_BY_KEY = {row.key: row for row in ACTIVITIES}


def met_for(activity_key: str, effort: str) -> float | None:
    """The value a row is credited at, or nothing when that pairing has none."""
    activity = ACTIVITY_BY_KEY.get(activity_key)
    if activity is None:
        return None
    return next((row.met for row in activity.efforts if row.effort == effort), None)
