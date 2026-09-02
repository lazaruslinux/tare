"""The health engine: a profile, the measurements it reads, and logged exercise.

Revision ID: 0007_health
Revises: 0006_recipes_meals
"""

import sqlalchemy as sa
from alembic import op

from app.models import UtcDateTime

revision: str = "0007_health"
down_revision: str | None = "0006_recipes_meals"
branch_labels = None
depends_on = None

# What to call a constraint that was never named. SQLite has no ALTER for one,
# so the batch below copies the table, and a copy cannot carry across a
# constraint it has no name for.
NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}


def upgrade() -> None:
    # Additive and nullable, so an install that already holds accounts takes it
    # without a value having to be invented for anybody.
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        batch.add_column(sa.Column("location", sa.String(length=80), nullable=True))

    op.create_table(
        "health_profiles",
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "sex",
            sa.Enum("female", "male", name="health_sex", native_enum=False),
            nullable=True,
        ),
        sa.Column("height_cm", sa.Float(), nullable=True),
        sa.Column(
            "activity_level",
            sa.Enum(
                "not_much",
                "light",
                "moderate",
                "heavy",
                name="health_activity",
                native_enum=False,
            ),
            nullable=False,
            server_default="not_much",
        ),
        sa.Column(
            "goal",
            sa.Enum("maintain", "lose", "gain", name="health_goal", native_enum=False),
            nullable=False,
            server_default="maintain",
        ),
        # Null is the default pace for the goal rather than no pace at all.
        sa.Column(
            "rate",
            sa.Enum(
                "gentle", "steady", "faster", "fastest", name="health_rate", native_enum=False
            ),
            nullable=True,
        ),
        sa.Column("goal_weight_kg", sa.Float(), nullable=True),
        sa.Column(
            "pregnant_or_breastfeeding",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "targets_mode",
            sa.Enum("auto", "manual", name="health_targets_mode", native_enum=False),
            nullable=False,
            server_default="auto",
        ),
        sa.Column("manual_calories", sa.Float(), nullable=True),
        sa.Column("manual_protein_g", sa.Float(), nullable=True),
        sa.Column("manual_carbs_g", sa.Float(), nullable=True),
        sa.Column("manual_fat_g", sa.Float(), nullable=True),
        sa.Column("disclaimer_seen_at", UtcDateTime(), nullable=True),
        sa.Column("dismissed_nudges", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("created_at", UtcDateTime(), nullable=False),
        sa.Column("updated_at", UtcDateTime(), nullable=False),
    )

    op.create_table(
        "weight_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("date_for", sa.Date(), nullable=False),
        sa.Column("weight_kg", sa.Float(), nullable=False),
        sa.Column("body_fat_pct", sa.Float(), nullable=True),
        sa.Column("body_water_pct", sa.Float(), nullable=True),
        sa.Column("muscle_kg", sa.Float(), nullable=True),
        sa.Column("bone_kg", sa.Float(), nullable=True),
        sa.Column("visceral_fat", sa.Integer(), nullable=True),
        sa.Column(
            "source",
            sa.Enum("manual", "ingest", name="measurement_source", native_enum=False),
            nullable=False,
            server_default="manual",
        ),
        sa.Column("created_at", UtcDateTime(), nullable=False),
        # One reading per day: the trend is built by day, and two readings for
        # one day would make it depend on which arrived last.
        sa.UniqueConstraint("user_id", "date_for", name="uq_weight_entries_user_day"),
    )
    op.create_index("ix_weight_entries_user_id", "weight_entries", ["user_id"])
    op.create_index("ix_weight_entries_date_for", "weight_entries", ["date_for"])

    op.create_table(
        "exercise_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("date_for", sa.Date(), nullable=False),
        sa.Column("activity", sa.String(length=40), nullable=False),
        sa.Column(
            "effort",
            sa.Enum(
                "light", "moderate", "vigorous", name="exercise_effort", native_enum=False
            ),
            nullable=False,
        ),
        sa.Column("minutes", sa.Integer(), nullable=False),
        # Copied on at the moment of logging, so a later weigh-in corrects what
        # happens next rather than what already happened.
        sa.Column("met", sa.Float(), nullable=False),
        sa.Column("weight_kg", sa.Float(), nullable=False),
        sa.Column("kcal", sa.Float(), nullable=False),
        sa.Column("created_at", UtcDateTime(), nullable=False),
    )
    op.create_index("ix_exercise_entries_user_id", "exercise_entries", ["user_id"])
    op.create_index("ix_exercise_entries_date_for", "exercise_entries", ["date_for"])


def downgrade() -> None:
    op.drop_index("ix_exercise_entries_date_for", table_name="exercise_entries")
    op.drop_index("ix_exercise_entries_user_id", table_name="exercise_entries")
    op.drop_table("exercise_entries")
    op.drop_index("ix_weight_entries_date_for", table_name="weight_entries")
    op.drop_index("ix_weight_entries_user_id", table_name="weight_entries")
    op.drop_table("weight_entries")
    op.drop_table("health_profiles")
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        batch.drop_column("location")
