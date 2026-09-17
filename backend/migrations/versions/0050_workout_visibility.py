"""What a session shares is the session's own business.

Until now the account answered for every workout it had ever synced: the
switches were read at the moment somebody looked, so turning one off reached
back through years of mornings and turning it on opened them again. A member
cannot mean that. From here each session is stamped with the account's list
when it arrives and keeps it: the switches shape what syncs next.

Every row that already exists is frozen at what it shows today, so nothing on
the feed changes appearance the day this lands. That includes the master
switch: an account sharing no workouts has its past ones stamped hidden, one
at a time to open again from the workout's own page.

The downgrade drops the column. It cannot give the account back its reach over
sessions that already happened, and nothing it could write would mean that.

Revision ID: 0050_workout_visibility
Revises: 0049_push
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0050_workout_visibility"
down_revision: str | None = "0049_push"
branch_labels = None
depends_on = None

NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s"}

users = sa.table(
    "users",
    sa.column("id", sa.Integer),
    sa.column("feed_hidden", sa.JSON),
    sa.column("share_workouts", sa.Boolean),
)
workouts = sa.table(
    "workouts",
    sa.column("id", sa.Integer),
    sa.column("user_id", sa.Integer),
    sa.column("feed_hidden", sa.JSON),
    sa.column("hidden_from_feed", sa.Boolean),
)


def upgrade() -> None:
    with op.batch_alter_table("workouts", naming_convention=NAMING) as batch:
        batch.add_column(sa.Column("feed_hidden", sa.JSON(), nullable=False, server_default="[]"))
    with op.batch_alter_table("workouts", naming_convention=NAMING) as batch:
        batch.alter_column("feed_hidden", existing_type=sa.JSON(), server_default=None)

    bind = op.get_bind()
    for row in bind.execute(
        sa.select(users.c.id, users.c.feed_hidden, users.c.share_workouts)
    ).all():
        held = list(row.feed_hidden or [])
        values: dict[str, object] = {"feed_hidden": held}
        if not row.share_workouts:
            # The master said no, so every session it covered says no itself.
            values["hidden_from_feed"] = True
        bind.execute(sa.update(workouts).where(workouts.c.user_id == row.id).values(**values))


def downgrade() -> None:
    with op.batch_alter_table("workouts", naming_convention=NAMING) as batch:
        batch.drop_column("feed_hidden")
