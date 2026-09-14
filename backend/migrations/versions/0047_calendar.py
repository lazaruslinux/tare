"""The shared calendar: appointments, who they are on, and who is asked.

An appointment carries the zone it was arranged in, so a time never moves under
anybody reading it from somewhere else, and a repeat is six columns rather than
a row per day. The three small tables beside it are the exceptions to a series:
a day carved out of it, a day called off, and a day nobody answered yet.

Revision ID: 0047_calendar
Revises: 0046_fixes
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0047_calendar"
down_revision: str | None = "0046_fixes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "calendars",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("color", sa.String(length=16), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name="fk_calendars_created_by", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "calendar_members",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("calendar_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("invited_by", sa.Integer(), nullable=False),
        sa.Column("invited_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["calendar_id"],
            ["calendars.id"],
            name="fk_calendar_members_calendar_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_calendar_members_user_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["invited_by"], ["users.id"], name="fk_calendar_members_invited_by",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("calendar_id", "user_id", name="uq_calendar_members_pair"),
    )
    op.create_index("ix_calendar_members_user_id", "calendar_members", ["user_id"])
    op.create_table(
        "appointments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("notes", sa.String(length=1000), nullable=False),
        sa.Column("location", sa.String(length=120), nullable=True),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("date_for", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("time_of_day", sa.Time(), nullable=True),
        sa.Column("end_time", sa.Time(), nullable=True),
        sa.Column("all_day", sa.Boolean(), nullable=False),
        sa.Column("repeat_type", sa.String(length=8), nullable=True),
        sa.Column("repeat_days", sa.Integer(), nullable=True),
        sa.Column("repeat_interval", sa.Integer(), nullable=False),
        sa.Column("repeat_anchor", sa.Date(), nullable=True),
        sa.Column("repeat_month_day", sa.Integer(), nullable=True),
        sa.Column("repeat_until", sa.Date(), nullable=True),
        sa.Column("detached", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["users.id"], name="fk_appointments_owner_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_appointments_owner_id", "appointments", ["owner_id"])
    op.create_index("ix_appointments_date_for", "appointments", ["date_for"])
    op.create_table(
        "appointment_calendars",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("appointment_id", sa.Integer(), nullable=False),
        sa.Column("calendar_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["appointment_id"],
            ["appointments.id"],
            name="fk_appointment_calendars_appointment_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["calendar_id"],
            ["calendars.id"],
            name="fk_appointment_calendars_calendar_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "appointment_id", "calendar_id", name="uq_appointment_calendars_pair"
        ),
    )
    op.create_table(
        "appointment_skips",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("appointment_id", sa.Integer(), nullable=False),
        sa.Column("date_for", sa.Date(), nullable=False),
        sa.ForeignKeyConstraint(
            ["appointment_id"],
            ["appointments.id"],
            name="fk_appointment_skips_appointment_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("appointment_id", "date_for", name="uq_appointment_skips_day"),
    )
    op.create_table(
        "appointment_marks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("appointment_id", sa.Integer(), nullable=False),
        sa.Column("date_for", sa.Date(), nullable=False),
        sa.Column("cancelled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["appointment_id"],
            ["appointments.id"],
            name="fk_appointment_marks_appointment_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("appointment_id", "date_for", name="uq_appointment_marks_day"),
    )
    op.create_table(
        "appointment_invites",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("appointment_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("invited_by", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["appointment_id"],
            ["appointments.id"],
            name="fk_appointment_invites_appointment_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_appointment_invites_user_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["invited_by"],
            ["users.id"],
            name="fk_appointment_invites_invited_by",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("appointment_id", "user_id", name="uq_appointment_invites_pair"),
    )
    op.create_index("ix_appointment_invites_user_id", "appointment_invites", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_appointment_invites_user_id", table_name="appointment_invites")
    op.drop_table("appointment_invites")
    op.drop_table("appointment_marks")
    op.drop_table("appointment_skips")
    op.drop_table("appointment_calendars")
    op.drop_index("ix_appointments_date_for", table_name="appointments")
    op.drop_index("ix_appointments_owner_id", table_name="appointments")
    op.drop_table("appointments")
    op.drop_index("ix_calendar_members_user_id", table_name="calendar_members")
    op.drop_table("calendar_members")
    op.drop_table("calendars")
