"""The two messages this instance sends, and the log lines it writes instead.

Mail is optional on purpose. An instance with no SMTP settings creates accounts
already verified, so a household install never has to stand up a mail server to
let anybody in; the settings being present is what turns verification on.
"""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from app.config import settings
from app.security import RESET_TOKEN_HOURS, VERIFY_TOKEN_HOURS

log = logging.getLogger("tare.mail")

_SUBJECT = "Verify your Tare account"

_BODY = """Someone created a Tare account with this address.

Open this link to finish signing up:

{url}

The link works once and stops working after {hours} hours. If this was not you,
ignore this message.
"""


_RESET_SUBJECT = "Reset your Tare password"

_RESET_BODY = """Someone asked to reset the Tare password for this address.

Open this link to choose a new one:

{url}

The link works once and stops working after {hours} hour. If this was not you,
ignore this message. Your password stays as it is until the link is used.
"""


def configured() -> bool:
    """Whether this instance can send mail at all.

    All of it or none of it: a host with no credentials and no From address is
    a half-filled form rather than a working relay, and treating that as
    configured would create accounts that can never verify.
    """
    return all(
        (settings.smtp_host, settings.smtp_user, settings.smtp_password, settings.smtp_from)
    )


def verification_url(token: str) -> str:
    """The link that lands on the frontend, which reads the token and calls the API."""
    return f"{settings.site_url.rstrip('/')}/verify-email?token={token}"


def reset_url(token: str) -> str:
    """The link that lands on the frontend, which reads the token and calls the API."""
    return f"{settings.site_url.rstrip('/')}/reset-password?token={token}"


def send_verification(address: str, token: str) -> None:
    """Mail a link that finishes a signup, or log it when there is nowhere to
    mail it. Called after the response has gone out, so a slow mail server is
    never a slow request, and nothing here raises: the caller is already gone
    and the person waiting can always ask for another link."""
    url = verification_url(token)
    if not configured():
        # Warning rather than info so it survives whatever log filtering the
        # container runs with: on such an install this line is the only copy.
        log.warning("No SMTP configured. Verification link for %s: %s", address, url)
        return
    send(address, _SUBJECT, _BODY.format(url=url, hours=VERIFY_TOKEN_HOURS))


def send_reset(address: str, token: str) -> None:
    """Mail a link that sets a new password, or log it when there is nowhere to
    mail it. Called after the response has gone out, like the verification
    message, and for the same reason: the answer is the same sentence whether
    or not there was anybody to write to."""
    url = reset_url(token)
    if not configured():
        # Warning rather than info so it survives whatever log filtering the
        # container runs with: on such an install this line is the only copy.
        log.warning("No SMTP configured. Reset link for %s: %s", address, url)
        return
    send(address, _RESET_SUBJECT, _RESET_BODY.format(url=url, hours=RESET_TOKEN_HOURS))


def send(to: str, subject: str, body: str) -> None:
    """One plain-text message over STARTTLS."""
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_from
    message["To"] = to
    message.set_content(body)

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
            server.starttls()
            server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(message)
    except (smtplib.SMTPException, OSError):
        # The link is deliberately not repeated here. It is a working
        # credential, and a log kept for troubleshooting is read by more people
        # than the inbox it was meant for.
        log.exception("Could not send mail to %s", to)
