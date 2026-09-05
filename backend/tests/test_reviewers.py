"""The second role: what a reviewer may do, what they may not, and the record.

The cases that matter are the boundary ones. A reviewer reaches the queue and
the shared foods and nothing else about the instance, an administrator keeps
everything they had, and every decision either of them makes leaves a line
somebody can read afterwards.
"""

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app import models
from app.models import now_utc
from app.profiles import REVIEWER_THRESHOLD
from app.routers.photos import readable_photo
from tests.conftest import PASSWORD

PANEL = {
    "calories": 250,
    "protein_g": 9,
    "carbs_g": 40,
    "fat_g": 5,
}


def sign_in(client, username):
    response = client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200


def make_reviewer(db, make_user, username="reviewer"):
    user = make_user(username)
    user.is_reviewer = True
    db.commit()
    return user


def a_food(db, owner=None, status="pending", name="Oat bar"):
    food = models.Food(
        status=status,
        owner_id=None if owner is None or status == "approved" else owner.id,
        created_by_id=None if owner is None else owner.id,
        name=name,
        base_unit="g",
        section="snacks",
        **PANEL,
    )
    food.servings = [
        models.FoodServing(name="1 bar", amount=40, unit="g", base_amount=40, position=0)
    ]
    db.add(food)
    db.commit()
    return food


def a_request(db, member, food, kind="new"):
    row = models.FoodSubmission(
        kind=kind, status="pending", submitted_by_id=member.id, food_id=food.id
    )
    db.add(row)
    db.commit()
    return row


def log_rows(db):
    """Everything written down so far, oldest first."""
    return list(db.execute(select(models.ReviewLog).order_by(models.ReviewLog.id)).scalars())


# What a reviewer may do
# ----------------------


def test_a_reviewer_reads_the_queue_and_approves_what_is_in_it(
    client, db_session, make_user
):
    member = make_user("member")
    make_reviewer(db_session, make_user)
    food = a_food(db_session, member)
    request = a_request(db_session, member, food)
    sign_in(client, "reviewer")

    queue = client.get("/api/admin/queue")
    assert queue.status_code == 200
    assert [item["id"] for item in queue.json()] == [request.id]

    decided = client.post(f"/api/admin/queue/{request.id}/approve", json={})
    assert decided.status_code == 200
    db_session.refresh(food)
    assert food.status == "approved"

    row = log_rows(db_session)[-1]
    assert row.action == "approved"
    assert row.actor_name == "reviewer"
    assert row.target_kind == "submission"
    assert row.target_name == "Oat bar"


def test_a_reviewer_turns_one_down_and_the_reason_is_in_the_record(
    client, db_session, make_user
):
    member = make_user("member")
    make_reviewer(db_session, make_user)
    request = a_request(db_session, member, a_food(db_session, member))
    sign_in(client, "reviewer")

    refused = client.post(
        f"/api/admin/queue/{request.id}/reject", json={"note": "The panel does not match."}
    )
    assert refused.status_code == 200

    row = log_rows(db_session)[-1]
    assert row.action == "rejected"
    assert row.detail == "The panel does not match."
    assert row.target_name == "Oat bar"


def test_a_reviewer_corrects_a_shared_food_and_the_record_names_what_moved(
    client, db_session, make_user
):
    make_reviewer(db_session, make_user)
    food = a_food(db_session, status="approved")
    sign_in(client, "reviewer")

    saved = client.patch(
        f"/api/foods/{food.id}",
        json={"name": "Oat bar", "brand": "Kirkland", "section": "snacks", **PANEL},
    )
    assert saved.status_code == 200

    row = log_rows(db_session)[-1]
    assert row.action == "food_edited"
    assert row.target_kind == "food"
    assert row.target_id == food.id
    assert row.detail == ["Brand"]


