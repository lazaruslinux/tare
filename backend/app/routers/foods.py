"""Foods: finding one, reading one, and keeping your own.

Everything here is private this round. A food is either in the shared database,
which nothing puts rows into yet, or it belongs to one account. Somebody else's
food is not refused, it is absent: it answers exactly what an id that was never
used answers, so this cannot be walked to find out what other people eat.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import Select, case, delete, func, or_, select, update
from sqlalchemy.orm import Session

from app import models, schemas
from app.db import get_db
from app.deps import require_user
from app.models import NUTRIENTS

router = APIRouter(prefix="/foods", tags=["foods"])

# The one answer for a food that is not there and for a food that is somebody
# else's. Two different endings and one sentence, so neither can be told from
# the other.
MISSING_FOOD = "There is no such food."
NOT_YOURS = "This food is not yours to change."

MAX_NAME = 200
MAX_BRAND = 120
MAX_SERVING_NAME = 60

# The shortest thing worth searching for. One letter matches most of a database
# and tells nobody anything.
MIN_QUERY = 2
SEARCH_LIMIT = 25

# How many recently eaten foods the repeat list offers under the pinned ones,
# and how far back it looks for them. Distinct foods, not entries, so a week of
# the same breakfast is one row.
RECENT_LIMIT = 10
RECENT_SCANNED = 50

# What a private food has to carry to be worth logging. The other six are on
# the label or they are not, and a food is not useless without them.
REQUIRED = ("calories", "protein_g", "carbs_g", "fat_g")

# What an owner may hold. 'pending' and 'shadow' are unreachable this round and
# named here anyway, so the rule stays in one place when they arrive.
OWNED = ("custom", "pending", "shadow")
# Of those, the ones an owner may edit and the ones an owner may delete. Only
# a food that is nobody else's business can simply go.
OWNER_MAY_EDIT = OWNED
OWNER_MAY_DELETE = ("custom",)


def food_row(food: models.Food) -> dict[str, object]:
    """A food as it reads in a list: enough to pick it out, nothing else."""
    return {
        "id": food.id,
        "name": food.name,
        "brand": food.brand,
        "calories": food.calories,
        "base_unit": food.base_unit,
        "status": food.status,
    }


def is_pinned(db: Session, user: models.User, food_id: int) -> bool:
    query = select(models.SavedFood.id).where(
        models.SavedFood.user_id == user.id, models.SavedFood.food_id == food_id
    )
    return db.execute(query).first() is not None


def food_detail(db: Session, food: models.Food, user: models.User) -> dict[str, object]:
    """The whole food, its panel per 100 of its base unit, and its servings."""
    detail: dict[str, object] = {
        **food_row(food),
        "density_g_per_ml": food.density_g_per_ml,
        "ingredients_text": food.ingredients_text,
        # Whether the account reading it is the one who may change it. The
        # owner's id is not sent: the answer is what the screen needs, and the
        # id is somebody's account.
        "mine": food.owner_id == user.id,
        "pinned": is_pinned(db, user, food.id),
        "servings": [
            {
                "id": serving.id,
                "name": serving.name,
                "base_amount": serving.base_amount,
                "position": serving.position,
            }
            for serving in food.servings
        ],
    }
    for field in NUTRIENTS:
        detail[field] = getattr(food, field)
    return detail


def visible(user: models.User) -> Select[tuple[models.Food]]:
    """Every food this account may read, as a query to narrow further."""
    return select(models.Food).where(
        or_(
            models.Food.status == "approved",
            models.Food.owner_id == user.id,
        )
    )


def readable_food(db: Session, user: models.User, food_id: int) -> models.Food:
    food = db.get(models.Food, food_id)
    if food is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_FOOD)
    if food.status == "approved" or food.owner_id == user.id or user.is_admin:
        return food
    raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_FOOD)


def changeable_food(
    db: Session, user: models.User, food_id: int, owner_may: tuple[str, ...]
) -> models.Food:
    """A food this account may write to, or the refusal saying it may not.

    An administrator's reach is the shared database and only that: the rows
    everyone eats out of are theirs to fix, and somebody's private food is not,
    however plainly they can see it.
    """
    food = readable_food(db, user, food_id)
    if food.owner_id == user.id and food.status in owner_may:
        return food
    if user.is_admin and food.status == "approved":
        return food
    raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_YOURS)


def like_literal(text: str) -> str:
    """A search word with the wildcards taken out of it.

    A typed % otherwise matches the whole table, which is a search that answers
    a question nobody asked.
    """
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def apply_body(food: models.Food, body: schemas.FoodIn) -> None:
    """Put a form's answer onto a food, refusing what it cannot mean.

    Shared by creating and editing, so the two can never hold a food to
    different standards.
    """
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A food needs a name.")
    if len(name) > MAX_NAME:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"A name must be at most {MAX_NAME} characters."
        )
    brand = body.brand.strip()
    if len(brand) > MAX_BRAND:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"A brand must be at most {MAX_BRAND} characters."
        )
    if any(getattr(body, field) is None for field in REQUIRED):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Calories, protein, carbs, and fat are all needed."
        )

    food.name = name
    food.brand = brand
    food.base_unit = body.base_unit
    food.density_g_per_ml = body.density_g_per_ml
    food.ingredients_text = body.ingredients_text.strip()
    for field in NUTRIENTS:
        setattr(food, field, getattr(body, field))

    if body.servings is None:
        return
    servings = []
    for serving in body.servings:
        serving_name = serving.name.strip()
        if not serving_name:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Every serving needs a name.")
        if len(serving_name) > MAX_SERVING_NAME:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"A serving name must be at most {MAX_SERVING_NAME} characters.",
            )
        servings.append(
            models.FoodServing(
                name=serving_name, base_amount=serving.base_amount, position=serving.position
            )
        )
    # Wholesale, never merged. A list that arrived without a row is a row the
    # person deleted, and matching them up by name would resurrect it.
    food.servings = servings


@router.get("/search")
def search_foods(
    q: str = "",
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> list[dict[str, object]]:
    """Foods matching a word: the shared database, plus this account's own.

    Too short a query answers with nothing rather than a refusal. The box types
    as somebody types, and the first letter of every search is not a mistake to
    be told about.
    """
    needle = q.strip().lower()
    if len(needle) < MIN_QUERY:
        return []

    literal = like_literal(needle)
    name = func.lower(models.Food.name)
    # Where the word sits in the name, which is the whole of the ranking: the
    # food called "Chicken breast" is what somebody typing "chicken" meant,
    # ahead of "Roast chicken", ahead of anything merely containing the
    # letters. Ties go to the shorter name, which is the plainer food.
    rank = case(
        (name.like(f"{literal}%", escape="\\"), 0),
        (name.like(f"% {literal}%", escape="\\"), 1),
        else_=2,
    )
    query = (
        visible(user)
        .where(
            models.Food.status.in_(("approved", "custom", "pending")),
            name.like(f"%{literal}%", escape="\\"),
        )
        .order_by(rank, func.length(models.Food.name), models.Food.id)
        .limit(SEARCH_LIMIT)
    )
    return [food_row(food) for food in db.execute(query).scalars()]


@router.get("/mine")
def list_my_foods(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> list[dict[str, object]]:
    """This account's own foods, newest first."""
    query = (
        select(models.Food)
        .where(models.Food.owner_id == user.id, models.Food.status.in_(OWNED))
        .order_by(models.Food.created_at.desc(), models.Food.id.desc())
        # A ceiling rather than paging: this is one person's own list, and a
        # screen that scrolls past two hundred of them needs a different shape
        # than a longer response.
        .limit(200)
    )
    return [food_row(food) for food in db.execute(query).scalars()]


