"""Which aisle a shared food would be found in.

The database is read the way somebody shops: produce, then meat, then the
freezer. That is a fixed list rather than free text, so the column holds the
slug and the words beside it live on the screens.

Every row already there is put in Other for a reviewer to sort, which is what
the default is for, and the default comes off once they all have one.

Revision ID: 0023_food_section
Revises: 0022_share_workouts
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0023_food_section"
down_revision: str | None = "0022_share_workouts"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}


def upgrade() -> None:
    with op.batch_alter_table("foods", naming_convention=NAMING) as batch:
        batch.add_column(
            sa.Column("section", sa.String(length=32), nullable=False, server_default="other")
        )
    with op.batch_alter_table("foods", naming_convention=NAMING) as batch:
        batch.alter_column("section", existing_type=sa.String(length=32), server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("foods", naming_convention=NAMING) as batch:
        batch.drop_column("section")
