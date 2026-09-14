"""The engine, the session factory, and the declarative base."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any, cast

from sqlalchemy import CursorResult, Engine, Result, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

_url = settings.resolved_database_url

# How many connections this process may hold, and how long a request waits for
# one. Twenty is comfortably above what a handful of members and one uvicorn
# worker use at once; the ten spare cover a burst, and a request that cannot
# get a connection in ten seconds is told so rather than left hanging.
# SQLite keeps its own single-connection pool and rejects these, so the tests
# and any file database get the plain engine.
_pool: dict[str, Any] = (
    {} if _url.startswith("sqlite") else {"pool_size": 20, "max_overflow": 10, "pool_timeout": 10}
)

# pool_pre_ping: the database container can restart under a running api, and a
# connection that died with it should be replaced rather than handed out.
engine = create_engine(_url, pool_pre_ping=True, **_pool)


def sqlite_transactions(bound: Engine) -> None:
    """Let SQLite hold a transaction the way the real database does.

    Its driver opens one only when it sees a write, so a savepoint taken before
    that becomes the outermost transaction and releasing it commits, which a
    later rollback then has nothing to undo. Opened here instead, so a nested
    block is really nested. Postgres needs none of this.
    """

    @event.listens_for(bound, "connect")
    def _no_driver_transactions(connection: Any, record: Any) -> None:
        connection.isolation_level = None

    @event.listens_for(bound, "begin")
    def _own_begin(connection: Any) -> None:
        connection.exec_driver_sql("BEGIN")


if _url.startswith("sqlite"):
    sqlite_transactions(engine)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def rows_touched(result: Result[Any]) -> int:
    """How many rows an UPDATE or a DELETE actually changed.

    Session.execute is typed as answering with the read-shaped Result, while a
    write really answers with a CursorResult, which is the one carrying this.
    The gap belongs to the type stubs rather than to the database, and this is
    the single place it is written down.
    """
    return cast("CursorResult[Any]", result).rowcount
