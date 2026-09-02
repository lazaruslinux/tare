"""Muscle and bone as a share of the weight, the way scales report them.

Revision ID: 0010_measurement_pcts
Revises: 0009_targets_modes
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0010_measurement_pcts"
down_revision: str | None = "0009_targets_modes"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}


def upgrade() -> None:
    with op.batch_alter_table("weight_entries", naming_convention=NAMING) as batch:
        batch.add_column(sa.Column("muscle_pct", sa.Float(), nullable=True))
        batch.add_column(sa.Column("bone_pct", sa.Float(), nullable=True))
    # A mass already recorded becomes the share it was of that day's weight.
    op.execute(
        "UPDATE weight_entries SET muscle_pct = muscle_kg / weight_kg * 100 "
        "WHERE muscle_kg IS NOT NULL AND weight_kg > 0"
    )
    op.execute(
        "UPDATE weight_entries SET bone_pct = bone_kg / weight_kg * 100 "
        "WHERE bone_kg IS NOT NULL AND weight_kg > 0"
    )
    with op.batch_alter_table("weight_entries", naming_convention=NAMING) as batch:
        batch.drop_column("muscle_kg")
        batch.drop_column("bone_kg")


def downgrade() -> None:
    with op.batch_alter_table("weight_entries", naming_convention=NAMING) as batch:
        batch.add_column(sa.Column("muscle_kg", sa.Float(), nullable=True))
        batch.add_column(sa.Column("bone_kg", sa.Float(), nullable=True))
    op.execute(
        "UPDATE weight_entries SET muscle_kg = muscle_pct / 100 * weight_kg "
        "WHERE muscle_pct IS NOT NULL"
    )
    op.execute(
        "UPDATE weight_entries SET bone_kg = bone_pct / 100 * weight_kg WHERE bone_pct IS NOT NULL"
    )
    with op.batch_alter_table("weight_entries", naming_convention=NAMING) as batch:
        batch.drop_column("muscle_pct")
        batch.drop_column("bone_pct")
