"""Offering a food to the shared database.

Two rules do most of the work here. A food offered to everybody has to carry the
whole label, because the person filling it in is holding the packet and nobody
after them will be. And a food that has been offered is still private until
somebody decides otherwise: the submitter can log it today, and nobody else can
see it at all.
"""

import io
import os

import httpx
from PIL import Image

from app import foods_api, models, photos
from tests.conftest import PASSWORD

CODE = "034000002405"

# A whole label, which is what a submission has to carry.
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


def body(**overrides):
    sent = {
        "barcode": CODE,
        "name": "Milk chocolate bar",
        "brand": "Hershey's",
        "base_unit": "g",
        "servings": SERVINGS,
        **FULL,
    }
    sent.update(overrides)
    return sent


def attach_front(client, food_id):
    """The picture an owner puts on their own food from its page."""
    photo_id = a_photo(client)
    assert (
        client.post(f"/api/foods/{food_id}/photo", json={"photo_id": photo_id}).status_code
        == 204
    )
    return photo_id


def offer(client, **overrides):
    """Offered with the pictures anything shared has to carry.

    Supplied here rather than in each case, so the cases that are about
    something else read as they did before the rule existed. The ones that are
    about the rule pass their own photo_id, including None.
    """
    sent = body(**overrides)
    sent.setdefault("photo_id", a_photo(client))
    sent.setdefault("label_photo_id", a_photo(client, "label"))
    return client.post("/api/submissions/food", json=sent)


def sign_in(client, username):
    response = client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200


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


# ---- What a submission has to carry ----


def test_every_number_on_the_label_is_needed(client, signed_in):
    for field, label in (
        ("calories", "Calories"),
        ("saturated_fat_g", "Saturated fat"),
        ("cholesterol_mg", "Cholesterol"),
        ("fiber_g", "Fiber"),
        ("sugar_g", "Sugar"),
    ):
        response = offer(client, **{field: None})
        assert response.status_code == 400
        assert response.json() == {
            "detail": f"{label} is required before this can be shared."
        }


def test_the_first_thing_missing_is_the_one_named(client, signed_in):
    response = offer(client, protein_g=None, sodium_mg=None)
    assert response.json() == {"detail": "Protein is required before this can be shared."}


def test_nought_is_an_answer_and_an_empty_box_is_not(client, signed_in):
    assert offer(client, fiber_g=0, sugar_g=0).status_code == 201


def test_a_serving_is_needed(client, signed_in):
    response = offer(client, servings=[])
    assert response.status_code == 400
    assert response.json() == {"detail": "A serving is required."}


# ---- What a submission does ----


def test_an_offered_food_is_pending_and_still_the_submitter_s(client, db_session, signed_in):
    response = offer(client, note="The wrapper is a bit faded.")
    assert response.status_code == 201
    made = response.json()["food"]
    assert made["status"] == "pending"
    assert made["mine"] is True

    food = db_session.get(models.Food, made["id"])
    assert (food.owner_id, food.created_by_id, food.barcode) == (signed_in.id, signed_in.id, CODE)

    submission = db_session.get(models.FoodSubmission, response.json()["submission_id"])
    assert (submission.kind, submission.status) == ("new", "pending")
    assert submission.note == "The wrapper is a bit faded."
    assert submission.decided_at is None


def test_an_offered_food_can_be_logged_the_moment_it_is_offered(client, signed_in):
    food_id = offer(client).json()["food"]["id"]
    logged = client.post(
        "/api/diary",
        json={"date": "2026-09-01", "slot": "snack", "food_id": food_id, "amount": 1, "unit": "g"},
    )
    assert logged.status_code == 201
    assert logged.json()["name"] == "Milk chocolate bar"


