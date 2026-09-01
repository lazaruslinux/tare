"""The tables: accounts, the tokens that let someone in, and the foods."""

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
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    units: Mapped[str] = mapped_column(String(16), nullable=False, default="imperial")
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    feed_hidden: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list)
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

    ingredients_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
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
    # In the food's own base unit, never in the unit the label printed: a
    # serving is the one measurement that never has to be converted.
    base_amount: Mapped[float] = mapped_column(Float, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
