"""Migration environment. Online mode only; this project never renders SQL."""

import logging

from alembic import context
from sqlalchemy import create_engine, pool

from app import models  # noqa: F401  (imported so Base knows every table)
from app.config import check_deploy_config, settings
from app.db import Base

# The same refusal the application makes. Running migrations against a
# half-configured install is how a database ends up somewhere unintended.
check_deploy_config()

# Alembic reports which revision it applied through the logging module and says
# nothing at all until something configures it. The container's boot log is the
# only place an upgrade that stalled or was skipped would be visible.
logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s")

target_metadata = Base.metadata

url = context.config.get_main_option("sqlalchemy.url") or settings.resolved_database_url
connectable = create_engine(url, poolclass=pool.NullPool)

with connectable.connect() as connection:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # SQLite cannot alter a column in place; batch mode rebuilds the table
        # instead. Harmless on Postgres, which is why it is decided by dialect.
        render_as_batch=connection.dialect.name == "sqlite",
    )
    with context.begin_transaction():
        context.run_migrations()
