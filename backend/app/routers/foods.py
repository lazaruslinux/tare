"""Foods: finding one, reading one, browsing them, and keeping your own.

A food is either in the shared database, where everybody can read it, or it
belongs to one account. Somebody else's food is not refused, it is absent: it
answers exactly what an id that was never used answers, so this cannot be
walked to find out what other people eat.
"""

from __future__ import annotations

import base64
import binascii
import re
from collections.abc import Sequence

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import Select, Subquery, and_, case, delete, func, or_, select, update
from sqlalchemy.orm import InstrumentedAttribute, Session

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
MISSING_PHOTO_TO_ATTACH = "That photo is not there to attach."

MAX_NAME = 200
MAX_BRAND = 120
MAX_SERVING_NAME = 60

# Every retail code printed on food: EAN-8 at the short end, GTIN-14 at the
# long. Anything else is not a barcode this app has any use for. It lives here
# rather than beside the lookup because a barcode is something a food carries,
# and both the lookup and the submission rules read it from here.
BARCODE_PATTERN = re.compile(r"^[0-9]{8,14}$")
BAD_BARCODE = "That is not a barcode."
ALREADY_MINE = "You already have a food with this barcode."
ALREADY_SHARED = "This barcode is already in the shared database."

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

# What an owner may hold.
OWNED = ("custom", "pending", "shadow")
# Of those, the ones that belong in a list of somebody's own foods. A shadow is
# a correction waiting on a decision rather than a food anybody keeps, so it is
# only ever reached by opening it.
LISTED = ("custom", "pending")
# Of those, the ones an owner may edit and the ones an owner may delete. Only
# a food that is nobody else's business can simply go.
OWNER_MAY_EDIT = OWNED
OWNER_MAY_DELETE = ("custom",)
# And what an administrator may do, which is the shared database plus the
# corrections waiting on it: a reviewer fixing a typo in a proposal is doing
# the same job as approving it.
ADMIN_MAY_EDIT = ("approved", "shadow")
ADMIN_MAY_DELETE = ("approved",)

# The ceiling on somebody's own list. High enough that nobody real reaches it,
# and still a ceiling: a screen that reads every row at once needs a number it
# cannot be given more than.
MY_LIST_CAP = 1000

# How many foods one page of the browse list holds.
BROWSE_PAGE = 40
BAD_CURSOR = "That page marker is not one of ours."
BAD_LETTER = "Pick a letter."


def photo_url(photo_id: int) -> str:
    return f"/api/photos/{photo_id}.webp"


def write_cursor(has_photo: int, food_id: int) -> str:
    """Where a page of the browse list stopped, as one opaque word.

    Encoded rather than sent as two numbers because it is a place in a listing
    and nothing else: a client that reads it as a row id will one day be given
    a marker that is not one.
    """
    return base64.urlsafe_b64encode(f"{has_photo}.{food_id}".encode()).decode().rstrip("=")


def read_cursor(cursor: str) -> tuple[int, int]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        has_photo, food_id = base64.urlsafe_b64decode(padded).decode().split(".")
        return int(has_photo), int(food_id)
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_CURSOR) from None


def write_name_cursor(name: str, food_id: int) -> str:
    """Where a page of one letter stopped, which is a place in an A to Z.

    The id leads so the two parts split cleanly: a name may hold a full stop
    and a row id never does.
    """
    return base64.urlsafe_b64encode(f"{food_id}.{name}".encode()).decode().rstrip("=")


def read_name_cursor(cursor: str) -> tuple[str, int]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        food_id, name = base64.urlsafe_b64decode(padded).decode().split(".", 1)
        return name, int(food_id)
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_CURSOR) from None


def photo_urls(db: Session, food_ids: Sequence[int]) -> dict[int, str]:
    """The published picture of each of these foods, where there is one.

    One query for the lot: every list here would otherwise ask the same
    question once per row.
    """
    if not food_ids:
        return {}
    rows = db.execute(
        select(models.FoodPhoto.food_id, models.FoodPhoto.id).where(
            models.FoodPhoto.food_id.in_(food_ids),
            models.FoodPhoto.status == "approved",
        )
    ).all()
    return {food_id: photo_url(photo_id) for food_id, photo_id in rows if food_id is not None}


