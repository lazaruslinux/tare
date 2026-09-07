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
from typing import NamedTuple

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import Select, Subquery, and_, case, delete, func, or_, select, update
from sqlalchemy.orm import InstrumentedAttribute, Session

from app import models, photos, profiles, schemas, units
from app.db import get_db
from app.deps import require_user, reviews
from app.models import DEFAULT_SECTION, FOOD_NUTRIENTS, FOOD_SECTIONS
from app.review_log import log_review

router = APIRouter(prefix="/foods", tags=["foods"])

# The one answer for a food that is not there and for a food that is somebody
# else's. Two different endings and one sentence, so neither can be told from
# the other.
MISSING_FOOD = "There is no such food."
NOT_YOURS = "This food is not yours to change."
MISSING_PHOTO_TO_ATTACH = "That photo is not there to attach."
# Two reviewers can have one food open at the same time. Whoever saves second
# is told rather than quietly writing over the first.
STALE_EDIT = "Someone changed this while you were editing. Reload to see it."
BAD_PURPOSE = "A photo is of the front or of the label."

MAX_NAME = 200
MAX_BRAND = 120
# Long enough for "King Size" or "Blueberry flavor" and short enough that it
# still reads as one line under a name in a list.
MAX_DESCRIPTION = 60
MAX_SERVING_NAME = 60

# An aisle nobody stocks, and a food that has not been put in one. Both are
# said here because the form, the browse list and the queue all lean on them.
BAD_SECTION = "That is not a section Tare has."

# A serving is measured in the food's own family or not at all: a cup of a
# food weighed in grams would need a density to mean anything, and a label
# that gives both prints them as two servings rather than one.
UNKNOWN_UNIT = "That is not a unit Tare knows."
WRONG_FAMILY = {
    "g": "Pick a weight unit for a food measured by weight.",
    "ml": "Pick a volume unit for a food measured by volume.",
}

# Every retail code printed on food: EAN-8 at the short end, GTIN-14 at the
# long. Anything else is not a barcode this app has any use for. It lives here
# rather than beside the lookup because a barcode is something a food carries,
# and both the lookup and the submission rules read it from here.
BARCODE_PATTERN = re.compile(r"^[0-9]{8,14}$")
BAD_BARCODE = "That is not a barcode."
ALREADY_MINE = "You already have a food with this barcode."
ALREADY_SHARED = "This barcode is already in the Tare database."

# The shortest thing worth searching for. One letter matches most of a database
# and tells nobody anything.
MIN_QUERY = 2
SEARCH_LIMIT = 25

# How many recently eaten foods the repeat list offers under the pinned ones,
# and how far back it looks for them. Distinct foods, not entries, so a week of
# the same breakfast is one row.
RECENT_LIMIT = 10
RECENT_SCANNED = 50

# How long the Recently used list runs. His cap: ten rows, and the card on the
# Food tab shows three of them and offers the rest.
RECENT_USED = 10

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
# And what an administrator may do, which is the shared database plus
# everything queued to change it: a reviewer fixing a typo in a proposal, new
# or a correction, is doing the same job as approving it.
ADMIN_MAY_EDIT = ("approved", "shadow", "pending")
ADMIN_MAY_DELETE = ("approved",)

# The ceiling on somebody's own list. High enough that nobody real reaches it,
# and still a ceiling: a screen that reads every row at once needs a number it
# cannot be given more than.
MY_LIST_CAP = 1000

# How many foods one page of the browse list holds. The same thirty every
# list on the Food page shows before it offers to show more.
BROWSE_PAGE = 30
BAD_CURSOR = "That page marker is not one of ours."
BAD_LETTER = "Pick a letter."


def photo_url(photo_id: int) -> str:
    return f"/api/photos/{photo_id}.webp"


def thumb_url(photo_id: int) -> str:
    return f"/api/photos/{photo_id}.thumb.webp"


