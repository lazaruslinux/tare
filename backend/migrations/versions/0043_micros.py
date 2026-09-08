"""The vitamins and minerals a food carries, and the matches waiting on a pick.

Three columns on foods: the readings themselves, who supplied them, and the
record they came out of. One table beside it for the foods that have no barcode
to match on, where the only way to a reading is somebody choosing between
candidates FoodData Central offered.

Revision ID: 0043_micros
Revises: 0042_ingest_log_days_workouts
"""

import sqlalchemy as sa
from alembic import op

from app.models import MICRO_MATCH_STATUSES

revision: str = "0043_micros"
down_revision: str | None = "0042_ingest_log_days_workouts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("foods") as batch:
        batch.add_column(sa.Column("micros", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("micros_source", sa.String(length=8), nullable=True))
        batch.add_column(sa.Column("micros_ref", sa.String(length=32), nullable=True))

    op.create_table(
        "micro_matches",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "food_id",
            sa.Integer(),
            sa.ForeignKey("foods.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("candidates", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column(
            "status",
            sa.Enum(*MICRO_MATCH_STATUSES, name="micro_match_status", native_enum=False),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "decided_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_micro_matches_food_id", "micro_matches", ["food_id"])
    # One waiting question per food, with the decided rows beside it, so the
    # uniqueness has to be partial.
    op.create_index(
        "uq_micro_matches_pending",
        "micro_matches",
        ["food_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
        sqlite_where=sa.text("status = 'pending'"),
    )


def downgrade() -> None:
    op.drop_index("uq_micro_matches_pending", table_name="micro_matches")
    op.drop_index("ix_micro_matches_food_id", table_name="micro_matches")
    op.drop_table("micro_matches")
    with op.batch_alter_table("foods") as batch:
        batch.drop_column("micros_ref")
        batch.drop_column("micros_source")
        batch.drop_column("micros")
