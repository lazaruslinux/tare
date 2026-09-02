"""Two purposes for a picture, and the label photo a request carries.

A front photo is the one published picture of a food. A label photo is the
nutrition panel, offered so a reviewer can check the numbers; it belongs to the
request, it is never published, and only its uploader and an administrator are
ever served it. Everything already in the table is a front photo.

Revision ID: 0011_photo_purposes
Revises: 0010_measurement_pcts
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0011_photo_purposes"
down_revision: str | None = "0010_measurement_pcts"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}

PURPOSE = sa.Enum("front", "label", name="photo_purpose", native_enum=False)


def upgrade() -> None:
    with op.batch_alter_table("food_photos", naming_convention=NAMING) as batch:
        batch.add_column(
            sa.Column("purpose", PURPOSE, nullable=False, server_default="front")
        )
    with op.batch_alter_table("food_submissions", naming_convention=NAMING) as batch:
        batch.add_column(sa.Column("label_photo_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_food_submissions_label_photo_id",
            "food_photos",
            ["label_photo_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("food_submissions", naming_convention=NAMING) as batch:
        batch.drop_constraint("fk_food_submissions_label_photo_id", type_="foreignkey")
        batch.drop_column("label_photo_id")
    with op.batch_alter_table("food_photos", naming_convention=NAMING) as batch:
        batch.drop_column("purpose")
