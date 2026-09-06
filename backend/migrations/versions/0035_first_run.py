"""The first-run screen is answered once, and the account remembers it.

Whether somebody had seen the questions Tare asks on the way in was never
written down: the app worked it out from the door they came through, so a new
member who registered, met the verification screen and came back through the
mailed link had already been counted as settled and never saw them. The account
carries the moment instead, set when the screen is answered or skipped, and
every account that exists today is past it.

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
