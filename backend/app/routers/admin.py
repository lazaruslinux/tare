"""The review queue: the only way anything reaches the shared database.

No decision here touches a diary. An entry keeps the numbers it was logged
with, worked out from the food as it stood at that moment, so a decision made
afterwards never rewrites anybody's day. Beside the queue are the two lists only
an administrator has a use for: the invite links that are out, and who is on the
instance.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import ColumnElement, delete, func, or_, select, tuple_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import foods_api, micros, models, profiles, schemas, usda_api
from app.db import get_db
from app.deps import require_admin, require_reviewer
from app.models import FOOD_NUTRIENTS, SUBMISSION_STATUSES, now_utc
from app.review_log import log_review
from app.routers import invites
from app.routers.foods import (
    FRONT_LABEL,
    LABEL_LABEL,
    like_literal,
    photo_url,
    record_changes,
)
from app.routers.photos import discard, published
from app.routers.submissions import (
    ALREADY_SHARED,
    MISSING_PHOTO,
    MISSING_SUBMISSION,
    attach,
    attach_label,
    check_serving,
    drop_shadow,
)

router = APIRouter(prefix="/admin", tags=["admin"])

# One already decided is not in the queue, so it reads the same as one that was
# never there.
NOT_WAITING = "That submission has already been decided."
# A no is the one decision somebody has to be able to answer, so it carries a
# reason or it is not made.
NO_REASON = "Give a reason."
# A reviewer answering their own request is reading the answer to it. An
# administrator is trusted with the whole queue, their own included.
OWN_SUBMISSION = "You can't review your own submission."
NO_FOOD = "The food this was about is gone."
NO_PHOTO = "The photo this was about is gone."
# A picture offered on its own is the picture: there is nothing to swap it for
# that would not simply be a different request.
PHOTO_KIND = "A picture is kept or turned down as it is."
# A report proposes nothing, so there is nothing on it to correct. What it asks
# for is done to the food itself, on the food's own page.
REPORT_KIND = "A report is resolved or dismissed as it is."
BAD_PURPOSE = "A photo is of the front or of the label."

# Granting the role to somebody who already reviews by being an administrator
# would read as a demotion waiting to happen, and there is no demotion here.
ALREADY_REVIEWS = "An administrator already reviews."
MISSING_MEMBER = "There is no such member."

# How many links one administrator may have out at a time. An unclaimed link is
# a way in, and a handful of them is a handful of doors left open.
OPEN_INVITES = 3
TOO_MANY_INVITES = "Three invites are already open."
MISSING_INVITE = "There is no such invite."
# How many people one link may let in. Ten is a group chat; more than that is
# an open door with a code in front of it.
MIN_SEATS = 1
MAX_SEATS = 10
BAD_SEATS = "An invite holds 1 to 10 seats."


def proposed(food: models.Food) -> dict[str, object]:
    """The food as it is being offered: the whole panel, and nothing about who.

    Not the shape /foods/{id} answers with. That one says whether the reader
    owns it and whether they pin it, and neither question means anything to
    somebody reading a queue.
    """
    payload: dict[str, object] = {
        "id": food.id,
        "name": food.name,
        "brand": food.brand,
        "description": food.description,
        "section": food.section,
        "barcode": food.barcode,
        "base_unit": food.base_unit,
        "density_g_per_ml": food.density_g_per_ml,
        "ingredients_text": food.ingredients_text,
        "servings": [
            {
                "name": serving.name,
                "amount": serving.amount,
                "unit": serving.unit,
                "base_amount": serving.base_amount,
                "position": serving.position,
            }
            for serving in food.servings
        ],
    }
    for field in FOOD_NUTRIENTS:
        payload[field] = getattr(food, field)
    return payload


def waiting(db: Session, submission_id: int) -> models.FoodSubmission:
    """The request, held for this transaction, or the refusal for one decided.

    The row is taken before its status is read, so two reviewers tapping at the
    same moment queue up behind each other rather than both deciding. The
    second one is told who got there first, which is the only useful thing to
    say about it. SQLite ignores the lock and the check behind it still holds.
    """
    submission = db.execute(
        select(models.FoodSubmission)
        .where(models.FoodSubmission.id == submission_id)
        .with_for_update()
    ).scalar_one_or_none()
    if submission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_SUBMISSION)
    if submission.status != "pending":
        decider = (
            db.get(models.User, submission.decided_by_id)
            if submission.decided_by_id is not None
            else None
        )
        if decider is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{decider.display_name or decider.username} already decided this.",
            )
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NOT_WAITING)
    return submission


def not_your_own(submission: models.FoodSubmission, reviewer: models.User) -> None:
    """Nobody reviews their own, unless they are the administrator."""
    if not reviewer.is_admin and submission.submitted_by_id == reviewer.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, OWN_SUBMISSION)


def offered_food(db: Session, submission: models.FoodSubmission) -> models.Food:
    food = db.get(models.Food, submission.food_id) if submission.food_id else None
    if food is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_FOOD)
    return food


def shared_target(db: Session, submission: models.FoodSubmission) -> models.Food:
    """The shared food a correction or a picture is about."""
    food = (
        db.get(models.Food, submission.target_food_id) if submission.target_food_id else None
    )
    if food is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_FOOD)
    return food


def stamp(
    submission: models.FoodSubmission, reviewer: models.User, outcome: str, note: str
) -> None:
    submission.status = outcome
    submission.decided_by_id = reviewer.id
    submission.decided_at = now_utc()
    submission.decision_note = note
    # Deciding your own request is reading the answer to it. Left unstamped, a
    # reviewer approving their own food keeps the badge lit over nothing.
    if submission.submitted_by_id == reviewer.id:
        submission.seen_at = now_utc()


def about(db: Session, submission: models.FoodSubmission) -> str:
    """What to call this request in the log: the food it is about, by name."""
    for food_id in (submission.food_id, submission.target_food_id):
        food = db.get(models.Food, food_id) if food_id else None
        if food is not None:
            return food.name
    return ""


def named(food: models.Food) -> dict[str, object]:
    """The shared food a request is about, named well enough to recognise."""
    return {"id": food.id, "name": food.name, "brand": food.brand}


def queue_item(
    db: Session,
    submission: models.FoodSubmission,
    submitted_by: str | None,
    mine: bool = False,
) -> dict[str, object] | None:
    """One waiting request with everything it is judged against.

    Every kind answers in one shape, so the screen reads the same keys whatever
    it is looking at and the ones that do not apply are simply null. None here
    means the thing the request was about has gone, and there is nothing left
    to decide.
    """
    food = db.get(models.Food, submission.food_id) if submission.food_id else None
    target = (
        db.get(models.Food, submission.target_food_id) if submission.target_food_id else None
    )
    photo = db.get(models.FoodPhoto, submission.photo_id) if submission.photo_id else None
    label = (
        db.get(models.FoodPhoto, submission.label_photo_id)
        if submission.label_photo_id
        else None
    )

    if submission.kind == "photo":
        if target is None or photo is None:
            return None
    elif submission.kind == "report":
        if target is None:
            return None
    elif food is None or (submission.kind == "edit" and target is None):
        return None

    # What the food says now. A correction is read beside the thing it would
    # replace; a report is read against the row somebody says is wrong.
    beside = target is not None and submission.kind in ("edit", "report")
    current = published(db, target.id) if submission.kind == "photo" and target else None
    return {
        "id": submission.id,
        "kind": submission.kind,
        "note": submission.note,
        "created_at": submission.created_at,
        # Null once the account that asked is gone. The request is still worth
        # judging; there is just nobody to tell. The name every other screen
        # shows them under, so a reviewer reads one name for one person.
        "submitted_by": submitted_by,
        "submitted_by_id": submission.submitted_by_id,
        # Whether the reader is the one who asked. A reviewer does not decide
        # their own, so the screen greys the row rather than offering it.
        "mine": mine,
        "photo_url": None if photo is None else photo_url(photo.id),
        # The nutrition panel this was read off, for checking the numbers
        # against. Only this screen ever asks for it, and only an
        # administrator is ever served one.
        "label_photo_url": None if label is None else photo_url(label.id),
        "food": None if food is None else proposed(food),
        "target": None if target is None else named(target),
        "current": proposed(target) if beside and target else None,
        "current_photo_url": None if current is None else photo_url(current.id),
    }


def waiting_items(
    db: Session, reviewer: models.User | None = None
) -> list[dict[str, object]]:
    """Everything waiting, oldest first: a queue, not a feed.

    Its own function so the strip that says how many are waiting counts the
    same rows this screen would draw, rather than a number that agrees with it
    most of the time.
    """
    rows = db.execute(
        select(models.FoodSubmission, models.User.username, models.User.display_name)
        .outerjoin(models.User, models.User.id == models.FoodSubmission.submitted_by_id)
        .where(models.FoodSubmission.status == "pending")
        .order_by(models.FoodSubmission.created_at, models.FoodSubmission.id)
        .limit(200)
    ).all()

    queue: list[dict[str, object]] = []
    for submission, username, display_name in rows:
        item = queue_item(
            db,
            submission,
            display_name or username,
            reviewer is not None and submission.submitted_by_id == reviewer.id,
        )
        if item is not None:
            queue.append(item)
    return queue


@router.get("/queue")
def read_queue(
    db: Session = Depends(get_db), reviewer: models.User = Depends(require_reviewer)
) -> list[dict[str, object]]:
    return waiting_items(db, reviewer)


def approve_edit(
    db: Session, submission: models.FoodSubmission, reviewer: models.User
) -> dict[str, object]:
    """Copy a correction onto the shared food, and throw the copy away.

    The barcode and the ingredients are left alone: a correction is about what
    the panel says, and the code on the packet is what the row is found by.
    """
    target = shared_target(db, submission)
    shadow = offered_food(db, submission)
    # A reviewer may have adjusted the copy since it was checked on the way
    # in, and a correction that says nothing about the size of a serving is
    # one nobody can read the numbers against.
    check_serving(shadow.servings)

    target.name = shadow.name
    target.brand = shadow.brand
    target.description = shadow.description
    # Which aisle it is browsed under, which a reviewer confirms or changes
    # the same way they do everything else on the panel.
    target.section = shadow.section
    # The unit the panel and the servings are both counted in, so it travels
    # with them or the numbers underneath it change meaning.
    target.base_unit = shadow.base_unit
    target.density_g_per_ml = shadow.density_g_per_ml
    for field in FOOD_NUTRIENTS:
        setattr(target, field, getattr(shadow, field))
    # Written again rather than moved across: the copy is about to go, and its
    # servings go with it.
    target.servings = [
        models.FoodServing(
            name=serving.name,
            amount=serving.amount,
            unit=serving.unit,
            base_amount=serving.base_amount,
            position=serving.position,
        )
        for serving in shadow.servings
    ]

    # A reviewer may have photographed the pack while reading the correction.
    # A picture that arrived that way is published with it.
    photo = db.get(models.FoodPhoto, submission.photo_id) if submission.photo_id else None
    if photo is not None and photo.status == "pending":
        publish_front(db, target, photo)
    # And the panel the correction was read against becomes the food's own, in
    # place of whatever it was keeping. The same row, not a second file.
    if submission.label_photo_id is not None:
        target.label_photo_id = submission.label_photo_id

    drop_shadow(db, submission)
    stamp(submission, reviewer, "approved", "")
    log_review(
        db, reviewer, "approved", "submission", submission.id, target.name, submission.changes
    )
    db.commit()
    return {"food": proposed(target)}


def publish_front(db: Session, target: models.Food, photo: models.FoodPhoto) -> None:
    """Give a shared food this picture, in place of whatever it was showing."""
    standing = published(db, target.id)
    if standing is not None and standing.id != photo.id:
        # Taken away and written out before the new one takes its place. One
        # food has one published picture, and the two would otherwise both
        # claim that for the length of the transaction.
        discard(db, standing)
        db.flush()
    photo.status = "approved"


def approve_photo(
    db: Session, submission: models.FoodSubmission, reviewer: models.User
) -> dict[str, object]:
    """Give a shared food its picture, in place of whatever it was showing."""
    target = shared_target(db, submission)
    photo = db.get(models.FoodPhoto, submission.photo_id) if submission.photo_id else None
    if photo is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_PHOTO)

    publish_front(db, target, photo)
    stamp(submission, reviewer, "approved", "")
    log_review(db, reviewer, "approved", "submission", submission.id, target.name, [FRONT_LABEL])
    db.commit()
    return {"food": proposed(target)}


def resolve_report(
    db: Session, submission: models.FoodSubmission, reviewer: models.User, note: str
) -> dict[str, object]:
    """Say the report has been dealt with. It changes nothing on the food.

    Whatever the reviewer did about it, they did to the food itself before they
    came back here, and a note is how they say so if it is worth saying.
    """
    target = shared_target(db, submission)
    stamp(submission, reviewer, "approved", note)
    log_review(db, reviewer, "resolved", "submission", submission.id, target.name, note or None)
    db.commit()
    return {"food": proposed(target)}


def shared_with_barcode(db: Session, food: models.Food) -> int | None:
    """The shared food already holding this one's barcode, if there is one."""
    return db.scalar(
        select(models.Food.id).where(
            models.Food.status == "approved",
            models.Food.barcode == food.barcode,
            models.Food.id != food.id,
        )
    )


