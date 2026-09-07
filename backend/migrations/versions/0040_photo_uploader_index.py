"""An index for the daily photo count.

Every upload first asks how many pictures this member has sent since their own
midnight, and the column that answers it has never been indexed, so the count
reads the whole table. The pair is the order the count asks in: whose, then
when.

Revision ID: 0040_photo_uploader_index
Revises: 0039_auto_log_kinds
"""

from alembic import op

revision: str = "0040_photo_uploader_index"
down_revision: str | None = "0039_auto_log_kinds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_food_photos_uploader_created",
        "food_photos",
        ["uploaded_by_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_food_photos_uploader_created", table_name="food_photos")
