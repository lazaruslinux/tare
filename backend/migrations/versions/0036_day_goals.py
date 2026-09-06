"""A day of its own step and exercise goals.

The usual pair lives on the health profile and is what almost every day is
read against. This table is the exception: one row for a day somebody set
apart, and nothing at all for the days they did not. A null column means that
one figure is still the usual one, so a row never has to repeat a default it
would then be out of step with.

Revision ID: 0036_day_goals
Revises: 0035_first_run
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0036_day_goals"
down_revision: str | None = "0035_first_run"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "day_goals",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("step_goal", sa.Integer(), nullable=True),
        sa.Column("exercise_minutes_goal", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_day_goals_user_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "date"),
    )


def downgrade() -> None:
    op.drop_table("day_goals")