class Picture(NamedTuple):
    """A stored photo as a list reads it: the picture, and the small copy of it
    where one has been written. A row draws the small one and the page the
    other, so both addresses travel together."""

    url: str
    thumb: str | None


def picture_of(photo_id: int, path: str) -> Picture:
    """One photo's two addresses. The thumb is null where the file is not
    there, which is a picture stored before there were thumbs."""
    return Picture(
        photo_url(photo_id),
        thumb_url(photo_id) if photos.stored(photos.thumb_name(path)) else None,
    )


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


def photo_urls(db: Session, food_ids: Sequence[int]) -> dict[int, Picture]:
    """The published picture of each of these foods, where there is one.

    One query for the lot: every list here would otherwise ask the same
    question once per row.
    """
    if not food_ids:
        return {}
    rows = db.execute(
        select(models.FoodPhoto.food_id, models.FoodPhoto.id, models.FoodPhoto.path).where(
            models.FoodPhoto.food_id.in_(food_ids),
            models.FoodPhoto.status == "approved",
        )
    ).all()
    return {
        food_id: picture_of(photo_id, path)
        for food_id, photo_id, path in rows
        if food_id is not None
    }


def pictures_for(
    db: Session, user: models.User, foods: Sequence[models.Food]
) -> dict[int, Picture]:
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
        select(models.FoodPhoto.food_id, models.FoodPhoto.id, models.FoodPhoto.path)
        .where(
            models.FoodPhoto.food_id.in_(waiting),
            models.FoodPhoto.status == "pending",
            models.FoodPhoto.purpose == "front",
        )
        .order_by(models.FoodPhoto.id)
    ).all()
    for food_id, photo_id, path in rows:
        if food_id is not None:
            shown[food_id] = picture_of(photo_id, path)
    return shown


class Mark(NamedTuple):
    """What a row that copied a food's name still has to ask the live food for:
    the small picture it draws, and whether the database holds it."""

    thumb: str | None
    status: str


def food_marks(db: Session, user: models.User, food_ids: Sequence[int | None]) -> dict[int, Mark]:
    """The picture and the standing of each of these foods, by id.

    For the recipe and meal rows, which keep a name and a brand of their own and
    nothing else. One query for the foods and the picture queries behind it, not
    a lookup per row. A food that is gone is simply not in the answer.
    """
    wanted = {food_id for food_id in food_ids if food_id is not None}
    if not wanted:
        return {}
    foods = list(db.execute(select(models.Food).where(models.Food.id.in_(wanted))).scalars())
    pictures = pictures_for(db, user, foods)
    marks: dict[int, Mark] = {}
    for food in foods:
        picture = pictures.get(food.id)
        # The address a row actually draws: the small copy, or the whole
        # picture on a food photographed before there were any.
        thumb = None if picture is None else (picture.thumb or picture.url)
        marks[food.id] = Mark(thumb, food.status)
    return marks


def first_servings(
    db: Session, foods: Sequence[models.Food]
) -> dict[int, dict[str, object]]:
    """The label serving of each of these foods, where it has one.

    Position 0 is the serving the label prints, which is what every list reads
    a food by. One query for the lot rather than a lazy load per row.
    """
    ids = [food.id for food in foods]
    if not ids:
        return {}
    rows = db.execute(
        select(
            models.FoodServing.food_id,
            models.FoodServing.name,
            models.FoodServing.amount,
            models.FoodServing.unit,
            models.FoodServing.base_amount,
        )
        .where(models.FoodServing.food_id.in_(ids))
        # Highest position first, so the lowest one is what is left in the map.
        .order_by(models.FoodServing.position.desc())
    ).all()
    return {
        food_id: {"name": name, "amount": amount, "unit": unit, "base_amount": base}
        for food_id, name, amount, unit, base in rows
    }


