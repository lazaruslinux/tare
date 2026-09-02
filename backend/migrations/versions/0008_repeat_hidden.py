"""Foods taken off a member's Repeat list.

Revision ID: 0008_repeat_hidden
Revises: 0007_health
"""

import sqlalchemy as sa
from alembic import op

from app.models import UtcDateTime

revision: str = "0008_repeat_hidden"
down_revision: str | None = "0007_health"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "repeat_hidden",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "food_id", sa.Integer(), sa.ForeignKey("foods.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("created_at", UtcDateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "food_id", name="uq_repeat_hidden_user_food"),
    )
    op.create_index("ix_repeat_hidden_user_id", "repeat_hidden", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_repeat_hidden_user_id", table_name="repeat_hidden")
    op.drop_table("repeat_hidden")
