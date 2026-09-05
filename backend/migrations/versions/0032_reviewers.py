"""A second role, and the record of what everybody with one did.

Reviewing was an administrator's job and nothing else. It is its own role now:
a reviewer reads the queue and keeps the shared foods right, and touches
nothing about the instance itself. Every decision either role makes is written
down here, so what reached the shared database can be read back afterwards.

Revision ID: 0032_reviewers
Revises: 0031_meal_entries
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0032_reviewers"
down_revision: str | None = "0031_meal_entries"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(
            sa.Column(
                "is_reviewer", sa.Boolean(), nullable=False, server_default=sa.text("false")
            )
        )
        # When they asked to review. Null for everybody who has not.
        batch.add_column(
            sa.Column("reviewer_requested_at", sa.DateTime(timezone=True), nullable=True)
        )

    # When a food last moved, so an edit written against an older copy of it
    # can be told from one written against what is there now. Backfilled from
    # when the row was made, which is the truest thing already known about it.
    with op.batch_alter_table("foods") as batch:
        batch.add_column(sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE foods SET updated_at = created_at WHERE updated_at IS NULL")
    with op.batch_alter_table("foods") as batch:
        batch.alter_column("updated_at", nullable=False)

    op.create_table(
        "review_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        # SET NULL: the record outlives the account that made it.
        sa.Column(
            "actor_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("actor_name", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("action", sa.String(length=30), nullable=False),
        sa.Column("target_kind", sa.String(length=20), nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=True),
        sa.Column("target_name", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("detail", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    # Newest first is the only way this table is ever read.
    op.create_index("ix_review_log_created_at", "review_log", [sa.text("created_at DESC")])
    op.create_index("ix_review_log_actor_id", "review_log", ["actor_id"])


def downgrade() -> None:
    op.drop_index("ix_review_log_actor_id", table_name="review_log")
    op.drop_index("ix_review_log_created_at", table_name="review_log")
    op.drop_table("review_log")
    with op.batch_alter_table("foods") as batch:
        batch.drop_column("updated_at")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("reviewer_requested_at")
        batch.drop_column("is_reviewer")
