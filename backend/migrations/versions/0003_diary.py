"""The diary, and the foods somebody keeps to hand.

Revision ID: 0003_diary
Revises: 0002_foods
"""

import sqlalchemy as sa
from alembic import op

from app.models import DIARY_SLOTS, UtcDateTime

revision: str = "0003_diary"
down_revision: str | None = "0002_foods"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "diary_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("date_for", sa.Date(), nullable=False),
        sa.Column(
            "slot",
            sa.Enum(*DIARY_SLOTS, name="diary_slot", native_enum=False),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("brand", sa.String(length=120), nullable=False, server_default=""),
        # SET NULL: a deleted food unlinks the meals it was part of; it does
        # not take them with it.
        sa.Column(
            "food_id",
            sa.Integer(),
            sa.ForeignKey("foods.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("amount", sa.Float(), nullable=True),
        sa.Column("unit", sa.String(length=8), nullable=True),
        sa.Column("serving_label", sa.String(length=60), nullable=True),
        # For the amount served, not per 100 of anything.
        sa.Column("calories", sa.Float(), nullable=True),
        sa.Column("protein_g", sa.Float(), nullable=True),
        sa.Column("carbs_g", sa.Float(), nullable=True),
        sa.Column("fat_g", sa.Float(), nullable=True),
        sa.Column("saturated_fat_g", sa.Float(), nullable=True),
        sa.Column("trans_fat_g", sa.Float(), nullable=True),
        sa.Column("cholesterol_mg", sa.Float(), nullable=True),
        sa.Column("sodium_mg", sa.Float(), nullable=True),
        sa.Column("fiber_g", sa.Float(), nullable=True),
        sa.Column("sugar_g", sa.Float(), nullable=True),
        sa.Column("created_at", UtcDateTime(), nullable=False),
    )
    op.create_index("ix_diary_entries_user_id", "diary_entries", ["user_id"])
    op.create_index("ix_diary_entries_date_for", "diary_entries", ["date_for"])
    op.create_index("ix_diary_entries_food_id", "diary_entries", ["food_id"])

    op.create_table(
        "saved_foods",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "food_id",
            sa.Integer(),
            sa.ForeignKey("foods.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", UtcDateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "food_id", name="uq_saved_foods_user_food"),
    )
    op.create_index("ix_saved_foods_user_id", "saved_foods", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_saved_foods_user_id", table_name="saved_foods")
    op.drop_table("saved_foods")
    op.drop_index("ix_diary_entries_food_id", table_name="diary_entries")
    op.drop_index("ix_diary_entries_date_for", table_name="diary_entries")
    op.drop_index("ix_diary_entries_user_id", table_name="diary_entries")
    op.drop_table("diary_entries")
