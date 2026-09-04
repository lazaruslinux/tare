"""The foods a member keeps on their own list.

One table. A food in the shared database belongs to nobody, so a member wanting
it among their own foods is a row of theirs rather than anything on the food.

The backfill writes what the old list worked out on the fly: everybody who
offered a food that was approved already had it on their list, so each of those
becomes a kept row, dated the day it was decided.

Revision ID: 0026_kept_foods
Revises: 0025_auto_logs
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0026_kept_foods"
down_revision: str | None = "0025_auto_logs"
branch_labels = None
depends_on = None

# One row per person per food, so the newest decision is the date it carries.
BACKFILL = """
INSERT INTO kept_foods (user_id, food_id, added_at)
SELECT s.submitted_by_id, s.food_id, MAX(COALESCE(s.decided_at, s.created_at))
FROM food_submissions AS s
JOIN foods AS f ON f.id = s.food_id
WHERE s.kind = 'new'
  AND s.status = 'approved'
  AND s.submitted_by_id IS NOT NULL
  AND f.status = 'approved'
GROUP BY s.submitted_by_id, s.food_id
"""


def upgrade() -> None:
    op.create_table(
        "kept_foods",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("food_id", sa.Integer(), nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_kept_foods_user_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["food_id"], ["foods.id"], name="fk_kept_foods_food_id", ondelete="CASCADE"
        ),
        sa.UniqueConstraint("user_id", "food_id", name="uq_kept_foods_user_food"),
    )
    op.create_index("ix_kept_foods_user_id", "kept_foods", ["user_id"])
    op.execute(sa.text(BACKFILL))


def downgrade() -> None:
    op.drop_index("ix_kept_foods_user_id", table_name="kept_foods")
    op.drop_table("kept_foods")
