"""A day that holds a body fat without a weight, and no visceral rating.

Weight and body fat are logged apart now, so a row is the day rather than the
weigh-in and its weight may be absent. The visceral rating goes with the split:
it is a number no scale agrees with another on, and nothing here reads it.

Revision ID: 0029_biometrics_split
Revises: 0028_weight_loss_clock
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0029_biometrics_split"
down_revision: str | None = "0028_weight_loss_clock"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}


def upgrade() -> None:
    with op.batch_alter_table("weight_entries", naming_convention=NAMING) as batch:
        batch.alter_column("weight_kg", existing_type=sa.Float(), nullable=True)
        batch.drop_column("visceral_fat")


def downgrade() -> None:
    # A day recorded without a weight has nothing to go back to, so it is
    # dropped rather than guessed at. The rating cannot come back either: it
    # was thrown away, and every row goes back blank.
    op.execute("DELETE FROM weight_entries WHERE weight_kg IS NULL")
    with op.batch_alter_table("weight_entries", naming_convention=NAMING) as batch:
        batch.add_column(sa.Column("visceral_fat", sa.Integer(), nullable=True))
        batch.alter_column("weight_kg", existing_type=sa.Float(), nullable=False)
