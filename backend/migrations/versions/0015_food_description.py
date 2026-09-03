"""A few words for what a food is, beside its name and its brand.

A name and a brand do not tell two rows apart when the difference is the size
of the bar or which fruit it was made with. This is that line: "King Size",
"Blueberry flavor", short enough that it reads as part of a list row rather
than as a paragraph nobody finishes.

Empty rather than null, so nothing has to ask which kind of nothing it is, and
the default comes off once the existing rows have their empty string.

Revision ID: 0015_food_description
Revises: 0014_serving_unit
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0015_food_description"
down_revision: str | None = "0014_serving_unit"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}


def upgrade() -> None:
    with op.batch_alter_table("foods", naming_convention=NAMING) as batch:
        batch.add_column(
            sa.Column("description", sa.String(length=60), nullable=False, server_default="")
        )
    with op.batch_alter_table("foods", naming_convention=NAMING) as batch:
        batch.alter_column("description", existing_type=sa.String(length=60), server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("foods", naming_convention=NAMING) as batch:
        batch.drop_column("description")