@router.post("/queue/{submission_id}/approve")
def approve(
    submission_id: int,
    body: schemas.ApproveIn,
    db: Session = Depends(get_db),
    reviewer: models.User = Depends(require_reviewer),
) -> dict[str, object]:
    """Say yes. What that means depends on what was asked for."""
    submission = waiting(db, submission_id)
    not_your_own(submission, reviewer)
    if submission.kind == "edit":
        return approve_edit(db, submission, reviewer)
    if submission.kind == "photo":
        return approve_photo(db, submission, reviewer)
    if submission.kind == "report":
        return resolve_report(db, submission, reviewer, body.note.strip())

    # A new food, published. From here it is everybody's and nobody's.
    food = offered_food(db, submission)
    # The owner could edit it while it waited, so the one thing everybody
    # needs is checked again at the moment it becomes everybody's.
    check_serving(food.servings)

    if food.barcode and shared_with_barcode(db, food) is not None:
        # Refused before anything is written. Two rows in the shared database
        # claiming one barcode is the one state the scanner cannot resolve.
        raise HTTPException(status.HTTP_409_CONFLICT, ALREADY_SHARED)

    food.status = "approved"
    # Let go of the owner. A shared food outlives whoever submitted it, and it
    # is not theirs to edit any more than it is anybody else's.
    food.owner_id = None

    if food.barcode:
        # The cached lookup for this code has been superseded by a row a person
        # checked, so it goes. Every future scan of this packet is answered
        # from here without a request leaving the machine.
        db.execute(
            delete(models.Food).where(
                models.Food.status == "cache", models.Food.barcode == food.barcode
            )
        )

    # Asked about here and nowhere else: a picture offered on its own was
    # offered to be published, and there is nothing to keep or not keep.
    photo = db.get(models.FoodPhoto, submission.photo_id) if submission.photo_id else None
    if photo is not None:
        if body.keep_photo:
            photo.status = "approved"
        else:
            discard(db, photo)

    # The panel it was offered with stays with the food rather than with the
    # request, so a reviewer correcting it later has something to read.
    if submission.label_photo_id is not None:
        food.label_photo_id = submission.label_photo_id

    stamp(submission, reviewer, "approved", "")
    log_review(
        db, reviewer, "approved", "submission", submission.id, food.name, submission.changes
    )
    try:
        db.commit()
    except IntegrityError:
        # Two reviewers approving two waiting foods with one barcode at the
        # same moment. The check above is a read, so both can pass it; the
        # index is the referee, and whoever lost is told the same thing.
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, ALREADY_SHARED) from None
    return {"food": proposed(food)}


