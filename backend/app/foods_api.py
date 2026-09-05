"""The one place this server talks to the internet.

Text search never leaves the instance. A barcode is the single exception: a code
nobody here has entered yet is asked about elsewhere, and what comes back is a
suggestion for somebody to correct, not a food. Nothing in this module writes a
row, reads a session, or knows what an account is; it takes a barcode and hands
back a normalised reading, so the routes stay thin and the tests can put a fake
transport under it instead of a network.

One source. Open Food Facts needs no key, covers the whole world, and is what
every install here reads from.
"""

from __future__ import annotations

import dataclasses
import math
import re
from typing import Any

import httpx

OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product/{barcode}.json"

# Named rather than anonymous. Open Food Facts asks callers to identify
# themselves, and an instance that misbehaves should be attributable to this
# software rather than to a bare HTTP client.
USER_AGENT = "tare/0.1 (self-hosted)"
TIMEOUT = 10.0

# Only what a panel needs. Asking for the whole product record would pull tens
# of kilobytes of things this app has no column for.
OFF_FIELDS = (
    "product_name,brands,nutriments,serving_size,serving_quantity,"
    "serving_quantity_unit,ingredients_text"
)


class FoodApiError(Exception):
    """A lookup could not be completed. The route answers 502 and one sentence."""


@dataclasses.dataclass
class FoodResult:
    """One product as this app stores foods: per 100 of its own base unit."""

    source: str
    source_id: str
    name: str
    brand: str

    calories: float | None = None
    protein_g: float | None = None
    carbs_g: float | None = None
    fat_g: float | None = None
    saturated_fat_g: float | None = None
    trans_fat_g: float | None = None
    cholesterol_mg: float | None = None
    sodium_mg: float | None = None
    fiber_g: float | None = None
    sugar_g: float | None = None
    # How much of the sugars above was put in. A record that never says stays
    # null, which is what the panel then shows.
    added_sugars_g: float | None = None

    # 'g' or 'ml'. Every number above is per 100 of this.
    base_unit: str = "g"
    # What one millilitre weighs, when the label named its serving both ways.
    density_g_per_ml: float | None = None
    # The serving as the label printed it, and the same serving as an amount of
    # the base unit. The text is what a person recognises; the amount is what
    # can be multiplied. A label giving only a household phrase has the first
    # and not the second.
    serving: str = ""
    serving_amount: float | None = None
    ingredients_text: str = ""


def _num(value: object) -> float | None:
    """A reading as a number, or nothing. A field that is absent, empty, or not
    a number at all is a nutrient nobody stated, which is not zero of it."""
    try:
        return round(float(value), 2)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _scaled(value: object, factor: float) -> float | None:
    """A reading moved into the unit this app stores it in.

    Open Food Facts reports sodium and cholesterol in grams per 100 g. Labels,
    and the columns here, use milligrams.

    Scaled before it is rounded, never after: 0.023 g of cholesterol rounded to
    two places first is 0.02 g, and the label says 23 mg, not 20.
    """
    try:
        return round(float(value) * factor, 2)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _energy_kcal(kcal: object, kj: object) -> float | None:
    """Calories, from whichever energy reading the source carried.

    Some records hold only kilojoules. Without this a perfectly good product
    would read as having no calories at all, which is the one number a food is
    unusable without.
    """
    direct = _num(kcal)
    if direct is not None:
        return direct
    joules = _num(kj)
    return None if joules is None else round(joules / 4.184, 1)


# The energy a food's own macronutrients account for cannot sit far above what
# the food claims to carry. The floor is built on SUGARS rather than on total
# carbohydrate on purpose: sugar alcohols count as carbohydrate on a label and
# carry almost no energy, so a truthful sweetener reading "98 g carbs, 20 kcal"
# would look impossible against a carbohydrate floor and be corrupted by the
# repair below. Sugars are never polyols, so four calories a gram holds there
# without exception.
ATWATER_FLOOR_MIN = 20.0
# Below this the floor is built out of trace figures the label rounded, and
# rounding is not a mistake worth correcting.
ATWATER_TOLERANCE = 0.9


