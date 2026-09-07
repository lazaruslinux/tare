"""A picture of the finished dish on a recipe and on a kept meal.

Only a food carried a photo until now. A recipe and a meal each get one of
their own, taken by whoever made it, and it is private to them: nothing about
it goes near the review queue. The photo rows are the ones already there, with
a third purpose beside the front of a pack and the nutrition panel.

Revision ID: 0038_dish_photos
Revises: 0037_friends
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0038_dish_photos"
down_revision: str | None = "0037_friends"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}

# The purpose column holds words rather than a database enum, and the longest
# of them is still "front", so a third one needs no change to it here.
DISHES = ("recipes", "meal_templates")


def upgrade() -> None:
    # SET NULL, like the panel a food keeps: a picture swept off the disk
    # leaves the recipe or the meal standing.
    for table in DISHES:
        with op.batch_alter_table(table, naming_convention=NAMING) as batch:
            batch.add_column(sa.Column("photo_id", sa.Integer(), nullable=True))
            batch.create_foreign_key(
                f"fk_{table}_photo_id",
                "food_photos",
                ["photo_id"],
                ["id"],
                ondelete="SET NULL",
            )


def downgrade() -> None:
    for table in DISHES:
        with op.batch_alter_table(table, naming_convention=NAMING) as batch:
            batch.drop_constraint(f"fk_{table}_photo_id", type_="foreignkey")
            batch.drop_column("photo_id")