def pictures_for(
    db: Session, user: models.User, foods: Sequence[models.Food]
) -> dict[int, str]:
    """The picture each of these foods shows to this account.

    The published one wherever there is one, and on a food of this account's
    own that nobody has published yet, the front photo they attached to it
    themselves. Nobody else is ever handed that: the foods it can happen on are
    private or waiting, and neither is in anybody else's list to begin with.

    Two queries for a whole list rather than one per row.
    """
    shown = photo_urls(db, [food.id for food in foods])
    waiting = [
        food.id
        for food in foods
        if food.id not in shown and food.owner_id is not None and food.owner_id == user.id
    ]
    if not waiting:
        return shown
    # Newest first, so the one an owner attached last is the one they see. The
    # attach route replaces rather than piles up, so in practice there is one.
    rows = db.execute(
        select(models.FoodPhoto.food_id, models.FoodPhoto.id)
        .where(
            models.FoodPhoto.food_id.in_(waiting),
            models.FoodPhoto.status == "pending",
            models.FoodPhoto.purpose == "front",
        )
        .order_by(models.FoodPhoto.id)
    ).all()
    for food_id, photo_id in rows:
        if food_id is not None:
            shown[food_id] = photo_url(photo_id)
    return shown


def food_row(
    food: models.Food, picture: str | None = None, community: str = "none"
) -> dict[str, object]:
    """A food as it reads in a list: enough to pick it out, nothing else."""
    return {
        "id": food.id,
        "name": food.name,
        "brand": food.brand,
        "calories": food.calories,
        "base_unit": food.base_unit,
        "status": food.status,
        "photo_url": picture,
        # Where this food stands with the shared database, from where the
        # person reading is standing.
        "community": community,
    }


def community_states(
    db: Session, user: models.User, foods: Sequence[models.Food]
) -> dict[int, str]:
    """What each of these foods is, to this account, as one word.

    'pending' is waiting on a decision, 'approved' is shared because this
    account offered it, 'rejected' is back in their own hands after a no, and
    'none' is everything else, a food nobody has offered included. Withdrawing
    deletes the request, so a food that was taken back reads as 'none' again.

    One query for the lot: the alternative is a submissions lookup per row.
    """
    ids = [food.id for food in foods]
    if not ids:
        return {}
    # Ascending by id, so the last one written for a food is the one left in
    # the map: what came of the most recent offer is what the dot is about.
    rows = db.execute(
        select(models.FoodSubmission.food_id, models.FoodSubmission.status)
        .where(
            models.FoodSubmission.submitted_by_id == user.id,
            models.FoodSubmission.kind == "new",
            models.FoodSubmission.food_id.in_(ids),
        )
        .order_by(models.FoodSubmission.id)
    ).all()
    latest = {food_id: state for food_id, state in rows}

    states: dict[int, str] = {}
    for food in foods:
        offered = latest.get(food.id)
        if food.status == "pending":
            states[food.id] = "pending"
        elif food.status == "approved" and offered == "approved":
            states[food.id] = "approved"
        elif food.status == "custom" and offered == "rejected":
            states[food.id] = "rejected"
        else:
            states[food.id] = "none"
    return states


def food_rows(
    db: Session, user: models.User, foods: Sequence[models.Food]
) -> list[dict[str, object]]:
    pictures = pictures_for(db, user, foods)
    states = community_states(db, user, foods)
    return [food_row(food, pictures.get(food.id), states[food.id]) for food in foods]


def last_logged_by(
    column: InstrumentedAttribute[int | None], user: models.User
) -> Subquery:
    """The newest day each row was eaten on, as a table to join against.

    One grouped query for a whole list rather than a lookup per row. Which
    column keys it is given, because a diary entry names the food it was and
    the recipe it came out of in two different places.
    """
    return (
        select(
            column.label("owner"),
            func.max(models.DiaryEntry.date_for).label("last_logged"),
        )
        .where(models.DiaryEntry.user_id == user.id, column.is_not(None))
        .group_by(column)
        .subquery()
    )


def hidden_ids(db: Session, user: models.User) -> set[int]:
    """The foods this member took off Repeat and wants kept off."""
    rows = db.execute(
        select(models.RepeatHidden.food_id).where(models.RepeatHidden.user_id == user.id)
    ).scalars()
    return set(rows)


