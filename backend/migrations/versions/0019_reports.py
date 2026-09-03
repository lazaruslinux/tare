"""A fourth kind of request: something is wrong with a shared food.

A member no longer corrects a food everybody eats out of. They say what is
wrong with it, in words, and an administrator fixes it or explains why they
have not. That is one more value in a column that has held three since the
table was written, so the column is made to say which four they are instead of
being any eight characters at all.

Revision ID: 0019_reports
Revises: 0018_upload_source
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0019_reports"
down_revision: str | None = "0018_upload_source"
branch_labels = None
depends_on = None

KINDS = sa.Enum(
    "new", "edit", "photo", "report", name="submission_kind", native_enum=False
)
# What it was: a plain column wide enough for three words and for a fourth
# nobody had named, holding whatever was written into it.
WAS = sa.String(length=8)
CHECK = "kind IN ('new', 'edit', 'photo', 'report')"


def upgrade() -> None:
    # Batch, because a non-native enum is a varchar with a check beside it and
    # SQLite cannot alter one in place. On Postgres these are the two plain
    # ALTERs they look like.
    with op.batch_alter_table("food_submissions") as batch:
        batch.alter_column("kind", existing_type=WAS, type_=KINDS, existing_nullable=False)
        batch.create_check_constraint("submission_kind", CHECK)


def downgrade() -> None:
    # The reports go with the kind that named them: nothing is left behind
    # holding a word the column no longer takes.
    op.execute(sa.text("DELETE FROM food_submissions WHERE kind = 'report'"))
    with op.batch_alter_table("food_submissions") as batch:
        batch.drop_constraint("submission_kind", type_="check")
        batch.alter_column("kind", existing_type=KINDS, type_=WAS, existing_nullable=False)
