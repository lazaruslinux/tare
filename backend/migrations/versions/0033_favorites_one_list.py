"""Favorites is the one saved list, and a recipe or a meal can be weighed.

Two lists said the same thing: a food kept on your own list, and a food
starred. Everything kept becomes a favorite, and the kept table goes. The copy
skips a food that is already starred, so nobody ends up with it twice.

The weight columns come with it: what the scale said when the pot was done,
which is what lets a recipe or a meal be logged by the gram.

Revision ID: 0033_favorites_one_list
Revises: 0032_reviewers
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0033_favorites_one_list"
down_revision: str | None = "0032_reviewers"
branch_labels = None
depends_on = None

# The date carries over as the date the food was kept, so the newest star is
# still the newest thing that happened.
COPY = """
INSERT INTO saved_foods (user_id, food_id, created_at)
SELECT k.user_id, k.food_id, k.added_at
FROM kept_foods AS k
WHERE NOT EXISTS (
  SELECT 1 FROM saved_foods AS s
  WHERE s.user_id = k.user_id AND s.food_id = k.food_id
)
"""


def upgrade() -> None:
    op.execute(sa.text(COPY))
    op.drop_index("ix_kept_foods_user_id", table_name="kept_foods")
    op.drop_table("kept_foods")

    with op.batch_alter_table("recipes") as batch:
        batch.add_column(sa.Column("final_weight_g", sa.Float(), nullable=True))
    with op.batch_alter_table("meal_templates") as batch:
        batch.add_column(sa.Column("final_weight_g", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("meal_templates") as batch:
        batch.drop_column("final_weight_g")
    with op.batch_alter_table("recipes") as batch:
        batch.drop_column("final_weight_g")

    # The table comes back empty. Which favorites were once kept rows is not
    # written down anywhere, so there is nothing honest to put back in it.
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
