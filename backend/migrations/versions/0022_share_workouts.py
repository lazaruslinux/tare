"""One switch over all of a member's workouts.

The feed shares workouts by default, and a member who would rather keep every
session to themselves should not have to hide them one page at a time. True
rather than null, so every row made before this reads as the default the feed
already worked by, and the default comes off once every row has one.

Revision ID: 0022_share_workouts
Revises: 0021_profile_sharing
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0022_share_workouts"
down_revision: str | None = "0021_profile_sharing"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}


def upgrade() -> None:
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        batch.add_column(
            sa.Column("share_workouts", sa.Boolean(), nullable=False, server_default=sa.true())
        )
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        batch.alter_column("share_workouts", existing_type=sa.Boolean(), server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        batch.drop_column("share_workouts")
