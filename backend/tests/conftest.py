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
os.environ.setdefault("TARE_TZ", "America/New_York")

import datetime as dt  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import models, security, throttle  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import Base, get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import now_utc  # noqa: E402

# What the registration and sign-in cases use throughout. Long enough to clear
# the minimum, and the same everywhere so a failing case is never about typing.
PASSWORD = "correct-horse-9"

# tare is for adults, so every account a case builds is one (decision 21). A
# fixed date rather than one counted back from today, so a case that freezes
# the clock is never arguing with the fixture that made its account.
BIRTHDATE = dt.date(1990, 4, 2)


@pytest.fixture(autouse=True)
def media_dir(tmp_path):
    """Every case writes its files where it can throw them away.

    Autouse and unconditional: the configured directory is a real path on a
    deployment, and a test suite that can reach it is a test suite that can
    delete somebody's photos.
    """
    was = settings.media_dir
    settings.media_dir = str(tmp_path / "media")
    yield tmp_path / "media"
    settings.media_dir = was


@pytest.fixture(autouse=True)
def feedback_path(tmp_path):
    """The same reason as the directory above: the configured path is a real
    file on a deployment, and a suite that can reach it can wipe it."""
    was = settings.feedback_path
    settings.feedback_path = str(tmp_path / "feedback.md")
    yield tmp_path / "feedback.md"
    settings.feedback_path = was


@pytest.fixture(autouse=True)
def _clean_limiters():
    """The limiters live in module state, so one case's attempts would
    otherwise be counted against the next one's allowance."""
    throttle.reset_limiters()
    yield
    throttle.reset_limiters()


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


@pytest.fixture()
def make_user(db_session):
    """Put an account straight into the database, skipping the front door.

    Registration is a thing under test rather than a way to set one up, so
    everything that only needs somebody signed in builds them here.
    """

    def build(
        username="member",
        *,
        admin=False,
        verified=True,
        email=None,
        password=PASSWORD,
        timezone="UTC",
        birthdate=BIRTHDATE,
    ):
        user = models.User(
            username=username,
            password_hash=security.hash_password(password),
            email=email,
            email_verified=verified,
            birthdate=birthdate,
            is_admin=admin,
            units="imperial",
            timezone=timezone,
            feed_hidden=[],
            created_at=now_utc(),
        )
        db_session.add(user)
        db_session.commit()
        return user

    return build


@pytest.fixture()
def admin(make_user):
    return make_user("admin", admin=True)


@pytest.fixture()
def invite(db_session, admin):
    """A one-seat code minted by the administrator, with no expiry."""
    row = models.Invite(
        code="an-invite-code",
        created_by=admin.id,
        seats=1,
        used=0,
        created_at=now_utc(),
        expires_at=None,
    )
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture()
def signed_in(client, make_user):
    """A verified ordinary account, with the client already holding its cookie."""
    user = make_user("member")
    response = client.post(
        "/api/auth/login", json={"username": "member", "password": PASSWORD}
    )
    assert response.status_code == 200
    return user


@pytest.fixture()
def admin_client(client, admin):
    """The same client, signed in as the administrator."""
    response = client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD})
    assert response.status_code == 200
    return client