def food_row(
    food: models.Food,
    picture: Picture | None = None,
    community: str = "none",
    serving: dict[str, object] | None = None,
) -> dict[str, object]:
    """A food as it reads in a list: enough to pick it out, nothing else."""
    return {
        "id": food.id,
        "name": food.name,
        "brand": food.brand,
        # The short line under the name, empty on most foods.
        "description": food.description,
        # Which aisle it is browsed under. Every food carries one; only a
        # shared food is browsed by it.
        "section": food.section,
        "calories": food.calories,
        "base_unit": food.base_unit,
        "status": food.status,
        "photo_url": None if picture is None else picture.url,
        # The same picture at the size a row draws it. Null where none has been
        # written, and a row falls back to the full one.
        "thumb_url": None if picture is None else picture.thumb,
        # Where this food stands with the shared database, from where the
        # person reading is standing.
        "community": community,
        # What the label calls one of them, so a row reads per the serving
        # somebody eats rather than per 100 of anything.
        "serving": serving,
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
    servings = first_servings(db, foods)
    return [
        food_row(food, pictures.get(food.id), states[food.id], servings.get(food.id))
        for food in foods
    ]


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


def rejection_note(db: Session, user: models.User, food: models.Food) -> str:
    """What an administrator said when they turned this account's offer down.

    The newest rejected offer of this food, which is the one the food's own
    page is about. Blank where there is nothing to say.
    """
    note = db.execute(
        select(models.FoodSubmission.decision_note)
        .where(
            models.FoodSubmission.submitted_by_id == user.id,
            models.FoodSubmission.kind == "new",
            models.FoodSubmission.food_id == food.id,
            models.FoodSubmission.status == "rejected",
        )
        .order_by(models.FoodSubmission.id.desc())
        .limit(1)
    ).scalar()
    return note or ""


# How many of a food's own requests its page shows. The record is short by
# nature: a food is offered, answered, corrected, and offered again.
SUBMISSION_HISTORY = 5


def submissions_for(
    db: Session, user: models.User, food: models.Food
) -> list[dict[str, object]]:
    """What this account has asked about this food, newest first.

    Only their own, because a request is between one member and whoever reviews
    it and nobody else is in it. Their own food, where the record is how far it
    has got towards being shared; and a shared food, where it is what they have
    reported about it. Newest first and capped: the page is about where the
    food stands now, with enough behind it to read as history.
    """
    if food.owner_id != user.id and food.status != "approved":
        return []
    rows = db.execute(
        select(models.FoodSubmission)
        .where(
            models.FoodSubmission.submitted_by_id == user.id,
            or_(
                models.FoodSubmission.food_id == food.id,
                models.FoodSubmission.target_food_id == food.id,
            ),
        )
        .order_by(models.FoodSubmission.created_at.desc(), models.FoodSubmission.id.desc())
        .limit(SUBMISSION_HISTORY)
    ).scalars().all()
    return [
        {
            "id": row.id,
            "kind": row.kind,
            "status": row.status,
            "created_at": row.created_at,
            # When it was answered, for the one line the page says about it.
            "decided_at": row.decided_at,
            "decision_note": row.decision_note,
            # What a reviewer changed on the way through, and whether this
            # account has read that yet.
            "edited": row.edited,
            "changes": row.changes,
            "seen_at": row.seen_at,
        }
        for row in rows
    ]


def submitter_of(
    db: Session, food: models.Food
) -> tuple[int | None, str | None, str | None]:
    """Who offered this food to the shared database, and what they are.

    The newest approved offer of it, and nothing where there is none or the
    account has since gone: a submission keeps its row and drops the person.
    """
    row = db.execute(
        select(models.User)
        .join(models.FoodSubmission, models.FoodSubmission.submitted_by_id == models.User.id)
        .where(
            models.FoodSubmission.food_id == food.id,
            models.FoodSubmission.kind == "new",
            models.FoodSubmission.status == "approved",
        )
        .order_by(models.FoodSubmission.decided_at.desc(), models.FoodSubmission.id.desc())
        .limit(1)
    ).scalars().first()
    if row is None:
        return None, None, None
    return row.id, row.display_name or row.username, profiles.role_of(row)


def food_detail(db: Session, food: models.Food, user: models.User) -> dict[str, object]:
    """The whole food, its panel per 100 of its base unit, and its servings.

    The picture here is the published one, and for the owner of a food nobody
    has published yet it is the front photo they attached themselves. A list
    shows only what everybody can see; the page where somebody manages their
    own food has to show them what they put on it.
    """
    state = community_states(db, user, [food])[food.id]
    label_serving = food.servings[0] if food.servings else None
    submitted_by_id, submitted_by, submitted_by_role = (
        submitter_of(db, food) if food.status == "approved" else (None, None, None)
    )
    detail: dict[str, object] = {
        **food_row(
            food,
            pictures_for(db, user, [food]).get(food.id),
            state,
            None
            if label_serving is None
            else {
                "name": label_serving.name,
                "amount": label_serving.amount,
                "unit": label_serving.unit,
                "base_amount": label_serving.base_amount,
            },
        ),
        # Why it was turned down, for the one screen that says so. Empty
        # unless this account's own offer of this food was rejected.
        "decision_note": rejection_note(db, user, food) if state == "rejected" else "",
        # The owner's own record of offering this food, which is what its page
        # says instead of one line about the last answer. Empty for everybody
        # else.
        "submissions": submissions_for(db, user, food),
        # Who the shared database has this food from. Sent to the submitter as
        # well: which of the two lines to show is the client's call.
        "submitted_by": submitted_by,
        # And whether they wear a shield beside that name, the same as anywhere
        # else a member is named.
        "submitted_by_role": submitted_by_role,
        # Which account that name belongs to, so it opens their member page.
        "submitted_by_id": submitted_by_id,
        # The nutrition label on file. It is published with a shared food:
        # whoever reads the numbers should be able to read the panel they came
        # from and say so if the two disagree. On a food that is not shared
        # yet, only the reviewer weighing it up is served it.
        "label_photo_url": (
            photo_url(food.label_photo_id)
            if food.label_photo_id is not None
            and (food.status == "approved" or reviews(user))
            else None
        ),
        "density_g_per_ml": food.density_g_per_ml,
        # When the row last moved. An edit sends it back, so one written
        # against an older copy is refused rather than applied.
        "updated_at": food.updated_at,
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
                "amount": serving.amount,
                "unit": serving.unit,
                "base_amount": serving.base_amount,
                "position": serving.position,
            }
            for serving in food.servings
        ],
    }
    for field in FOOD_NUTRIENTS:
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
    if food.status == "approved" or food.owner_id == user.id or reviews(user):
        return food
    raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_FOOD)


