"""What one member shows another: their picture, and what they have given.

Two small things that both the members list and one member's page need, kept
here so the list and the page can never answer differently. Nothing in this
module reads anything private: a picture somebody chose to be seen as, and a
count of foods they offered the shared database.
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app import models


# How many of a member's offers have to have been taken before they may ask to
# review. One place, because the badge on the row, the check on the way in and
# the number the account is told all have to mean the same thing.
REVIEWER_THRESHOLD = 100


def role_of(user: models.User) -> str | None:
    """What this account is, wherever its name is shown to another member.

    None for most people, which is what a member is. An administrator reviews
    by being one, so the two roles are read off in that order.
    """
    if user.is_admin:
        return "admin"
    return "reviewer" if user.is_reviewer else None


def approved_count(db: Session, user: models.User) -> int:
    """How many foods this account offered that the queue took."""
    return submission_counts(db, [user.id])[user.id]["approved"]


def avatar_url(user: models.User) -> str | None:
    """Where a member's picture is read from, or null when they have none.

    Served under the photos router like every other stored picture, and named
    by the file rather than by the account: a new picture is a new address, so
    a replaced one is never the old one out of a cache.
    """
    if not user.avatar_path:
        return None
    return f"/api/photos/avatar/{user.avatar_path}"


def submission_counts(db: Session, user_ids: Iterable[int]) -> dict[int, dict[str, int]]:
    """How many foods each of these members offered, and how many were taken.

    Only the kind that offers a new food counts. A correction, a picture and a
    report are about somebody else's row rather than a food given to everybody.
    A withdrawn request leaves no row behind, so it is not counted here either.
    """
    wanted = list(user_ids)
    counts = {member: {"submitted": 0, "approved": 0} for member in wanted}
    if not wanted:
        return counts
    rows = db.execute(
        select(
            models.FoodSubmission.submitted_by_id,
            func.count(),
            func.sum(case((models.FoodSubmission.status == "approved", 1), else_=0)),
        )
        .where(
            models.FoodSubmission.kind == "new",
            models.FoodSubmission.submitted_by_id.in_(wanted),
        )
        .group_by(models.FoodSubmission.submitted_by_id)
    ).all()
    for member, submitted, approved in rows:
        if member in counts:
            counts[member] = {"submitted": int(submitted), "approved": int(approved or 0)}
    return counts


def contribution_counts(db: Session, user_ids: Iterable[int]) -> dict[int, int]:
    """How many foods each of these members gave that are still on Tare.

    Counted off the food rather than off the request: a food that was taken
    and has since been deleted stops being a contribution, and the request it
    arrived on keeps its row without one. Distinct foods, because what is
    counted is rows in the shared database, not times somebody asked.
    """
    wanted = list(user_ids)
    counts = {member: 0 for member in wanted}
    if not wanted:
        return counts
    rows = db.execute(
        select(
            models.FoodSubmission.submitted_by_id,
            func.count(models.Food.id.distinct()),
        )
        .join(models.Food, models.Food.id == models.FoodSubmission.food_id)
        .where(
            models.FoodSubmission.kind == "new",
            models.FoodSubmission.status == "approved",
            models.FoodSubmission.submitted_by_id.in_(wanted),
            models.Food.status == "approved",
        )
        .group_by(models.FoodSubmission.submitted_by_id)
    ).all()
    for member, total in rows:
        if member in counts:
            counts[member] = int(total)
    return counts