def test_nobody_else_can_see_a_food_that_is_only_offered(
    client, make_user, signed_in, monkeypatch
):
    food_id = offer(client).json()["food"]["id"]

    make_user("stranger")
    sign_in(client, "stranger")

    missing = client.get(f"/api/foods/{food_id}")
    assert missing.status_code == 404
    assert missing.json() == {"detail": "There is no such food."}
    assert client.get("/api/foods/search?q=chocolate").json() == []

    # And the barcode resolves for them as though nothing were there at all.
    monkeypatch.setattr(
        foods_api,
        "session",
        lambda: httpx.Client(
            transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"status": 0}))
        ),
    )
    assert client.get(f"/api/barcode/{CODE}").json() == {"state": "blank", "barcode": CODE}


def test_a_barcode_you_already_hold_is_said_plainly(client, signed_in):
    assert offer(client).status_code == 201
    again = offer(client)
    assert again.status_code == 400
    assert again.json() == {"detail": "You already have a food with this barcode."}


def test_a_barcode_already_in_the_shared_database_is_a_conflict(
    client, db_session, signed_in
):
    db_session.add(
        models.Food(status="approved", barcode=CODE, name="Milk chocolate bar", base_unit="g")
    )
    db_session.commit()

    response = offer(client)
    assert response.status_code == 409
    assert response.json() == {"detail": "This barcode is already in the Tare database."}


def test_something_that_is_not_a_barcode_is_refused(client, signed_in):
    response = offer(client, barcode="not-a-code")
    assert response.status_code == 400
    assert response.json() == {"detail": "That is not a barcode."}


def test_a_food_offered_without_a_barcode_is_fine(client, signed_in):
    assert offer(client, barcode=None).status_code == 201


# ---- Offering one you already keep ----


def test_a_food_you_already_keep_can_be_offered_as_it_stands(client, db_session, signed_in):
    made = client.post(
        "/api/foods",
        json={"name": "Grandma's fudge", "base_unit": "g", "servings": SERVINGS, **FULL},
    ).json()

    attach_front(client, made["id"])
    response = client.post(
        f"/api/foods/{made['id']}/submit",
        json={"note": "Home made.", "label_photo_id": a_photo(client, "label")},
    )
    assert response.status_code == 201
    assert response.json()["food"]["status"] == "pending"
    assert db_session.get(models.Food, made["id"]).status == "pending"


def test_offering_one_you_keep_is_held_to_the_same_whole_label(client, signed_in):
    made = client.post(
        "/api/foods",
        json={"name": "Half a label", "base_unit": "g", "calories": 100, "protein_g": 1,
              "carbs_g": 2, "fat_g": 3, "servings": SERVINGS},
    ).json()

    attach_front(client, made["id"])
    response = client.post(
        f"/api/foods/{made['id']}/submit", json={"label_photo_id": a_photo(client, "label")}
    )
    assert response.status_code == 400
    assert response.json() == {"detail": "Saturated fat is required before this can be shared."}


def test_somebody_else_s_food_cannot_be_offered(client, db_session, make_user, signed_in):
    stranger = make_user("stranger")
    theirs = models.Food(
        status="custom", owner_id=stranger.id, name="Their food", base_unit="g", **FULL
    )
    db_session.add(theirs)
    db_session.commit()

    response = client.post(f"/api/foods/{theirs.id}/submit", json={})
    assert response.status_code == 404


def test_one_food_cannot_be_waiting_twice(client, signed_in):
    made = client.post(
        "/api/foods",
        json={"name": "Grandma's fudge", "base_unit": "g", "servings": SERVINGS, **FULL},
    ).json()
    attach_front(client, made["id"])
    assert (
        client.post(
            f"/api/foods/{made['id']}/submit", json={"label_photo_id": a_photo(client, "label")}
        ).status_code
        == 201
    )

    again = client.post(f"/api/foods/{made['id']}/submit", json={})
    assert again.status_code in (403, 409)


# ---- Photos ----


def test_a_photo_goes_with_the_food_it_was_offered_for(client, db_session, signed_in):
    photo_id = a_photo(client)
    response = offer(client, photo_id=photo_id)
    assert response.status_code == 201

    photo = db_session.get(models.FoodPhoto, photo_id)
    assert photo.food_id == response.json()["food"]["id"]
    assert photo.status == "pending"


