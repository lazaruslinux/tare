"""Notifications: the devices that get them and the ones already sent.

A device is its endpoint, so the same browser turned on again takes its row
back rather than leaving a second one behind. The sends table is what keeps a
check-in to one a day: the triple of member, kind and their own local date.
The switches themselves ride on the account, empty until the screen is
answered, which the normalizer reads as everything on.

Revision ID: 0049_push
Revises: 0048_dashboard_cards
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0049_push"
down_revision: str | None = "0048_dashboard_cards"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("endpoint", sa.String(length=1024), nullable=False),
        sa.Column("p256dh", sa.String(length=128), nullable=False),
        sa.Column("auth", sa.String(length=32), nullable=False),
        sa.Column("label", sa.String(length=60), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_ok_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failures", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_push_subscriptions_user_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint", name="uq_push_subscriptions_endpoint"),
    )
    op.create_index("ix_push_subscriptions_user_id", "push_subscriptions", ["user_id"])
    op.create_table(
        "push_sends",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_push_sends_user_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "kind", "day", name="uq_push_sends_user_kind_day"),
    )
    op.create_index("ix_push_sends_user_id", "push_sends", ["user_id"])
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        batch.add_column(sa.Column("notify", sa.JSON(), nullable=False, server_default="{}"))
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        batch.alter_column("notify", existing_type=sa.JSON(), server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        batch.drop_column("notify")
    op.drop_index("ix_push_sends_user_id", table_name="push_sends")
    op.drop_table("push_sends")
    op.drop_index("ix_push_subscriptions_user_id", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
