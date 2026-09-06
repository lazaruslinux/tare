#!/usr/bin/env python3
"""Administrative entry point.

The things somebody running an instance has to do from a shell, because there
is deliberately no way to do them from the browser: make the first account,
mint a link that lets somebody else in, and mark an address verified when there
is no mail server to answer.
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys
from getpass import getpass

from sqlalchemy import func, or_, select

from app import health, models, security, thumbs
from app.config import check_deploy_config
from app.db import SessionLocal
from app.models import now_utc
from app.routers import invites
from app.routers.admin import BAD_SEATS, MAX_SEATS, MIN_SEATS
from app.routers.auth import MIN_AGE


def create_admin(args: argparse.Namespace) -> int:
    """Make an administrator, verified and ready to sign in.

    The password is prompted for rather than taken as an argument: an argument
    is in the shell history and in the process list of every other user on the
    machine.
    """
    with SessionLocal() as db:
        name = args.username.strip().lower()
        if not security.USERNAME_PATTERN.match(name):
            print(
                "Username must be 3 to 32 characters: lowercase letters, numbers, "
                "dot, dash, underscore.",
                file=sys.stderr,
            )
            return 1

        email = args.email.strip().lower() if args.email else None
        if email is not None and not security.EMAIL_PATTERN.match(email):
            print("That does not look like an email address.", file=sys.stderr)
            return 1

        try:
            birthdate = dt.date.fromisoformat(args.birthdate)
        except ValueError:
            print("Birthdate must be written as YYYY-MM-DD.", file=sys.stderr)
            return 1
        # The same rule the front door holds everybody to (decision 21).
        today = now_utc().date()
        if birthdate > today or health.age_on(birthdate, today) < MIN_AGE:
            print(f"Tare is for adults {MIN_AGE} and over.", file=sys.stderr)
            return 1

        conflicts = [models.User.username == name]
        if email is not None:
            conflicts.append(func.lower(models.User.email) == email)
        if db.execute(select(models.User.id).where(or_(*conflicts))).first() is not None:
            print("That username or email is already taken.", file=sys.stderr)
            return 1

        password = getpass("Password: ")
        if password != getpass("Repeat password: "):
            print("The two passwords do not match.", file=sys.stderr)
            return 1
        if not security.MIN_PASSWORD_LENGTH <= len(password) <= security.MAX_PASSWORD_LENGTH:
            print(
                f"Password must be between {security.MIN_PASSWORD_LENGTH} and "
                f"{security.MAX_PASSWORD_LENGTH} characters.",
                file=sys.stderr,
            )
            return 1

        db.add(
            models.User(
                username=name,
                password_hash=security.hash_password(password),
                email=email,
                # Verified outright: there is nobody to send a link to this
                # account, and it is the account that lets everyone else in.
                email_verified=True,
                birthdate=birthdate,
                is_admin=True,
                units="imperial",
                timezone="UTC",
                feed_hidden=[],
                created_at=now_utc(),
            )
        )
        db.commit()
    print(f"Created administrator {name}.")
    return 0


def create_invite(args: argparse.Namespace) -> int:
    """Mint a code and print the path it lives at."""
    if not MIN_SEATS <= args.seats <= MAX_SEATS:
        print(BAD_SEATS, file=sys.stderr)
        return 2

    with SessionLocal() as db:
        # The lowest-numbered administrator, which on a fresh instance is the
        # only one. A code has to be minted by somebody, and the welcome page
        # names them.
        admin = db.execute(
            select(models.User)
            .where(models.User.is_admin.is_(True))
            .order_by(models.User.id)
        ).scalars().first()
        if admin is None:
            print("There is no administrator yet. Run create-admin first.", file=sys.stderr)
            return 1

        invite = invites.mint(db, admin, args.days, args.seats)
        code, expires, seats = invite.code, invite.expires_at, invite.seats
        db.commit()

    print(f"Code:  {code}")
    print(f"Path:  {invites.invite_path(code)}")
    print(f"Seats: {seats}")
    if expires is None:
        print("Expires: never, until it is claimed.")
    else:
        print(f"Expires: {expires.date().isoformat()}")
    return 0


def verify_email(args: argparse.Namespace) -> int:
    """Mark an account verified by hand, for an instance that sends no mail."""
    with SessionLocal() as db:
        user = db.execute(
            select(models.User).where(models.User.username == args.username.strip().lower())
        ).scalar_one_or_none()
        if user is None:
            print("No account has that username.", file=sys.stderr)
            return 1
        user.email_verified = True
        db.commit()
        print(f"{user.username} is verified.")
    return 0


def make_thumbnails(args: argparse.Namespace) -> int:
    """Write the small copy of every front photo that is missing one."""
    with SessionLocal() as db:
        written = thumbs.backfill(db)
    print(f"Wrote {written} thumbnails.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="manage.py", description="Tare administration")
    commands = parser.add_subparsers(dest="command", metavar="command")

    admin = commands.add_parser("create-admin", help="make an administrator account")
    admin.add_argument("--username", required=True)
    admin.add_argument("--birthdate", required=True, help="YYYY-MM-DD")
    admin.add_argument("--email", default="")
    admin.set_defaults(run=create_admin)

    invite = commands.add_parser("create-invite", help="mint an invite link")
    invite.add_argument(
        "--days", type=int, default=0, help="days until it expires; omit for no expiry"
    )
    invite.add_argument(
        "--seats", type=int, default=1, help="how many people it lets in, 1 to 10"
    )
    invite.set_defaults(run=create_invite)

    verify = commands.add_parser("verify-email", help="mark an account verified")
    verify.add_argument("--username", required=True)
    verify.set_defaults(run=verify_email)

    photos = commands.add_parser(
        "make-thumbnails", help="write the missing small copies of stored front photos"
    )
    photos.set_defaults(run=make_thumbnails)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.command is None:
        parser.print_help()
        return 1
    # The same refusal the application makes. Writing accounts into a
    # half-configured install is how rows end up in a database nobody meant.
    check_deploy_config()
    return int(args.run(args))


if __name__ == "__main__":
    raise SystemExit(main())
