"""Shared fixtures.

Every test gets the real application wired to a database of its own, so no
case can see another's rows and none of them needs a running Postgres.
"""

import os

# Set before anything imports the app: settings are read from the environment
# once, at import, and the startup guard refuses an unconfigured install. The
# engine this URL builds is never used, because get_db is overridden per test.
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("SECRET_KEY", "tests-only-not-a-real-secret")
os.environ.setdefault("TARE_TZ", "UTC")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import models  # noqa: E402,F401  (imported so create_all sees the tables)
from app.db import Base, get_db  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture()
def db_session():
    # StaticPool keeps one connection, and therefore one in-memory database,
    # alive across everything the app opens; without it each new connection
    # would get an empty database of its own.
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture()
def client(db_session):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as test_client:
        yield test_client
