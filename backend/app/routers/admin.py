"""The review queue: the only way anything reaches the shared database.

Approving a new food does two things and no more. It changes the row's status
and lets go of its owner, so what was one person's becomes everybody's, and it
deletes the cached lookup for that barcode, so the next scan of the packet is
answered out of this database rather than off somebody else's server.

The other two kinds change something that is already shared. A correction is
copied onto the food it is about and its working copy is thrown away; a picture
replaces whatever the food was showing, row and file both.

What none of them does is touch a diary. An entry keeps the numbers it was
logged with, worked out from the food as it stood at that moment, and a decision
made afterwards does not reach back and rewrite anybody's day. The submitter's
entries keep pointing at the same food, which is now the shared one.

Beside the queue, the two lists that only an administrator has any use for: the
invite links that are out, and who is on the instance.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app import models, schemas
from app.db import get_db
from app.deps import require_admin
from app.models import NUTRIENTS, SUBMISSION_STATUSES, now_utc
from app.routers import invites
from app.routers.foods import (
    FRONT_LABEL,
    LABEL_LABEL,
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
NO_FOOD = "The food this was about is gone."
NO_PHOTO = "The photo this was about is gone."
# A picture offered on its own is the picture: there is nothing to swap it for
# that would not simply be a different request.
PHOTO_KIND = "A picture is kept or turned down as it is."
# A report proposes nothing, so there is nothing on it to correct. What it asks
# for is done to the food itself, on the food's own page.
REPORT_KIND = "A report is resolved or dismissed as it is."
BAD_PURPOSE = "A photo is of the front or of the label."

# How many links one administrator may have out at a time. An unclaimed link is
# a way in, and a handful of them is a handful of doors left open.
OPEN_INVITES = 3
TOO_MANY_INVITES = "Three invites are already open."
MISSING_INVITE = "There is no such invite."
INVITE_USED = "That invite has already been used."


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
    for field in NUTRIENTS:
        payload[field] = getattr(food, field)
    return payload


def waiting(db: Session, submission_id: int) -> models.FoodSubmission:
    submission = db.get(models.FoodSubmission, submission_id)
    if submission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_SUBMISSION)
    if submission.status != "pending":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NOT_WAITING)
    return submission


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


def stamp(submission: models.FoodSubmission, admin: models.User, outcome: str, note: str) -> None:
    submission.status = outcome
    submission.decided_by_id = admin.id
    submission.decided_at = now_utc()
    submission.decision_note = note
    # Deciding your own request is reading the answer to it. Left unstamped, an
    # administrator approving their own food keeps the badge lit over nothing.
    if submission.submitted_by_id == admin.id:
        submission.seen_at = now_utc()


def named(food: models.Food) -> dict[str, object]:
    """The shared food a request is about, named well enough to recognise."""
    return {"id": food.id, "name": food.name, "brand": food.brand}


def queue_item(
    db: Session, submission: models.FoodSubmission, username: str | None
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
        # judging; there is just nobody to tell.
        "submitted_by": username,
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


def waiting_items(db: Session) -> list[dict[str, object]]:
    """Everything waiting, oldest first: a queue, not a feed.

    Its own function so the strip that says how many are waiting counts the
    same rows this screen would draw, rather than a number that agrees with it
    most of the time.
    """
    rows = db.execute(
        select(models.FoodSubmission, models.User.username)
        .outerjoin(models.User, models.User.id == models.FoodSubmission.submitted_by_id)
        .where(models.FoodSubmission.status == "pending")
        .order_by(models.FoodSubmission.created_at, models.FoodSubmission.id)
        .limit(200)
    ).all()

    queue: list[dict[str, object]] = []
    for submission, username in rows:
        item = queue_item(db, submission, username)
        if item is not None:
            queue.append(item)
    return queue


@router.get("/queue")
def read_queue(
    db: Session = Depends(get_db), admin: models.User = Depends(require_admin)
) -> list[dict[str, object]]:
    return waiting_items(db)


def approve_edit(
    db: Session, submission: models.FoodSubmission, admin: models.User
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
    for field in NUTRIENTS:
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
    stamp(submission, admin, "approved", "")
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
    db: Session, submission: models.FoodSubmission, admin: models.User
) -> dict[str, object]:
    """Give a shared food its picture, in place of whatever it was showing."""
    target = shared_target(db, submission)
    photo = db.get(models.FoodPhoto, submission.photo_id) if submission.photo_id else None
    if photo is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_PHOTO)

    publish_front(db, target, photo)
    stamp(submission, admin, "approved", "")
    db.commit()
    return {"food": proposed(target)}


def resolve_report(
    db: Session, submission: models.FoodSubmission, admin: models.User, note: str
) -> dict[str, object]:
    """Say the report has been dealt with. It changes nothing on the food.

    Whatever the reviewer did about it, they did to the food itself before they
    came back here, and a note is how they say so if it is worth saying.
    """
    target = shared_target(db, submission)
    stamp(submission, admin, "approved", note)
    db.commit()
    return {"food": proposed(target)}


@router.post("/queue/{submission_id}/approve")
def approve(
    submission_id: int,
    body: schemas.ApproveIn,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
) -> dict[str, object]:
    """Say yes. What that means depends on what was asked for."""
    submission = waiting(db, submission_id)
    if submission.kind == "edit":
        return approve_edit(db, submission, admin)
    if submission.kind == "photo":
        return approve_photo(db, submission, admin)
    if submission.kind == "report":
        return resolve_report(db, submission, admin, body.note.strip())

    # A new food, published. From here it is everybody's and nobody's.
    food = offered_food(db, submission)
    # The owner could edit it while it waited, so the one thing everybody
    # needs is checked again at the moment it becomes everybody's.
    check_serving(food.servings)

    if food.barcode:
        clash = db.execute(
            select(models.Food.id).where(
                models.Food.status == "approved",
                models.Food.barcode == food.barcode,
                models.Food.id != food.id,
            )
        ).first()
        if clash is not None:
            # Refused before anything is written. Two rows in the shared
            # database claiming one barcode is the one state the scanner
            # cannot resolve.
            raise HTTPException(status.HTTP_409_CONFLICT, ALREADY_SHARED)

    food.status = "approved"
    # Let go of the owner. A shared food outlives whoever submitted it, and it
    # is not theirs to edit any more than it is anybody else's.
    food.owner_id = None

    # It is nobody's food now, so the person who entered it is given a place
    # for it on their own list, which is where they have always found it.
    if submission.submitted_by_id is not None:
        already = db.execute(
            select(models.KeptFood.id).where(
                models.KeptFood.user_id == submission.submitted_by_id,
                models.KeptFood.food_id == food.id,
            )
        ).first()
        if already is None:
            db.add(models.KeptFood(user_id=submission.submitted_by_id, food_id=food.id))

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

    stamp(submission, admin, "approved", "")
    db.commit()
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
    admin: models.User = Depends(require_admin),
) -> None:
    """Put a reviewer's own picture on a waiting request, in place of its own.

    The front of a new food is the picture that food is offered with. The front
    of a correction is a picture nothing is showing yet, so it waits with the
    correction and is published when that is.
    """
    if body.purpose not in models.PHOTO_PURPOSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BAD_PURPOSE)
    submission = adjustable(db, submission_id)

    if body.purpose == "front":
        about = submission.food_id if submission.kind == "new" else submission.target_food_id
        if about is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_FOOD)
        standing = (
            db.get(models.FoodPhoto, submission.photo_id) if submission.photo_id else None
        )
        submission.photo_id = attach(db, admin, body.photo_id, about)
        label = FRONT_LABEL
    else:
        standing = (
            db.get(models.FoodPhoto, submission.label_photo_id)
            if submission.label_photo_id
            else None
        )
        submission.label_photo_id = attach_label(db, admin, body.photo_id)
        label = LABEL_LABEL

    # The new one is written down first, so taking the old one away cannot
    # unpick the row that now points at its replacement.
    db.flush()
    if standing is not None and standing.status == "pending":
        discard(db, standing)
    record_changes(submission, [label])
    db.commit()


@router.delete("/queue/{submission_id}/photo", status_code=status.HTTP_204_NO_CONTENT)
def remove_queue_photo(
    submission_id: int,
    purpose: str,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
) -> None:
    """Take a picture off a waiting request, row and file both."""
    if purpose not in models.PHOTO_PURPOSES:
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
    record_changes(submission, [FRONT_LABEL if purpose == "front" else LABEL_LABEL])
    db.commit()


@router.post("/queue/{submission_id}/reject")
def reject(
    submission_id: int,
    body: schemas.RejectIn,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
) -> dict[str, object]:
    """Say no, with a reason, which is not optional. Nothing shared changes.

    A food that was offered goes back to being its submitter's own, privately.
    A correction and a picture leave nothing behind: neither of them was ever
    anybody's food, and a turned-down picture is a deleted row and a deleted
    file rather than a state.
    """
    submission = waiting(db, submission_id)
    reason = body.note.strip()
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

    stamp(submission, admin, "rejected", reason)
    db.commit()
    return {"id": submission.id, "status": submission.status}


# ---- The invite links that are out ----


def invite_row(invite: models.Invite, used_by: str | None) -> dict[str, object]:
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
        # Null while it is still a way in. A name here is the record of who
        # came through it.
        "used_by": used_by,
    }


def open_invites(db: Session, admin: models.User) -> int:
    """How many of this administrator's links are still a way in."""
    total = db.execute(
        select(func.count())
        .select_from(models.Invite)
        .where(
            models.Invite.created_by == admin.id,
            models.Invite.used_by.is_(None),
            models.Invite.revoked_at.is_(None),
            or_(models.Invite.expires_at.is_(None), models.Invite.expires_at > now_utc()),
        )
    ).scalar_one()
    return int(total)