def test_somebody_else_s_photo_cannot_be_attached(client, make_user, signed_in):
    photo_id = a_photo(client)
    make_user("stranger")
    sign_in(client, "stranger")

    response = offer(client, photo_id=photo_id)
    assert response.status_code == 400
    assert response.json() == {"detail": "That photo is not there to attach."}


# ---- Withdrawing ----


def test_the_list_of_what_you_offered_is_newest_first(client, signed_in):
    offer(client, barcode=None, name="First")
    offer(client, barcode=None, name="Second")

    rows = client.get("/api/submissions/mine").json()
    assert [row["name"] for row in rows] == ["Second", "First"]
    assert rows[0]["status"] == "pending"
    assert rows[0]["decision_note"] == ""
    assert rows[0]["decided_at"] is None


def test_the_list_is_only_your_own(client, make_user, signed_in):
    offer(client, barcode=None)
    make_user("stranger")
    sign_in(client, "stranger")
    assert client.get("/api/submissions/mine").json() == []


def test_taking_an_offer_back_leaves_the_food_privately_yours(
    client, db_session, signed_in
):
    made = offer(client)
    submission_id = made.json()["submission_id"]
    food_id = made.json()["food"]["id"]

    assert client.delete(f"/api/submissions/{submission_id}").status_code == 204
    assert db_session.get(models.FoodSubmission, submission_id) is None
    assert db_session.get(models.Food, food_id).status == "custom"
    assert client.get("/api/submissions/mine").json() == []


def test_taking_an_offer_back_takes_the_photo_with_it(client, db_session, signed_in):
    photo_id = a_photo(client)
    name = db_session.get(models.FoodPhoto, photo_id).path
    submission_id = offer(client, photo_id=photo_id).json()["submission_id"]

    assert client.delete(f"/api/submissions/{submission_id}").status_code == 204
    assert db_session.get(models.FoodPhoto, photo_id) is None
    assert not os.path.isfile(photos.path_for(name))


def test_somebody_else_s_offer_cannot_be_taken_back(client, make_user, signed_in):
    submission_id = offer(client).json()["submission_id"]
    make_user("stranger")
    sign_in(client, "stranger")

    response = client.delete(f"/api/submissions/{submission_id}")
    assert response.status_code == 404
    assert response.json() == {"detail": "There is no such submission."}


def test_offering_needs_a_session(client):
    # Sent by hand rather than through the helper, which would need a session
    # of its own to upload a photo with.
    assert client.post("/api/submissions/food", json=body()).status_code == 401
    assert client.get("/api/submissions/mine").status_code == 401


# ---- What a food everybody will eat out of has to be photographed from ----


def test_a_packet_needs_the_front_and_the_label(client, signed_in):
    without = client.post("/api/submissions/food", json=body(photo_id=a_photo(client)))
    assert without.status_code == 400
    assert without.json() == {"detail": "Add a photo of the nutrition label."}

    with_both = offer(client)
    assert with_both.status_code == 201


def test_anything_shared_needs_the_front_of_the_pack(client, signed_in):
    response = client.post("/api/submissions/food", json=body(barcode=None))
    assert response.status_code == 400
    assert response.json() == {"detail": "Add a photo of the front of the pack."}


def test_a_loose_food_still_needs_a_label_photo(client, signed_in):
    response = client.post(
        "/api/submissions/food", json=body(barcode=None, photo_id=a_photo(client))
    )
    assert response.status_code == 400
    assert response.json() == {"detail": "Add a photo of the nutrition label."}


def test_the_label_photo_is_kept_with_the_request_and_not_with_the_food(
    client, db_session, signed_in
):
    label_id = a_photo(client, "label")
    made = offer(client, label_photo_id=label_id).json()
    submission = db_session.get(models.FoodSubmission, made["submission_id"])

    assert submission.label_photo_id == label_id
    # It belongs to the request. Attaching it to the food would publish it the
    # day somebody publishes the food's picture.
    assert db_session.get(models.FoodPhoto, label_id).food_id is None
    assert db_session.get(models.FoodPhoto, label_id).status == "pending"


