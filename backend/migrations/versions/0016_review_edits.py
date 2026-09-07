"""What a reviewer changed before saying yes, and whether it has been read.

Three columns on food_submissions: whether the reviewer corrected the proposal
on the way through, the list of what they corrected, and when the submitter
looked at the decision, which is what the badge counts. The two that are never
null take a default so the rows already there have something, and the default
comes straight back off.

Revision ID: 0016_review_edits
Revises: 0015_food_description
"""

import sqlalchemy as sa
from alembic import op

from app.models import UtcDateTime

revision: str = "0016_review_edits"
down_revision: str | None = "0015_food_description"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}


def upgrade() -> None:
    with op.batch_alter_table("food_submissions", naming_convention=NAMING) as batch:
        batch.add_column(
            sa.Column("edited", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch.add_column(
            sa.Column("changes", sa.JSON(), nullable=False, server_default="[]")
        )
        batch.add_column(sa.Column("seen_at", UtcDateTime(), nullable=True))
    with op.batch_alter_table("food_submissions", naming_convention=NAMING) as batch:
        batch.alter_column("edited", existing_type=sa.Boolean(), server_default=None)
        batch.alter_column("changes", existing_type=sa.JSON(), server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("food_submissions", naming_convention=NAMING) as batch:
        batch.drop_column("seen_at")
        batch.drop_column("changes")
        batch.drop_column("edited")
