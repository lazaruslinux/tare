"""The review queue, which is the only door into the shared database.

The cases that matter most are about what approval does not do. It does not
rewrite anybody's diary: an entry keeps the numbers it was logged with, and a
decision made afterwards never reaches back into somebody's day.
"""

import io
import os

import httpx
from PIL import Image

from app import foods_api, models, photos
from tests.conftest import PASSWORD

CODE = "034000002405"

FULL = {
    "calories": 535,
    "protein_g": 7,
    "carbs_g": 58.1,
    "fat_g": 32.6,
    "saturated_fat_g": 18.6,
    "trans_fat_g": 0,
    "cholesterol_mg": 23,
    "sodium_mg": 81,
    "fiber_g": 2.3,
    "sugar_g": 51.2,
}

SERVINGS = [{"name": "1 bar", "amount": 43, "unit": "g", "position": 0}]


def sign_in(client, username):
    response = client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200


def offer(client, **overrides):
    sent = {
        "barcode": CODE,
        "name": "Milk chocolate bar",
        "brand": "Hershey's",
        "base_unit": "g",
        "section": "candy-and-sweets",
        "servings": SERVINGS,
        **FULL,
    }
    sent.update(overrides)
    # The pictures anything offered to everybody carries, unless the case says
    # otherwise: the front of the pack and the panel.
    sent.setdefault("photo_id", a_photo(client))
    sent.setdefault("label_photo_id", a_photo(client, "label"))
    response = client.post("/api/submissions/food", json=sent)
    assert response.status_code == 201
    return response.json()


def a_photo(client, purpose="front"):
    out = io.BytesIO()
    Image.new("RGB", (160, 120), (200, 180, 120)).save(out, format="JPEG")
    response = client.post(
        "/api/photos",
        files={"file": ("label.jpg", out.getvalue(), "image/jpeg")},
        data={"purpose": purpose},
    )
    assert response.status_code == 201
    return response.json()["photo_id"]


def offline(monkeypatch):
    """Nothing found anywhere, so a scan falls all the way through."""
    monkeypatch.setattr(
        foods_api,
        "session",
        lambda: httpx.Client(
            transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"status": 0}))
        ),
    )


def member_and_admin(client, make_user):
    """One ordinary account with something offered, and one reviewer."""
    make_user("member")
    make_user("reviewer", admin=True)
    sign_in(client, "member")
    return offer(client)


# ---- Who may look ----


def test_the_queue_is_not_for_ordinary_accounts(client, make_user, signed_in):
    for call in (
        lambda: client.get("/api/admin/queue"),
        lambda: client.post("/api/admin/queue/1/approve", json={}),
        lambda: client.post("/api/admin/queue/1/reject", json={"note": "no"}),
        lambda: client.post(
            "/api/admin/queue/1/photo", json={"photo_id": 1, "purpose": "front"}
        ),
        lambda: client.delete("/api/admin/queue/1/photo?purpose=front"),
    ):
        response = call()
        assert response.status_code == 403
        assert response.json() == {"detail": "This needs an administrator account."}


def test_the_queue_needs_a_session(client):
    assert client.get("/api/admin/queue").status_code == 401


# ---- Reading it ----


def test_the_queue_carries_the_whole_proposed_label(client, make_user):
    made = member_and_admin(client, make_user)
    photo_id = a_photo(client)
    # A second offer, so the ordering can be seen as well.
    client.post(
        "/api/submissions/food",
        json={
            "barcode": None,
            "name": "Grandma's fudge",
            "base_unit": "g",
            "section": "candy-and-sweets",
            "servings": SERVINGS,
            "photo_id": photo_id,
            "label_photo_id": a_photo(client, "label"),
            **FULL,
        },
    )

    sign_in(client, "reviewer")
    queue = client.get("/api/admin/queue").json()
    assert [item["food"]["name"] for item in queue] == ["Milk chocolate bar", "Grandma's fudge"]

    first = queue[0]
    assert first["id"] == made["submission_id"]
    assert first["submitted_by"] == "member"
    # Both pictures, because it is a packet: the front of it, and the panel the
    # numbers were read off, which only this screen is ever served.
    assert first["photo_url"] is not None
    assert first["label_photo_url"] is not None
    # The label is evidence for every submission, barcode or not.
    assert queue[1]["label_photo_url"] is not None
    assert first["food"]["barcode"] == CODE
    assert first["food"]["sodium_mg"] == 81
    assert first["food"]["servings"] == [
        {"name": "1 bar", "amount": 43, "unit": "g", "base_amount": 43, "position": 0}
    ]
    assert queue[1]["photo_url"] == f"/api/photos/{photo_id}.webp"


