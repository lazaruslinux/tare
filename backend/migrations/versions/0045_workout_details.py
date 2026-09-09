"""The breakdown of a workout is one switch, and it starts off.

Tare is a calorie tracker first, and the Strava-like reading of a session is
for the member rather than for the room. The four names 0044 wrote become two:
`stats`, `minutes` and `splits` are all the one breakdown, so they collapse to
`details`; the route is still the route. Then `details` is added to every
account that does not already hold it, existing members included, because a
switch that opens the whole session has to be turned on rather than found on.

The downgrade is best-effort: `details` goes back to the three names it covers,
and an account that never held anything comes back holding those three, because
the old shape had no way to say what the new default says.

Revision ID: 0045_workout_details
Revises: 0044_workout_sharing
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0045_workout_details"
down_revision: str | None = "0044_workout_sharing"
branch_labels = None
depends_on = None

# The server's own order, which is the order a list is stored in either way.
NEW_ORDER = ("details", "route")
OLD_ORDER = ("stats", "route", "minutes", "splits")

FORWARD = {
    "stats": ("details",),
    "minutes": ("details",),
    "splits": ("details",),
    "route": ("route",),
}
BACK = {"details": ("stats", "minutes", "splits"), "route": ("route",)}

users = sa.table("users", sa.column("id", sa.Integer), sa.column("feed_hidden", sa.JSON))


def _rewrite(
    mapping: dict[str, tuple[str, ...]], order: tuple[str, ...], always: tuple[str, ...]
) -> None:
    """Every account's list read through one mapping, plus whatever it must
    hold either way, de-duplicated and ordered."""
    bind = op.get_bind()
    for row in bind.execute(sa.select(users.c.id, users.c.feed_hidden)).all():
        held = {name for old in (row.feed_hidden or []) for name in mapping.get(old, ())}
        held.update(always)
        wanted = [name for name in order if name in held]
        if wanted != list(row.feed_hidden or []):
            bind.execute(
                sa.update(users).where(users.c.id == row.id).values(feed_hidden=wanted)
            )


def upgrade() -> None:
    _rewrite(FORWARD, NEW_ORDER, ("details",))


def downgrade() -> None:
    _rewrite(BACK, OLD_ORDER, ())
