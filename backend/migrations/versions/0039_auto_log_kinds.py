"""An auto-log about a recipe or a kept meal, not only about a food.

The instruction was always a food and a portion of it. It is now any one of the
three things this app logs, so the food column lets go of NOT NULL and two more
join it, with a check holding a row to exactly one of them and a unique pair
each, the way the food already had. Rows already there are food rows and are
left alone.

Revision ID: 0039_auto_log_kinds
Revises: 0038_dish_photos
"""

import sqlalchemy as sa
from alembic import op

from app.models import ONE_AUTO_LOG_KIND

revision: str = "0039_auto_log_kinds"
down_revision: str | None = "0038_dish_photos"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}


def upgrade() -> None:
    # CASCADE on both, like the food: an instruction to log something that is
    # gone is nothing.
    with op.batch_alter_table("auto_logs", naming_convention=NAMING) as batch:
        batch.alter_column("food_id", existing_type=sa.Integer(), nullable=True)
        batch.add_column(sa.Column("recipe_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("meal_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_auto_logs_recipe_id", "recipes", ["recipe_id"], ["id"], ondelete="CASCADE"
        )
        batch.create_foreign_key(
            "fk_auto_logs_meal_id",
            "meal_templates",
            ["meal_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch.create_unique_constraint(
            "uq_auto_logs_user_recipe_slot", ["user_id", "recipe_id", "slot"]
        )
        batch.create_unique_constraint(
            "uq_auto_logs_user_meal_slot", ["user_id", "meal_id", "slot"]
        )
        batch.create_check_constraint("ck_auto_logs_one_kind", sa.text(ONE_AUTO_LOG_KIND))


def downgrade() -> None:
    with op.batch_alter_table("auto_logs", naming_convention=NAMING) as batch:
        batch.drop_constraint("ck_auto_logs_one_kind", type_="check")
        batch.drop_constraint("uq_auto_logs_user_meal_slot", type_="unique")
        batch.drop_constraint("uq_auto_logs_user_recipe_slot", type_="unique")
        batch.drop_constraint("fk_auto_logs_meal_id", type_="foreignkey")
        batch.drop_constraint("fk_auto_logs_recipe_id", type_="foreignkey")
        batch.drop_column("meal_id")
        batch.drop_column("recipe_id")
        batch.alter_column("food_id", existing_type=sa.Integer(), nullable=False)