def unhide(db: Session, user: models.User, food_id: int) -> None:
    db.execute(
        delete(models.RepeatHidden).where(
            models.RepeatHidden.user_id == user.id, models.RepeatHidden.food_id == food_id
        )
    )


def is_pinned(db: Session, user: models.User, food_id: int) -> bool:
    query = select(models.SavedFood.id).where(
        models.SavedFood.user_id == user.id, models.SavedFood.food_id == food_id
    )
    return db.execute(query).first() is not None


def food_detail(db: Session, food: models.Food, user: models.User) -> dict[str, object]:
    """The whole food, its panel per 100 of its base unit, and its servings.

    The picture here is the published one, and for the owner of a food nobody
    has published yet it is the front photo they attached themselves. A list
    shows only what everybody can see; the page where somebody manages their
    own food has to show them what they put on it.
    """
    detail: dict[str, object] = {
        **food_row(
            food,
            pictures_for(db, user, [food]).get(food.id),
            community_states(db, user, [food])[food.id],
        ),
        "density_g_per_ml": food.density_g_per_ml,
        # What it was scanned from, where it was. On the packaging either way,
        # and it is what decides whether offering this food needs a photograph
        # of the panel printed beside it.
        "barcode": food.barcode,
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
    """Every food this account may see listed, as a query to narrow further.

    Narrower than what it may read. A cache row is a lookup rather than a food,
    and a shadow is a correction somebody has offered: both are reachable by
    their own address and neither belongs in a list of foods.
    """
    return select(models.Food).where(
        models.Food.status.not_in(("cache", "shadow")),
        or_(
            models.Food.status == "approved",
            models.Food.owner_id == user.id,
        ),
    )


def readable_food(db: Session, user: models.User, food_id: int) -> models.Food:
    food = db.get(models.Food, food_id)
    if food is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_FOOD)
    # A cache row is a lookup this instance wrote down, not a food anybody has.
    # It belongs to nobody and it is not in the shared database, so it reads as
    # absent everywhere, an administrator included.
    if food.status == "cache":
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_FOOD)
    if food.status == "approved" or food.owner_id == user.id or user.is_admin:
        return food
    raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_FOOD)


def changeable_food(
    db: Session,
    user: models.User,
    food_id: int,
    owner_may: tuple[str, ...],
    admin_may: tuple[str, ...],
) -> models.Food:
    """A food this account may write to, or the refusal saying it may not.

    An administrator's reach is the shared database and what is queued to
    change it: the rows everyone eats out of are theirs to fix, and somebody's
    private food is not, however plainly they can see it.
    """
    food = readable_food(db, user, food_id)
    if food.owner_id == user.id and food.status in owner_may:
        return food
    if user.is_admin and food.status in admin_may:
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


def check_barcode(db: Session, user: models.User, code: str) -> None:
    """Refuse a code this account cannot put on a new food of its own.

    Two private foods in two accounts may carry one code, because a private
    food is a note somebody made about a packet. One account holding the same
    code twice is not a note, it is a duplicate, and neither is a code the
    shared database already answers: that food is there to be used.
    """
    if not BARCODE_PATTERN.match(code):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_BARCODE)
    shared = db.execute(
        select(models.Food.id).where(
            models.Food.status == "approved", models.Food.barcode == code
        )
    ).first()
    if shared is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, ALREADY_SHARED)
    held = db.execute(
        select(models.Food.id).where(
            models.Food.owner_id == user.id,
            models.Food.barcode == code,
            models.Food.status.in_(LISTED),
        )
    ).first()
    if held is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, ALREADY_MINE)


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
    return food_rows(db, user, list(db.execute(query).scalars()))