def test_an_empty_queue_is_an_empty_list(client, admin_client):
    assert client.get("/api/admin/queue").json() == []


# ---- Approving ----


def test_approving_hands_a_food_to_everybody(client, db_session, make_user, monkeypatch):
    made = member_and_admin(client, make_user)
    food_id = made["food"]["id"]

    sign_in(client, "reviewer")
    response = client.post(f"/api/admin/queue/{made['submission_id']}/approve", json={})
    assert response.status_code == 200

    food = db_session.get(models.Food, food_id)
    assert food.status == "approved"
    # Nobody's any more, which is what shared means.
    assert food.owner_id is None

    submission = db_session.get(models.FoodSubmission, made["submission_id"])
    assert submission.status == "approved"
    assert submission.decided_at is not None
    assert submission.decided_by_id is not None

    # Everybody can find it now, by name and by the code on the packet.
    offline(monkeypatch)
    make_user("stranger")
    sign_in(client, "stranger")
    assert [row["id"] for row in client.get("/api/foods/search?q=chocolate").json()] == [food_id]
    resolved = client.get(f"/api/barcode/{CODE}").json()
    assert resolved["state"] == "approved"
    assert resolved["food"]["id"] == food_id


def test_approving_throws_away_the_cached_lookup_for_that_code(
    client, db_session, make_user, monkeypatch
):
    made = member_and_admin(client, make_user)
    db_session.add(
        models.Food(
            status="cache",
            barcode=CODE,
            name="What the internet said",
            base_unit="g",
            source="off",
            **FULL,
        )
    )
    db_session.commit()

    sign_in(client, "reviewer")
    client.post(f"/api/admin/queue/{made['submission_id']}/approve", json={})

    cached = db_session.query(models.Food).filter(models.Food.status == "cache").all()
    assert cached == []


def test_what_was_already_logged_is_not_touched_by_a_decision(
    client, db_session, make_user
):
    made = member_and_admin(client, make_user)
    logged = client.post(
        "/api/diary",
        json={
            "date": "2026-09-01",
            "slot": "snack",
            "food_id": made["food"]["id"],
            "amount": 1,
            "unit": "serving:" + str(made["food"]["servings"][0]["id"]),
        },
    ).json()

    sign_in(client, "reviewer")
    client.post(f"/api/admin/queue/{made['submission_id']}/approve", json={})

    sign_in(client, "member")
    after = client.get("/api/diary/day?date=2026-09-01").json()
    entry = after["slots"]["snack"]["entries"][0]
    assert entry == logged
    # And it still points at the same food, which is now the shared one.
    assert entry["food_id"] == made["food"]["id"]


def test_a_barcode_conflict_changes_nothing_at_all(client, db_session, make_user):
    made = member_and_admin(client, make_user)
    db_session.add(
        models.Food(status="approved", barcode=CODE, name="Already shared", base_unit="g")
    )
    db_session.commit()

    sign_in(client, "reviewer")
    response = client.post(f"/api/admin/queue/{made['submission_id']}/approve", json={})
    assert response.status_code == 409
    assert response.json() == {"detail": "This barcode is already in the Tare database."}

    db_session.expire_all()
    food = db_session.get(models.Food, made["food"]["id"])
    assert food.status == "pending"
    assert food.owner_id is not None
    assert db_session.get(models.FoodSubmission, made["submission_id"]).status == "pending"


def test_a_kept_photo_is_published_with_its_food(client, db_session, make_user):
    make_user("member")
    make_user("reviewer", admin=True)
    sign_in(client, "member")
    photo_id = a_photo(client)
    made = offer(client, photo_id=photo_id)
    name = db_session.get(models.FoodPhoto, photo_id).path

    sign_in(client, "reviewer")
    client.post(f"/api/admin/queue/{made['submission_id']}/approve", json={"keep_photo": True})

    db_session.expire_all()
    assert db_session.get(models.FoodPhoto, photo_id).status == "approved"
    assert os.path.isfile(photos.path_for(name))
    # And now anybody signed in may look at it.
    make_user("stranger")
    sign_in(client, "stranger")
    assert client.get(f"/api/photos/{photo_id}.webp").status_code == 200