def adjustable(db: Session, submission_id: int) -> models.FoodSubmission:
    """A waiting request a reviewer may still change before deciding it."""
    submission = waiting(db, submission_id)
    if submission.kind == "photo":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, PHOTO_KIND)
    if submission.kind == "report":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, REPORT_KIND)
    return submission


@router.post("/queue/{submission_id}/photo", status_code=status.HTTP_204_NO_CONTENT)
def replace_queue_photo(
    submission_id: int,
    body: schemas.QueuePhotoIn,
    db: Session = Depends(get_db),
    reviewer: models.User = Depends(require_reviewer),
) -> None:
    """Put a reviewer's own picture on a waiting request, in place of its own.

    The front of a new food is the picture that food is offered with. The front
    of a correction is a picture nothing is showing yet, so it waits with the
    correction and is published when that is.
    """
    if body.purpose not in models.FOOD_PHOTO_PURPOSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_PURPOSE)
    submission = adjustable(db, submission_id)

    if body.purpose == "front":
        on = submission.food_id if submission.kind == "new" else submission.target_food_id
        if on is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_FOOD)
        standing = (
            db.get(models.FoodPhoto, submission.photo_id) if submission.photo_id else None
        )
        submission.photo_id = attach(db, reviewer, body.photo_id, on)
        label = FRONT_LABEL
    else:
        standing = (
            db.get(models.FoodPhoto, submission.label_photo_id)
            if submission.label_photo_id
            else None
        )
        submission.label_photo_id = attach_label(db, reviewer, body.photo_id)
        label = LABEL_LABEL

    # The new one is written down first, so taking the old one away cannot
    # unpick the row that now points at its replacement.
    db.flush()
    if standing is not None and standing.status == "pending":
        discard(db, standing)
    record_changes(submission, [label])
    log_review(
        db, reviewer, "photo_replaced", "submission", submission.id, about(db, submission), [label]
    )
    db.commit()


