"""Two goals for a day of movement: minutes and steps.

Both are stored with a default rather than left null, because each is drawn as
a ring and a ring with nothing to fill is not a goal anybody set. The steps one
is written now and read from a device later, so the column is here before the
number that fills it.

Revision ID: 0013_activity_goals
Revises: 0012_goal_rate
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0013_activity_goals"
down_revision: str | None = "0012_goal_rate"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}

DEFAULT_MINUTES = "30"
DEFAULT_STEPS = "8000"


def upgrade() -> None:
    with op.batch_alter_table("health_profiles", naming_convention=NAMING) as batch:
        batch.add_column(
            sa.Column(
                "exercise_minutes_goal",
                sa.Integer(),
                nullable=False,
                server_default=DEFAULT_MINUTES,
            )
        )
        batch.add_column(
            sa.Column(
                "step_goal", sa.Integer(), nullable=False, server_default=DEFAULT_STEPS
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("health_profiles", naming_convention=NAMING) as batch:
        batch.drop_column("step_goal")
        batch.drop_column("exercise_minutes_goal")
