"""The welcome tour is walked once, and the account remembers it.

One column on users: the moment the tour was finished or skipped. Every account
that already exists is stamped as past it, the same rule the first-run screen
took, so nobody already in is interrupted by a tour of an app they know.

Revision ID: 0041_tour_seen
Revises: 0040_photo_uploader_index
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0041_tour_seen"
down_revision: str | None = "0040_photo_uploader_index"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("tour_seen_at", sa.DateTime(timezone=True), nullable=True))

    # CURRENT_TIMESTAMP rather than a value written by this process, so the
    # stamp is the database's own and reads as UTC on both engines.
    op.execute(sa.text("UPDATE users SET tour_seen_at = CURRENT_TIMESTAMP"))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("tour_seen_at")
