"""What everybody with a role did, written down as they do it.

One function, called from inside the action it records, so the row and the
thing it is about are committed together or neither is. A log written after the
fact is a log that disagrees with the database the first time something fails
halfway.

Names are copied in rather than joined to. A food can be deleted and a member
can be renamed, and the record of a decision has to still say who decided what.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app import models


def log_review(
    db: Session,
    actor: models.User,
    action: str,
    target_kind: str,
    target_id: int | None,
    target_name: str,
    detail: object | None = None,
) -> models.ReviewLog:
    """Add one line to the record. Added to the session, never committed here."""
    row = models.ReviewLog(
        actor_id=actor.id,
        actor_name=(actor.display_name or actor.username)[:80],
        action=action,
        target_kind=target_kind,
        target_id=target_id,
        target_name=(target_name or "")[:120],
        detail=detail,
    )
    db.add(row)
    return row