def test_an_edit_written_against_an_older_copy_is_refused(client, db_session, make_user):
    make_reviewer(db_session, make_user)
    food = a_food(db_session, status="approved")
    sign_in(client, "reviewer")

    loaded = client.get(f"/api/foods/{food.id}").json()["updated_at"]
    body = {"name": "Oat bar", "brand": "Kirkland", "section": "snacks", **PANEL}

    # Somebody else saved in between, so the stamp the form loaded is old.
    stale = client.patch(f"/api/foods/{food.id}", json={**body, "as_of": loaded})
    assert stale.status_code == 200
    again = client.patch(f"/api/foods/{food.id}", json={**body, "brand": "Other", "as_of": loaded})
    assert again.status_code == 409
    assert again.json() == {
        "detail": "Someone changed this while you were editing. Reload to see it."
    }
    db_session.refresh(food)
    assert food.brand == "Kirkland"

    # Reloaded, it saves. And a body without a stamp at all is left alone.
    fresh = client.get(f"/api/foods/{food.id}").json()["updated_at"]
    assert client.patch(
        f"/api/foods/{food.id}", json={**body, "brand": "Other", "as_of": fresh}
    ).status_code == 200
    assert client.patch(f"/api/foods/{food.id}", json=body).status_code == 200


def test_a_reviewer_is_served_the_panel_a_proposal_was_read_off(db_session, make_user):
    """Reading the label against the numbers is the whole of reviewing."""
    member = make_user("member")
    reviewer = make_reviewer(db_session, make_user)
    label = models.FoodPhoto(
        path="label.webp", purpose="label", status="pending", uploaded_by_id=member.id
    )
    db_session.add(label)
    db_session.commit()

    assert readable_photo(db_session, reviewer, label.id).id == label.id

    # And a member who did not take it is told there is no such picture.
    stranger = make_user("stranger")
    with pytest.raises(HTTPException):
        readable_photo(db_session, stranger, label.id)


# And what they may not
# ---------------------


def test_the_rest_of_the_administration_is_shut_to_a_reviewer(client, db_session, make_user):
    make_reviewer(db_session, make_user)
    food = a_food(db_session, status="approved")
    sign_in(client, "reviewer")

    for call in (
        lambda: client.get("/api/admin/invites"),
        lambda: client.post("/api/admin/invites", json={}),
        lambda: client.get("/api/admin/uploads"),
        lambda: client.get("/api/admin/users"),
        lambda: client.get("/api/admin/review-log"),
        lambda: client.patch("/api/admin/users/1", json={"is_reviewer": True}),
        lambda: client.get("/api/feedback"),
    ):
        response = call()
        assert response.status_code == 403
        assert response.json() == {"detail": "This needs an administrator account."}

    # And the one thing about a shared food that is not keeping it right.
    gone = client.delete(f"/api/foods/{food.id}")
    assert gone.status_code == 403
    assert db_session.get(models.Food, food.id) is not None


# Handing the role out
# --------------------


def test_granting_and_revoking_leave_a_line_each(client, db_session, make_user, admin_client):
    member = make_user("member")

    granted = admin_client.patch(f"/api/admin/users/{member.id}", json={"is_reviewer": True})
    assert granted.status_code == 200
    assert granted.json()["role"] == "reviewer"
    db_session.refresh(member)
    assert member.is_reviewer is True

    taken = admin_client.patch(f"/api/admin/users/{member.id}", json={"is_reviewer": False})
    assert taken.status_code == 200
    assert taken.json()["role"] is None
    db_session.refresh(member)
    assert member.is_reviewer is False

    assert [row.action for row in log_rows(db_session)] == ["role_granted", "role_revoked"]
    assert log_rows(db_session)[0].target_name == "member"


def test_an_administrator_cannot_be_given_the_role(db_session, make_user, admin_client):
    other = make_user("second", admin=True)
    refused = admin_client.patch(f"/api/admin/users/{other.id}", json={"is_reviewer": True})
    assert refused.status_code == 400
    assert refused.json() == {"detail": "An administrator already reviews."}
    assert log_rows(db_session) == []


# The record itself
# -----------------