def test_a_photo_that_is_not_kept_goes_from_the_database_and_the_disk(
    client, db_session, make_user
):
    make_user("member")
    make_user("reviewer", admin=True)
    sign_in(client, "member")
    photo_id = a_photo(client)
    made = offer(client, photo_id=photo_id)
    name = db_session.get(models.FoodPhoto, photo_id).path
    assert os.path.isfile(photos.path_for(name))

    sign_in(client, "reviewer")
    client.post(f"/api/admin/queue/{made['submission_id']}/approve", json={"keep_photo": False})

    assert db_session.get(models.FoodPhoto, photo_id) is None
    assert not os.path.isfile(photos.path_for(name))


def test_a_decision_can_only_be_made_once(client, make_user):
    made = member_and_admin(client, make_user)
    sign_in(client, "reviewer")
    assert client.post(f"/api/admin/queue/{made['submission_id']}/approve", json={}).status_code == 200

    again = client.post(f"/api/admin/queue/{made['submission_id']}/approve", json={})
    assert again.status_code == 400
    assert again.json() == {"detail": "That submission has already been decided."}
    assert client.get("/api/admin/queue").json() == []


# ---- Rejecting ----


def test_rejecting_gives_the_food_back_privately_with_a_reason(
    client, db_session, make_user
):
    made = member_and_admin(client, make_user)

    sign_in(client, "reviewer")
    response = client.post(
        f"/api/admin/queue/{made['submission_id']}/reject",
        json={"note": "The sodium is out by a factor of ten."},
    )
    assert response.status_code == 200

    db_session.expire_all()
    food = db_session.get(models.Food, made["food"]["id"])
    assert food.status == "custom"
    # Still theirs, and still logged wherever they logged it.
    assert food.owner_id is not None

    sign_in(client, "member")
    rows = client.get("/api/submissions/mine").json()
    assert rows[0]["status"] == "rejected"
    assert rows[0]["decision_note"] == "The sodium is out by a factor of ten."
    assert rows[0]["decided_at"] is not None
    # And it is not in the shared database, however plainly they can still see it.
    assert client.get(f"/api/foods/{food.id}").json()["status"] == "custom"


def test_a_no_without_a_reason_is_refused(client, db_session, make_user):
    """Somebody who is told no is told why, so the submission stands until
    whoever is reviewing it has written one."""
    made = member_and_admin(client, make_user)

    sign_in(client, "reviewer")
    response = client.post(
        f"/api/admin/queue/{made['submission_id']}/reject", json={"note": "   "}
    )
    assert response.status_code == 400
    assert response.json() == {"detail": "Give a reason."}

    db_session.expire_all()
    assert db_session.get(models.Food, made["food"]["id"]).status == "pending"
    assert len(client.get("/api/admin/queue").json()) == 1


def test_rejecting_takes_the_photo_with_it(client, db_session, make_user):
    make_user("member")
    make_user("reviewer", admin=True)
    sign_in(client, "member")
    photo_id = a_photo(client)
    made = offer(client, photo_id=photo_id)
    name = db_session.get(models.FoodPhoto, photo_id).path

    sign_in(client, "reviewer")
    client.post(f"/api/admin/queue/{made['submission_id']}/reject", json={"note": "Not clear."})

    assert db_session.get(models.FoodPhoto, photo_id) is None
    assert not os.path.isfile(photos.path_for(name))


def test_a_food_turned_down_can_be_corrected_and_offered_again(client, make_user):
    made = member_and_admin(client, make_user)
    sign_in(client, "reviewer")
    client.post(f"/api/admin/queue/{made['submission_id']}/reject", json={"note": "Check it."})

    sign_in(client, "member")
    # The pictures went back with the refusal, so it is offered again with new
    # ones. The front photo rides on the food; the panel goes with the request.
    again = client.post(
        f"/api/foods/{made['food']['id']}/submit",
        json={"photo_id": a_photo(client), "label_photo_id": a_photo(client, "label")},
    )
    assert again.status_code == 201

    sign_in(client, "reviewer")
    assert len(client.get("/api/admin/queue").json()) == 1


# ---- Where a food stands with the shared database ----


def community(client, food_id):
    """What this account's own list says about one food."""
    rows = client.get("/api/foods/mine").json()
    return next((row["community"] for row in rows if row["id"] == food_id), None)


