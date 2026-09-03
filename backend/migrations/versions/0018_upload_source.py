"""Where a fitness row came from, and how large the file was.

Everything a phone has posted so far came from a phone, so the backfill is the
default: 'sync' on every row already here. What an upload writes from now on
says so, and that is what makes it possible to take an upload back out again
without touching a number anybody's watch sent.

The two enums are widened rather than replaced. Both are non-native, so each is
a varchar the length of its longest word, and 'upload' is longer than 'hae'.

Revision ID: 0018_upload_source
Revises: 0017_fitness
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0018_upload_source"
down_revision: str | None = "0017_fitness"
branch_labels = None
depends_on = None

DIALECTS = sa.Enum("hae", "hc", "upload", "wipe", name="ingest_dialect", native_enum=False)
OLD_DIALECTS = sa.Enum("hae", "hc", name="ingest_dialect", native_enum=False)
SOURCES = sa.Enum("apple", "hc", "manual", "upload", name="workout_source", native_enum=False)
OLD_SOURCES = sa.Enum("apple", "hc", "manual", name="workout_source", native_enum=False)


def upgrade() -> None:
    op.add_column(
        "fitness_daily",
        sa.Column("source", sa.String(length=8), nullable=False, server_default="sync"),
    )
    op.add_column(
        "fitness_intraday",
        sa.Column("source", sa.String(length=8), nullable=False, server_default="sync"),
    )
    op.add_column("weight_entries", sa.Column("via", sa.String(length=8), nullable=True))
    op.add_column("ingest_log", sa.Column("bytes", sa.Integer(), nullable=True))
    # Batch, because a non-native enum is a varchar and SQLite cannot alter one
    # in place. On Postgres this is the plain ALTER it looks like.
    with op.batch_alter_table("ingest_log") as batch:
        batch.alter_column(
            "dialect", existing_type=OLD_DIALECTS, type_=DIALECTS, existing_nullable=False
        )
    with op.batch_alter_table("workouts") as batch:
        batch.alter_column(
            "source", existing_type=OLD_SOURCES, type_=SOURCES, existing_nullable=False
        )


def downgrade() -> None:
    with op.batch_alter_table("workouts") as batch:
        batch.alter_column(
            "source", existing_type=SOURCES, type_=OLD_SOURCES, existing_nullable=False
        )
    with op.batch_alter_table("ingest_log") as batch:
        batch.alter_column(
            "dialect", existing_type=DIALECTS, type_=OLD_DIALECTS, existing_nullable=False
        )
    op.drop_column("ingest_log", "bytes")
    op.drop_column("weight_entries", "via")
    op.drop_column("fitness_intraday", "source")
    op.drop_column("fitness_daily", "source")