def test_a_front_photo_cannot_stand_in_for_the_label(client, signed_in):
    response = client.post(
        "/api/submissions/food",
        json=body(photo_id=a_photo(client), label_photo_id=a_photo(client)),
    )
    assert response.status_code == 400
    assert response.json() == {"detail": "That photo is not there to attach."}


def test_one_label_photo_cannot_be_evidence_for_two_requests(client, signed_in):
    label_id = a_photo(client, "label")
    assert offer(client, label_photo_id=label_id).status_code == 201

    again = client.post(
        "/api/submissions/food",
        json=body(barcode="0123456789012", photo_id=a_photo(client), label_photo_id=label_id),
    )
    assert again.status_code == 400
    assert again.json() == {"detail": "That photo is not there to attach."}


def test_taking_an_offer_back_takes_the_label_photo_with_it(client, db_session, signed_in):
    label_id = a_photo(client, "label")
    name = db_session.get(models.FoodPhoto, label_id).path
    submission_id = offer(client, label_photo_id=label_id).json()["submission_id"]

    assert client.delete(f"/api/submissions/{submission_id}").status_code == 204
    assert db_session.get(models.FoodPhoto, label_id) is None
    assert not os.path.isfile(photos.path_for(name))


def test_a_food_with_a_barcode_offered_from_its_own_page_needs_both(
    client, db_session, signed_in
):
    made = client.post(
        "/api/foods",
        json={
            "name": "Scanned bar",
            "base_unit": "g",
            "barcode": CODE,
            "servings": SERVINGS,
            **FULL,
        },
    ).json()

    bare = client.post(f"/api/foods/{made['id']}/submit", json={})
    assert bare.status_code == 400
    assert bare.json() == {"detail": "Add a photo of the front of the pack."}

    front_id = attach_front(client, made["id"])
    no_label = client.post(f"/api/foods/{made['id']}/submit", json={})
    assert no_label.status_code == 400
    assert no_label.json() == {"detail": "Add a photo of the nutrition label."}

    sent = client.post(
        f"/api/foods/{made['id']}/submit", json={"label_photo_id": a_photo(client, "label")}
    )
    assert sent.status_code == 201
    # The picture the owner put on the food is the one the request carries.
    submission = db_session.get(models.FoodSubmission, sent.json()["submission_id"])
    assert submission.photo_id == front_id


def test_a_second_front_photo_replaces_the_first(client, db_session, signed_in):
    made = client.post(
        "/api/foods", json={"name": "Fudge", "base_unit": "g", **FULL}
    ).json()
    first = attach_front(client, made["id"])
    name = db_session.get(models.FoodPhoto, first).path
    second = attach_front(client, made["id"])

    assert db_session.get(models.FoodPhoto, first) is None
    assert not os.path.isfile(photos.path_for(name))
    assert db_session.get(models.FoodPhoto, second).food_id == made["id"]
    # And the owner sees it on their own food before anybody has published it.
    assert client.get(f"/api/foods/{made['id']}").json()["photo_url"] == (
        f"/api/photos/{second}.webp"
    )


def test_somebody_else_s_food_cannot_be_photographed(client, db_session, make_user, signed_in):
    stranger = make_user("stranger")
    theirs = models.Food(
        status="custom", owner_id=stranger.id, name="Their food", base_unit="g", **FULL
    )
    db_session.add(theirs)
    db_session.commit()

    response = client.post(
        f"/api/foods/{theirs.id}/photo", json={"photo_id": a_photo(client)}
    )
    assert response.status_code == 404


