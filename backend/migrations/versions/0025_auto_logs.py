"""A food that logs itself into the same meal every day.

Two tables and one column: the standing instruction, being a portion, a meal
and the first day it counts from; the days it has already written, so an entry
somebody deleted is not written again tomorrow; and a mark on the entry saying
which instruction wrote it. The mark lets go rather than cascading, so turning
an auto-log off leaves the days already eaten as they were.

Revision ID: 0025_auto_logs
Revises: 0024_journal_days
"""

import sqlalchemy as sa
from alembic import op

from app.models import DIARY_SLOTS

revision: str = "0025_auto_logs"
down_revision: str | None = "0024_journal_days"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}


def upgrade() -> None:
    op.create_table(
        "auto_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("food_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        # Wide enough for "serving:" and an id, which is the longest a portion
        # is ever written as.
        sa.Column("unit", sa.String(length=24), nullable=False),
        sa.Column(
            "slot",
            sa.Enum(*DIARY_SLOTS, name="diary_slot", native_enum=False),
            nullable=False,
        ),
        sa.Column("started_on", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_auto_logs_user_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["food_id"], ["foods.id"], name="fk_auto_logs_food_id", ondelete="CASCADE"
        ),
        sa.UniqueConstraint("user_id", "food_id", "slot", name="uq_auto_logs_user_food_slot"),
    )
    op.create_index("ix_auto_logs_user_id", "auto_logs", ["user_id"])

    op.create_table(
        "auto_log_days",
        sa.Column("auto_log_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.ForeignKeyConstraint(
            ["auto_log_id"],
            ["auto_logs.id"],
            name="fk_auto_log_days_auto_log_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("auto_log_id", "date"),
    )

    with op.batch_alter_table("diary_entries", naming_convention=NAMING) as batch:
        batch.add_column(sa.Column("auto_log_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_diary_entries_auto_log_id",
            "auto_logs",
            ["auto_log_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index("ix_diary_entries_auto_log_id", "diary_entries", ["auto_log_id"])


def downgrade() -> None:
    op.drop_index("ix_diary_entries_auto_log_id", table_name="diary_entries")
    with op.batch_alter_table("diary_entries", naming_convention=NAMING) as batch:
        batch.drop_constraint("fk_diary_entries_auto_log_id", type_="foreignkey")
        batch.drop_column("auto_log_id")
    op.drop_table("auto_log_days")
    op.drop_index("ix_auto_logs_user_id", table_name="auto_logs")
    op.drop_table("auto_logs")