def repair_energy(result: FoodResult) -> FoodResult:
    """Raise a calorie figure the food's own macronutrients contradict.

    One-sided, and deliberately so. Calories above the macronutrients are
    ordinary: alcohol carries seven calories a gram and appears in no column
    here, so nothing in this function ever lowers a number. What it catches is
    a record whose units were mixed up somewhere upstream, the syrup that reads
    78 calories against sugars that alone account for 96.
    """
    if result.calories is None or result.sugar_g is None:
        return result
    floor = 4 * (result.protein_g or 0) + 4 * result.sugar_g + 9 * (result.fat_g or 0)
    if floor < ATWATER_FLOOR_MIN or result.calories >= ATWATER_TOLERANCE * floor:
        return result
    # The repair is the full sum over every macronutrient, less an allowance for
    # the insoluble fibre that passes through unburned: the raw arithmetic
    # overstates a high-fibre food. Never below what the record already said.
    atwater = 4 * (result.protein_g or 0) + 4 * (result.carbs_g or 0) + 9 * (result.fat_g or 0)
    result.calories = float(round(max(result.calories, atwater - 2 * (result.fiber_g or 0))))
    return result


# What a serving's structured size may be measured in, and what one of it is
# worth in the base unit of its family.
MASS_TO_G = {"g": 1.0, "gram": 1.0, "grams": 1.0, "grm": 1.0, "kg": 1000.0, "oz": 28.3495}
VOLUME_TO_ML = {"ml": 1.0, "mlt": 1.0, "cl": 10.0, "l": 1000.0, "floz": 29.5735}

# Volume marks that can be read out of the phrase a label prints. A metric mark
# or a fluid ounce is unambiguously a liquid. A cup or a spoon measures cereal
# as readily as milk, so it is kept apart below and only trusted when nothing
# better is available.
COMMITTED_ML = {
    "ml": 1.0,
    "millilitre": 1.0,
    "millilitres": 1.0,
    "milliliter": 1.0,
    "milliliters": 1.0,
    "cl": 10.0,
    "l": 1000.0,
    "litre": 1000.0,
    "litres": 1000.0,
    "liter": 1000.0,
    "liters": 1000.0,
    "floz": 29.5735,
}
IMPLIED_ML = {
    "cup": 236.588,
    "cups": 236.588,
    "tbsp": 14.7868,
    "tbsps": 14.7868,
    "tablespoon": 14.7868,
    "tablespoons": 14.7868,
    "tsp": 4.92892,
    "tsps": 4.92892,
    "teaspoon": 4.92892,
    "teaspoons": 4.92892,
}
# Metric mass marks only. A bare "oz" in a phrase may be an ounce or a fluid
# ounce, and guessing wrong would put a density in the database that is out by
# a factor nobody could spot afterwards.
PHRASE_G = {"g": 1.0, "gram": 1.0, "grams": 1.0, "gramme": 1.0, "grammes": 1.0, "kg": 1000.0}

# No serving on a real label is bigger than a few litres. Anything past this is
# a mangled record, and it must never reach a row somebody eats out of.
MAX_SERVING = 10000.0

# The bounds the food form already holds a density to. Outside them a reading
# was misread rather than unusual, and saying nothing is better than lying.
DENSITY_MIN = 0.2
DENSITY_MAX = 3.0

# An amount and the word after it. The lookbehind keeps a fraction's denominator
# ("1/4 cup" reading as "4 cup") and a decimal's tail from parsing as amounts of
# their own.
_MEASURE = re.compile(r"(?<![\d/.])(\d+(?:\.\d+)?)\s*([a-z]+)")


