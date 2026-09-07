"""What a phone knows about a body, and the sessions it recorded.

Six tables. fitness_daily is deliberately shaped to hold metrics nothing draws
yet, because a reading dropped on the way in can never be shown later, so a
phone's sleep, oxygen and variability are written under the exporter's own
names. ingest_tokens is not touched: it has been in place since the first
migration.

Revision ID: 0017_fitness
Revises: 0016_review_edits
"""

import sqlalchemy as sa
from alembic import op

from app.models import UtcDateTime

revision: str = "0017_fitness"
down_revision: str | None = "0016_review_edits"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        "fitness_daily",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("date_for", sa.Date(), nullable=False),
        sa.Column("metric", sa.String(length=60), nullable=False),
        sa.Column("value", sa.Float(), nullable=True),
        sa.Column("unit", sa.String(length=20), nullable=False),
        sa.Column("fields", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_fitness_daily_user_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "date_for", "metric", name="uq_fitness_daily_day_metric"),
    )
    op.create_index("ix_fitness_daily_user_id", "fitness_daily", ["user_id"])
    op.create_index("ix_fitness_daily_date_for", "fitness_daily", ["date_for"])

    op.create_table(
        "fitness_intraday",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("date_for", sa.Date(), nullable=False),
        sa.Column("metric", sa.String(length=30), nullable=False),
        sa.Column("hour", sa.Integer(), nullable=False),
        sa.Column("value", sa.Float(), nullable=True),
        sa.Column("unit", sa.String(length=20), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_fitness_intraday_user_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "date_for", "metric", "hour", name="uq_fitness_intraday_hour"
        ),
    )
    op.create_index("ix_fitness_intraday_user_id", "fitness_intraday", ["user_id"])
    op.create_index("ix_fitness_intraday_date_for", "fitness_intraday", ["date_for"])

    op.create_table(
        "workouts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("external_id", sa.String(length=64), nullable=True),
        sa.Column("activity", sa.String(length=80), nullable=False),
        sa.Column("started_at", UtcDateTime(), nullable=False),
        sa.Column("ended_at", UtcDateTime(), nullable=True),
        sa.Column("date_for", sa.Date(), nullable=False),
        sa.Column("duration_s", sa.Integer(), nullable=False),
        sa.Column("kcal", sa.Float(), nullable=True),
        sa.Column("distance_m", sa.Float(), nullable=True),
        sa.Column("avg_hr", sa.Integer(), nullable=True),
        sa.Column("max_hr", sa.Integer(), nullable=True),
        sa.Column("elevation_gain_m", sa.Float(), nullable=True),
        sa.Column("indoor", sa.Boolean(), nullable=False),
        sa.Column("hidden_from_feed", sa.Boolean(), nullable=False),
        sa.Column(
            "source",
            sa.Enum("apple", "hc", "manual", name="workout_source", native_enum=False),
            nullable=False,
        ),
        sa.Column("flags", sa.JSON(), nullable=False),
        sa.Column("created_at", UtcDateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_workouts_user_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "external_id", name="uq_workouts_user_external"),
    )
    op.create_index("ix_workouts_user_id", "workouts", ["user_id"])
    op.create_index("ix_workouts_started_at", "workouts", ["started_at"])
    op.create_index("ix_workouts_date_for", "workouts", ["date_for"])

    op.create_table(
        "workout_routes",
        sa.Column("workout_id", sa.Integer(), nullable=False),
        sa.Column("points", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["workout_id"],
            ["workouts.id"],
            name="fk_workout_routes_workout_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("workout_id"),
    )

    op.create_table(
        "workout_samples",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("workout_id", sa.Integer(), nullable=False),
        sa.Column("minute", sa.Integer(), nullable=False),
        sa.Column("distance_m", sa.Float(), nullable=True),
        sa.Column("hr_min", sa.Integer(), nullable=True),
        sa.Column("hr_avg", sa.Integer(), nullable=True),
        sa.Column("hr_max", sa.Integer(), nullable=True),
        sa.Column("kcal", sa.Float(), nullable=True),
        sa.Column("steps", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["workout_id"],
            ["workouts.id"],
            name="fk_workout_samples_workout_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workout_id", "minute", name="uq_workout_samples_minute"),
    )
    op.create_index("ix_workout_samples_workout_id", "workout_samples", ["workout_id"])

    op.create_table(
        "ingest_log",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("received_at", UtcDateTime(), nullable=False),
        sa.Column(
            "dialect",
            sa.Enum("hae", "hc", name="ingest_dialect", native_enum=False),
            nullable=False,
        ),
        sa.Column("items", sa.Integer(), nullable=False),
        sa.Column("accepted", sa.Integer(), nullable=False),
        sa.Column("flagged", sa.Integer(), nullable=False),
        sa.Column("skipped", sa.Integer(), nullable=False),
        sa.Column("error", sa.String(length=200), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_ingest_log_user_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ingest_log_user_id", "ingest_log", ["user_id"])


def downgrade() -> None:
    op.drop_table("ingest_log")
    op.drop_table("workout_samples")
    op.drop_table("workout_routes")
    op.drop_table("workouts")
    op.drop_table("fitness_intraday")
    op.drop_table("fitness_daily")
