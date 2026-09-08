"""Fill in the vitamins and minerals of the foods already here.

Run inside the api container:

    python -m app.micros_backfill [--again] [--limit N]

Two passes, and neither of them touches the ten figures on the panel. A food
with a barcode is looked up by that barcode, Open Food Facts first because that
is the same source a scan reads and the same answer a member would have got,
then FoodData Central for whatever Open Food Facts left empty. A food without a
barcode can only be matched by its name, and a name is a guess, so its
candidates are written down for an administrator to pick from.

Safe to run again. Only empty keys are ever written, so a second run over the
same database changes nothing.
"""

from __future__ import annotations

import argparse
import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import foods_api, micros, models, usda_api
from app.db import SessionLocal
from app.models import now_utc

# Between calls to somebody else's server. FoodData Central holds a key to an
# hourly allowance, and a burst is the way to spend it on nothing.
PAUSE = 1.0

# Which rows are worth a barcode lookup: the shared database, the cache this
# instance keeps, and a private food somebody scanned for themselves.
BARCODED = ("approved", "cache", "custom", "pending")


def barcoded_pass(db: Session, limit: int | None) -> tuple[int, int, list[str]]:
    """Every food with a barcode and no vitamins, filled where anything has them."""
    rows = db.execute(
        select(models.Food)
        .where(
            models.Food.status.in_(BARCODED),
            models.Food.barcode.is_not(None),
            models.Food.micros.is_(None),
        )
        .order_by(models.Food.id)
    ).scalars().all()
    if limit is not None:
        rows = rows[:limit]

    filled = skipped = 0
    notes: list[str] = []
    for food in rows:
        code = food.barcode or ""
        found: dict[str, float] = {}
        source = ""
        record: dict[str, object] | None = None

        try:
            result = foods_api.lookup(code)
        except foods_api.FoodApiError as failure:
            notes.append(f"  {food.name}: Open Food Facts said no ({failure})")
            result = None
        if result is not None and result.micros:
            found, source = dict(result.micros), "off"
        time.sleep(PAUSE)

        # FoodData Central for what is still missing, and only for that.
        if usda_api.configured():
            try:
                record = usda_api.search_by_barcode(code)
            except foods_api.FoodApiError as failure:
                notes.append(f"  {food.name}: FoodData Central said no ({failure})")
                record = None
            if record is not None:
                extra = usda_api.read_micros(record)
                gained = {key: value for key, value in extra.items() if key not in found}
                if gained:
                    # Whichever supplied more names the row.
                    if len(gained) > len(found):
                        source = "usda"
                    found.update(gained)
            time.sleep(PAUSE)

        if not found:
            skipped += 1
            notes.append(f"  {food.name}: nothing out there had vitamins for {code}")
            continue
        ref = code if source == "off" else str((record or {}).get("fdcId") or code)
        added = micros.fill_empty(food, found, source, ref)
        if added:
            filled += 1
            print(f"  filled {food.name} from {source}: {len(added)} keys")
        else:
            skipped += 1
    db.commit()
    return filled, skipped, notes


def name_pass(db: Session, again: bool, limit: int | None) -> tuple[int, int, list[str]]:
    """Every shared food with no barcode, offered to an administrator to match.

    A food measured in millilitres with no density cannot be carried over from
    a per-hundred-gram record at all, so it is left alone and said out loud.
    """
    # A decision stands. --again is the one thing that re-opens the ones
    # somebody said no to; an applied food is never asked about twice.
    decided = {"pending", "applied"} if again else {"pending", "applied", "skipped"}
    seen = {
        food_id
        for food_id, status in db.execute(
            select(models.MicroMatch.food_id, models.MicroMatch.status)
        ).all()
        if status in decided
    }
    rows = db.execute(
        select(models.Food)
        .where(
            models.Food.status == "approved",
            models.Food.barcode.is_(None),
            models.Food.micros.is_(None),
        )
        .order_by(models.Food.id)
    ).scalars().all()
    rows = [food for food in rows if food.id not in seen]
    if limit is not None:
        rows = rows[:limit]

    queued = skipped = 0
    notes: list[str] = []
    if rows and not usda_api.configured():
        return 0, len(rows), [f"  {len(rows)} foods not queued: {usda_api.NO_KEY}"]

    for food in rows:
        if food.base_unit == "ml" and not food.density_g_per_ml:
            skipped += 1
            notes.append(f"  {food.name}: measured in ml with no density, nothing to carry over")
            continue
        query = " ".join(part for part in (food.brand, food.name) if part).strip()
        try:
            candidates = usda_api.search_by_name(query)
        except foods_api.FoodApiError as failure:
            notes.append(f"  {food.name}: FoodData Central said no ({failure})")
            skipped += 1
            time.sleep(PAUSE)
            continue
        time.sleep(PAUSE)
        if not candidates:
            skipped += 1
            notes.append(f"  {food.name}: FoodData Central offered nothing for {query!r}")
            continue
        # An old skipped row is replaced rather than added beside, so a food
        # asked about twice is still one question.
        for stale in db.execute(
            select(models.MicroMatch).where(models.MicroMatch.food_id == food.id)
        ).scalars().all():
            db.delete(stale)
        db.flush()
        db.add(
            models.MicroMatch(
                food_id=food.id,
                candidates=[candidate.as_dict() for candidate in candidates],
                status="pending",
                created_at=now_utc(),
            )
        )
        queued += 1
        print(f"  queued {food.name}: {len(candidates)} candidates")
    db.commit()
    return queued, skipped, notes


def run(again: bool = False, limit: int | None = None) -> None:
    db = SessionLocal()
    try:
        print("Barcoded foods:")
        filled, skipped_a, notes_a = barcoded_pass(db, limit)
        for line in notes_a:
            print(line)
        print("Foods with no barcode:")
        queued, skipped_b, notes_b = name_pass(db, again, limit)
        for line in notes_b:
            print(line)
    finally:
        db.close()
    print(f"filled {filled}, queued {queued}, skipped {skipped_a + skipped_b}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--again",
        action="store_true",
        help="ask about foods whose match was skipped before",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="stop after this many foods in each pass, for a key with an hourly allowance",
    )
    args = parser.parse_args()
    run(again=args.again, limit=args.limit)


if __name__ == "__main__":
    main()
