from pathlib import Path

import sqlalchemy as sa
from alembic import command
from alembic.config import Config

BACKEND = Path(__file__).resolve().parents[1]

IDENTITY_TABLES = {"users", "sessions", "email_tokens", "invites", "ingest_tokens"}


def test_upgrade_head_builds_the_identity_schema(tmp_path):
    database = tmp_path / "tare.db"
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")

    command.upgrade(config, "head")

    engine = sa.create_engine(f"sqlite:///{database}")
    try:
        tables = set(sa.inspect(engine).get_table_names())
    finally:
        engine.dispose()
    assert IDENTITY_TABLES <= tables
