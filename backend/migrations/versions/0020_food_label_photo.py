"""The nutrition panel a shared food keeps.

One column on foods, pointing at the photo that is its panel: approval hands
the panel to the food, and it stays there for the life of the row, so a reviewer
correcting a shared food a year later has it. The shared foods already here take
the newest panel any request about them still carries, which is the picture the
food page shows anyway.

Revision ID: 0020_food_label_photo
Revises: 0019_reports
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0020_food_label_photo"
down_revision: str | None = "0019_reports"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}

# The newest label any request about this food is still holding. Ordered the
# same way the food page ordered it, so nothing changes on screen.
BACKFILL = sa.text(
    """
    UPDATE foods SET label_photo_id = (
        SELECT s.label_photo_id FROM food_submissions AS s
        WHERE (s.food_id = foods.id OR s.target_food_id = foods.id)
          AND s.label_photo_id IS NOT NULL
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT 1
    )
    WHERE status = 'approved'
    """
)


def upgrade() -> None:
    with op.batch_alter_table("foods", naming_convention=NAMING) as batch:
        batch.add_column(sa.Column("label_photo_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_foods_label_photo_id",
            "food_photos",
            ["label_photo_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.execute(BACKFILL)


def downgrade() -> None:
    with op.batch_alter_table("foods", naming_convention=NAMING) as batch:
        batch.drop_constraint("fk_foods_label_photo_id", type_="foreignkey")
        batch.drop_column("label_photo_id")
