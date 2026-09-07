"""Who a member shares with.

A friendship is mutual and one row: whoever asked is the requester, and it
counts for nothing until the other side accepts. The feed and a shared workout
both read the set from here, so neither of them can end up wider than the other.
"""

from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app import models


def friend_ids(db: Session, user: models.User) -> set[int]:
    """Every member this account has an accepted friendship with.

    Either side may have done the asking, so the row is read both ways round
    and the other member is whichever of the two is not this one.
    """
    rows = db.execute(
        select(models.Friendship.requester_id, models.Friendship.addressee_id).where(
            models.Friendship.accepted_at.is_not(None),
            or_(
                models.Friendship.requester_id == user.id,
                models.Friendship.addressee_id == user.id,
            ),
        )
    )
    return {
        addressee if requester == user.id else requester for requester, addressee in rows
    }
