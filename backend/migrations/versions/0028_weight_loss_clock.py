"""A weigh-in that came in lower, and which clock an account reads.

Both columns are added under accounts that already exist, so both start at the
answer nobody has to be asked for. Sharing a loss is opt in, like every other
switch on that screen: what somebody weighs is the most private thing here, and
a column added under people cannot start by announcing anything about it. The
clock starts at twelve hours, which is what every account here reads today.

Revision ID: 0028_weight_loss_clock
Revises: 0027_avatars
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0028_weight_loss_clock"
down_revision: str | None = "0027_avatars"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}


def upgrade() -> None:
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        batch.add_column(
            sa.Column("share_weight_loss", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch.add_column(
            sa.Column("clock", sa.String(length=4), nullable=False, server_default="12h")
        )
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        batch.alter_column("share_weight_loss", existing_type=sa.Boolean(), server_default=None)
        batch.alter_column("clock", existing_type=sa.String(length=4), server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        batch.drop_column("clock")
        batch.drop_column("share_weight_loss")
