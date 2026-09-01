"""The engine, the session factory, and the declarative base."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any, cast

from sqlalchemy import CursorResult, Result, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

# pool_pre_ping: the database container can restart under a running api, and a
# connection that died with it should be replaced rather than handed out.
engine = create_engine(settings.resolved_database_url, pool_pre_ping=True)

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