@router.post("/invites", status_code=status.HTTP_201_CREATED)
def create_invite(
    db: Session = Depends(get_db), admin: models.User = Depends(require_admin)
) -> dict[str, object]:
    """Mint a link that lets one person in, up to three at a time."""
    # The administrator's own row is taken first, so two taps on the button
    # cannot both read two open invites and both write the third.
    db.execute(select(models.User.id).where(models.User.id == admin.id).with_for_update())
    if open_invites(db, admin) >= OPEN_INVITES:
        raise HTTPException(status.HTTP_409_CONFLICT, TOO_MANY_INVITES)
    invite = invites.mint(db, admin)
    db.commit()
    return invite_row(invite, None)


@router.get("/invites")
def read_invites(
    db: Session = Depends(get_db), admin: models.User = Depends(require_admin)
) -> list[dict[str, object]]:
    """Every link this instance has minted, newest first."""
    rows = db.execute(
        select(models.Invite, models.User.username)
        .outerjoin(models.User, models.User.id == models.Invite.used_by)
        .order_by(models.Invite.created_at.desc(), models.Invite.id.desc())
        .limit(200)
    ).all()
    return [invite_row(invite, username) for invite, username in rows]


@router.delete("/invites/{code}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invite(
    code: str, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)
) -> None:
    """Take a link back, by deleting it. Only one nobody has used yet."""
    invite = db.execute(
        select(models.Invite).where(models.Invite.code == code)
    ).scalar_one_or_none()
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MISSING_INVITE)
    if invite.used_by is not None:
        # Somebody came in through it. The row is the record of that, and a
        # record is not a door left open.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVITE_USED)
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


@router.get("/users")
def read_users(
    db: Session = Depends(get_db), admin: models.User = Depends(require_admin)
) -> list[dict[str, object]]:
    """Everybody with an account, and how much each has offered.

    The counts are one grouped query rather than three per person: a small
    instance would not notice the difference and a list that scales by asking
    once is the one worth writing.
    """
    tallies = {
        (user_id, outcome): int(total)
        for user_id, outcome, total in db.execute(
            select(
                models.FoodSubmission.submitted_by_id,
                models.FoodSubmission.status,
                func.count(),
            )
            .where(models.FoodSubmission.submitted_by_id.is_not(None))
            .group_by(models.FoodSubmission.submitted_by_id, models.FoodSubmission.status)
        ).all()
    }
    people = db.execute(select(models.User).order_by(models.User.id)).scalars()
    return [
        {
            "id": person.id,
            "username": person.username,
            "display_name": person.display_name,
            "is_admin": person.is_admin,
            "email_verified": person.email_verified,
            "created_at": person.created_at,
            "submissions": {
                outcome: tallies.get((person.id, outcome), 0)
                for outcome in SUBMISSION_STATUSES
            },
        }
        for person in people
    ]
