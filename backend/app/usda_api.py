"""FoodData Central, which only the backfill and the vitamin picker ever read.

Nothing a member touches reaches this module. A scan goes to Open Food Facts
and stops there, the same as it always has; this is the second pass an
administrator runs afterwards, and the search behind the one-tap match.

Everything here is per 100 g, which is how FoodData Central reports a nutrient
whatever the food's own serving is.
"""

from __future__ import annotations

import dataclasses
from typing import Any

import httpx

from app import micros
from app.config import settings
from app.foods_api import USER_AGENT, FoodApiError

SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search"
FOOD_URL = "https://api.nal.usda.gov/fdc/v1/food/{fdc_id}"

TIMEOUT = 20.0

# What a name search is asked for: whole foods described by somebody who
# measured them, rather than the branded records a barcode already answers.
NAME_TYPES = "Foundation,SR Legacy"
NAME_RESULTS = 5

# Vitamin D is the one vitamin whose international unit is a fixed amount.
IU_PER_MCG_VITAMIN_D = 40.0

# FoodData Central files a barcode zero-padded to fourteen digits, and a search
# for the number as it is printed on the packet finds nothing at all.
GTIN_WIDTH = 14

NO_KEY = "This instance has no USDA_API_KEY, so FoodData Central cannot be read."


@dataclasses.dataclass
class Candidate:
    """One record FoodData Central offers for a name."""

    fdc_id: int
    description: str
    data_type: str

    def as_dict(self) -> dict[str, object]:
        return {
            "fdc_id": self.fdc_id,
            "description": self.description,
            "data_type": self.data_type,
        }


def configured() -> bool:
    return bool(settings.usda_api_key)


def session() -> httpx.Client:
    """A client carrying this app's manners, and the one place a test swaps in
    a transport."""
    return httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT)


def _get(url: str, params: dict[str, Any], client: httpx.Client | None) -> dict[str, Any]:
    """One request, and one exception for everything that can go wrong with it."""
    if not configured():
        raise FoodApiError(NO_KEY)
    borrowed = client is not None
    client = client if client is not None else session()
    try:
        response = client.get(url, params={**params, "api_key": settings.usda_api_key})
    except httpx.HTTPError as failure:
        raise FoodApiError("Could not reach FoodData Central.") from failure
    finally:
        if not borrowed:
            client.close()
    if response.status_code == 429:
        raise FoodApiError("FoodData Central has had enough requests for now.")
    if response.status_code >= 400:
        raise FoodApiError("FoodData Central did not answer.")
    try:
        payload = response.json()
    except ValueError as failure:
        raise FoodApiError("FoodData Central did not answer.") from failure
    return payload if isinstance(payload, dict) else {}


def _rows(food: dict[str, Any]) -> list[dict[str, Any]]:
    """The nutrient lines out of either shape this API answers in.

    A search result carries them flattened, with the number and the unit beside
    the value. A single food nests them under 'nutrient'. Both are read here so
    a caller never has to know which call it came from.
    """
    rows: list[dict[str, Any]] = []
    for entry in food.get("foodNutrients") or []:
        if not isinstance(entry, dict):
            continue
        nested = entry.get("nutrient")
        if isinstance(nested, dict):
            rows.append(
                {
                    "number": str(nested.get("number") or ""),
                    "unit": str(nested.get("unitName") or ""),
                    "value": entry.get("amount"),
                }
            )
        else:
            # A search row says nutrientNumber and value; an abridged record
            # says number and amount.
            rows.append(
                {
                    "number": str(entry.get("nutrientNumber") or entry.get("number") or ""),
                    "unit": str(entry.get("unitName") or ""),
                    "value": entry.get("value", entry.get("amount")),
                }
            )
    return rows


def read_micros(food: dict[str, Any]) -> dict[str, float]:
    """The vitamins and minerals out of one FoodData Central record.

    A nutrient filed under more than one definition is taken from the first of
    them that the record actually carries, which is why the catalogue holds the
    numbers in order rather than one apiece.
    """
    stated: dict[str, tuple[float, str]] = {}
    for row in _rows(food):
        value = row["value"]
        if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
            continue
        stated.setdefault(row["number"], (float(value), row["unit"]))

    found: dict[str, float] = {}
    for micro in micros.CATALOG:
        for number in micro.usda:
            if number not in stated:
                continue
            value, unit = stated[number]
            if micro.key == "vitamin_d" and unit.strip().upper() == "IU":
                value, unit = value / IU_PER_MCG_VITAMIN_D, "mcg"
            converted = micros.convert(value, unit, micro.key)
            if converted is not None:
                found[micro.key] = converted
            break
    return found


def search_by_barcode(code: str, client: httpx.Client | None = None) -> dict[str, Any] | None:
    """The branded record for one barcode, or nothing.

    Asked for twice at most: the number as FoodData Central files it, and the
    number as it was scanned, in case a code was already padded or is longer
    than fourteen digits.
    """
    tried: list[str] = []
    for query in (code.zfill(GTIN_WIDTH), code):
        if query in tried:
            continue
        tried.append(query)
        payload = _get(
            SEARCH_URL,
            {"query": query, "dataType": "Branded", "pageSize": 1},
            client,
        )
        foods = payload.get("foods") or []
        if foods and isinstance(foods[0], dict):
            return foods[0]
    return None


def search_by_name(name: str, client: httpx.Client | None = None) -> list[Candidate]:
    """What FoodData Central thinks a name might be, best first."""
    payload = _get(
        SEARCH_URL,
        {"query": name, "dataType": NAME_TYPES, "pageSize": NAME_RESULTS},
        client,
    )
    found: list[Candidate] = []
    for entry in payload.get("foods") or []:
        if not isinstance(entry, dict):
            continue
        fdc_id = entry.get("fdcId")
        if not isinstance(fdc_id, int):
            continue
        found.append(
            Candidate(
                fdc_id=fdc_id,
                description=str(entry.get("description") or "")[:120],
                data_type=str(entry.get("dataType") or ""),
            )
        )
    return found[:NAME_RESULTS]


def food(fdc_id: int, client: httpx.Client | None = None) -> dict[str, Any]:
    """One whole record, which is where the nutrient list lives."""
    # Abridged on purpose: the full record answers 404 for Foundation foods,
    # and the abridged one still carries every nutrient number and amount.
    return _get(FOOD_URL.format(fdc_id=fdc_id), {"format": "abridged"}, client)