def test_a_food_nobody_offered_stands_at_none(client, signed_in):
    made = client.post(
        "/api/foods", json={"name": "Chicken breast", "calories": 165,
                            "protein_g": 31, "carbs_g": 0, "fat_g": 3.6}
    ).json()
    assert community(client, made["id"]) == "none"
    assert client.get(f"/api/foods/{made['id']}").json()["community"] == "none"


def test_a_food_waiting_on_a_decision_stands_at_pending(client, make_user):
    made = member_and_admin(client, make_user)
    assert community(client, made["food"]["id"]) == "pending"
    assert client.get(f"/api/foods/{made['food']['id']}").json()["community"] == "pending"


def test_a_food_approved_stays_in_my_list_marked_as_shared(client, make_user):
    made = member_and_admin(client, make_user)
    sign_in(client, "reviewer")
    assert client.post(f"/api/admin/queue/{made['submission_id']}/approve", json={}).status_code == 200

    sign_in(client, "member")
    assert community(client, made["food"]["id"]) == "approved"
    detail = client.get(f"/api/foods/{made['food']['id']}").json()
    assert detail["community"] == "approved"
    # It belongs to everybody now, so the owner's own actions are gone with it.
    assert detail["mine"] is False


def test_a_food_turned_down_stands_at_rejected(client, make_user):
    made = member_and_admin(client, make_user)
    sign_in(client, "reviewer")
    client.post(f"/api/admin/queue/{made['submission_id']}/reject", json={"note": "Check it."})

    sign_in(client, "member")
    assert community(client, made["food"]["id"]) == "rejected"
    assert client.get(f"/api/foods/{made['food']['id']}").json()["community"] == "rejected"


def test_taking_an_offer_back_puts_the_food_back_at_none(client, make_user):
    made = member_and_admin(client, make_user)
    assert client.delete(f"/api/submissions/{made['submission_id']}").status_code == 204
    assert community(client, made["food"]["id"]) == "none"


def test_somebody_else_s_approved_food_is_not_in_my_list(client, make_user):
    made = member_and_admin(client, make_user)
    sign_in(client, "reviewer")
    client.post(f"/api/admin/queue/{made['submission_id']}/approve", json={})

    make_user("stranger")
    sign_in(client, "stranger")
    assert client.get("/api/foods/mine").json() == []
    # Readable, because it is shared, and marked as nobody's doing but its own.
    assert client.get(f"/api/foods/{made['food']['id']}").json()["community"] == "none"


def test_a_submission_row_names_the_food_it_is_about(client, make_user):
    made = member_and_admin(client, make_user)
    row = client.get("/api/submissions/mine").json()[0]
    assert (row["kind"], row["food_id"]) == ("new", made["food"]["id"])


def test_a_scanned_food_offered_from_the_form_carries_its_code_through(
    client, db_session, make_user
):
    """A food entered from a scan keeps its code when it is offered, and the
    queue holds it to the same one-row-per-barcode rule as anything else."""
    make_user("member")
    make_user("reviewer", admin=True)
    sign_in(client, "member")
    made = client.post(
        "/api/foods",
        json={
            "name": "Milk chocolate bar",
            "base_unit": "g",
            "barcode": CODE,
            "servings": SERVINGS,
            **FULL,
        },
    ).json()
    offered = client.post(
        f"/api/foods/{made['id']}/submit",
        json={"photo_id": a_photo(client), "label_photo_id": a_photo(client, "label")},
    )
    assert offered.status_code == 201

    db_session.expire_all()
    waiting = db_session.get(models.Food, made["id"])
    assert (waiting.status, waiting.barcode) == ("pending", CODE)

    # Somebody else's food reached the shared database with that code first.
    db_session.add(
        models.Food(status="approved", barcode=CODE, name="Already shared", base_unit="g")
    )
    db_session.commit()

    sign_in(client, "reviewer")
    response = client.post(
        f"/api/admin/queue/{offered.json()['submission_id']}/approve", json={}
    )
    assert response.status_code == 409
    assert response.json() == {"detail": "This barcode is already in the Tare database."}


# ---- Approving with edits ----


