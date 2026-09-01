"""Label photos, and the submissions that carry a food into the shared database.

Revision ID: 0004_submissions
Revises: 0003_diary
"""

import sqlalchemy as sa
from alembic import op

from app.models import UtcDateTime

revision: str = "0004_submissions"
down_revision: str | None = "0003_diary"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "food_photos",
        sa.Column("id", sa.Integer(), primary_key=True),
        # Null until the submission carrying it is sent. SET NULL after, so a
        # deleted food leaves a file for the sweep rather than a vanished row.
        sa.Column(
            "food_id",
            sa.Integer(),
            sa.ForeignKey("foods.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "uploaded_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # The server-chosen file name and nothing else.
        sa.Column("path", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="pending"),
        sa.Column("created_at", UtcDateTime(), nullable=False),
    )
    op.create_index("ix_food_photos_food_id", "food_photos", ["food_id"])
    # Partial: a food may collect several offered pictures, and exactly one
    # published one.
    op.create_index(
        "uq_food_photos_food_approved",
        "food_photos",
        ["food_id"],
        unique=True,
        postgresql_where=sa.text("status = 'approved'"),
        sqlite_where=sa.text("status = 'approved'"),
    )

    op.create_table(
        "food_submissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(length=8), nullable=False, server_default="new"),
        sa.Column(
            "food_id",
            sa.Integer(),
            sa.ForeignKey("foods.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # CASCADE: a correction to a food that is gone is not answerable.
        sa.Column(
            "target_food_id",
            sa.Integer(),
            sa.ForeignKey("foods.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "photo_id",
            sa.Integer(),
            sa.ForeignKey("food_photos.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "submitted_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("note", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="pending"),
        sa.Column(
            "decided_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("decided_at", UtcDateTime(), nullable=True),
        sa.Column("decision_note", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("created_at", UtcDateTime(), nullable=False),
    )
    op.create_index("ix_food_submissions_submitted_by_id", "food_submissions", ["submitted_by_id"])
    # Partial: one request about a food may be waiting at a time. A decided one
    # is history and does not stand in the way of the next.
    op.create_index(
        "uq_food_submissions_open",
        "food_submissions",
        ["food_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
        sqlite_where=sa.text("status = 'pending'"),
    )


def downgrade() -> None:
    op.drop_index("uq_food_submissions_open", table_name="food_submissions")
    op.drop_index("ix_food_submissions_submitted_by_id", table_name="food_submissions")
    op.drop_table("food_submissions")
    op.drop_index("uq_food_photos_food_approved", table_name="food_photos")
    op.drop_index("ix_food_photos_food_id", table_name="food_photos")
    op.drop_table("food_photos")