def _phrase_readings(text: str) -> tuple[float | None, float | None, float | None]:
    """What a printed serving phrase says: grams, a stated volume, a hinted one.

    Split into two volume tiers because the two answer different questions. The
    stated tier decides whether this product is measured by volume at all. The
    hinted tier is useless for that and exactly right for a density: a label
    that pairs a spoon with a gram weight is saying what a spoonful weighs.
    """
    if not text:
        return None, None, None
    normalised = text.lower()
    for phrase in ("fluid ounces", "fluid ounce", "fl. oz.", "fl oz", "fl.oz", "fl-oz"):
        normalised = normalised.replace(phrase, "floz")

    grams = stated = hinted = None
    for amount, unit in _MEASURE.findall(normalised):
        for table, held in ((PHRASE_G, "g"), (COMMITTED_ML, "stated"), (IMPLIED_ML, "hinted")):
            factor = table.get(unit)
            if factor is None:
                continue
            reading = round(float(amount) * factor, 2)
            if not math.isfinite(reading) or not 0 < reading < MAX_SERVING:
                break
            if held == "g" and grams is None:
                grams = reading
            elif held == "stated" and stated is None:
                stated = reading
            elif held == "hinted" and hinted is None:
                hinted = reading
            break
    return grams, stated, hinted


def _structured_serving(size: object, unit: object) -> tuple[float, str] | None:
    """A serving's size from the fields that carry it, as an amount of a base unit."""
    amount = _num(size)
    if amount is None or amount <= 0 or amount >= MAX_SERVING:
        return None
    mark = str(unit or "").strip().lower()
    if mark in MASS_TO_G:
        return round(amount * MASS_TO_G[mark], 2), "g"
    if mark in VOLUME_TO_ML:
        return round(amount * VOLUME_TO_ML[mark], 2), "ml"
    return None


@dataclasses.dataclass
class Measured:
    """What a label's serving settles: the family, the size, and the density."""

    base_unit: str = "g"
    amount: float | None = None
    density_g_per_ml: float | None = None


def measured_serving(size: object, unit: object, text: str) -> Measured:
    """How a product is measured, how big its serving is, and what it weighs.

    Both sources routinely stamp a liquid serving with a mass unit: a cream at
    "2 tbsp (30 ml)" arrives with its unit field saying grams. So a volume the
    phrase states outright beats the fields, the fields beat a phrase that only
    hints at one, and a product that gives nothing measurable stays in grams
    with no serving amount at all.

    A label that names the same serving both ways has also given up the food's
    density, which is what lets it be logged in either family of units. That
    reading is taken alongside and never instead: it does not move the base unit
    the lines above settled on.
    """
    structured = _structured_serving(size, unit)
    grams, stated, hinted = _phrase_readings(text)

    found = Measured()
    if stated is not None:
        found = Measured(base_unit="ml", amount=stated)
    elif structured is not None:
        found = Measured(base_unit=structured[1], amount=structured[0])
    elif hinted is not None:
        found = Measured(base_unit="ml", amount=hinted)

    # One reading from each family, wherever each came from. The hinted tier is
    # welcome here for the reason it is refused above.
    mass = structured[0] if structured is not None and structured[1] == "g" else grams
    volume = structured[0] if structured is not None and structured[1] == "ml" else None
    if volume is None:
        volume = stated if stated is not None else hinted
    if mass and volume:
        density = round(mass / volume, 4)
        if DENSITY_MIN <= density <= DENSITY_MAX:
            found.density_g_per_ml = density
    return found


# A word, apostrophes and all. str.title() capitalises the letter after an
# apostrophe, which turns HERSHEY'S into Hershey'S.
_WORD = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)*")


def _titled(text: str) -> str:
    """A catalogue name in ordinary case. Branded records are often shouted.

    Only a name that is entirely upper case is touched. One that is already
    cased is somebody's choice, and re-casing it would lose the capitals in
    names that carry them for a reason.
    """
    if text and text == text.upper() and any(character.isalpha() for character in text):
        return _WORD.sub(lambda word: word.group(0).capitalize(), text)
    return text