def adjusted(client, food_id, **overrides):
    """The whole form again, as the reviewer's screen sends it."""
    sent = {
        "name": "Milk chocolate bar",
        "brand": "Hershey's",
        "base_unit": "g",
        "section": "candy-and-sweets",
        "servings": SERVINGS,
        **FULL,
    }
    sent.update(overrides)
    return client.patch(f"/api/foods/{food_id}", json=sent)


def test_a_reviewer_may_correct_a_waiting_food_and_what_they_changed_is_kept(
    client, db_session, make_user
):
    made = member_and_admin(client, make_user)

    sign_in(client, "reviewer")
    response = adjusted(client, made["food"]["id"], calories=500, name="Milk chocolate")
    assert response.status_code == 200

    db_session.expire_all()
    submission = db_session.get(models.FoodSubmission, made["submission_id"])
    assert submission.edited is True
    assert submission.changes == ["Name", "Calories"]

    # And approving carries the reviewer's own numbers into the shared row.
    assert client.post(
        f"/api/admin/queue/{made['submission_id']}/approve", json={}
    ).status_code == 200
    db_session.expire_all()
    assert db_session.get(models.Food, made["food"]["id"]).calories == 500


def test_a_reviewer_puts_a_food_in_another_aisle_before_approving_it(
    client, db_session, make_user
):
    """The submitter picks the section; whoever reviews it has the last word."""
    made = member_and_admin(client, make_user)

    sign_in(client, "reviewer")
    assert adjusted(client, made["food"]["id"], section="snacks").status_code == 200
    assert client.post(
        f"/api/admin/queue/{made['submission_id']}/approve", json={}
    ).status_code == 200

    db_session.expire_all()
    shared = db_session.get(models.Food, made["food"]["id"])
    assert (shared.status, shared.section) == ("approved", "snacks")
    submission = db_session.get(models.FoodSubmission, made["submission_id"])
    assert submission.changes == ["Section"]


def test_an_aisle_tare_does_not_have_is_refused_in_the_queue(client, make_user):
    made = member_and_admin(client, make_user)

    sign_in(client, "reviewer")
    response = adjusted(client, made["food"]["id"], section="hardware")
    assert response.status_code == 400
    assert response.json() == {"detail": "That is not a section Tare has."}


def test_what_the_reviewer_changed_reads_on_the_submitter_s_own_list(
    client, make_user
):
    made = member_and_admin(client, make_user)

    sign_in(client, "reviewer")
    adjusted(client, made["food"]["id"], sugar_g=None)
    client.post(f"/api/admin/queue/{made['submission_id']}/approve", json={})

    sign_in(client, "member")
    row = client.get("/api/submissions/mine").json()[0]
    assert (row["status"], row["edited"], row["changes"]) == (
        "approved",
        True,
        ["Total sugars"],
    )
    assert row["seen_at"] is None


def test_the_change_list_names_the_two_sugar_lines_apart(client, make_user):
    made = member_and_admin(client, make_user)

    sign_in(client, "reviewer")
    # The panel offered carried the total and not the split, which is the
    # ordinary case: a reviewer reads both off the photograph of the label.
    adjusted(client, made["food"]["id"], sugar_g=50, added_sugars_g=48)
    client.post(f"/api/admin/queue/{made['submission_id']}/approve", json={})

    sign_in(client, "member")
    row = client.get("/api/submissions/mine").json()[0]
    assert row["changes"] == ["Total sugars", "Added sugars"]


def test_a_food_nobody_touched_is_approved_without_an_edit_on_it(client, make_user):
    made = member_and_admin(client, make_user)

    sign_in(client, "reviewer")
    client.post(f"/api/admin/queue/{made['submission_id']}/approve", json={})

    sign_in(client, "member")
    row = client.get("/api/submissions/mine").json()[0]
    assert (row["edited"], row["changes"]) == (False, [])


def test_only_a_reviewer_writing_on_a_waiting_food_counts_as_an_edit(
    client, db_session, make_user
):
    """The owner correcting their own offer is the food, not a review of it."""
    made = member_and_admin(client, make_user)
    assert adjusted(client, made["food"]["id"], calories=505).status_code == 200

    db_session.expire_all()
    submission = db_session.get(models.FoodSubmission, made["submission_id"])
    assert (submission.edited, submission.changes) == (False, [])


# ---- The pictures a reviewer changes ----