@router.get("/repeat")
def repeat_foods(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> list[dict[str, object]]:
    """What to offer before anybody searches: the kept, then the recent.

    Pinned foods first, newest pin at the top, because a pin is somebody saying
    outright what they eat. Under them, the foods they have actually been
    logging, which is the same answer arrived at without being asked for.
    """
    pinned = list(
        db.execute(
            select(models.Food)
            .join(models.SavedFood, models.SavedFood.food_id == models.Food.id)
            .where(models.SavedFood.user_id == user.id)
            .order_by(models.SavedFood.created_at.desc(), models.SavedFood.id.desc())
        ).scalars()
    )
    rows = [{**food_row(food), "pinned": True} for food in pinned]
    kept = {food.id for food in pinned}

    # Ordered by the newest entry each food appears in, which is what "recent"
    # means here: when it was last eaten, not how often.
    logged = db.execute(
        select(models.DiaryEntry.food_id, func.max(models.DiaryEntry.id).label("last"))
        .where(models.DiaryEntry.user_id == user.id, models.DiaryEntry.food_id.is_not(None))
        .group_by(models.DiaryEntry.food_id)
        .order_by(func.max(models.DiaryEntry.id).desc())
        .limit(RECENT_SCANNED)
    ).all()
    wanted = [row.food_id for row in logged if row.food_id not in kept]
    if not wanted:
        return rows

    # One query for the lot, then put back in the order they were eaten in. A
    # food somebody may no longer read is simply not offered.
    found = {
        food.id: food
        for food in db.execute(visible(user).where(models.Food.id.in_(wanted))).scalars()
    }
    for food_id in wanted:
        food = found.get(food_id)
        if food is None:
            continue
        rows.append({**food_row(food), "pinned": False})
        if len(rows) - len(kept) == RECENT_LIMIT:
            break
    return rows


@router.get("/{food_id}")
def read_food(
    food_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    return food_detail(db, readable_food(db, user, food_id), user)


@router.post("/{food_id}/pin", status_code=status.HTTP_204_NO_CONTENT)
def pin_food(
    food_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    """Keep a food to hand. Pinning one that is already pinned changes nothing."""
    food = readable_food(db, user, food_id)
    if not is_pinned(db, user, food.id):
        db.add(models.SavedFood(user_id=user.id, food_id=food.id))
        db.commit()


@router.delete("/{food_id}/pin", status_code=status.HTTP_204_NO_CONTENT)
def unpin_food(
    food_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    food = readable_food(db, user, food_id)
    db.execute(
        delete(models.SavedFood).where(
            models.SavedFood.user_id == user.id, models.SavedFood.food_id == food.id
        )
    )
    db.commit()


@router.post("", status_code=status.HTTP_201_CREATED)
def create_food(
    body: schemas.FoodIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Keep a food of your own. Private, and only ever yours."""
    food = models.Food(status="custom", owner_id=user.id, created_by_id=user.id, source="user")
    apply_body(food, body)
    db.add(food)
    db.commit()
    return food_detail(db, food, user)


@router.patch("/{food_id}")
def update_food(
    food_id: int,
    body: schemas.FoodIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    food = changeable_food(db, user, food_id, OWNER_MAY_EDIT)
    apply_body(food, body)
    db.commit()
    return food_detail(db, food, user)


@router.delete("/{food_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_food(
    food_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    food = changeable_food(db, user, food_id, OWNER_MAY_DELETE)
    # What the foreign keys already say, said again here. The constraints hold
    # on Postgres; stating it in the session keeps SQLite and the rows this
    # process is already holding in step with them.
    db.execute(
        update(models.DiaryEntry)
        .where(models.DiaryEntry.food_id == food.id)
        .values(food_id=None)
    )
    db.execute(delete(models.SavedFood).where(models.SavedFood.food_id == food.id))
    # Through the session rather than in SQL, so the servings go with it on
    # SQLite too, where the foreign key is only enforced when it is asked for.
    db.delete(food)
    db.commit()
