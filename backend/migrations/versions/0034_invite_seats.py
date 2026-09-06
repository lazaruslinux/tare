"""An invite link holds seats, and who came in through one is on the member.

A link let exactly one person in and then stopped being a link at all: the row
carried the account that spent it. It carries a count of seats now, so one link
posted to a group chat lets that many people in, and the record of who came
through it moves onto the account, where several accounts can point at the same
link. The two columns that only made sense for a single use go with it.

Revision ID: 0034_invite_seats
Revises: 0033_favorites_one_list
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0034_invite_seats"
down_revision: str | None = "0033_favorites_one_list"
branch_labels = None
depends_on = None

# What to call a constraint that was never named, because SQLite copies the
# table rather than altering it and a copy needs every name.
NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}

# Where each member came in, read off the link that named them. A correlated
# subquery rather than UPDATE ... FROM, which is the one form both Postgres and
# every SQLite worth running already understand.
CLAIMED = """
UPDATE users SET invite_id = (
  SELECT i.id FROM invites AS i WHERE i.used_by = users.id
)
WHERE EXISTS (SELECT 1 FROM invites AS i WHERE i.used_by = users.id)
"""


def upgrade() -> None:
    # SET NULL: deleting a link drops the record of who came through it and
    # leaves their accounts standing.
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        batch.add_column(
            sa.Column(
                "invite_id",
                sa.Integer(),
                sa.ForeignKey("invites.id", ondelete="SET NULL", name="fk_users_invite_id"),
                nullable=True,
            )
        )
    op.create_index("ix_users_invite_id", "users", ["invite_id"])

    # One seat is what every link out there already was.
    with op.batch_alter_table("invites") as batch:
        batch.add_column(sa.Column("seats", sa.Integer(), nullable=False, server_default="1"))
        batch.add_column(sa.Column("used", sa.Integer(), nullable=False, server_default="0"))

    op.execute(sa.text(CLAIMED))
    op.execute("UPDATE invites SET used = 1 WHERE used_by IS NOT NULL")

    with op.batch_alter_table("invites", naming_convention=NAMING) as batch:
        batch.drop_column("used_by")
        batch.drop_column("revoked_at")


def downgrade() -> None:
    # Both columns come back empty. A link that let three people in has no one
    # person to name, so there is nothing honest to put back in used_by.
    with op.batch_alter_table("invites", naming_convention=NAMING) as batch:
        batch.add_column(
            sa.Column(
                "used_by",
                sa.Integer(),
                sa.ForeignKey("users.id", name="fk_invites_used_by"),
                nullable=True,
            )
        )
        batch.add_column(sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True))
        batch.drop_column("used")
        batch.drop_column("seats")

    op.drop_index("ix_users_invite_id", table_name="users")
    with op.batch_alter_table("users", naming_convention=NAMING) as batch:
        batch.drop_column("invite_id")