@router.delete("/queue/{submission_id}/photo", status_code=status.HTTP_204_NO_CONTENT)
def remove_queue_photo(
    submission_id: int,
    purpose: str,
    db: Session = Depends(get_db),
    reviewer: models.User = Depends(require_reviewer),
) -> None:
    """Take a picture off a waiting request, row and file both."""
    if purpose not in models.FOOD_PHOTO_PURPOSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_PURPOSE)
    submission = adjustable(db, submission_id)

    held = submission.photo_id if purpose == "front" else submission.label_photo_id
    photo = db.get(models.FoodPhoto, held) if held else None
    if photo is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_PHOTO)
    if photo.status == "approved":
        # Published already, which means it belongs to the shared database
        # rather than to this request.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, MISSING_PHOTO)

    discard(db, photo)
    if purpose == "front":
        submission.photo_id = None
    else:
        submission.label_photo_id = None
    label = FRONT_LABEL if purpose == "front" else LABEL_LABEL
    record_changes(submission, [label])
    log_review(
        db, reviewer, "photo_removed", "submission", submission.id, about(db, submission), [label]
    )
    db.commit()


@router.post("/queue/{submission_id}/reject")
def reject(
    submission_id: int,
    body: schemas.RejectIn,
    db: Session = Depends(get_db),
    reviewer: models.User = Depends(require_reviewer),
) -> dict[str, object]:
    """Say no, with a reason, which is not optional. Nothing shared changes.

    A food that was offered goes back to being its submitter's own, privately.
    A correction and a picture leave nothing behind: neither of them was ever
    anybody's food, and a turned-down picture is a deleted row and a deleted
    file rather than a state.
    """
    submission = waiting(db, submission_id)
    not_your_own(submission, reviewer)
    reason = body.note.strip()
    # Read while the food this was about is still reachable: rejecting a
    # correction throws its working copy away.
    name = about(db, submission)
    # Turning something down without saying why is the one decision that leaves
    # somebody with nothing to do about it.
    if not reason:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_REASON)
    if submission.kind == "edit":
        drop_shadow(db, submission)
    else:
        food = db.get(models.Food, submission.food_id) if submission.food_id else None
        if food is not None and food.status == "pending":
            food.status = "custom"

    photo = db.get(models.FoodPhoto, submission.photo_id) if submission.photo_id else None
    if photo is not None and photo.status == "pending":
        discard(db, photo)

    stamp(submission, reviewer, "rejected", reason)
    log_review(db, reviewer, "rejected", "submission", submission.id, name, reason)
    db.commit()
    return {"id": submission.id, "status": submission.status}


