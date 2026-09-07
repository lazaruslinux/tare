"""Who each member shares with.

One row for a pair of members however the asking went round, and no row at all
until somebody asks; the acceptance stamp is null while a request is waiting.

Revision ID: 0037_friends
Revises: 0036_day_goals
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0037_friends"
down_revision: str | None = "0036_day_goals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "friendships",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("requester_id", sa.Integer(), nullable=False),
        sa.Column("addressee_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["requester_id"], ["users.id"], name="fk_friendships_requester_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["addressee_id"], ["users.id"], name="fk_friendships_addressee_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("requester_id", "addressee_id", name="uq_friendships_pair"),
        sa.CheckConstraint("requester_id <> addressee_id", name="ck_friendships_two_members"),
    )
    op.create_index("ix_friendships_addressee_id", "friendships", ["addressee_id"])


def downgrade() -> None:
    op.drop_index("ix_friendships_addressee_id", table_name="friendships")
    op.drop_table("friendships")
