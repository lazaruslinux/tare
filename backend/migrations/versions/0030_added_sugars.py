"""The sugars that were put in, kept apart from the sugars that were there.

A label prints total sugars and, under it, how much of that was added. The two
answer different questions, and only the second is the one worth watching, so
it gets its own column rather than being guessed at from the first.

Null on everything already here: a food nobody has read the added-sugars line
off is a food with no answer, which is not the same as none.

Revision ID: 0030_added_sugars
Revises: 0029_biometrics_split
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0030_added_sugars"
down_revision: str | None = "0029_biometrics_split"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}


def upgrade() -> None:
    with op.batch_alter_table("foods", naming_convention=NAMING) as batch:
        batch.add_column(sa.Column("added_sugars_g", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("foods", naming_convention=NAMING) as batch:
        batch.drop_column("added_sugars_g")