# ---- The invite links that are out ----


# How many links the list reaches back over. Newest first, and far enough
# back that a spent one is still there to read.
INVITE_ROWS = 200


def invite_row(
    invite: models.Invite, members: list[str], inviter: str, mine: bool
) -> dict[str, object]:
    """One link, as the screen that hands it out reads it.

    The path and not a whole address: this server does not know what somebody
    typed to reach it, and a link built from a guess is a link that does not
    open. The browser puts its own origin in front of this.
    """
    return {
        "code": invite.code,
        "path": invites.invite_path(invite.code),
        "created_at": invite.created_at,
        "expires_at": invite.expires_at,
        "seats": invite.seats,
        "used": invite.used,
        # Who came in through it, oldest account first. Empty while nobody has.
        "members": members,
        "inviter": inviter,
        # Whether the reader minted it, which is what the allowance counts.
        "mine": mine,
    }


def member_name(user: models.User) -> str:
    """What a member is called on the invite screen."""
    return user.display_name or user.username


def seat_words(seats: int) -> str:
    """How many seats, in words a line of the record can end on."""
    return "1 seat" if seats == 1 else f"{seats} seats"


def open_invites(db: Session, admin: models.User) -> int:
    """How many of this administrator's links are still a way in."""
    total = db.execute(
        select(func.count())
        .select_from(models.Invite)
        .where(
            models.Invite.created_by == admin.id,
            models.Invite.used < models.Invite.seats,
            or_(models.Invite.expires_at.is_(None), models.Invite.expires_at > now_utc()),
        )
    ).scalar_one()
    return int(total)