@router.get("/mine")
def list_my_foods(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> list[dict[str, object]]:
    """This account's own foods, and the ones it gave away.

    A food that was approved belongs to nobody now, but the person who entered
    it still thinks of it as theirs and still wants to find it where they put
    it. So it stays in this list, marked as shared rather than owned.

    Ordered by when each was last eaten rather than when it was entered. What
    somebody had yesterday is what they are most likely to have again, and a
    food entered a year ago and eaten every week belongs above one typed in
    last month and never touched. A food nobody has logged has no such date and
    falls to the bottom, newest first among its own kind.
    """
    offered = select(models.FoodSubmission.food_id).where(
        models.FoodSubmission.submitted_by_id == user.id,
        models.FoodSubmission.kind == "new",
        models.FoodSubmission.status == "approved",
        models.FoodSubmission.food_id.is_not(None),
    )
    logged = last_logged_by(models.DiaryEntry.food_id, user)
    query = (
        select(models.Food, logged.c.last_logged)
        .outerjoin(logged, logged.c.owner == models.Food.id)
        .where(
            or_(
                and_(models.Food.owner_id == user.id, models.Food.status.in_(LISTED)),
                and_(models.Food.status == "approved", models.Food.id.in_(offered)),
            )
        )
        .order_by(
            logged.c.last_logged.desc().nullslast(),
            models.Food.created_at.desc(),
            models.Food.id.desc(),
        )
        # A ceiling rather than paging: this is one person's own list, and the
        # screen that reads it filters what it was given rather than asking
        # again.
        .limit(MY_LIST_CAP)
    )
    found = db.execute(query).all()
    rows = food_rows(db, user, [food for food, _ in found])
    return [
        {**row, "last_logged": stamp}
        for row, (_, stamp) in zip(rows, found, strict=True)
    ]


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
    rows: list[dict[str, object]] = [
        {**row, "pinned": True} for row in food_rows(db, user, pinned)
    ]
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
    # Taken off the list on purpose, and eating it again does not put it back.
    off = hidden_ids(db, user)
    wanted = [row.food_id for row in logged if row.food_id not in kept and row.food_id not in off]
    if not wanted:
        return rows

    # One query for the lot, then put back in the order they were eaten in. A
    # food somebody may no longer read is simply not offered.
    found = {
        food.id: food
        for food in db.execute(visible(user).where(models.Food.id.in_(wanted))).scalars()
    }
    pictures = photo_urls(db, list(found))
    states = community_states(db, user, list(found.values()))
    for food_id in wanted:
        food = found.get(food_id)
        if food is None:
            continue
        rows.append(
            {**food_row(food, pictures.get(food.id), states[food.id]), "pinned": False}
        )
        if len(rows) - len(kept) == RECENT_LIMIT:
            break
    return rows


@router.get("/browse")
def browse_foods(
    cursor: str = "",
    letter: str = "",
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """The shared database, a page at a time, the photographed ones first.

    Paged by where the last page stopped rather than by an offset. A food
    approved while somebody is scrolling shifts every offset after it, which
    shows one row twice and hides another; a marker naming the last row read
    cannot do either.

    Given a letter it is the same database read the other way: everything
    starting with that letter, in alphabetical order, which is how somebody
    looks for a food they cannot spell the middle of.
    """
    if letter and not (len(letter) == 1 and letter.isascii() and letter.isalpha()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_LETTER)
    # One row per food, so a food is not repeated when it has been photographed
    # more than once. The lowest id is the published one, and the partial index
    # allows only one of those anyway.
    published = (
        select(
            models.FoodPhoto.food_id.label("food_id"),
            func.min(models.FoodPhoto.id).label("photo_id"),
        )
        .where(models.FoodPhoto.status == "approved", models.FoodPhoto.food_id.is_not(None))
        .group_by(models.FoodPhoto.food_id)
        .subquery()
    )
    has_photo = case((published.c.photo_id.is_not(None), 1), else_=0)

    query = (
        select(models.Food, published.c.photo_id, has_photo.label("has_photo"))
        .outerjoin(published, published.c.food_id == models.Food.id)
        .where(models.Food.status == "approved")
        # One more than a page, which is how the answer knows whether there is
        # another one without counting the whole table.
        .limit(BROWSE_PAGE + 1)
    )
    if letter:
        # Sorted and compared on the folded name throughout, so a page break
        # lands in the same place on either database rather than following
        # whatever a collation does with capitals.
        folded = func.lower(models.Food.name)
        query = query.where(
            models.Food.name.ilike(f"{like_literal(letter)}%", escape="\\")
        ).order_by(folded, models.Food.id)
        if cursor:
            seen_name, seen_id = read_name_cursor(cursor)
            query = query.where(
                or_(folded > seen_name, and_(folded == seen_name, models.Food.id > seen_id))
            )
    else:
        query = query.order_by(has_photo.desc(), models.Food.id)
        if cursor:
            seen_photo, seen_id = read_cursor(cursor)
            query = query.where(
                or_(
                    has_photo < seen_photo,
                    and_(has_photo == seen_photo, models.Food.id > seen_id),
                )
            )

    rows = db.execute(query).all()
    page = rows[:BROWSE_PAGE]
    states = community_states(db, user, [food for food, _, _ in page])
    items = [
        food_row(food, None if photo_id is None else photo_url(photo_id), states[food.id])
        for food, photo_id, _ in page
    ]
    more = len(rows) > BROWSE_PAGE
    if not more or not page:
        marker = None
    elif letter:
        marker = write_name_cursor(page[-1][0].name.lower(), page[-1][0].id)
    else:
        marker = write_cursor(page[-1][2], page[-1][0].id)
    return {"items": items, "next_cursor": marker}


@router.get("/{food_id}")
def read_food(
    food_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    return food_detail(db, readable_food(db, user, food_id), user)


@router.post("/{food_id}/photo", status_code=status.HTTP_204_NO_CONTENT)
def attach_front_photo(
    food_id: int,
    body: schemas.FoodPhotoIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    """Put a picture of the front of the pack on one of your own foods.

    Attached rather than offered, because until this food is shared it is
    nobody else's business. It rides along if the food is ever submitted.
    Attaching a second one replaces the first, file and all: a food shows one
    picture, and a stack of replaced attempts is a directory nobody empties.
    """
    from app.routers.photos import discard, front_photo

    food = changeable_food(db, user, food_id, ("custom", "pending"), ())
    photo = db.get(models.FoodPhoto, body.photo_id)
    if (
        photo is None
        or photo.uploaded_by_id != user.id
        or photo.food_id is not None
        or photo.purpose != "front"
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, MISSING_PHOTO_TO_ATTACH)

    standing = front_photo(db, food.id)
    # Only one that is still waiting. A published picture belongs to the shared
    # database, and this route never reaches a food that has one.
    if standing is not None and standing.status == "pending":
        discard(db, standing)
    photo.food_id = food.id
    db.commit()


@router.post("/{food_id}/pin", status_code=status.HTTP_204_NO_CONTENT)
def pin_food(
    food_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    """Keep a food to hand. Pinning one that is already pinned changes nothing."""
    food = readable_food(db, user, food_id)
    # A pin is the stronger word: it also puts back a food taken off Repeat.
    unhide(db, user, food.id)
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


@router.delete("/{food_id}/repeat", status_code=status.HTTP_204_NO_CONTENT)
def leave_repeat(
    food_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    """Take a food off Repeat for good. Eating it again does not bring it back;
    a pin does. Taking off one already off changes nothing."""
    food = readable_food(db, user, food_id)
    if food.id not in hidden_ids(db, user):
        db.add(models.RepeatHidden(user_id=user.id, food_id=food.id))
        db.commit()


@router.post("/{food_id}/repeat", status_code=status.HTTP_204_NO_CONTENT)
def rejoin_repeat(
    food_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    """Let a food be offered again. What was undone was the taking off, so this
    puts nothing on the list by itself: the food shows when it is eaten."""
    food = readable_food(db, user, food_id)
    unhide(db, user, food.id)
    db.commit()


@router.post("", status_code=status.HTTP_201_CREATED)
def create_food(
    body: schemas.FoodIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    """Keep a food of your own. Private, and only ever yours.

    A code scanned into the form is kept with it, so the next scan of that
    packet is answered from this row rather than from somebody else's server.
    """
    code = (body.barcode or "").strip()
    if code:
        check_barcode(db, user, code)
    food = models.Food(
        status="custom",
        owner_id=user.id,
        created_by_id=user.id,
        source="user",
        barcode=code or None,
    )
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
    food = changeable_food(db, user, food_id, OWNER_MAY_EDIT, ADMIN_MAY_EDIT)
    # The barcode is not among what an edit changes. It is what the row was
    # scanned from, and a code that moves is a code the scanner cannot trust.
    apply_body(food, body)
    db.commit()
    return food_detail(db, food, user)


@router.delete("/{food_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_food(
    food_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    food = changeable_food(db, user, food_id, OWNER_MAY_DELETE, ADMIN_MAY_DELETE)
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
