"""What a sync's accepted count was made of, kept apart.

Two nullable columns on the sync record: how many day rows it wrote and how
many workouts. Null on a wipe and on every row written before this, which the
screen reads as "no split kept" rather than as zero.

Revision ID: 0042_ingest_log_days_workouts
Revises: 0041_tour_seen
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0042_ingest_log_days_workouts"
down_revision: str | None = "0041_tour_seen"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("ingest_log") as batch:
        batch.add_column(sa.Column("days", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("workouts", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("ingest_log") as batch:
        batch.drop_column("workouts")
        batch.drop_column("days")
