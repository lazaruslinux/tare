"""The shell commands, run the way somebody at a shell runs them.

A database of their own rather than the client fixture's: these open their own
session through manage.SessionLocal instead of taking one from the app.
"""

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import manage
from app import models, security
from app.db import Base
from app.models import now_utc
from tests.conftest import BIRTHDATE, PASSWORD


@pytest.fixture()
def sessions(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(manage, "SessionLocal", factory)
    yield factory
    engine.dispose()


def run(*argv: str) -> int:
    """One command, through the parser, so the wiring is under test too."""
    args = manage.build_parser().parse_args(argv)
    return int(args.run(args))


def member(sessions, username="member", admin=False):
    with sessions() as db:
        db.add(
            models.User(
                username=username,
                password_hash=security.hash_password(PASSWORD),
                email=None,
                email_verified=True,
                birthdate=BIRTHDATE,
                is_admin=admin,
                units="imperial",
                timezone="UTC",
                feed_hidden=[],
                created_at=now_utc(),
            )
        )
        db.commit()


def is_admin(sessions, username="member") -> bool:
    with sessions() as db:
        return bool(
            db.execute(
                select(models.User.is_admin).where(models.User.username == username)
            ).scalar_one()
        )


def test_grant_admin_makes_an_existing_account_an_administrator(sessions, capsys):
    member(sessions)

    assert run("grant-admin", "--username", "member") == 0
    assert is_admin(sessions) is True
    assert "member is an administrator." in capsys.readouterr().out


def test_the_name_is_read_the_way_the_front_door_reads_it(sessions):
    member(sessions)
    assert run("grant-admin", "--username", "  MEMBER ") == 0
    assert is_admin(sessions) is True


def test_a_username_nobody_has_is_refused(sessions, capsys):
    member(sessions)

    assert run("grant-admin", "--username", "stranger") == 2
    assert capsys.readouterr().err.strip() == "No account has that username."
    assert is_admin(sessions) is False
