"""Recipes, the meals kept as lists, and the diary's link to a recipe.

Revision ID: 0006_recipes_meals
Revises: 0005_moderation
"""

import sqlalchemy as sa
from alembic import op

from app.models import UtcDateTime

revision: str = "0006_recipes_meals"
down_revision: str | None = "0005_moderation"
branch_labels = None
depends_on = None

# What to call a constraint that was never named. SQLite has no ALTER for one,
# so the batch below copies the table, and a copy cannot carry across a
# constraint it has no name for.
NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}


def upgrade() -> None:
    op.create_table(
        "recipes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("yield_servings", sa.Float(), nullable=False),
        sa.Column("created_at", UtcDateTime(), nullable=False),
        sa.Column("updated_at", UtcDateTime(), nullable=False),
    )
    op.create_index("ix_recipes_user_id", "recipes", ["user_id"])

    op.create_table(
        "recipe_ingredients",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "recipe_id",
            sa.Integer(),
            sa.ForeignKey("recipes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # SET NULL: a deleted food unlinks the ingredient; the recipe keeps the
        # numbers it was saved with.
        sa.Column(
            "food_id",
            sa.Integer(),
            sa.ForeignKey("foods.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("brand", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(length=8), nullable=False),
        sa.Column("serving_label", sa.String(length=60), nullable=True),
        sa.Column("base_amount", sa.Float(), nullable=False),
        # For the amount used, not per 100 of anything.
        sa.Column("calories", sa.Float(), nullable=True),
        sa.Column("protein_g", sa.Float(), nullable=True),
        sa.Column("carbs_g", sa.Float(), nullable=True),
        sa.Column("fat_g", sa.Float(), nullable=True),
        sa.Column("saturated_fat_g", sa.Float(), nullable=True),
        sa.Column("trans_fat_g", sa.Float(), nullable=True),
        sa.Column("cholesterol_mg", sa.Float(), nullable=True),
        sa.Column("sodium_mg", sa.Float(), nullable=True),
        sa.Column("fiber_g", sa.Float(), nullable=True),
        sa.Column("sugar_g", sa.Float(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_recipe_ingredients_food_id", "recipe_ingredients", ["food_id"])

    op.create_table(
        "meal_templates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("created_at", UtcDateTime(), nullable=False),
        sa.Column("updated_at", UtcDateTime(), nullable=False),
    )
    op.create_index("ix_meal_templates_user_id", "meal_templates", ["user_id"])

    op.create_table(
        "meal_template_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "meal_id",
            sa.Integer(),
            sa.ForeignKey("meal_templates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "food_id",
            sa.Integer(),
            sa.ForeignKey("foods.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("brand", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(length=8), nullable=False),
        sa.Column("serving_label", sa.String(length=60), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_meal_template_items_food_id", "meal_template_items", ["food_id"])

    # In batch, because SQLite cannot alter a constraint onto a table that is
    # already there and the batch copies it instead. SET NULL: deleting a
    # recipe leaves what was eaten of it standing, with the numbers it was
    # logged at.
    with op.batch_alter_table("diary_entries", naming_convention=NAMING) as batch:
        batch.add_column(
            sa.Column(
                "recipe_id",
                sa.Integer(),
                sa.ForeignKey(
                    "recipes.id", ondelete="SET NULL", name="fk_diary_entries_recipe_id"
                ),
                nullable=True,
            )
        )
    op.create_index("ix_diary_entries_recipe_id", "diary_entries", ["recipe_id"])


def downgrade() -> None:
    op.drop_index("ix_diary_entries_recipe_id", table_name="diary_entries")
    with op.batch_alter_table("diary_entries", naming_convention=NAMING) as batch:
        batch.drop_column("recipe_id")
    op.drop_index("ix_meal_template_items_food_id", table_name="meal_template_items")
    op.drop_table("meal_template_items")
    op.drop_index("ix_meal_templates_user_id", table_name="meal_templates")
    op.drop_table("meal_templates")
    op.drop_index("ix_recipe_ingredients_food_id", table_name="recipe_ingredients")
    op.drop_table("recipe_ingredients")
    op.drop_index("ix_recipes_user_id", table_name="recipes")
    op.drop_table("recipes")