def test_a_correction_may_carry_the_panel_it_was_read_off(client, db_session, signed_in):
    shared = models.Food(
        status="approved", name="Shared bar", base_unit="g", **FULL
    )
    shared.servings = [
        models.FoodServing(name="1 bar", amount=43, unit="g", base_amount=43, position=0)
    ]
    db_session.add(shared)
    db_session.commit()

    label_id = a_photo(client, "label")
    response = client.post(
        "/api/submissions/edit",
        json={
            "target_food_id": shared.id,
            "proposed": {"name": "Shared bar", "base_unit": "g", "servings": SERVINGS, **FULL},
            "label_photo_id": label_id,
        },
    )
    assert response.status_code == 201
    submission = db_session.get(models.FoodSubmission, response.json()["submission_id"])
    assert submission.label_photo_id == label_id


def test_the_owner_sees_their_own_waiting_photo_in_their_own_list(
    client, make_user, signed_in
):
    made = client.post(
        "/api/foods", json={"name": "Kitchen bar", "base_unit": "g", **FULL}
    ).json()
    photo_id = attach_front(client, made["id"])

    row = next(r for r in client.get("/api/foods/mine").json() if r["id"] == made["id"])
    assert row["photo_url"] == f"/api/photos/{photo_id}.webp"

    # Nobody else has this food in a list to begin with, so nobody else is
    # handed the picture with it, and the file itself is not theirs to read.
    make_user("stranger")
    sign_in(client, "stranger")
    assert client.get("/api/foods/search", params={"q": "kitchen"}).json() == []
    assert client.get(f"/api/photos/{photo_id}.webp").status_code == 404


def test_a_shared_food_shows_only_what_was_published(client, db_session, signed_in):
    """The fallback is about a food of your own. A picture waiting on somebody
    else's decision is not shown on a row everybody reads."""
    shared = models.Food(status="approved", name="Shared bar", base_unit="g", **FULL)
    db_session.add(shared)
    db_session.commit()
    photo_id = a_photo(client)
    assert (
        client.post(
            "/api/submissions/photo",
            json={"target_food_id": shared.id, "photo_id": photo_id},
        ).status_code
        == 201
    )

    found = client.get("/api/foods/search", params={"q": "shared"}).json()
    assert [row["photo_url"] for row in found] == [None]


# ---- What a food's own page says about it ----


def test_a_food_s_page_lists_what_was_asked_about_it_newest_first(
    client, make_user, signed_in
):
    """A rejection and the offer that followed it, in that order, with the
    reason still on the one it was given about."""
    make_user("reviewer", admin=True)
    made = offer(client, barcode=None).json()
    food_id = made["food"]["id"]

    sign_in(client, "reviewer")
    assert (
        client.post(
            f"/api/admin/queue/{made['submission_id']}/reject",
            json={"note": "The sodium is out by a factor of ten."},
        ).status_code
        == 200
    )

    sign_in(client, "member")
    rows = client.get(f"/api/foods/{food_id}").json()["submissions"]
    assert [(row["kind"], row["status"]) for row in rows] == [("new", "rejected")]
    assert rows[0]["decision_note"] == "The sodium is out by a factor of ten."

    assert (
        client.post(
            f"/api/foods/{food_id}/submit",
            json={
                "photo_id": a_photo(client),
                "label_photo_id": a_photo(client, "label"),
            },
        ).status_code
        == 201
    )
    rows = client.get(f"/api/foods/{food_id}").json()["submissions"]
    assert [(row["status"], row["decision_note"]) for row in rows] == [
        ("pending", ""),
        ("rejected", "The sodium is out by a factor of ten."),
    ]


def test_nobody_else_is_told_what_was_asked_about_a_food(client, make_user, signed_in):
    """A request is between whoever made it and whoever reviews it. Once the
    food is shared, the page everybody reads carries none of that."""
    make_user("reviewer", admin=True)
    made = offer(client).json()

    sign_in(client, "reviewer")
    assert (
        client.post(f"/api/admin/queue/{made['submission_id']}/approve", json={}).status_code
        == 200
    )

    make_user("stranger")
    sign_in(client, "stranger")
    assert client.get(f"/api/foods/{made['food']['id']}").json()["submissions"] == []