def test_a_reviewer_may_replace_the_front_photo_of_a_waiting_food(
    client, db_session, make_user
):
    make_user("member")
    make_user("reviewer", admin=True)
    sign_in(client, "member")
    photo_id = a_photo(client)
    made = offer(client, photo_id=photo_id)
    was = db_session.get(models.FoodPhoto, photo_id).path

    sign_in(client, "reviewer")
    theirs = a_photo(client)
    response = client.post(
        f"/api/admin/queue/{made['submission_id']}/photo",
        json={"photo_id": theirs, "purpose": "front"},
    )
    assert response.status_code == 204

    db_session.expire_all()
    submission = db_session.get(models.FoodSubmission, made["submission_id"])
    assert submission.photo_id == theirs
    assert submission.changes == ["Front photo"]
    # The one it replaced is gone from the database and off the disk.
    assert db_session.get(models.FoodPhoto, photo_id) is None
    assert not os.path.isfile(photos.path_for(was))
    # And the queue shows the reviewer's own.
    assert client.get("/api/admin/queue").json()[0]["photo_url"].endswith(f"{theirs}.webp")


def test_a_reviewer_may_take_the_label_photo_off_a_waiting_food(
    client, db_session, make_user
):
    make_user("member")
    make_user("reviewer", admin=True)
    sign_in(client, "member")
    label_id = a_photo(client, "label")
    made = offer(client, label_photo_id=label_id)
    was = db_session.get(models.FoodPhoto, label_id).path

    sign_in(client, "reviewer")
    response = client.delete(f"/api/admin/queue/{made['submission_id']}/photo?purpose=label")
    assert response.status_code == 204

    db_session.expire_all()
    submission = db_session.get(models.FoodSubmission, made["submission_id"])
    assert submission.label_photo_id is None
    assert submission.changes == ["Label photo"]
    assert db_session.get(models.FoodPhoto, label_id) is None
    assert not os.path.isfile(photos.path_for(was))


def test_a_picture_that_is_not_there_cannot_be_taken_off(client, make_user):
    made = member_and_admin(client, make_user)
    sign_in(client, "reviewer")
    client.delete(f"/api/admin/queue/{made['submission_id']}/photo?purpose=front")

    again = client.delete(f"/api/admin/queue/{made['submission_id']}/photo?purpose=front")
    assert again.status_code == 400
    assert again.json() == {"detail": "The photo this was about is gone."}


def test_a_purpose_that_is_neither_is_refused(client, make_user):
    made = member_and_admin(client, make_user)
    sign_in(client, "reviewer")
    response = client.delete(f"/api/admin/queue/{made['submission_id']}/photo?purpose=side")
    assert response.status_code == 400
    assert response.json() == {"detail": "A photo is of the front or of the label."}


# ---- Reading the answer ----


def test_a_decision_is_unread_until_the_submitter_says_otherwise(client, make_user):
    made = member_and_admin(client, make_user)
    second = offer(client, barcode="034000002412")

    sign_in(client, "reviewer")
    client.post(f"/api/admin/queue/{made['submission_id']}/approve", json={})

    sign_in(client, "member")
    unread = [
        row
        for row in client.get("/api/submissions/mine").json()
        if row["status"] != "pending" and row["seen_at"] is None
    ]
    assert len(unread) == 1

    assert client.post("/api/submissions/seen").status_code == 204
    rows = {row["id"]: row for row in client.get("/api/submissions/mine").json()}
    assert rows[made["submission_id"]]["seen_at"] is not None
    # The one still waiting is not an answer, so it is not marked as read.
    assert rows[second["submission_id"]]["seen_at"] is None


def test_nobody_else_s_answers_are_marked_read(client, make_user):
    made = member_and_admin(client, make_user)
    sign_in(client, "reviewer")
    client.post(f"/api/admin/queue/{made['submission_id']}/approve", json={})

    # The reviewer reading their own list leaves the member's answer unread.
    assert client.post("/api/submissions/seen").status_code == 204
    sign_in(client, "member")
    assert client.get("/api/submissions/mine").json()[0]["seen_at"] is None


def test_deciding_your_own_request_counts_as_reading_it(client, make_user):
    """An administrator approving their own food has read the answer already."""
    make_user("reviewer", admin=True)
    sign_in(client, "reviewer")
    made = offer(client)

    client.post(f"/api/admin/queue/{made['submission_id']}/approve", json={})

    rows = {row["id"]: row for row in client.get("/api/submissions/mine").json()}
    assert rows[made["submission_id"]]["seen_at"] is not None
