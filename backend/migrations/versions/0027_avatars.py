"""The picture a member is shown by.

One nullable column holding a file name the server chose. Null is the ordinary
state: an account with no picture is shown its own initial rather than a stock
face.

Revision ID: 0027_avatars
Revises: 0026_kept_foods
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0027_avatars"
down_revision: str | None = "0026_kept_foods"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_path", sa.String(length=128), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_path")
