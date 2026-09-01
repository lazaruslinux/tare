"""One open request of each kind per person per shared food.

Revision ID: 0005_moderation
Revises: 0004_submissions
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0005_moderation"
down_revision: str | None = "0004_submissions"
branch_labels = None
depends_on = None

# Corrections and pictures both point at a food that is already shared, and
# nobody may have two of the same kind waiting on the same food. Partial, like
# the indexes 0004 declared: a decided request is history and does not stand in
# the way of the next one, and the kinds with no target are not held to this.
WHERE = "status = 'pending' AND target_food_id IS NOT NULL"


def upgrade() -> None:
    op.create_index(
        "uq_food_submissions_open_target",
        "food_submissions",
        ["submitted_by_id", "target_food_id", "kind"],
        unique=True,
        postgresql_where=sa.text(WHERE),
        sqlite_where=sa.text(WHERE),
    )


def downgrade() -> None:
    op.drop_index("uq_food_submissions_open_target", table_name="food_submissions")