def lookup_off(barcode: str, client: httpx.Client | None = None) -> FoodResult | None:
    """One barcode in Open Food Facts, or nothing."""
    payload = _get(
        OFF_PRODUCT_URL.format(barcode=barcode), params={"fields": OFF_FIELDS}, client=client
    )
    if payload.get("status") != 1:
        return None
    product = payload.get("product") or {}
    nutriments = product.get("nutriments") or {}
    serving_text = str(product.get("serving_size") or "").strip()
    measured = measured_serving(
        product.get("serving_quantity"), product.get("serving_quantity_unit"), serving_text
    )
    return repair_energy(
        FoodResult(
            source="off",
            source_id=barcode,
            name=_titled(str(product.get("product_name") or "").strip()),
            # A record may list several brands. The first is the one on the front.
            brand=_titled(str(product.get("brands") or "").split(",")[0].strip()),
            calories=_energy_kcal(
                nutriments.get("energy-kcal_100g"), nutriments.get("energy-kj_100g")
            ),
            protein_g=_num(nutriments.get("proteins_100g")),
            carbs_g=_num(nutriments.get("carbohydrates_100g")),
            fat_g=_num(nutriments.get("fat_100g")),
            saturated_fat_g=_num(nutriments.get("saturated-fat_100g")),
            trans_fat_g=_num(nutriments.get("trans-fat_100g")),
            # Stored there in grams per 100 g; labels, and this app, use mg.
            cholesterol_mg=_scaled(nutriments.get("cholesterol_100g"), 1000),
            sodium_mg=_scaled(nutriments.get("sodium_100g"), 1000),
            fiber_g=_num(nutriments.get("fiber_100g")),
            sugar_g=_num(nutriments.get("sugars_100g")),
            added_sugars_g=_num(nutriments.get("added-sugars_100g")),
            base_unit=measured.base_unit,
            density_g_per_ml=measured.density_g_per_ml,
            serving=serving_text,
            serving_amount=measured.amount,
            ingredients_text=clean_ingredients(str(product.get("ingredients_text") or "")),
        )
    )


# Where an ingredient list stops and the rest of the package begins. A
# contributor sometimes types in the whole panel, trademarks and helpline
# included; an ingredient list ends before any of these.
_INGREDIENTS_END = (
    "distributed by",
    "manufactured by",
    "manufactured for",
    "produced by",
    "packed by",
    "made in a",
    "made in the",
    "www.",
    "http",
    "all rights reserved",
    "trademark",
    "questions",
    "comments",
    "call ",
    "keep refrigerated",
    "store in",
    "best if",
    "best by",
    "proof of purchase",
    "nutrition facts",
    "serving size",
    "per serving",
    "\u00a9",
    "\u00ae",
    "\u2122",
)
_INGREDIENTS_CAP = 600


def clean_ingredients(text: str) -> str:
    """The ingredient list alone, on one line, without the word "ingredients"
    in front of it and without whatever the package went on to say."""
    flat = " ".join(text.split())
    low = flat.lower()
    for lead in ("ingredients:", "ingredient:", "ingredients "):
        if low.startswith(lead):
            flat = flat[len(lead) :].lstrip()
            low = flat.lower()
            break
    ends = [at for mark in _INGREDIENTS_END if (at := low.find(mark)) > 0]
    if ends:
        flat = flat[: min(ends)]
    if len(flat) > _INGREDIENTS_CAP:
        flat = flat[:_INGREDIENTS_CAP]
        flat = flat[: flat.rfind(",")] if "," in flat else flat
    return flat.rstrip(" ,;.-")


def session() -> httpx.Client:
    """A client carrying this app's manners. The one place a test swaps in a
    transport, so nothing below it ever reaches a network by accident."""
    return httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT)


def _get(url: str, params: dict[str, Any], client: httpx.Client | None) -> dict[str, Any]:
    """One request, and one exception for everything that can go wrong with it.

    Nothing above cares which of the many failures it was, because the person
    holding the packet cannot do anything different about any of them.
    """
    borrowed = client is not None
    client = client if client is not None else session()
    try:
        response = client.get(url, params=params)
    except httpx.HTTPError as failure:
        raise FoodApiError("Could not reach the barcode database.") from failure
    finally:
        if not borrowed:
            client.close()
    if response.status_code >= 400:
        raise FoodApiError("The barcode database did not answer.")
    try:
        payload = response.json()
    except ValueError as failure:
        raise FoodApiError("The barcode database did not answer.") from failure
    return payload if isinstance(payload, dict) else {}


def lookup(barcode: str, client: httpx.Client | None = None) -> FoodResult | None:
    """A barcode against the one source this instance reads.

    Kept as its own function though it now has one line to do: the routes call
    this, so where a reading comes from stays a question this module answers.
    """
    return lookup_off(barcode, client)
