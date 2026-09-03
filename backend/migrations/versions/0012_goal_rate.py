"""A goal rate in kilograms a week, and no stored goal to go with it.

The direction is read off the latest weigh-in and the goal weight, so the goal
column has nothing left to say. The paces that were words become the three
numbers the stepper offers: gentle and steady both land on the slowest of them,
which is the nearest honest reading of a pace picked under the old table.

Revision ID: 0012_goal_rate
Revises: 0011_photo_purposes
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0012_goal_rate"
down_revision: str | None = "0011_photo_purposes"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}

GOALS = sa.Enum("maintain", "lose", "gain", name="health_goal", native_enum=False)
RATES = sa.Enum("gentle", "steady", "faster", "fastest", name="health_rate", native_enum=False)

BACKFILL = {"gentle": 0.45, "steady": 0.45, "faster": 0.7, "fastest": 0.9}
RESTORE = {0.45: "steady", 0.7: "faster", 0.9: "fastest", 0.25: "gentle"}


def upgrade() -> None:
    with op.batch_alter_table("health_profiles", naming_convention=NAMING) as batch:
        batch.add_column(sa.Column("rate_kg_per_week", sa.Float(), nullable=True))
    for name, kg in BACKFILL.items():
        op.execute(
            f"UPDATE health_profiles SET rate_kg_per_week = {kg} WHERE rate = '{name}'"
        )
    with op.batch_alter_table("health_profiles", naming_convention=NAMING) as batch:
        batch.drop_column("rate")
        batch.drop_column("goal")


def downgrade() -> None:
    with op.batch_alter_table("health_profiles", naming_convention=NAMING) as batch:
        batch.add_column(
            sa.Column("goal", GOALS, nullable=False, server_default="maintain")
        )
        batch.add_column(sa.Column("rate", RATES, nullable=True))
    # The goal cannot come back: it was derived from the two weights, and
    # every row goes back as maintaining rather than as a guess.
    for kg, name in RESTORE.items():
        op.execute(
            f"UPDATE health_profiles SET rate = '{name}' WHERE rate_kg_per_week = {kg}"
        )
    with op.batch_alter_table("health_profiles", naming_convention=NAMING) as batch:
        batch.drop_column("rate_kg_per_week")