@router.post("/invites", status_code=status.HTTP_201_CREATED)
def create_invite(
    body: schemas.InviteIn | None = None,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
) -> dict[str, object]:
    """Mint a link that lets one to ten people in, up to three links at a time."""
    seats = body.seats if body is not None else MIN_SEATS
    if not MIN_SEATS <= seats <= MAX_SEATS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_SEATS)
    # The administrator's own row is taken first, so two taps on the button
    # cannot both read two open invites and both write the third.
    db.execute(select(models.User.id).where(models.User.id == admin.id).with_for_update())
    if open_invites(db, admin) >= OPEN_INVITES:
        raise HTTPException(status.HTTP_409_CONFLICT, TOO_MANY_INVITES)
    invite = invites.mint(db, admin, seats=seats)
    db.flush()
    log_review(db, admin, "invite_minted", "invite", invite.id, seat_words(seats))
    db.commit()
    return invite_row(invite, [], member_name(admin), True)


@router.get("/invites")
def read_invites(
    db: Session = Depends(get_db), admin: models.User = Depends(require_admin)
) -> list[dict[str, object]]:
    """Every link this instance has minted, newest first."""
    rows = db.execute(
        select(models.Invite, models.User)
        .join(models.User, models.User.id == models.Invite.created_by)
        .order_by(models.Invite.created_at.desc(), models.Invite.id.desc())
        .limit(INVITE_ROWS)
    ).all()

    # One query for everybody who came in, rather than one per link.
    members: dict[int, list[str]] = {}
    ids = [invite.id for invite, _ in rows]
    if ids:
        for user in db.execute(
            select(models.User)
            .where(models.User.invite_id.in_(ids))
            .order_by(models.User.id)
        ).scalars():
            if user.invite_id is not None:
                members.setdefault(user.invite_id, []).append(member_name(user))

    return [
        invite_row(invite, members.get(invite.id, []), member_name(inviter), inviter.id == admin.id)
        for invite, inviter in rows
    ]


@router.delete("/invites/{code}", status_code=status.HTTP_204_NO_CONTENT)
def delete_invite(
    code: str, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)
) -> None:
    """Delete a link, whatever state it is in.

    A spent one is only the record of who came in through it, so deleting it
    drops that record and leaves the accounts alone.
    """
    invite = db.execute(
        select(models.Invite).where(models.Invite.code == code)
    ).scalar_one_or_none()
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_INVITE)
    # By hand as well as by the foreign key: SQLite does not enforce ON DELETE
    # unless it is asked to, and a member left pointing at a deleted row is a
    # member the list would try to name.
    db.execute(
        update(models.User)
        .where(models.User.invite_id == invite.id)
        .values(invite_id=None)
    )
    log_review(
        db,
        admin,
        "invite_deleted",
        "invite",
        invite.id,
        f"{invite.used} of {invite.seats} used",
    )
    db.delete(invite)
    db.commit()


# ---- What has been uploaded ----

# How far back the list reaches. Long enough to see a pattern, short enough
# that the screen is one read.
UPLOAD_ROWS = 200


@router.get("/uploads")
def read_uploads(
    db: Session = Depends(get_db), admin: models.User = Depends(require_admin)
) -> list[dict[str, object]]:
    """Every file that has been handed to this instance, newest first.

    A file is the one thing here that arrives by hand and can carry anything,
    so who sent one, when, and how large it was is worth an administrator being
    able to read. What was in it is not here and never will be.
    """
    rows = db.execute(
        select(models.IngestLog, models.User.username, models.User.display_name)
        .join(models.User, models.User.id == models.IngestLog.user_id)
        .where(models.IngestLog.dialect == "upload")
        .order_by(models.IngestLog.received_at.desc())
        .limit(UPLOAD_ROWS)
    ).all()
    return [
        {
            "id": row.id,
            "username": username,
            "display_name": display_name,
            "received_at": row.received_at,
            "bytes": row.bytes,
            "accepted": row.accepted,
            "flagged": row.flagged,
            "skipped": row.skipped,
        }
        for row, username, display_name in rows
    ]


# ---- Who is on the instance ----

# One page of the account list. Long enough that a small instance is one
# request, short enough that the screen never draws a thousand rows nobody
# asked for.
USERS_PAGE = 50
# The page marker, shared by both lists here that have one: it is the id of the
# last row handed over and nothing else.
BAD_CURSOR = "That page marker is not one of ours."
# Which slice of the account list is wanted. Not a permission: it is the filter
# above the list, so anything else is a typed mistake said back in words.
USER_ROLES = ("reviewer", "admin", "requested")
BAD_ROLE = "That is not a role Tare has."


