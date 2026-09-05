"""The tables: accounts, the tokens that let someone in, the foods, and the
diary those foods are eaten into."""

from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Dialect,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from app.db import Base


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class UtcDateTime(TypeDecorator[dt.datetime]):
    """A timestamp that is always aware and always UTC.

    A naive datetime is refused on the way in rather than stored: SQLite keeps
    no zone at all and Postgres would read one in from the session, so the two
    engines would disagree about the same row. Values read back are stamped UTC
    for the engines that hand them over bare.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: dt.datetime | None, dialect: Dialect) -> dt.datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetime refused; pass an aware UTC datetime")
        return value.astimezone(dt.timezone.utc)

    def process_result_value(
        self, value: dt.datetime | None, dialect: Dialect
    ) -> dt.datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=dt.timezone.utc)
        return value.astimezone(dt.timezone.utc)


class User(Base):
    __tablename__ = "users"
    # Addresses are compared case-insensitively, so uniqueness has to be too:
    # a plain unique column would let the same mailbox register twice with
    # different capitalisation.
    __table_args__ = (Index("ix_users_email_lower", text("lower(email)"), unique=True),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # The address a change was requested to, held here until it is confirmed so
    # a typo cannot lock the account out of its own mail.
    pending_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
    birthdate: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    # Free text, "City, State". Never geocoded and never looked up.
    location: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # The file name of the picture other members see beside this account's
    # name, or null for the account's initial. The name is the server's own,
    # like every other stored picture.
    avatar_path: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    units: Mapped[str] = mapped_column(String(16), nullable=False, default="imperial")
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    # Which clock this account reads times on, "12h" or "24h". A preference
    # rather than a fact about the data: every time is stored in UTC either way.
    clock: Mapped[str] = mapped_column(String(4), nullable=False, default="12h")
    # Which parts of a shared workout this account keeps to itself: any of
    # avg_hr, kcal and route. Another member is served the workout without
    # them rather than with them emptied.
    feed_hidden: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list)
    # The only three facts another member may be shown, each off until it is
    # turned on. Everything else about an account stays private.
    share_age: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    share_sex: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    share_location: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Every workout at once. Off, and nothing of theirs reaches the feed.
    share_workouts: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Whether finishing a day says so in the feed. Off until it is turned on.
    share_journal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Whether a weigh-in that came in lower than the one before it says so in
    # the feed. The weight itself never goes, only how much of it went.
    share_weight_loss: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)


class Session(Base):
    __tablename__ = "sessions"

    # The hash is the key: the token itself is only ever in the cookie, so a
    # copy of this table is not a set of usable sessions.
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)
    expires_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False)


class EmailToken(Base):
    __tablename__ = "email_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    purpose: Mapped[str] = mapped_column(String(16), nullable=False, default="verify")
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)
    expires_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False)


class Invite(Base):
    __tablename__ = "invites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    used_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)
    expires_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime, nullable=True)
    revoked_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime, nullable=True)


class IngestToken(Base):
    __tablename__ = "ingest_tokens"

    # One standing token per account, so the account id is the key.
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)
    last_used_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime, nullable=True)


# What a food row is, and who may see it. Only 'custom' is written this round;
# the rest are the states a shared database needs, declared now so a later
# round adds behaviour rather than another migration on this table.
#   cache     looked up from elsewhere and kept, belonging to nobody
#   custom    somebody's own, private to them
#   pending   their own, offered to the shared database and not judged yet
#   shadow    their own copy of something shared, edited for themselves
#   approved  in the shared database, visible to everyone
FOOD_STATUSES = ("cache", "custom", "pending", "shadow", "approved")

# Where a food sits in a shop, which is how the shared database is browsed. A
# fixed list rather than free text, for the same reason the database itself is
# one. Stored as the slug; the words a screen says live with the screen.
FOOD_SECTIONS = (
    "produce",
    "meat",
    "seafood",
    "eggs-and-dairy",
    "bread-and-bakery",
    "grains-and-pasta",
    "canned-and-jarred",
    "frozen",
    "snacks",
    "candy-and-sweets",
    "drinks",
    "coffee-and-tea",
    "condiments-and-sauces",
    "spices-and-baking",
    "prepared-meals",
    "supplements",
    "other",
)

# What a food carries until somebody says otherwise, and the aisle everything
# already shared was put in for a reviewer to sort.
DEFAULT_SECTION = "other"

# The nutrition panel, stored per 100 of the food's base unit. The order is the
# order it reads in, and the routes and the screens both follow it.
NUTRIENTS = (
    "calories",
    "protein_g",
    "carbs_g",
    "fat_g",
    "saturated_fat_g",
    "trans_fat_g",
    "cholesterol_mg",
    "sodium_mg",
    "fiber_g",
    "sugar_g",
)

# The panel plus what only a food carries. Added sugars is read off a packet,
# so it lives on the food; a portion that was eaten keeps the ten above.
FOOD_NUTRIENTS = (*NUTRIENTS, "added_sugars_g")


class Food(Base):
    """One food, and its nutrition per 100 of whatever it is measured in."""

    __tablename__ = "foods"
    __table_args__ = (
        # Only the shared database holds one row per barcode. A private custom
        # food may carry the same barcode as somebody else's, and as the
        # approved row it was copied from, so the uniqueness is partial rather
        # than a plain unique column.
        Index(
            "uq_foods_barcode_approved",
            "barcode",
            unique=True,
            postgresql_where=text("status = 'approved'"),
            sqlite_where=text("status = 'approved'"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Non-native: a database enum type has to be altered to gain a value, and
    # this list will gain values. A string column with the set written down
    # here reads the same and changes by editing one tuple.
    status: Mapped[str] = mapped_column(
        Enum(*FOOD_STATUSES, name="food_status", native_enum=False),
        nullable=False,
        default="custom",
    )
    # Both accounts are SET NULL rather than CASCADE: a food in the shared
    # database outlives whoever submitted it, and closing an account should not
    # quietly take away rows other people are eating out of.
    owner_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    barcode: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    # Where the row came from: typed in here, or fetched from somewhere that
    # names its own rows, in which case source_id is that name.
    source: Mapped[str] = mapped_column(String(8), nullable=False, default="user")
    source_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    brand: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    # What it is, in a few words: "King Size", "Blueberry flavor". Not the
    # brand and not the panel, just what tells two rows of one food apart.
    description: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    # Which aisle it would be found in. Only a food in the shared database is
    # browsed this way, so a private one keeps the default and never asks.
    section: Mapped[str] = mapped_column(
        String(32), nullable=False, default=DEFAULT_SECTION
    )
    # 'g' or 'ml'. Every number below is per 100 of this.
    base_unit: Mapped[str] = mapped_column(String(2), nullable=False, default="g")
    # What one millilitre of it weighs, when the label gave enough to work it
    # out. Null is not zero: it is the reason a screen says water was assumed.
    density_g_per_ml: Mapped[float | None] = mapped_column(Float, nullable=True)

    calories: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbs_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    saturated_fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    trans_fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    cholesterol_mg: Mapped[float | None] = mapped_column(Float, nullable=True)
    sodium_mg: Mapped[float | None] = mapped_column(Float, nullable=True)
    fiber_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    sugar_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Of the sugars above, the ones put in rather than grown in. Null is a
    # label that never printed the line, which most older foods here are.
    added_sugars_g: Mapped[float | None] = mapped_column(Float, nullable=True)

    ingredients_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # The nutrition panel this food keeps, once a reviewer has approved
    # something that carried one. One file for the life of the food, served to
    # administrators and nobody else. use_alter because food_photos points back
    # at foods: the two tables are a cycle, and create_all has to be told.
    label_photo_id: Mapped[int | None] = mapped_column(
        ForeignKey("food_photos.id", ondelete="SET NULL", use_alter=True), nullable=True
    )
    fetched_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)

    # delete-orphan as well as the database's ON DELETE CASCADE: the constraint
    # is what holds when rows go in SQL, and this is what holds when they go
    # through a session.
    servings: Mapped[list["FoodServing"]] = relationship(
        cascade="all, delete-orphan", order_by="FoodServing.position"
    )


class FoodServing(Base):
    """A named amount of one food: "1 slice", "1 cup, chopped"."""

    __tablename__ = "food_servings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    food_id: Mapped[int] = mapped_column(
        ForeignKey("foods.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    # How it was typed: "1" and "lb", kept so the form and the picker can read
    # a serving back in the words it was entered in.
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(8), nullable=False)
    # What that came to in the food's own base unit, which is the number every
    # sum is worked out from.
    base_amount: Mapped[float] = mapped_column(Float, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


# What a picture of a label is: waiting on a decision, or published with the
# food it belongs to. A rejected photo is not a state, it is a deleted row and
# a deleted file.
PHOTO_STATUSES = ("pending", "approved")

# What somebody is asking for.
#   new     a food that is not in the shared database yet
#   edit    a correction to one that is, written as a copy a reviewer reads
#           beside it. An administrator's tool now: a shared food is corrected
#           by whoever reviews it, and a member reports it instead.
#   photo   a picture for one that has none
#   report  something wrong with a shared food, said in words. It changes
#           nothing by itself; it puts the food back in front of a reviewer.
SUBMISSION_KINDS = ("new", "edit", "photo", "report")

# Where a submission has got to. Withdrawing one deletes it rather than adding
# a fourth state: nobody has judged it, so there is nothing to keep.
SUBMISSION_STATUSES = ("pending", "approved", "rejected")

# What a picture is for, which decides who may ever see it.
#   front   the pack as it looks on a shelf. One of these per food is
#           published, and everybody signed in can read it.
#   label   the nutrition panel, offered so a reviewer can check the numbers
#           against something. It belongs to the request rather than the food,
#           it is never published, and nobody but its uploader and an
#           administrator is ever served it.
PHOTO_PURPOSES = ("front", "label")


class FoodPhoto(Base):
    """A picture of a food, uploaded before there is a food to attach it to.

    Held as its own row rather than a column on the food because the upload
    happens first: somebody chooses a photo while filling the form in, and the
    form may never be sent. Those are the rows the purge in the photos router
    sweeps up.
    """

    __tablename__ = "food_photos"
    __table_args__ = (
        # One published picture per food. Partial, like the barcode index above:
        # a food may collect several pending photos while people offer them, and
        # only one of those ever becomes the one everybody sees.
        Index(
            "uq_food_photos_food_approved",
            "food_id",
            unique=True,
            postgresql_where=text("status = 'approved'"),
            sqlite_where=text("status = 'approved'"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Null until the submission that carries it is sent, and SET NULL rather
    # than CASCADE after: a food going away leaves a file to be tidied, not a
    # row that vanishes out from under the sweep.
    food_id: Mapped[int | None] = mapped_column(
        ForeignKey("foods.id", ondelete="SET NULL"), nullable=True, index=True
    )
    uploaded_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # The file's name and nothing else: the server chooses it, and no part of it
    # comes from the upload. A path from a client is a path traversal.
    path: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="pending")
    # A label photo never reaches 'approved' and never counts towards the one
    # published picture per food: the index above is about front photos, and
    # nothing ever publishes the other kind.
    purpose: Mapped[str] = mapped_column(
        Enum(*PHOTO_PURPOSES, name="photo_purpose", native_enum=False),
        nullable=False,
        default="front",
    )
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)


class FoodSubmission(Base):
    """Somebody offering a food to the shared database, and what came of it."""

    __tablename__ = "food_submissions"
    __table_args__ = (
        # One open submission per food. A person may offer a food, have it
        # turned down, correct it and offer it again; they may not have two
        # requests about the same food waiting at once.
        Index(
            "uq_food_submissions_open",
            "food_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
            sqlite_where=text("status = 'pending'"),
        ),
        # And one open request of each kind per person per shared food. A
        # correction and a picture for the same food are two requests; two
        # corrections from the same person are one request sent twice. Only the
        # kinds that point at something already shared are held to this, which
        # is what the target being there stands for.
        Index(
            "uq_food_submissions_open_target",
            "submitted_by_id",
            "target_food_id",
            "kind",
            unique=True,
            postgresql_where=text("status = 'pending' AND target_food_id IS NOT NULL"),
            sqlite_where=text("status = 'pending' AND target_food_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(
        # The one enum here the database is asked to hold to as well. It grew a
        # value, and a column that says which four words it takes is the check
        # a wrong one fails on rather than a row nothing downstream can decide.
        Enum(
            *SUBMISSION_KINDS,
            name="submission_kind",
            native_enum=False,
            create_constraint=True,
        ),
        nullable=False,
        default="new",
    )
    # The food being offered. SET NULL so a submission that has been decided
    # still reads as history after its food is deleted.
    food_id: Mapped[int | None] = mapped_column(
        ForeignKey("foods.id", ondelete="SET NULL"), nullable=True
    )
    # For the kinds that change something already shared: the row in the shared
    # database this is about. CASCADE, because a correction to a food that is
    # gone is not a request anybody can answer.
    target_food_id: Mapped[int | None] = mapped_column(
        ForeignKey("foods.id", ondelete="CASCADE"), nullable=True
    )
    photo_id: Mapped[int | None] = mapped_column(
        ForeignKey("food_photos.id", ondelete="SET NULL"), nullable=True
    )
    # The nutrition panel offered with this request, for whoever reads it. It
    # belongs to the request and not to the food: it is never published, and
    # withdrawing the request takes it away with everything else.
    label_photo_id: Mapped[int | None] = mapped_column(
        ForeignKey("food_photos.id", ondelete="SET NULL"), nullable=True
    )
    submitted_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # What the person wanted the reviewer to know, and what the reviewer said
    # back. Both plain text and both optional.
    note: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="pending")
    decided_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime, nullable=True)
    decision_note: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    # Whether a reviewer changed the proposal before saying yes to it, and what
    # they changed, in the words the submitter is told it in. An approval with
    # nothing in here is the thing exactly as it was offered.
    edited: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    changes: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list)
    # When the submitter last read the answer. Null while a decision is still
    # news to them, which is what the badge counts.
    seen_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)


# The four parts of a day, in the order they are eaten. Non-native for the same
# reason the food statuses are: a list that may gain a value should change by
# editing a tuple, not by altering a type in the database.
DIARY_SLOTS = ("breakfast", "lunch", "dinner", "snack")

# What the unit column holds when the amount was counted in the food's own
# named servings rather than measured. The name of the serving goes in
# serving_label beside it, and neither depends on the food still existing.
SERVING_UNIT = "serving"


class DiaryEntry(Base):
    """One thing eaten, on one day, with its numbers already worked out.

    The panel here is not per 100 of anything: it is what was actually eaten,
    copied at the moment of logging. Correcting a food afterwards corrects the
    food, and deleting one leaves every meal it was part of standing, which is
    why the name and the brand are copied rather than looked up.
    """

    __tablename__ = "diary_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The day it counts against, in the account's own zone. A date rather than a
    # timestamp: somebody eating at midnight decides which day that was.
    date_for: Mapped[dt.date] = mapped_column(Date, nullable=False, index=True)
    slot: Mapped[str] = mapped_column(
        Enum(*DIARY_SLOTS, name="diary_slot", native_enum=False), nullable=False
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    brand: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    # SET NULL: deleting a food unlinks what was eaten rather than erasing it.
    food_id: Mapped[int | None] = mapped_column(
        ForeignKey("foods.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # How it was measured out, kept so the row can say "2 tbsp" rather than the
    # millilitres that came of it. Null on a quick add, which is a number and a
    # name and no portion at all.
    amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(8), nullable=True)
    serving_label: Mapped[str | None] = mapped_column(String(60), nullable=True)
    # Set instead of food_id when what was eaten was a recipe. The amount is a
    # number of servings of it, and SET NULL for the same reason: deleting the
    # recipe leaves the meal standing with the numbers it was logged at.
    recipe_id: Mapped[int | None] = mapped_column(
        ForeignKey("recipes.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Set instead when what was eaten was a kept meal, in which case the amount
    # is a number of servings of the whole meal. SET NULL for the same reason
    # again: deleting the meal leaves the line standing.
    meal_id: Mapped[int | None] = mapped_column(
        ForeignKey("meal_templates.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # For the amount served, not per 100 of anything.
    calories: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbs_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    saturated_fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    trans_fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    cholesterol_mg: Mapped[float | None] = mapped_column(Float, nullable=True)
    sodium_mg: Mapped[float | None] = mapped_column(Float, nullable=True)
    fiber_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    sugar_g: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Which standing auto-log wrote this row, when one did. SET NULL: turning
    # an auto-log off stops tomorrow and leaves what it already wrote standing,
    # the same way deleting a food leaves the meals it was part of.
    auto_log_id: Mapped[int | None] = mapped_column(
        ForeignKey("auto_logs.id", ondelete="SET NULL"), nullable=True, index=True
    )

    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)


class AutoLog(Base):
    """A food somebody eats every day, set once so it logs itself.

    It holds a portion and a meal and nothing about any particular day: what it
    has already written down lives in auto_log_days beside it, so a day whose
    entry was deleted is a day that stays deleted.
    """

    __tablename__ = "auto_logs"
    __table_args__ = (
        UniqueConstraint("user_id", "food_id", "slot", name="uq_auto_logs_user_food_slot"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # CASCADE, like a pin: an instruction to log a food that is gone is nothing.
    food_id: Mapped[int] = mapped_column(
        ForeignKey("foods.id", ondelete="CASCADE"), nullable=False
    )
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    # The portion as the diary route takes it: a unit from a measure family, or
    # "serving:<id>" for one of the food's own. Kept that way so a fill-in is
    # measured by exactly the code a manual log is.
    unit: Mapped[str] = mapped_column(String(24), nullable=False)
    slot: Mapped[str] = mapped_column(
        Enum(*DIARY_SLOTS, name="diary_slot", native_enum=False), nullable=False
    )
    # The first day it may fill in, in the member's own zone. Nothing before it
    # is ever written: an auto-log is a promise about days to come.
    started_on: Mapped[dt.date] = mapped_column(Date, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)


class AutoLogDay(Base):
    """One day an auto-log has already been filled in for.

    The row is the whole answer, like a completed day: it exists, so that day
    has had its turn. Deleting the entry it wrote does not delete this, which
    is what keeps a deleted entry deleted.
    """

    __tablename__ = "auto_log_days"

    auto_log_id: Mapped[int] = mapped_column(
        ForeignKey("auto_logs.id", ondelete="CASCADE"), primary_key=True
    )
    date: Mapped[dt.date] = mapped_column(Date, primary_key=True)


class JournalDay(Base):
    """A day somebody said they were finished with.

    The row is the whole answer: it exists, so the day is complete and locked.
    Taking it away unlocks the day again, which is why there is nothing here
    to set back to false.
    """

    __tablename__ = "journal_days"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    date: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    completed_at: Mapped[dt.datetime] = mapped_column(
        UtcDateTime, nullable=False, default=now_utc
    )


class Recipe(Base):
    """Something cooked out of other foods, and how many servings it makes.

    Its ingredients carry their own numbers, copied from the foods at the
    moment the recipe was saved, for the reason a diary entry does: correcting
    a food afterwards corrects the food, and the recipe still reads as what was
    written down. Saving the recipe again is what works the numbers out afresh.
    """

    __tablename__ = "recipes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # How many servings the whole recipe makes, which is what every per-serving
    # figure is divided by.
    yield_servings: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)
    updated_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)

    ingredients: Mapped[list["RecipeIngredient"]] = relationship(
        cascade="all, delete-orphan", order_by="RecipeIngredient.position"
    )


class RecipeIngredient(Base):
    """One food in a recipe, with what that much of it came to."""

    __tablename__ = "recipe_ingredients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipe_id: Mapped[int] = mapped_column(
        ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False
    )
    # SET NULL, like a diary entry's: deleting a food unlinks the ingredient
    # rather than taking the recipe's numbers with it.
    food_id: Mapped[int | None] = mapped_column(
        ForeignKey("foods.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    brand: Mapped[str] = mapped_column(String(120), nullable=False, default="")

    # How it was measured out, kept so the row can say "2 tbsp" rather than the
    # millilitres that came of it.
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(8), nullable=False)
    serving_label: Mapped[str | None] = mapped_column(String(60), nullable=True)
    # What that amount came to in the food's own base unit.
    base_amount: Mapped[float] = mapped_column(Float, nullable=False)

    # For the amount used, not per 100 of anything.
    calories: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbs_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    saturated_fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    trans_fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    cholesterol_mg: Mapped[float | None] = mapped_column(Float, nullable=True)
    sodium_mg: Mapped[float | None] = mapped_column(Float, nullable=True)
    fiber_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    sugar_g: Mapped[float | None] = mapped_column(Float, nullable=True)

    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class MealTemplate(Base):
    """Foods somebody eats together, kept so they log as one line."""

    __tablename__ = "meal_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)
    updated_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)

    items: Mapped[list["MealTemplateItem"]] = relationship(
        cascade="all, delete-orphan", order_by="MealTemplateItem.position"
    )


class MealTemplateItem(Base):
    """One thing in a kept meal: a food and how much of it.

    No panel of its own. A meal is a list of things, and each of them takes its
    numbers from the food as it stands when the meal is read or logged.
    """

    __tablename__ = "meal_template_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    meal_id: Mapped[int] = mapped_column(
        ForeignKey("meal_templates.id", ondelete="CASCADE"), nullable=False
    )
    food_id: Mapped[int | None] = mapped_column(
        ForeignKey("foods.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    brand: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(8), nullable=False)
    serving_label: Mapped[str | None] = mapped_column(String(60), nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class SavedFood(Base):
    """A food somebody keeps to hand, so it is offered before it is searched for."""

    __tablename__ = "saved_foods"
    __table_args__ = (UniqueConstraint("user_id", "food_id", name="uq_saved_foods_user_food"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # CASCADE rather than SET NULL: a pin is a shortcut to a food, and a
    # shortcut to a food that is gone is nothing at all.
    food_id: Mapped[int] = mapped_column(
        ForeignKey("foods.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)


class KeptFood(Base):
    """A shared food somebody put on their own list of foods.

    A food in the Tare database belongs to nobody, so wanting it to hand is a
    thing the member keeps rather than a thing the food carries. The row is the
    whole answer: it exists, so the food is on their list.
    """

    __tablename__ = "kept_foods"
    __table_args__ = (UniqueConstraint("user_id", "food_id", name="uq_kept_foods_user_food"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # CASCADE, like a pin: a place on a list for a food that is gone is nothing.
    food_id: Mapped[int] = mapped_column(
        ForeignKey("foods.id", ondelete="CASCADE"), nullable=False
    )
    # What the list is ordered by, so the food somebody added last is the one
    # they see first.
    added_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)


class RepeatHidden(Base):
    """A food somebody took off their Repeat list and wants kept off.

    Eating it again does not bring it back; pinning it does, because a pin is
    the stronger word about the same food.
    """

    __tablename__ = "repeat_hidden"
    __table_args__ = (UniqueConstraint("user_id", "food_id", name="uq_repeat_hidden_user_food"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    food_id: Mapped[int] = mapped_column(
        ForeignKey("foods.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)


# What the energy equations need a sex for, and nothing else: they carry
# separate coefficients, and a member who would rather not say gets the fixed
# guideline targets instead.
SEXES = ("female", "male")

# How much somebody moves in an ordinary day, workouts left out of it. The
# multipliers live in app.health beside the equation they multiply.
ACTIVITY_LEVELS = ("not_much", "light", "moderate", "heavy")

# Whether the daily numbers are worked out, split by percentages somebody
# chose, or typed in as grams.
TARGET_MODES = ("auto", "pct", "grams")

# Where a weight reading came from. Manual always wins a day.
MEASUREMENT_SOURCES = ("manual", "ingest")

# How hard a logged workout was, which is what picks the value it is credited
# at. An activity offers only the ones it has a published value for.
EFFORTS = ("light", "moderate", "vigorous")



class HealthProfile(Base):
    """What tare needs to work out one member's own numbers.

    One row per account, the account's id as its key: a member has one set of
    details, not a list of them. Every field is optional because every one of
    them has a stated fallback, and a member who fills in nothing still gets
    the fixed guideline targets.
    """

    __tablename__ = "health_profiles"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    sex: Mapped[str | None] = mapped_column(
        Enum(*SEXES, name="health_sex", native_enum=False), nullable=True
    )
    height_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    activity_level: Mapped[str] = mapped_column(
        Enum(*ACTIVITY_LEVELS, name="health_activity", native_enum=False),
        nullable=False,
        default="not_much",
    )
    # How fast, in kilograms a week. Null is not "no goal rate": it is the
    # first step of whichever way the two weights point. The direction itself
    # is not stored, because the two weights already say it.
    rate_kg_per_week: Mapped[float | None] = mapped_column(Float, nullable=True)
    goal_weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    # What a day of movement is aimed at. Both carry a default rather than a
    # null, because a ring drawn against no goal has nothing to fill.
    exercise_minutes_goal: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    step_goal: Mapped[int] = mapped_column(Integer, nullable=False, default=8000)
    pregnant_or_breastfeeding: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    targets_mode: Mapped[str] = mapped_column(
        Enum(*TARGET_MODES, name="health_targets_mode", native_enum=False),
        nullable=False,
        default="auto",
    )
    manual_calories: Mapped[float | None] = mapped_column(Float, nullable=True)
    manual_protein_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    manual_carbs_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    manual_fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    # The percentage split, kept beside the grams so switching between the two
    # ways of setting them does not lose either one.
    manual_protein_pct: Mapped[int | None] = mapped_column(Integer, nullable=True)
    manual_carbs_pct: Mapped[int | None] = mapped_column(Integer, nullable=True)
    manual_fat_pct: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # When the estimate disclaimer was acknowledged. Null means never, and the
    # Targets page shows it.
    disclaimer_seen_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime, nullable=True)
    # The nudge keys this member has waved away, so one that keeps being true
    # is not said twice.
    dismissed_nudges: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)
    updated_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)


class WeightEntry(Base):
    """One day's reading: a weight, a body fat, or both.

    One row per day per account. A day holds a single reading because the day
    is what the trend is built from, and two readings for one day would make
    the trend depend on which of them arrived last.
    """

    __tablename__ = "weight_entries"
    __table_args__ = (
        UniqueConstraint("user_id", "date_for", name="uq_weight_entries_user_day"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    date_for: Mapped[dt.date] = mapped_column(Date, nullable=False, index=True)
    # Null on a day somebody read a body fat off the scale without weighing:
    # the row is the day, and every number on it is one that may be absent.
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    # What a scale reports beyond the weight. Null is a thing that was not
    # measured rather than none of it.
    body_fat_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    body_water_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Muscle and bone as a share of the weight, the way bioimpedance scales
    # report them. A mass typed in is turned into a share before it is stored.
    muscle_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    bone_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(
        Enum(*MEASUREMENT_SOURCES, name="measurement_source", native_enum=False),
        nullable=False,
        default="manual",
    )
    # Set only on a weigh-in a file brought in. The source above still reads
    # "ingest", because that is what it is; this is what takes it away again.
    via: Mapped[str | None] = mapped_column(String(8), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)


class ExerciseEntry(Base):
    """One workout somebody typed in, with what it was credited at.

    The value, the weight and the calories are copied onto the row the moment
    it is logged, for the reason a diary entry copies its panel: a later weigh
    in corrects what happens next, not what already happened.
    """

    __tablename__ = "exercise_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    date_for: Mapped[dt.date] = mapped_column(Date, nullable=False, index=True)
    activity: Mapped[str] = mapped_column(String(40), nullable=False)
    effort: Mapped[str] = mapped_column(
        Enum(*EFFORTS, name="exercise_effort", native_enum=False), nullable=False
    )
    minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    met: Mapped[float] = mapped_column(Float, nullable=False)
    weight_kg: Mapped[float] = mapped_column(Float, nullable=False)
    kcal: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)


# Where a workout came from. A phone's own export, the Android bridge, a file
# somebody uploaded, or somebody typing it in.
WORKOUT_SOURCES = ("apple", "hc", "manual", "upload")

# Which dialect one sync spoke, kept on the log so a sync that went wrong can
# be told apart from one that never arrived. An upload says so instead of
# naming its dialect, and a wipe is the record of numbers being taken away.
INGEST_DIALECTS = ("hae", "hc", "upload", "wipe")

# How a fitness row got here: a phone posting to the sync address, or a file
# somebody picked. Carried on every table an upload writes so an upload can be
# taken back out again without touching a single thing a phone sent.
FITNESS_SOURCES = ("sync", "upload")


class FitnessDaily(Base):
    """One metric's figure for one day, whatever the metric is.

    Deliberately generic: a phone exports far more than this app draws, and a
    reading that is thrown away on the way in can never be shown later. So
    every metric a sync carries is written here under the name the exporter
    used, and the screens read the few they know about.

    `fields` is for the readings that are not one number: a night's sleep in
    its stages, a blood pressure, a heart rate summary. `value` then holds the
    headline of it, or nothing when there is no single number to name.
    """

    __tablename__ = "fitness_daily"
    __table_args__ = (
        UniqueConstraint("user_id", "date_for", "metric", name="uq_fitness_daily_day_metric"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    date_for: Mapped[dt.date] = mapped_column(Date, nullable=False, index=True)
    metric: Mapped[str] = mapped_column(String(60), nullable=False)
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    fields: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # Which way in wrote it. See FITNESS_SOURCES.
    source: Mapped[str] = mapped_column(String(8), nullable=False, default="sync")


class FitnessIntraday(Base):
    """One metric's figure for one hour of one day, for the hour bars.

    Only the four the bars are drawn from. Every metric is kept by the day
    above; keeping every metric by the hour as well would be a table of
    readings nothing reads.
    """

    __tablename__ = "fitness_intraday"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "date_for", "metric", "hour", name="uq_fitness_intraday_hour"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    date_for: Mapped[dt.date] = mapped_column(Date, nullable=False, index=True)
    metric: Mapped[str] = mapped_column(String(30), nullable=False)
    # The hour where the member was, not where the server is.
    hour: Mapped[int] = mapped_column(Integer, nullable=False)
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    source: Mapped[str] = mapped_column(String(8), nullable=False, default="sync")


class Workout(Base):
    """A session that arrived from a phone, or one that was typed in.

    Everything is stored the way the arithmetic wants it, in metres and
    kilograms, and turned into the member's own units on the way to a screen.
    """

    __tablename__ = "workouts"
    __table_args__ = (
        UniqueConstraint("user_id", "external_id", name="uq_workouts_user_external"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The exporter's own id when it sends one. It is what makes a resend of the
    # same window land on the rows it already wrote.
    external_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    activity: Mapped[str] = mapped_column(String(80), nullable=False)
    started_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, index=True)
    ended_at: Mapped[dt.datetime | None] = mapped_column(UtcDateTime, nullable=True)
    # The day the session started on where the member was, which is the day it
    # is credited to. Kept rather than worked out on every read: an instant
    # says nothing about anybody's day on its own.
    date_for: Mapped[dt.date] = mapped_column(Date, nullable=False, index=True)
    duration_s: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    kcal: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_hr: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_hr: Mapped[int | None] = mapped_column(Integer, nullable=True)
    elevation_gain_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    indoor: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Nothing reads this yet. The column is here because the feed it belongs to
    # is the next round, and a member's answer about one workout should not
    # wait on it.
    hidden_from_feed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    source: Mapped[str] = mapped_column(
        Enum(*WORKOUT_SOURCES, name="workout_source", native_enum=False), nullable=False
    )
    # What looked wrong about it. A flag is never a refusal: the session
    # happened, and a number that reads oddly is still the number the watch
    # reported.
    flags: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)


class WorkoutRoute(Base):
    """The line one workout drew, with both its ends thrown away.

    A raw trace starts and ends where somebody lives, so what is stored here
    never can: see app.routemaps for the trimming, which happens once, on the
    way in, and is never undone.
    """

    __tablename__ = "workout_routes"

    workout_id: Mapped[int] = mapped_column(
        ForeignKey("workouts.id", ondelete="CASCADE"), primary_key=True
    )
    points: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list)


class WorkoutSample(Base):
    """One minute of one session, as the export described it.

    Every reading is optional: the arrays a phone sends start and stop at their
    own moments, and a strap that slipped sends heart rate for half a walk and
    distance for all of it.
    """

    __tablename__ = "workout_samples"
    __table_args__ = (
        UniqueConstraint("workout_id", "minute", name="uq_workout_samples_minute"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    workout_id: Mapped[int] = mapped_column(
        ForeignKey("workouts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    minute: Mapped[int] = mapped_column(Integer, nullable=False)
    distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    hr_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hr_avg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hr_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kcal: Mapped[float | None] = mapped_column(Float, nullable=True)
    steps: Mapped[int | None] = mapped_column(Integer, nullable=True)


class IngestLog(Base):
    """That a sync happened, and how it went. Never what was in it.

    There is no payload column and there never will be one: a health export is
    the most personal thing this app is ever handed, and the rows it becomes
    are the only copy worth keeping. What is here is the counting, so a sync
    that quietly dropped half an export can be told apart from one that had
    nothing to bring.
    """

    __tablename__ = "ingest_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    received_at: Mapped[dt.datetime] = mapped_column(UtcDateTime, nullable=False, default=now_utc)
    dialect: Mapped[str] = mapped_column(
        Enum(*INGEST_DIALECTS, name="ingest_dialect", native_enum=False), nullable=False
    )
    items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    accepted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    flagged: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # How large the file was. Only an upload has one, and it is the size of the
    # body rather than anything out of it.
    bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # The first thing that could not be read, and why. One line, no payload.
    error: Mapped[str | None] = mapped_column(String(200), nullable=True)
