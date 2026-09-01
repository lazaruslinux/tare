"""The one place this server talks to the internet.

Text search never leaves the instance. A barcode is the single exception: a code
nobody here has entered yet is asked about elsewhere, and what comes back is a
suggestion for somebody to correct, not a food. Nothing in this module writes a
row, reads a session, or knows what an account is; it takes a barcode and hands
back a normalised reading, so the routes stay thin and the tests can put a fake
transport under it instead of a network.

Two sources, in the order they are tried. USDA FoodData Central's Branded set is
transcribed from United States labels and matched on an exact barcode, so it is
asked first when the instance has a key. Open Food Facts needs no key and covers
the rest of the world, so it is the fallback and the only source a keyless
install has.
"""

from __future__ import annotations

import dataclasses
import math
import re
from typing import Any

import httpx

USDA_SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search"
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

# USDA reports nutrients by number rather than by name. Sodium and cholesterol
# arrive in milligrams and the rest in grams, which is what the columns here
# already hold, so only energy needs any arithmetic.
N_ENERGY_KCAL = "208"
N_ENERGY_KJ = "268"
N_PROTEIN = "203"
N_CARBS = "205"
N_FAT = "204"
N_SATURATED = "606"
N_TRANS = "605"
N_CHOLESTEROL = "601"
N_SODIUM = "307"
N_FIBER = "291"
N_SUGAR = "269"


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


def normalised_barcode(code: object) -> str:
    """A barcode as it compares: digits only, leading zeros dropped.

    The same product is stored as a twelve-digit code in one place and a
    zero-padded fourteen-digit one in another, and neither is wrong.
    """
    return "".join(character for character in str(code or "") if character.isdigit()).lstrip("0")


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


def _usda_result(hit: dict[str, Any], barcode: str) -> FoodResult:
    by_number: dict[str, Any] = {}
    for entry in hit.get("foodNutrients") or []:
        if isinstance(entry, dict):
            by_number[str(entry.get("nutrientNumber"))] = entry.get("value")
    brand = hit.get("brandName") or hit.get("brandOwner") or ""
    household = str(hit.get("householdServingFullText") or "").strip()
    measured = measured_serving(hit.get("servingSize"), hit.get("servingSizeUnit"), household)
    return repair_energy(
        FoodResult(
            source="usda",
            # The barcode, not the record's own id: what identifies this row
            # here is the code that was scanned to find it.
            source_id=barcode,
            name=_titled(str(hit.get("description") or "").strip()),
            brand=_titled(str(brand).strip()),
            calories=_energy_kcal(by_number.get(N_ENERGY_KCAL), by_number.get(N_ENERGY_KJ)),
            protein_g=_num(by_number.get(N_PROTEIN)),
            carbs_g=_num(by_number.get(N_CARBS)),
            fat_g=_num(by_number.get(N_FAT)),
            saturated_fat_g=_num(by_number.get(N_SATURATED)),
            trans_fat_g=_num(by_number.get(N_TRANS)),
            cholesterol_mg=_num(by_number.get(N_CHOLESTEROL)),
            sodium_mg=_num(by_number.get(N_SODIUM)),
            fiber_g=_num(by_number.get(N_FIBER)),
            sugar_g=_num(by_number.get(N_SUGAR)),
            base_unit=measured.base_unit,
            density_g_per_ml=measured.density_g_per_ml,
            serving=household,
            serving_amount=measured.amount,
            ingredients_text=str(hit.get("ingredients") or "").strip(),
        )
    )


def lookup_usda(barcode: str, api_key: str, client: httpx.Client | None = None) -> FoodResult | None:
    """One barcode in USDA's Branded set, or nothing.

    An install with no key skips this source entirely rather than failing over
    it: Open Food Facts needs no key and covers the same scan.

    The catalogue matches its stored barcode string exactly, and stores it
    zero-padded to fourteen digits far more often than bare, so the padded form
    is asked first. A miss falls through to the other source anyway, so the
    second request only costs anything on the rare codes.
    """
    if not api_key:
        return None
    hits: list[dict[str, Any]] = []
    wanted = normalised_barcode(barcode)
    for query in dict.fromkeys((barcode.zfill(14), barcode)):
        payload = _get(
            USDA_SEARCH_URL,
            params={"api_key": api_key, "query": query, "pageSize": 10, "dataType": "Branded"},
            client=client,
        )
        # Only an exact barcode counts. The catalogue is searched by text, so a
        # loose match on some other product's digits is entirely possible.
        hits = [
            food
            for food in payload.get("foods") or []
            if isinstance(food, dict) and normalised_barcode(food.get("gtinUpc")) == wanted
        ]
        if hits:
            break
    if not hits:
        return None
    # The same product is listed once per label revision. The newest printing is
    # the one on the packet somebody is holding.
    newest = max(hits, key=lambda food: str(food.get("publishedDate") or ""))
    return _usda_result(newest, barcode)


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
            base_unit=measured.base_unit,
            density_g_per_ml=measured.density_g_per_ml,
            serving=serving_text,
            serving_amount=measured.amount,
            ingredients_text=str(product.get("ingredients_text") or "").strip(),
        )
    )


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


def lookup(barcode: str, api_key: str, client: httpx.Client | None = None) -> FoodResult | None:
    """A barcode against every source this instance has, in order.

    USDA first when there is a key, because its Branded set is transcribed from
    the label rather than typed in by whoever scanned it last. Open Food Facts
    after, and alone on an install with no key.

    One client for however many requests this takes, so a scan that falls
    through from one source to the other opens one connection rather than three.
    """
    borrowed = client is not None
    client = client if client is not None else session()
    try:
        found = lookup_usda(barcode, api_key, client)
        return found if found is not None else lookup_off(barcode, client)
    finally:
        if not borrowed:
            client.close()