def name_match(needle: str) -> ColumnElement[bool]:
    """Where a typed word may sit: the sign-in name, or the chosen one.

    Read by both lists of people, so the account list and the roster can never
    disagree about what a search found. Wildcards are taken out of the word: a
    typed % otherwise matches everybody.
    """
    literal = like_literal(needle.strip().lower())
    return or_(
        func.lower(models.User.username).like(f"%{literal}%", escape="\\"),
        func.lower(func.coalesce(models.User.display_name, "")).like(
            f"%{literal}%", escape="\\"
        ),
    )


@router.get("/users")
def read_users(
    q: str = "",
    role: str | None = None,
    cursor: str | None = None,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
) -> dict[str, object]:
    """One page of everybody with an account, newest first.

    A page and a search box rather than the whole table: every row carries an
    address and a tally, and a list that draws all of them slows as people join.
    Newest first, because the account being asked about is nearly always a
    recent one. The counts are one grouped query scoped to this page's ids
    rather than three per person.
    """
    query = select(models.User)
    if q.strip():
        query = query.where(name_match(q))
    if role is not None:
        if role not in USER_ROLES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_ROLE)
        if role == "reviewer":
            query = query.where(models.User.is_reviewer.is_(True))
        elif role == "admin":
            query = query.where(models.User.is_admin.is_(True))
        else:
            query = query.where(models.User.reviewer_requested_at.is_not(None))
    if cursor is not None:
        if not cursor.isdigit():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_CURSOR)
        seen = db.get(models.User, int(cursor))
        if seen is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_CURSOR)
        # The pair rather than the id alone: two accounts made in the same
        # second would otherwise hide each other at the seam of two pages.
        query = query.where(
            tuple_(models.User.created_at, models.User.id) < (seen.created_at, seen.id)
        )

    query = query.order_by(models.User.created_at.desc(), models.User.id.desc())
    rows = list(db.execute(query.limit(USERS_PAGE + 1)).scalars())
    more = len(rows) > USERS_PAGE
    people = rows[:USERS_PAGE]
    tallies = {
        (user_id, outcome): int(total)
        for user_id, outcome, total in db.execute(
            select(
                models.FoodSubmission.submitted_by_id,
                models.FoodSubmission.status,
                func.count(),
            )
            .where(models.FoodSubmission.submitted_by_id.in_([person.id for person in people]))
            .group_by(models.FoodSubmission.submitted_by_id, models.FoodSubmission.status)
        ).all()
    }
    return {
        "items": [
            {
                "id": person.id,
                "username": person.username,
                "display_name": person.display_name,
                "is_admin": person.is_admin,
                "role": profiles.role_of(person),
                # Whether they have asked to review and nobody has answered yet,
                # and when they asked, which is what the Roles screen reads.
                "requested": person.reviewer_requested_at is not None,
                "requested_at": person.reviewer_requested_at,
                # The address, so an administrator can tell who is sitting behind
                # the verify screen and why.
                "email": person.email,
                "email_verified": person.email_verified,
                "created_at": person.created_at,
                "submissions": {
                    outcome: tallies.get((person.id, outcome), 0)
                    for outcome in SUBMISSION_STATUSES
                },
            }
            for person in people
        ],
        "next_cursor": str(people[-1].id) if more and people else None,
    }


@router.patch("/users/{user_id}")
def set_role(
    user_id: int,
    body: schemas.RoleIn,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
) -> dict[str, object]:
    """Give one member the reviewer role, or take it back.

    Administrators only, and never about an administrator: this screen hands
    out the second role and nothing else. There is no path here to the first
    one, in either direction.
    """
    member = db.get(models.User, user_id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_MEMBER)
    if member.is_admin:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, ALREADY_REVIEWS)

    member.is_reviewer = body.is_reviewer
    # Answered either way, so the request is no longer waiting on anybody. A no
    # to somebody who put their name forward is its own line in the record: the
    # log has to say what happened, and turning an application down is not the
    # same act as taking the role off somebody who had it.
    declined = not body.is_reviewer and member.reviewer_requested_at is not None
    member.reviewer_requested_at = None
    if body.is_reviewer:
        action = "role_granted"
    else:
        action = "application_declined" if declined else "role_revoked"
    log_review(
        db,
        admin,
        action,
        "user",
        member.id,
        member.display_name or member.username,
    )
    db.commit()
    return {"id": member.id, "role": profiles.role_of(member), "requested": False}


# ---- What everybody with a role has done ----