def test_the_log_reads_newest_first_and_pages(db_session, admin, admin_client):
    for number in range(55):
        db_session.add(
            models.ReviewLog(
                actor_id=admin.id,
                actor_name="admin",
                action="approved",
                target_kind="food",
                target_id=number,
                target_name=f"Food {number}",
                created_at=now_utc(),
            )
        )
    db_session.commit()

    first = admin_client.get("/api/admin/review-log").json()
    assert len(first["items"]) == 50
    assert first["items"][0]["target_name"] == "Food 54"
    assert first["next_cursor"] is not None

    second = admin_client.get(f"/api/admin/review-log?cursor={first['next_cursor']}").json()
    assert len(second["items"]) == 5
    assert second["items"][-1]["target_name"] == "Food 0"
    assert second["next_cursor"] is None


# What the account is told about itself
# -------------------------------------


def test_the_account_carries_its_role(client, db_session, make_user):
    make_reviewer(db_session, make_user)
    sign_in(client, "reviewer")
    assert client.get("/api/auth/me").json()["role"] == "reviewer"


def test_an_administrator_reads_as_one(client, admin_client):
    assert admin_client.get("/api/auth/me").json()["role"] == "admin"


# Applying
# --------


def approvals(db, member, total):
    """Foods this member offered that the queue took."""
    for _ in range(total):
        db.add(
            models.FoodSubmission(
                kind="new",
                status="approved",
                submitted_by_id=member.id,
                decided_at=now_utc(),
            )
        )
    db.commit()


def test_applying_is_refused_until_enough_foods_have_been_taken(
    client, db_session, make_user
):
    member = make_user("member")
    approvals(db_session, member, REVIEWER_THRESHOLD - 1)
    sign_in(client, "member")

    assert client.get("/api/auth/me").json()["reviewer_eligible"] is False
    refused = client.post("/api/account/apply-reviewer")
    assert refused.status_code == 400
    assert refused.json() == {"detail": "Not yet."}
    db_session.refresh(member)
    assert member.reviewer_requested_at is None


def test_applying_at_the_threshold_is_recorded_once(client, db_session, make_user):
    member = make_user("member")
    approvals(db_session, member, REVIEWER_THRESHOLD)
    sign_in(client, "member")

    told = client.get("/api/auth/me").json()
    assert told["approved_count"] == REVIEWER_THRESHOLD
    assert told["reviewer_eligible"] is True

    sent = client.post("/api/account/apply-reviewer")
    assert sent.status_code == 200
    assert sent.json() == {"reviewer_requested": True}
    db_session.refresh(member)
    stamped = member.reviewer_requested_at
    assert stamped is not None
    assert client.get("/api/auth/me").json()["reviewer_requested"] is True

    row = log_rows(db_session)[-1]
    assert row.action == "applied"
    assert row.target_kind == "user"
    assert row.target_name == "member"

    # Asking twice is asking once.
    again = client.post("/api/account/apply-reviewer")
    assert again.status_code == 200
    db_session.refresh(member)
    assert member.reviewer_requested_at == stamped
    assert len(log_rows(db_session)) == 1


def test_somebody_who_already_reviews_has_nothing_to_apply_for(
    client, db_session, make_user
):
    make_reviewer(db_session, make_user)
    sign_in(client, "reviewer")
    refused = client.post("/api/account/apply-reviewer")
    assert refused.status_code == 400
    assert refused.json() == {"detail": "You already review."}


def test_granting_the_role_answers_the_application(
    client, db_session, make_user, admin_client
):
    member = make_user("member")
    member.reviewer_requested_at = now_utc()
    db_session.commit()

    waiting = {row["username"]: row for row in admin_client.get("/api/admin/users").json()}
    assert waiting["member"]["requested"] is True

    admin_client.patch(f"/api/admin/users/{member.id}", json={"is_reviewer": True})
    db_session.refresh(member)
    assert member.reviewer_requested_at is None
    answered = {row["username"]: row for row in admin_client.get("/api/admin/users").json()}
    assert answered["member"]["requested"] is False
    assert answered["member"]["role"] == "reviewer"