def changeable_food(
    db: Session,
    user: models.User,
    food_id: int,
    owner_may: tuple[str, ...],
    admin_may: tuple[str, ...],
    *,
    reviewers: bool = False,
) -> models.Food:
    """A food this account may write to, or the refusal saying it may not.

    An administrator's reach is the shared database and what is queued to
    change it: the rows everyone eats out of are theirs to fix, and somebody's
    private food is not, however plainly they can see it.

    A reviewer has the same reach on the routes that keep a food right, which
    is what `reviewers` says. Deleting one is not among them, so the route that
    deletes leaves this off and stays an administrator's.
    """
    food = readable_food(db, user, food_id)
    if food.owner_id == user.id and food.status in owner_may:
        return food
    if food.status in admin_may and (user.is_admin or (reviewers and reviews(user))):
        return food
    raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_YOURS)


def like_literal(text: str) -> str:
    """A search word with the wildcards taken out of it.

    A typed % otherwise matches the whole table, which is a search that answers
    a question nobody asked.
    """
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# What each nutrient is called when the list of what a reviewer changed has to
# name one. The panel fields first, in the order a label prints them, which is
# also the order the screens read them in.
NUTRIENT_LABELS = {
    "calories": "Calories",
    "fat_g": "Fat",
    "saturated_fat_g": "Saturated fat",
    "trans_fat_g": "Trans fat",
    "cholesterol_mg": "Cholesterol",
    "sodium_mg": "Sodium",
    "carbs_g": "Carbs",
    "fiber_g": "Fiber",
    "sugar_g": "Total sugars",
    "added_sugars_g": "Added sugars",
    "protein_g": "Protein",
}

