"""Foods and their named servings.

Revision ID: 0002_foods
Revises: 0001_identity
"""

import sqlalchemy as sa
from alembic import op

from app.models import FOOD_STATUSES, UtcDateTime

revision: str = "0002_foods"
down_revision: str | None = "0001_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "foods",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "status",
            sa.Enum(*FOOD_STATUSES, name="food_status", native_enum=False),
            nullable=False,
            server_default="custom",
        ),
        sa.Column(
            "owner_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("barcode", sa.String(length=32), nullable=True),
        sa.Column("source", sa.String(length=8), nullable=False, server_default="user"),
        sa.Column("source_id", sa.String(length=64), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("brand", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("base_unit", sa.String(length=2), nullable=False, server_default="g"),
        sa.Column("density_g_per_ml", sa.Float(), nullable=True),
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
        sa.Column("ingredients_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("fetched_at", UtcDateTime(), nullable=True),
        sa.Column("created_at", UtcDateTime(), nullable=False),
    )
    op.create_index("ix_foods_owner_id", "foods", ["owner_id"])
    op.create_index("ix_foods_barcode", "foods", ["barcode"])
    # Partial, so only the shared database is held to one row per barcode.
    # Private copies of the same product, one per account, are not a conflict.
    op.create_index(
        "uq_foods_barcode_approved",
        "foods",
        ["barcode"],
        unique=True,
        postgresql_where=sa.text("status = 'approved'"),
        sqlite_where=sa.text("status = 'approved'"),
    )

    op.create_table(
        "food_servings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "food_id",
            sa.Integer(),
            sa.ForeignKey("foods.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("base_amount", sa.Float(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_food_servings_food_id", "food_servings", ["food_id"])


def downgrade() -> None:
    op.drop_index("ix_food_servings_food_id", table_name="food_servings")
    op.drop_table("food_servings")
    op.drop_index("uq_foods_barcode_approved", table_name="foods")
    op.drop_index("ix_foods_barcode", table_name="foods")
    op.drop_index("ix_foods_owner_id", table_name="foods")
    op.drop_table("foods")
