"""A serving remembers the unit it was typed in.

Two columns on food_servings: the amount as somebody typed it, and the unit
they typed it in. The base amount is left alone because every sum is worked out
from it; "1 block" is a pound of cheese, and reading that back as 453.592 g is
arithmetic nobody asked for. Rows written before this take the base amount and
their food's own base unit.

Revision ID: 0014_serving_unit
Revises: 0013_activity_goals
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0014_serving_unit"
down_revision: str | None = "0013_activity_goals"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}


def upgrade() -> None:
    # Added with a default so the existing rows have something before the
    # backfill, and the default comes straight back off once they do: a serving
    # of nothing is not a serving, and no column should be able to say it.
    with op.batch_alter_table("food_servings", naming_convention=NAMING) as batch:
        batch.add_column(sa.Column("amount", sa.Float(), nullable=False, server_default="0"))
        batch.add_column(
            sa.Column("unit", sa.String(length=8), nullable=False, server_default="g")
        )
    op.execute(
        "UPDATE food_servings SET amount = base_amount, "
        "unit = (SELECT foods.base_unit FROM foods WHERE foods.id = food_servings.food_id)"
    )
    with op.batch_alter_table("food_servings", naming_convention=NAMING) as batch:
        batch.alter_column("amount", existing_type=sa.Float(), server_default=None)
        batch.alter_column("unit", existing_type=sa.String(length=8), server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("food_servings", naming_convention=NAMING) as batch:
        batch.drop_column("unit")
        batch.drop_column("amount")
