"""The first-run screen is answered once, and the account remembers it.

One column on users: the moment the screen is answered or skipped. Written down
rather than worked out from the door somebody came through, which cannot tell a
member who registered, met the verification screen and came back through the
mailed link from one who has already answered. Every account that exists is
stamped as past it.

Revision ID: 0035_first_run
Revises: 0034_invite_seats
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0035_first_run"
down_revision: str | None = "0034_invite_seats"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("first_run_at", sa.DateTime(timezone=True), nullable=True))

    # Everybody already here has been through it, whatever they answered.
    # CURRENT_TIMESTAMP rather than a value written by this process, so the
    # stamp is the database's own and reads as UTC on both engines.
    op.execute(sa.text("UPDATE users SET first_run_at = CURRENT_TIMESTAMP"))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("first_run_at")