# One page of the record. Long enough to read a morning's reviewing in one go,
# short enough that the screen is one request.
LOG_PAGE = 50


@router.get("/review-log")
def read_review_log(
    cursor: str | None = None,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
) -> dict[str, object]:
    """Every review action, newest first. An administrator's screen alone.

    The marker is the id of the last row handed over. Ids only ever climb here,
    so one number is the whole of a page marker.
    """
    query = select(models.ReviewLog).order_by(models.ReviewLog.id.desc()).limit(LOG_PAGE + 1)
    if cursor is not None:
        if not cursor.isdigit():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_CURSOR)
        query = query.where(models.ReviewLog.id < int(cursor))

    rows = list(db.execute(query).scalars())
    more = len(rows) > LOG_PAGE
    page = rows[:LOG_PAGE]
    return {
        "items": [
            {
                "id": row.id,
                "when": row.created_at,
                "actor_name": row.actor_name,
                "action": row.action,
                "target_kind": row.target_kind,
                "target_id": row.target_id,
                "target_name": row.target_name,
                "detail": row.detail,
            }
            for row in page
        ],
        "next_cursor": str(page[-1].id) if more and page else None,
    }


# ---- Vitamin matches ----

# A food with a barcode is matched by that barcode and needs nobody. These are
# the ones with none, where FoodData Central was asked about a name and a name
# is a guess, so an administrator says which of the guesses is right.
MISSING_MATCH = "That match is not waiting on a decision."
NOT_A_CANDIDATE = "That is not one of the records offered for this food."
NO_RECORD = "FoodData Central has nothing under that record any more."
NO_VITAMINS = "That record carries no vitamins or minerals."


def waiting_match(db: Session, match_id: int) -> models.MicroMatch:
    row = db.get(models.MicroMatch, match_id)
    if row is None or row.status != "pending":
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_MATCH)
    return row


@router.get("/micro-matches")
def read_micro_matches(
    db: Session = Depends(get_db), admin: models.User = Depends(require_admin)
) -> list[dict[str, object]]:
    """Every food waiting on somebody to say which record it is."""
    rows = db.execute(
        select(models.MicroMatch, models.Food)
        .join(models.Food, models.Food.id == models.MicroMatch.food_id)
        .where(models.MicroMatch.status == "pending")
        .order_by(models.MicroMatch.id)
    ).all()
    return [
        {
            "id": match.id,
            "food_id": food.id,
            "name": food.name,
            "brand": food.brand,
            # The panel on file, so a decision can be checked against the
            # numbers rather than made on a name alone.
            "label_photo_url": photo_url(food.label_photo_id),
            "candidates": match.candidates,
        }
        for match, food in rows
    ]


@router.post("/micro-matches/{match_id}/apply")
def apply_micro_match(
    match_id: int,
    body: schemas.MicroPickIn,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
) -> dict[str, object]:
    """Take one record's vitamins into the food, filling only what is empty.

    The ten figures on the panel are never touched. They were read off a label
    somebody photographed, and a record that agrees with them adds nothing while
    one that disagrees is not the food.
    """
    match = waiting_match(db, match_id)
    offered = {
        candidate.get("fdc_id")
        for candidate in match.candidates
        if isinstance(candidate, dict)
    }
    if body.fdc_id not in offered:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NOT_A_CANDIDATE)
    food = db.get(models.Food, match.food_id)
    if food is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NO_FOOD)

    try:
        record = usda_api.food(body.fdc_id)
    except foods_api.FoodApiError as failure:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(failure)) from None
    if not record:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, NO_RECORD)
    found = usda_api.read_micros(record)
    if not found:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, NO_VITAMINS)

    added = micros.fill_empty(food, found, "usda", str(body.fdc_id))
    match.status = "applied"
    match.decided_at = now_utc()
    match.decided_by_id = admin.id
    log_review(
        db,
        admin,
        "micros_applied",
        "food",
        food.id,
        food.name,
        {"fdc_id": body.fdc_id, "keys": added},
    )
    db.commit()
    return {"filled": len(added)}


@router.post("/micro-matches/{match_id}/skip")
def skip_micro_match(
    match_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
) -> dict[str, object]:
    """None of these is the food. Kept as a decision rather than deleted, so the
    backfill does not ask again until it is asked to with --again."""
    match = waiting_match(db, match_id)
    match.status = "skipped"
    match.decided_at = now_utc()
    match.decided_by_id = admin.id
    db.commit()
    return {"skipped": True}
