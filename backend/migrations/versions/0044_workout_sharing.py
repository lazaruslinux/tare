"""What a member may keep back on a shared workout, said in four parts.

The old list named three figures: the calories, the heart rate, and the route.
The new one names the four things a screen actually draws, so a switch turns
off a card rather than a column. Every stored list is rewritten to match:
calories were part of the numbers card, so `kcal` becomes `stats`; the heart
rate was on the card and in the minute-by-minute graph both, so `avg_hr`
becomes `stats` and `minutes`; the route is still the route. Splits were never
hideable before, so nobody starts out holding them back.

The downgrade is best-effort, because the new names say more than the old ones
could: `stats` goes back to the two figures it covers, `minutes` to the heart
rate it carries, and `splits` to nothing at all.

Revision ID: 0044_workout_sharing
Revises: 0043_micros
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0044_workout_sharing"
down_revision: str | None = "0043_micros"
branch_labels = None
depends_on = None

# The server's own order, which is the order a list is stored in either way.
NEW_ORDER = ("stats", "route", "minutes", "splits")
OLD_ORDER = ("avg_hr", "kcal", "route")

FORWARD = {"kcal": ("stats",), "avg_hr": ("stats", "minutes"), "route": ("route",)}
BACK = {"stats": ("avg_hr", "kcal"), "minutes": ("avg_hr",), "route": ("route",)}

users = sa.table("users", sa.column("id", sa.Integer), sa.column("feed_hidden", sa.JSON))


def _rewrite(mapping: dict[str, tuple[str, ...]], order: tuple[str, ...]) -> None:
    """Every account's list read through one mapping, de-duplicated and ordered.

    A list nothing changes is left alone, which is almost all of them: the
    default is empty and the switches were only ever three.
    """
    bind = op.get_bind()
    for row in bind.execute(sa.select(users.c.id, users.c.feed_hidden)).all():
        held = {
            name
            for old in (row.feed_hidden or [])
            for name in mapping.get(old, ())
        }
        wanted = [name for name in order if name in held]
        if wanted != list(row.feed_hidden or []):
            bind.execute(
                sa.update(users).where(users.c.id == row.id).values(feed_hidden=wanted)
            )


def upgrade() -> None:
    _rewrite(FORWARD, NEW_ORDER)


def downgrade() -> None:
    _rewrite(BACK, OLD_ORDER)
