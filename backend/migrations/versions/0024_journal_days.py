"""A day somebody marked complete, and whether saying so reaches the feed.

The table holds nothing but the fact: one row a member a day, and the row
existing is what "complete" means, so unlocking deletes it rather than setting a
flag back. The switch beside it is off for everybody already here, because a
column added under people cannot start by announcing the most private thing in
the app.

Revision ID: 0024_journal_days
Revises: 0023_food_section
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0024_journal_days"
down_revision: str | None = "0023_food_section"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}


def upgrade() -> None:
    op.create_table(
        "journal_days",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_journal_days_user_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "date"),
    )
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        batch.add_column(
            sa.Column("share_journal", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        batch.alter_column("share_journal", existing_type=sa.Boolean(), server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        batch.drop_column("share_journal")
    op.drop_table("journal_days")
