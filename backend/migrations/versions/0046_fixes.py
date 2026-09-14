"""What a daily cap counts, the pair the diary is read on, and a dead column.

The caps counted the rows themselves, so taking a submission back handed the
day's allowance back with it. They count marks now: one row per thing offered
or photographed, which nothing else deletes.

The diary index is the pair every read of it asks on, a member and a day. And
`via` on a weigh-in was written by nothing: weigh-ins are typed in by hand, so
the column only ever held null and the two branches reading it were dead.

Revision ID: 0046_fixes
Revises: 0045_workout_details
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0046_fixes"
down_revision: str | None = "0045_workout_details"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cap_marks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_cap_marks_user_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cap_marks_user_created", "cap_marks", ["user_id", "created_at"])
    op.create_index("ix_diary_entries_user_date", "diary_entries", ["user_id", "date_for"])
    op.drop_column("weight_entries", "via")


def downgrade() -> None:
    op.add_column("weight_entries", sa.Column("via", sa.String(length=8), nullable=True))
    op.drop_index("ix_diary_entries_user_date", table_name="diary_entries")
    op.drop_index("ix_cap_marks_user_created", table_name="cap_marks")
    op.drop_table("cap_marks")
