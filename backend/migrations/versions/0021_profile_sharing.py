"""The three facts a member may let other members see.

Age, sex and where somebody lives, each its own answer and each off until it
is turned on. Nothing else about an account is ever shown to another member,
so there is no fourth column here waiting to be filled in.

False rather than null, so a row made before this existed reads as a decision
already taken, and the default comes off once every row has one.

Revision ID: 0021_profile_sharing
Revises: 0020_food_label_photo
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0021_profile_sharing"
down_revision: str | None = "0020_food_label_photo"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}

SHARED = ("share_age", "share_sex", "share_location")


def upgrade() -> None:
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        for name in SHARED:
            batch.add_column(
                sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.false())
            )
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        for name in SHARED:
            batch.alter_column(name, existing_type=sa.Boolean(), server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        for name in SHARED:
            batch.drop_column(name)