# Everything a reviewer can change about a waiting proposal, in the words the
# person who offered it reads afterwards. The servings are a list rather than a
# column, so they are compared whole under one word.
EDIT_LABELS = {
    "name": "Name",
    "brand": "Brand",
    "description": "Description",
    "section": "Section",
}
EDIT_LABELS.update(NUTRIENT_LABELS)
SERVING_LABEL = "Serving"
FRONT_LABEL = "Front photo"
LABEL_LABEL = "Label photo"


def open_submission(db: Session, food_id: int) -> models.FoodSubmission | None:
    """The request still waiting on this food, if there is one."""
    return db.execute(
        select(models.FoodSubmission).where(
            models.FoodSubmission.food_id == food_id,
            models.FoodSubmission.status == "pending",
        )
    ).scalars().first()


def review_snapshot(food: models.Food) -> dict[str, object]:
    """A proposal as it stands, keyed by what each part is called on screen."""
    shot: dict[str, object] = {
        label: getattr(food, field) for field, label in EDIT_LABELS.items()
    }
    shot[SERVING_LABEL] = [
        (serving.name, serving.amount, serving.unit, serving.position)
        for serving in food.servings
    ]
    return shot


def record_changes(submission: models.FoodSubmission, labels: Sequence[str]) -> None:
    """Add what a reviewer changed to what they had already changed.

    Written as a new list rather than appended to: a JSON column holds a plain
    list, and a list changed in place is a change the session never sees.
    """
    fresh = [label for label in labels if label not in submission.changes]
    if not fresh:
        return
    submission.edited = True
    submission.changes = [*submission.changes, *fresh]


