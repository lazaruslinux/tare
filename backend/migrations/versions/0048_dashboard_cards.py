"""How a member has arranged the Dashboard.

One list on the account: the cards in the order they are read, each with
whether it is shown. Empty on every row that already exists, which is what the
normalizer reads as Tare's own order with everything shown.

Revision ID: 0048_dashboard_cards
Revises: 0047_calendar
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0048_dashboard_cards"
down_revision: str | None = "0047_calendar"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}


def upgrade() -> None:
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        batch.add_column(
            sa.Column("dashboard_cards", sa.JSON(), nullable=False, server_default="[]")
        )
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        batch.alter_column("dashboard_cards", existing_type=sa.JSON(), server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        batch.drop_column("dashboard_cards")
