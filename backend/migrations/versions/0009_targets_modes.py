"""Two ways of setting the daily split by hand, not one.

Revision ID: 0009_targets_modes
Revises: 0008_repeat_hidden
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0009_targets_modes"
down_revision: str | None = "0008_repeat_hidden"
branch_labels = None
depends_on = None

# SQLite has no ALTER for a column type, so the batch below copies the table,
# and a copy cannot carry across a constraint it has no name for.
NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}

MODES = sa.Enum("auto", "pct", "grams", name="health_targets_mode", native_enum=False)
OLD_MODES = sa.Enum("auto", "manual", name="health_targets_mode", native_enum=False)


def upgrade() -> None:
    # The mode that used to be called manual is the grams one, said plainly.
    op.execute("UPDATE health_profiles SET targets_mode = 'grams' WHERE targets_mode = 'manual'")
    with op.batch_alter_table("health_profiles", naming_convention=NAMING) as batch:
        batch.alter_column(
            "targets_mode", existing_type=OLD_MODES, type_=MODES, existing_nullable=False
        )
        batch.add_column(sa.Column("manual_protein_pct", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("manual_carbs_pct", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("manual_fat_pct", sa.Integer(), nullable=True))


def downgrade() -> None:
    # A percentage split has no grams behind it, so it goes back to automatic
    # rather than to a hand-set row with nothing in it.
    op.execute("UPDATE health_profiles SET targets_mode = 'auto' WHERE targets_mode = 'pct'")
    op.execute("UPDATE health_profiles SET targets_mode = 'manual' WHERE targets_mode = 'grams'")
    with op.batch_alter_table("health_profiles", naming_convention=NAMING) as batch:
        batch.drop_column("manual_fat_pct")
        batch.drop_column("manual_carbs_pct")
        batch.drop_column("manual_protein_pct")
        batch.alter_column(
            "targets_mode", existing_type=MODES, type_=OLD_MODES, existing_nullable=False
        )