def note_edit(
    db: Session, user: models.User, food: models.Food, before: dict[str, object]
) -> None:
    """Write down a reviewer's changes to something that is still waiting.

    Only a reviewer's, and only while the thing is still a proposal. What the
    owner does to their own food before anybody has looked at it is the food,
    not a change to what they asked for.
    """
    if not reviews(user) or food.status not in ("pending", "shadow"):
        return
    submission = open_submission(db, food.id)
    if submission is None:
        return
    after = review_snapshot(food)
    record_changes(submission, [key for key, was in before.items() if after[key] != was])


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
    # One line, whatever arrived: split with no argument breaks on every kind
    # of whitespace, so a pasted paragraph comes back as words with one space
    # between them and nothing to trim off either end.
    description = " ".join(body.description.split())
    if len(description) > MAX_DESCRIPTION:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"A description must be at most {MAX_DESCRIPTION} characters.",
        )
    # Blank is the aisle a private food keeps: nothing asks for one, and a
    # food that is offered later is asked then. Anything else is held to the
    # list, so a slug nothing browses by cannot be stored.
    section = body.section.strip().lower()
    if section and section not in FOOD_SECTIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_SECTION)
    if any(getattr(body, field) is None for field in REQUIRED):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Calories, protein, carbs, and fat are required."
        )

    food.name = name
    food.brand = brand
    food.description = description
    food.section = section or DEFAULT_SECTION
    food.base_unit = body.base_unit
    food.density_g_per_ml = body.density_g_per_ml
    food.ingredients_text = body.ingredients_text.strip()
    for field in FOOD_NUTRIENTS:
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
        if serving.unit not in units.UNIT_TO_BASE:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, UNKNOWN_UNIT)
        if units.base_unit_of(serving.unit) != food.base_unit:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, WRONG_FAMILY[food.base_unit])
        servings.append(
            models.FoodServing(
                name=serving_name,
                amount=serving.amount,
                unit=serving.unit,
                # The one sum, and the server's: within a family it is the
                # factor and nothing else, because nothing was assumed.
                base_amount=serving.amount * units.UNIT_TO_BASE[serving.unit],
                position=serving.position,
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
    brand = func.lower(models.Food.brand)
    # Where the word sits, which is the whole of the ranking: the food called
    # "Chicken breast" is what somebody typing "chicken" meant, ahead of "Roast
    # chicken", ahead of a brand of that name, ahead of anything merely
    # containing the letters. Ties go to the shorter name, then the brand,
    # which is what tells twenty rows called Butter apart.
    rank = case(
        (name.like(f"{literal}%", escape="\\"), 0),
        (name.like(f"% {literal}%", escape="\\"), 1),
        (brand.like(f"{literal}%", escape="\\"), 2),
        (brand.like(f"% {literal}%", escape="\\"), 3),
        else_=4,
    )
    # Every word has to be somewhere, in the name or in the brand, so
    # "kerrygold butter" finds the one row that is both.
    words = [
        or_(
            name.like(f"%{like_literal(word)}%", escape="\\"),
            brand.like(f"%{like_literal(word)}%", escape="\\"),
        )
        for word in needle.split()
    ]
    query = (
        visible(user)
        .where(
            models.Food.status.in_(("approved", "custom", "pending")),
            *words,
        )
        .order_by(rank, func.length(models.Food.name), models.Food.brand, models.Food.id)
        .limit(SEARCH_LIMIT)
    )
    return food_rows(db, user, list(db.execute(query).scalars()))


@router.get("/mine")
def list_my_foods(
    db: Session = Depends(get_db), user: models.User = Depends(require_user)
) -> list[dict[str, object]]:
    """What this account has been eating lately, and its own foods.

    Nothing is put here by hand and nothing is taken off: a shared food is on
    the list because it was logged, and it drops down the list as other things
    are. A food of their own is here from the moment it is entered, because
    they made it and it is theirs to find.

    Ordered by when each was last eaten, newest first, which is the Journal's
    own order: what somebody ate this morning is what they reach for again.
    Under those, the ones nobody has logged yet, by when each was entered.

    Ten rows, own foods counted in with the rest. Everything a member owns is
    still found by searching or browsing; this is the short list of what they
    have been eating, not their whole cupboard.
    """
    logged = last_logged_by(models.DiaryEntry.food_id, user)
    query = (
        select(models.Food)
        .outerjoin(logged, logged.c.owner == models.Food.id)
        .where(
            or_(
                and_(models.Food.owner_id == user.id, models.Food.status.in_(LISTED)),
                and_(
                    models.Food.status == "approved", logged.c.last_logged.is_not(None)
                ),
            )
        )
        .order_by(
            logged.c.last_logged.desc().nullslast(),
            models.Food.created_at.desc(),
            models.Food.id.desc(),
        )
        # Ten, not a ceiling nobody reaches: this is Recently used, and an
        # eleventh row is something somebody has stopped reaching for.
        .limit(RECENT_USED)
    )
    return food_rows(db, user, list(db.execute(query).scalars()))


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
    # When each of them was last eaten. The order here stays the pin's own; the
    # day is carried so a screen that reads them by hand can lead with what
    # somebody actually reaches for.
    eaten = {
        row.food_id: row.day
        for row in db.execute(
            select(
                models.DiaryEntry.food_id,
                func.max(models.DiaryEntry.date_for).label("day"),
            )
            .where(
                models.DiaryEntry.user_id == user.id,
                models.DiaryEntry.food_id.in_([food.id for food in pinned]),
            )
            .group_by(models.DiaryEntry.food_id)
        ).all()
    }
    rows: list[dict[str, object]] = [
        {**row, "pinned": True, "last_logged": eaten.get(food.id)}
        for row, food in zip(food_rows(db, user, pinned), pinned, strict=True)
    ]
    kept = {food.id for food in pinned}

    # Ordered by the newest entry each food appears in, which is what "recent"
    # means here: when it was last eaten, not how often.
    logged = db.execute(
        select(
            models.DiaryEntry.food_id,
            func.max(models.DiaryEntry.id).label("last"),
            func.max(models.DiaryEntry.date_for).label("day"),
        )
        .where(models.DiaryEntry.user_id == user.id, models.DiaryEntry.food_id.is_not(None))
        .group_by(models.DiaryEntry.food_id)
        .order_by(func.max(models.DiaryEntry.id).desc())
        .limit(RECENT_SCANNED)
    ).all()
    days = {row.food_id: row.day for row in logged}
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
    servings = first_servings(db, list(found.values()))
    for food_id in wanted:
        food = found.get(food_id)
        if food is None:
            continue
        rows.append(
            {
                **food_row(
                    food, pictures.get(food.id), states[food.id], servings.get(food.id)
                ),
                "pinned": False,
                "last_logged": days.get(food.id),
            }
        )
        if len(rows) - len(kept) == RECENT_LIMIT:
            break
    return rows


@router.get("/browse")
def browse_foods(
    cursor: str = "",
    letter: str = "",
    section: str = "",
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

    A section is the same list read the way somebody shops, and the two narrow
    it together: the frozen things beginning with P are both at once.
    """
    if letter and not (len(letter) == 1 and letter.isascii() and letter.isalpha()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_LETTER)
    if section and section not in FOOD_SECTIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_SECTION)
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
        select(models.Food, has_photo.label("has_photo"))
        .outerjoin(published, published.c.food_id == models.Food.id)
        .where(models.Food.status == "approved")
        # One more than a page, which is how the answer knows whether there is
        # another one without counting the whole table.
        .limit(BROWSE_PAGE + 1)
    )
    if section:
        query = query.where(models.Food.section == section)
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
    foods = [food for food, _ in page]
    states = community_states(db, user, foods)
    servings = first_servings(db, foods)
    # The pictures the same way every other list reads them, so a row here and
    # a row anywhere else carry the same two addresses.
    pictures = photo_urls(db, [food.id for food in foods])
    items = [
        food_row(food, pictures.get(food.id), states[food.id], servings.get(food.id))
        for food in foods
    ]
    more = len(rows) > BROWSE_PAGE
    if not more or not page:
        marker = None
    elif letter:
        marker = write_name_cursor(page[-1][0].name.lower(), page[-1][0].id)
    else:
        marker = write_cursor(page[-1][1], page[-1][0].id)
    return {"items": items, "next_cursor": marker}


@router.get("/{food_id}")
def read_food(
    food_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> dict[str, object]:
    return food_detail(db, readable_food(db, user, food_id), user)


def set_label_photo(db: Session, food: models.Food, photo: models.FoodPhoto | None) -> None:
    """Give a shared food its nutrition panel, or take the one it has away.

    The picture it was keeping goes with it, unless a waiting request is still
    offering that one as its evidence, in which case the food simply lets go.
    """
    from app.routers.photos import discard

    standing = (
        db.get(models.FoodPhoto, food.label_photo_id)
        if food.label_photo_id is not None
        else None
    )
    food.label_photo_id = None if photo is None else photo.id
    # Written down before the old one is taken away, so nothing unpicks the row
    # that now points at its replacement.
    db.flush()
    if standing is None or (photo is not None and standing.id == photo.id):
        return
    held = db.execute(
        select(models.FoodSubmission.id).where(
            models.FoodSubmission.label_photo_id == standing.id
        )
    ).first()
    if held is None:
        discard(db, standing)


@router.post("/{food_id}/photo", status_code=status.HTTP_204_NO_CONTENT)
def attach_food_photo(
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

    The panel is the other case, and it is an administrator's: a food everybody
    eats out of keeps one, so whoever corrects it next has the label to read.
    """
    from app.routers.photos import discard, front_photo

    if body.purpose not in models.PHOTO_PURPOSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_PURPOSE)
    # A reviewer may also swap the picture on a shared food: the rows
    # everybody eats out of are theirs to keep right, photograph included.
    food = changeable_food(
        db, user, food_id, ("custom", "pending"), ("approved",), reviewers=True
    )
    if body.purpose == "label" and not (reviews(user) and food.status == "approved"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_YOURS)
    photo = db.get(models.FoodPhoto, body.photo_id)
    if (
        photo is None
        or photo.uploaded_by_id != user.id
        or photo.food_id is not None
        or photo.purpose != body.purpose
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, MISSING_PHOTO_TO_ATTACH)

    if body.purpose == "label":
        set_label_photo(db, food, photo)
        log_review(db, user, "photo_replaced", "food", food.id, food.name, [LABEL_LABEL])
        db.commit()
        return

    if food.status == "approved":
        # Published in place of the one showing, the way an approved photo
        # proposal lands. Imported here: admin imports this module.
        from app.routers.admin import publish_front

        photo.food_id = food.id
        publish_front(db, food, photo)
        log_review(db, user, "photo_replaced", "food", food.id, food.name, [FRONT_LABEL])
        db.commit()
        return

    standing = front_photo(db, food.id)
    # Only one that is still waiting. A published picture belongs to the shared
    # database, and this route reaches a food that has one only for an admin.
    if standing is not None and standing.status == "pending":
        discard(db, standing)
    photo.food_id = food.id
    db.commit()


@router.delete("/{food_id}/photo", status_code=status.HTTP_204_NO_CONTENT)
def remove_food_photo(
    food_id: int,
    purpose: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    """Take a picture off a shared food, row and file both.

    An administrator's, and only on the shared database: a food of somebody's
    own carries the picture they attached, and they replace it rather than
    empty it.
    """
    from app.routers.photos import discard, published

    if purpose not in models.PHOTO_PURPOSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_PURPOSE)
    food = changeable_food(db, user, food_id, (), ("approved",), reviewers=True)

    if purpose == "label":
        set_label_photo(db, food, None)
    else:
        standing = published(db, food.id)
        if standing is not None:
            discard(db, standing)
    log_review(
        db,
        user,
        "photo_removed",
        "food",
        food.id,
        food.name,
        [LABEL_LABEL if purpose == "label" else FRONT_LABEL],
    )
    db.commit()


@router.post("/{food_id}/pin", status_code=status.HTTP_204_NO_CONTENT)
def pin_food(
    food_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_user),
) -> None:
    """Keep a food to hand. Pinning one that is already pinned changes nothing.

    A food of their own that is still waiting for review counts: it is theirs
    to eat today, so it is theirs to favorite today. Somebody else's is absent
    until it is approved, and favoriting it answers what reading it does.
    """
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
    food = changeable_food(db, user, food_id, OWNER_MAY_EDIT, ADMIN_MAY_EDIT, reviewers=True)
    # A form that loaded an older copy of this food is refused rather than
    # applied over whoever saved in between. A body without the stamp is an
    # older client or somebody's own food, and neither has a race to lose.
    if body.as_of is not None and body.as_of != food.updated_at:
        raise HTTPException(status.HTTP_409_CONFLICT, STALE_EDIT)
    # Read before the form lands on it, so a reviewer's corrections to a
    # waiting proposal can be told from what was offered.
    before = review_snapshot(food)
    # The barcode is not among what an edit changes. It is what the row was
    # scanned from, and a code that moves is a code the scanner cannot trust.
    apply_body(food, body)
    db.flush()
    note_edit(db, user, food, before)
    # Correcting a shared food is a review action, and the record says which
    # parts of it moved. Somebody editing their own food is not one.
    if food.status == "approved":
        after = review_snapshot(food)
        changed = [key for key, was in before.items() if after[key] != was]
        log_review(db, user, "food_edited", "food", food.id, food.name, changed)
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
