"""The diary's link to a kept meal, so a meal is one line rather than five.

A meal was logged as an entry per food in it, which buried a breakfast in the
day it was part of. It is one row now, counted in servings of the whole thing,
the way a recipe already was. Nothing already written is touched: the rows an
older log made are ordinary entries and stay as they are.

Revision ID: 0031_meal_entries
Revises: 0030_added_sugars
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0031_meal_entries"
down_revision: str | None = "0030_added_sugars"
branch_labels = None
depends_on = None

# What to call a constraint that was never named, for the same reason the
# recipe link needed it: SQLite copies the table rather than altering it.
NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}


def upgrade() -> None:
    # SET NULL: deleting a meal leaves what was eaten of it standing, with the
    # numbers it was logged at.
    with op.batch_alter_table("diary_entries", naming_convention=NAMING) as batch:
        batch.add_column(
            sa.Column(
                "meal_id",
                sa.Integer(),
                sa.ForeignKey(
                    "meal_templates.id", ondelete="SET NULL", name="fk_diary_entries_meal_id"
                ),
                nullable=True,
            )
        )
    op.create_index("ix_diary_entries_meal_id", "diary_entries", ["meal_id"])


def downgrade() -> None:
    op.drop_index("ix_diary_entries_meal_id", table_name="diary_entries")
    with op.batch_alter_table("diary_entries", naming_convention=NAMING) as batch:
        batch.drop_column("meal_id")
