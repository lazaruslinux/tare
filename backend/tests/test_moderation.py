"""Changing what is already shared: corrections, pictures, and who sees what.

The rules being held to here are the ones a shared database lives or dies by. A
correction is written down as a copy nobody else can see, so nothing everybody
eats out of changes until a person says so. A picture replaces the one before
it, file and all, because two published pictures of one food is a state nothing
can render. And approving either of them never reaches back into a diary: the
day somebody already ate is theirs, not the database's.
"""

import io
import os

import httpx
import pytest
from PIL import Image

from app import foods_api, models, photos
from app.routers import invites
from tests.conftest import PASSWORD

CODE = "034000002405"

# A whole label, which is what anything offered to everybody has to carry.
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


def sign_in(client, username):
    response = client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200


def offline(monkeypatch):
    """Nothing found anywhere, so a scan falls all the way through."""
    monkeypatch.setattr(
        foods_api,
        "session",
        lambda: httpx.Client(
            transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"status": 0}))
        ),
    )


def a_photo(client):
    out = io.BytesIO()
    Image.new("RGB", (160, 120), (200, 180, 120)).save(out, format="JPEG")
    response = client.post(
        "/api/photos", files={"file": ("label.jpg", out.getvalue(), "image/jpeg")}
    )
    assert response.status_code == 201
    return response.json()["photo_id"]


def put_food(db, *, status="approved", owner=None, name="Milk chocolate bar", **fields):
    """A food straight into the database, in whatever state a case needs."""
    food = models.Food(
        status=status,
        owner_id=None if owner is None else owner.id,
        name=name,
        brand=fields.pop("brand", "Hershey's"),
        base_unit="g",
        source="user",
        **{**FULL, **fields},
    )
    food.servings = [
        models.FoodServing(name="1 bar", amount=43, unit="g", base_amount=43, position=0)
    ]
    db.add(food)
    db.commit()
    return food


def shared(db, **fields):
    return put_food(db, status="approved", **{"barcode": CODE, **fields})


def proposal(**overrides):
    sent = {
        "name": "Milk chocolate bar",
        "brand": "Hershey",
        "description": "King Size",
        "base_unit": "g",
        "servings": [{"name": "1 bar", "amount": 45, "unit": "g", "position": 0}],
        **FULL,
        "calories": 500,
        "sodium_mg": 90,
    }
    sent.update(overrides)
    return sent


def suggest(client, target_id, note="The bar got smaller.", **overrides):
    return client.post(
        "/api/submissions/edit",
        json={
            "target_food_id": target_id,
            "proposed": proposal(**overrides),
            "note": note,
        },
    )


def people(client, make_user):
    """One ordinary account signed in, one stranger, and one reviewer."""
    make_user("member")
    make_user("stranger")
    make_user("reviewer", admin=True)
    sign_in(client, "member")


# ---- Suggesting a correction ----


def test_a_correction_is_written_down_as_a_copy_nobody_else_can_see(
    client, db_session, make_user
):
    people(client, make_user)
    target = shared(db_session)
    before = target.calories

    response = suggest(client, target.id)
    assert response.status_code == 201
    made = response.json()
    shadow_id = made["food"]["id"]

    shadow = db_session.get(models.Food, shadow_id)
    assert shadow.status == "shadow"
    assert shadow.owner_id == db_session.get(models.Food, shadow_id).created_by_id
    # Never the target's code: one barcode belongs to one row in the shared
    # database, and this is not that row.
    assert shadow.barcode is None
    assert shadow.calories == 500

    submission = db_session.get(models.FoodSubmission, made["submission_id"])
    assert (submission.kind, submission.status) == ("edit", "pending")
    assert (submission.food_id, submission.target_food_id) == (shadow_id, target.id)

    # And nothing about the shared food has moved.
    db_session.expire_all()
    assert db_session.get(models.Food, target.id).calories == before


def test_a_correction_is_absent_from_every_list_it_could_appear_in(
    client, db_session, make_user, monkeypatch
):
    offline(monkeypatch)
    people(client, make_user)
    target = shared(db_session)
    shadow_id = suggest(client, target.id, name="Matrix shadow").json()["food"]["id"]

    # Not in the owner's own search, own list, browse, or repeat.
    assert shadow_id not in [row["id"] for row in client.get("/api/foods/search?q=matrix").json()]
    assert shadow_id not in [row["id"] for row in client.get("/api/foods/mine").json()]
    assert shadow_id not in [
        row["id"] for row in client.get("/api/foods/browse").json()["items"]
    ]
    assert shadow_id not in [row["id"] for row in client.get("/api/foods/repeat").json()]
    # Reachable by its own address, because that is where it is corrected.
    assert client.get(f"/api/foods/{shadow_id}").status_code == 200

    sign_in(client, "stranger")
    assert client.get(f"/api/foods/{shadow_id}").status_code == 404


def test_a_correction_needs_the_whole_panel(client, db_session, make_user):
    people(client, make_user)
    target = shared(db_session)

    response = suggest(client, target.id, fiber_g=None)
    assert response.status_code == 400
    assert response.json() == {"detail": "Fiber is required before this can be shared."}
    assert suggest(client, target.id, servings=[]).status_code == 400


def test_nought_is_an_answer_in_a_correction_too(client, db_session, make_user):
    people(client, make_user)
    target = shared(db_session)
    assert suggest(client, target.id, fiber_g=0, sugar_g=0).status_code == 201


def test_only_a_shared_food_can_be_corrected(client, db_session, make_user):
    people(client, make_user)
    member = db_session.execute(
        models.User.__table__.select().where(models.User.__table__.c.username == "member")
    ).first()
    mine = put_food(db_session, status="custom", owner=member, name="My own")

    for food_id in (mine.id, 999999):
        response = suggest(client, food_id)
        assert response.status_code == 404
        assert response.json() == {"detail": "There is no such food."}


def test_one_correction_at_a_time_per_person_per_food(client, db_session, make_user):
    people(client, make_user)
    target = shared(db_session)
    assert suggest(client, target.id).status_code == 201

    again = suggest(client, target.id)
    assert again.status_code == 409
    assert again.json() == {"detail": "You already have an edit waiting on this food."}

    # Somebody else may still offer their own correction to the same food.
    sign_in(client, "stranger")
    assert suggest(client, target.id).status_code == 201


# ---- The queue reads two panels side by side ----


def test_the_queue_shows_a_correction_beside_what_it_would_replace(
    client, db_session, make_user
):
    people(client, make_user)
    target = shared(db_session)
    suggest(client, target.id)

    sign_in(client, "reviewer")
    item = client.get("/api/admin/queue").json()[0]
    assert item["kind"] == "edit"
    assert item["submitted_by"] == "member"
    assert item["target"] == {"id": target.id, "name": target.name, "brand": target.brand}
    assert item["current"]["calories"] == 535
    assert item["current"]["servings"] == [
        {"name": "1 bar", "amount": 43, "unit": "g", "base_amount": 43, "position": 0}
    ]
    assert item["food"]["calories"] == 500
    assert item["food"]["servings"] == [
        {"name": "1 bar", "amount": 45, "unit": "g", "base_amount": 45, "position": 0}
    ]
    assert item["note"] == "The bar got smaller."
    # The short line under the name is a correction like any other, so both
    # sides of the diff carry it.
    assert (item["current"]["description"], item["food"]["description"]) == ("", "King Size")


def test_a_reviewer_may_correct_a_proposal_before_deciding_it(
    client, db_session, make_user
):
    people(client, make_user)
    target = shared(db_session)
    shadow_id = suggest(client, target.id).json()["food"]["id"]

    sign_in(client, "reviewer")
    adjusted = client.patch(
        f"/api/foods/{shadow_id}",
        json={"name": "Milk chocolate bar", "base_unit": "g", **FULL, "calories": 505},
    )
    assert adjusted.status_code == 200
    assert adjusted.json()["calories"] == 505

    # And nobody else's account can reach it at all.
    sign_in(client, "stranger")
    refused = client.patch(
        f"/api/foods/{shadow_id}", json={"name": "Theirs", "base_unit": "g", **FULL}
    )
    assert refused.status_code == 404


def test_a_proposal_a_reviewer_left_half_filled_cannot_be_approved(
    client, db_session, make_user
):
    people(client, make_user)
    target = shared(db_session)
    before = target.sodium_mg
    made = suggest(client, target.id)
    shadow_id = made.json()["food"]["id"]

    sign_in(client, "reviewer")
    blanked = client.patch(
        f"/api/foods/{shadow_id}",
        json={"name": "Milk chocolate bar", "base_unit": "g", **FULL, "sodium_mg": None},
    )
    assert blanked.status_code == 200

    refused = client.post(f"/api/admin/queue/{made.json()['submission_id']}/approve", json={})
    assert refused.status_code == 400
    assert refused.json()["detail"] == "Sodium is required before this can be shared."

    # Nothing moved: the shared row still says what it said, and the request
    # is still waiting.
    db_session.expire_all()
    assert db_session.get(models.Food, target.id).sodium_mg == before
    assert db_session.get(models.FoodSubmission, made.json()["submission_id"]).status == "pending"


# ---- Deciding a correction ----


def test_approving_a_correction_moves_it_onto_the_shared_food(
    client, db_session, make_user
):
    people(client, make_user)
    target = shared(db_session)
    made = suggest(client, target.id, brand="Hershey")

    sign_in(client, "reviewer")
    response = client.post(f"/api/admin/queue/{made.json()['submission_id']}/approve", json={})
    assert response.status_code == 200

    db_session.expire_all()
    after = db_session.get(models.Food, target.id)
    assert (after.calories, after.sodium_mg, after.brand) == (500, 90, "Hershey")
    assert after.description == "King Size"
    assert [(row.name, row.base_amount) for row in after.servings] == [("1 bar", 45)]
    # Still shared, still nobody's, still the same row.
    assert (after.status, after.owner_id, after.barcode) == ("approved", None, CODE)

    # The copy has gone, and the request reads as history.
    assert db_session.get(models.Food, made.json()["food"]["id"]) is None
    submission = db_session.get(models.FoodSubmission, made.json()["submission_id"])
    assert submission.status == "approved"
    assert submission.decided_by_id is not None
    assert submission.decided_at is not None
    assert client.get("/api/admin/queue").json() == []


def test_what_was_already_logged_is_untouched_by_a_correction(
    client, db_session, make_user
):
    people(client, make_user)
    target = shared(db_session)
    logged = client.post(
        "/api/diary",
        json={
            "date": "2026-09-01",
            "slot": "snack",
            "food_id": target.id,
            "amount": 1,
            "unit": "serving:" + str(target.servings[0].id),
        },
    )
    assert logged.status_code == 201
    before = client.get("/api/diary/day?date=2026-09-01").json()

    made = suggest(client, target.id, name="Milk chocolate bar, smaller")
    sign_in(client, "reviewer")
    client.post(f"/api/admin/queue/{made.json()['submission_id']}/approve", json={})

    sign_in(client, "member")
    after = client.get("/api/diary/day?date=2026-09-01").json()
    assert after == before
    assert after["slots"]["snack"]["entries"][0]["food_id"] == target.id


def test_rejecting_a_correction_throws_the_copy_away(client, db_session, make_user):
    people(client, make_user)
    target = shared(db_session)
    made = suggest(client, target.id)
    shadow_id = made.json()["food"]["id"]

    sign_in(client, "reviewer")
    response = client.post(
        f"/api/admin/queue/{made.json()['submission_id']}/reject",
        json={"note": "The old weight is the right one."},
    )
    assert response.status_code == 200

    db_session.expire_all()
    assert db_session.get(models.Food, shadow_id) is None
    assert db_session.get(models.Food, target.id).calories == 535

    sign_in(client, "member")
    row = client.get("/api/submissions/mine").json()[0]
    assert (row["kind"], row["status"]) == ("edit", "rejected")
    assert row["target_name"] == "Milk chocolate bar"
    assert row["decision_note"] == "The old weight is the right one."
    # A correction opens the food it was about, not the copy that is now gone.
    assert row["food_id"] == target.id


def test_withdrawing_a_correction_throws_the_copy_away(client, db_session, make_user):
    people(client, make_user)
    target = shared(db_session)
    made = suggest(client, target.id)
    shadow_id = made.json()["food"]["id"]

    assert client.delete(f"/api/submissions/{made.json()['submission_id']}").status_code == 204
    assert db_session.get(models.Food, shadow_id) is None
    assert db_session.get(models.FoodSubmission, made.json()["submission_id"]) is None
    assert db_session.get(models.Food, target.id).calories == 535
    # And the same food can be corrected again straight away.
    assert suggest(client, target.id).status_code == 201


# ---- Offering a picture ----


def offer_photo(client, target_id, photo_id, note=""):
    return client.post(
        "/api/submissions/photo",
        json={"target_food_id": target_id, "photo_id": photo_id, "note": note},
    )


def approved_photo(db, food_id):
    return (
        db.query(models.FoodPhoto)
        .filter(models.FoodPhoto.food_id == food_id, models.FoodPhoto.status == "approved")
        .all()
    )


def test_a_picture_is_attached_to_the_food_and_stays_unpublished(
    client, db_session, make_user
):
    people(client, make_user)
    target = shared(db_session)
    photo_id = a_photo(client)

    response = offer_photo(client, target.id, photo_id, note="Taken in daylight.")
    assert response.status_code == 201

    photo = db_session.get(models.FoodPhoto, photo_id)
    assert (photo.food_id, photo.status) == (target.id, "pending")
    submission = db_session.get(models.FoodSubmission, response.json()["submission_id"])
    assert (submission.kind, submission.target_food_id) == ("photo", target.id)
    assert (submission.food_id, submission.photo_id) == (None, photo_id)
    # Nothing is shown on the food yet.
    assert client.get(f"/api/foods/{target.id}").json()["photo_url"] is None


def test_somebody_else_s_photo_cannot_be_offered(client, db_session, make_user):
    people(client, make_user)
    target = shared(db_session)
    photo_id = a_photo(client)

    sign_in(client, "stranger")
    response = offer_photo(client, target.id, photo_id)
    assert response.status_code == 400
    assert response.json() == {"detail": "That photo is not there to attach."}


def test_one_picture_at_a_time_per_person_per_food(client, db_session, make_user):
    people(client, make_user)
    target = shared(db_session)
    assert offer_photo(client, target.id, a_photo(client)).status_code == 201

    again = offer_photo(client, target.id, a_photo(client))
    assert again.status_code == 409
    assert again.json() == {"detail": "You already have a photo waiting on this food."}


def test_a_picture_can_only_be_offered_for_a_shared_food(client, db_session, make_user):
    people(client, make_user)
    waiting = put_food(db_session, status="pending", name="Not shared yet")
    response = offer_photo(client, waiting.id, a_photo(client))
    assert response.status_code == 404
    assert response.json() == {"detail": "There is no such food."}


def test_the_queue_shows_a_picture_beside_the_one_it_would_replace(
    client, db_session, make_user
):
    people(client, make_user)
    target = shared(db_session)
    standing = a_photo(client)
    db_session.get(models.FoodPhoto, standing).food_id = target.id
    db_session.get(models.FoodPhoto, standing).status = "approved"
    db_session.commit()

    offered = a_photo(client)
    offer_photo(client, target.id, offered)

    sign_in(client, "reviewer")
    item = client.get("/api/admin/queue").json()[0]
    assert item["kind"] == "photo"
    assert item["food"] is None
    assert item["target"]["id"] == target.id
    assert item["photo_url"] == f"/api/photos/{offered}.webp"
    assert item["current_photo_url"] == f"/api/photos/{standing}.webp"


def test_approving_a_picture_replaces_the_one_before_it(client, db_session, make_user):
    people(client, make_user)
    target = shared(db_session)
    standing = a_photo(client)
    row = db_session.get(models.FoodPhoto, standing)
    row.food_id, row.status = target.id, "approved"
    db_session.commit()
    old_file = photos.path_for(row.path)
    assert os.path.isfile(old_file)

    offered = a_photo(client)
    new_file = photos.path_for(db_session.get(models.FoodPhoto, offered).path)
    made = offer_photo(client, target.id, offered)

    sign_in(client, "reviewer")
    response = client.post(f"/api/admin/queue/{made.json()['submission_id']}/approve", json={})
    assert response.status_code == 200

    db_session.expire_all()
    assert db_session.get(models.FoodPhoto, standing) is None
    assert not os.path.isfile(old_file)
    assert db_session.get(models.FoodPhoto, offered).status == "approved"
    assert os.path.isfile(new_file)
    # One published picture per food, whatever has been offered for it.
    assert [photo.id for photo in approved_photo(db_session, target.id)] == [offered]
    assert client.get(f"/api/foods/{target.id}").json()["photo_url"] == (
        f"/api/photos/{offered}.webp"
    )


def test_keeping_the_photo_is_asked_about_for_a_new_food_only(
    client, db_session, make_user
):
    people(client, make_user)
    target = shared(db_session, barcode=None)
    offered = a_photo(client)
    made = offer_photo(client, target.id, offered)

    sign_in(client, "reviewer")
    # A picture offered on its own was offered to be published, so the flag
    # that would throw one away is ignored.
    client.post(
        f"/api/admin/queue/{made.json()['submission_id']}/approve", json={"keep_photo": False}
    )
    db_session.expire_all()
    assert db_session.get(models.FoodPhoto, offered).status == "approved"


def test_rejecting_a_picture_takes_the_row_and_the_file(client, db_session, make_user):
    people(client, make_user)
    target = shared(db_session)
    offered = a_photo(client)
    stored = photos.path_for(db_session.get(models.FoodPhoto, offered).path)
    made = offer_photo(client, target.id, offered)

    sign_in(client, "reviewer")
    client.post(
        f"/api/admin/queue/{made.json()['submission_id']}/reject", json={"note": "Too dark."}
    )

    assert db_session.get(models.FoodPhoto, offered) is None
    assert not os.path.isfile(stored)


def test_withdrawing_a_picture_takes_the_row_and_the_file(client, db_session, make_user):
    people(client, make_user)
    target = shared(db_session)
    offered = a_photo(client)
    stored = photos.path_for(db_session.get(models.FoodPhoto, offered).path)
    made = offer_photo(client, target.id, offered)

    assert client.delete(f"/api/submissions/{made.json()['submission_id']}").status_code == 204
    assert db_session.get(models.FoodPhoto, offered) is None
    assert not os.path.isfile(stored)
    assert client.get(f"/api/foods/{target.id}").json()["photo_url"] is None


# ---- Who sees what, across every state a food can be in ----

# One row per state and reader: whether it is searchable, whether it is in the
# browse list, what its own address answers, and what a scan of its barcode
# says. Written out rather than worked out, because a table that derives its
# own expectations proves nothing about the rules underneath it.
MATRIX = [
    ("approved", "member", True, True, 200, "approved"),
    ("approved", "stranger", True, True, 200, "approved"),
    ("approved", "reviewer", True, True, 200, "approved"),
    ("custom", "member", True, False, 200, "mine"),
    ("custom", "stranger", False, False, 404, "blank"),
    ("custom", "reviewer", False, False, 200, "blank"),
    ("pending", "member", True, False, 200, "mine"),
    ("pending", "stranger", False, False, 404, "blank"),
    ("pending", "reviewer", False, False, 200, "blank"),
    ("shadow", "member", False, False, 200, "blank"),
    ("shadow", "stranger", False, False, 404, "blank"),
    ("shadow", "reviewer", False, False, 200, "blank"),
    ("cache", "member", False, False, 404, "prefill"),
    ("cache", "stranger", False, False, 404, "prefill"),
    ("cache", "reviewer", False, False, 404, "prefill"),
]

# A code of its own for each state, so one scan cannot answer out of another.
CODES = {
    "approved": "0000000000017",
    "custom": "0000000000024",
    "pending": "0000000000031",
    "shadow": "0000000000048",
    "cache": "0000000000055",
}


@pytest.mark.parametrize("status,viewer,in_search,in_browse,detail,scan", MATRIX)
def test_a_food_is_visible_exactly_where_its_state_says(
    client, db_session, make_user, monkeypatch, status, viewer, in_search, in_browse, detail, scan
):
    offline(monkeypatch)
    member = make_user("member")
    make_user("stranger")
    make_user("reviewer", admin=True)

    # Owned by somebody only where the application would own it: the shared
    # database and the cache both belong to nobody.
    owner = None if status in ("approved", "cache") else member
    food = put_food(
        db_session,
        status=status,
        owner=owner,
        name=f"Matrix {status}",
        barcode=CODES[status],
    )
    if status == "cache":
        food.fetched_at = models.now_utc()
        db_session.commit()

    sign_in(client, viewer)
    found = [row["id"] for row in client.get("/api/foods/search?q=matrix").json()]
    assert (food.id in found) is in_search
    listed = [row["id"] for row in client.get("/api/foods/browse").json()["items"]]
    assert (food.id in listed) is in_browse
    assert client.get(f"/api/foods/{food.id}").status_code == detail
    assert client.get(f"/api/barcode/{CODES[status]}").json()["state"] == scan


# ---- Browsing the shared database ----


def test_browse_puts_the_photographed_foods_first_and_pages_the_rest(
    client, db_session, signed_in
):
    made = [
        put_food(db_session, status="approved", name=f"Browse {index:02d}", barcode=None)
        for index in range(45)
    ]
    # Two of them have a published picture, and one has one still waiting.
    pictured = [made[30].id, made[41].id]
    for food_id in pictured:
        db_session.add(models.FoodPhoto(food_id=food_id, path=f"{food_id}.webp", status="approved"))
    db_session.add(models.FoodPhoto(food_id=made[2].id, path="waiting.webp", status="pending"))
    db_session.commit()

    first = client.get("/api/foods/browse").json()
    assert len(first["items"]) == 40
    assert [row["id"] for row in first["items"][:2]] == pictured
    assert first["items"][0]["photo_url"] is not None
    # The rest are in id order, and none of them claims a picture.
    rest = [row["id"] for row in first["items"][2:]]
    assert rest == sorted(rest)
    assert all(row["photo_url"] is None for row in first["items"][2:])
    assert first["next_cursor"]

    second = client.get(f"/api/foods/browse?cursor={first['next_cursor']}").json()
    assert second["next_cursor"] is None
    seen = [row["id"] for row in first["items"]] + [row["id"] for row in second["items"]]
    # Every food once, and no food twice.
    assert sorted(seen) == sorted(food.id for food in made)


def test_a_page_marker_that_is_not_ours_is_refused(client, signed_in):
    response = client.get("/api/foods/browse?cursor=not-a-marker")
    assert response.status_code == 400
    assert response.json() == {"detail": "That page marker is not one of ours."}


def test_browse_needs_a_session(client):
    assert client.get("/api/foods/browse").status_code == 401


def test_browse_by_letter_reads_alphabetically_and_ignores_the_case_of_it(
    client, db_session, signed_in
):
    for name in ("Apricot", "almond butter", "Banana", "Apple"):
        put_food(db_session, status="approved", name=name, barcode=None)

    lower = client.get("/api/foods/browse?letter=a").json()
    upper = client.get("/api/foods/browse?letter=A").json()
    assert [row["id"] for row in lower["items"]] == [row["id"] for row in upper["items"]]
    assert [row["name"] for row in lower["items"]] == ["almond butter", "Apple", "Apricot"]


def test_browse_by_letter_still_pages(client, db_session, signed_in):
    made = [
        put_food(db_session, status="approved", name=f"Pear {index:02d}", barcode=None)
        for index in range(45)
    ]
    first = client.get("/api/foods/browse?letter=p").json()
    assert len(first["items"]) == 40
    assert first["next_cursor"]

    second = client.get(
        f"/api/foods/browse?letter=p&cursor={first['next_cursor']}"
    ).json()
    assert second["next_cursor"] is None
    seen = [row["id"] for row in first["items"]] + [row["id"] for row in second["items"]]
    assert sorted(seen) == sorted(food.id for food in made)


def test_browse_wants_a_letter_and_nothing_else(client, signed_in):
    for asked in ("1", "ab", "%", " "):
        response = client.get("/api/foods/browse", params={"letter": asked})
        assert response.status_code == 400
        assert response.json() == {"detail": "Pick a letter."}


# ---- Invite links ----


def test_an_administrator_mints_lists_and_revokes_links(client, db_session, admin_client):
    made = client.post("/api/admin/invites", json={})
    assert made.status_code == 201
    code = made.json()["code"]
    assert made.json()["path"] == f"/welcome/{code}"
    assert made.json()["used_by"] is None
    assert made.json()["expires_at"] is not None

    listed = client.get("/api/admin/invites").json()
    assert [row["code"] for row in listed] == [code]
    # And the link works, which is the only thing that makes it an invite.
    assert client.get(f"/api/invites/{code}").status_code == 200

    assert client.delete(f"/api/admin/invites/{code}").status_code == 204
    assert client.get("/api/admin/invites").json() == []
    assert client.get(f"/api/invites/{code}").status_code == 404


def test_three_links_at_a_time_is_the_whole_allowance(client, admin_client):
    for _ in range(3):
        assert client.post("/api/admin/invites", json={}).status_code == 201

    fourth = client.post("/api/admin/invites", json={})
    assert fourth.status_code == 409
    assert fourth.json() == {"detail": "Three invites are already open."}

    # Taking one back makes room for the next.
    code = client.get("/api/admin/invites").json()[0]["code"]
    client.delete(f"/api/admin/invites/{code}")
    assert client.post("/api/admin/invites", json={}).status_code == 201


def test_a_link_somebody_came_in_through_is_a_record_not_a_door(
    client, db_session, admin_client, make_user
):
    joined = make_user("joined")
    code = client.post("/api/admin/invites", json={}).json()["code"]
    db_session.execute(
        models.Invite.__table__.update()
        .where(models.Invite.__table__.c.code == code)
        .values(used_by=joined.id)
    )
    db_session.commit()

    response = client.delete(f"/api/admin/invites/{code}")
    assert response.status_code == 400
    assert response.json() == {"detail": "That invite has already been used."}
    assert client.get("/api/admin/invites").json()[0]["used_by"] == "joined"
    # A spent link is not an open one, so it does not count against the three.
    for _ in range(3):
        assert client.post("/api/admin/invites", json={}).status_code == 201


def test_the_command_line_still_mints_a_link_that_never_expires(db_session, admin):
    """What manage.py create-invite does, which is the same minting with no
    date asked for."""
    made = invites.mint(db_session, admin, 0)
    db_session.commit()
    assert made.expires_at is None
    assert invites.invite_path(made.code) == f"/welcome/{made.code}"


def test_a_link_that_was_never_minted_is_absent(client, admin_client):
    response = client.delete("/api/admin/invites/nothing-like-a-code")
    assert response.status_code == 404
    assert response.json() == {"detail": "There is no such invite."}


# ---- Who is on the instance ----


def test_the_member_list_counts_what_each_person_has_offered(
    client, db_session, make_user
):
    people(client, make_user)
    target = shared(db_session)
    first = suggest(client, target.id)
    second = suggest(client, put_food(db_session, name="Another shared").id)

    sign_in(client, "reviewer")
    client.post(f"/api/admin/queue/{first.json()['submission_id']}/approve", json={})
    client.post(
        f"/api/admin/queue/{second.json()['submission_id']}/reject", json={"note": "No."}
    )

    rows = {row["username"]: row for row in client.get("/api/admin/users").json()}
    assert set(rows) == {"member", "stranger", "reviewer"}
    assert rows["member"]["submissions"] == {"pending": 0, "approved": 1, "rejected": 1}
    assert rows["stranger"]["submissions"] == {"pending": 0, "approved": 0, "rejected": 0}
    assert rows["reviewer"]["is_admin"] is True
    assert rows["member"]["is_admin"] is False
    assert rows["member"]["email_verified"] is True
    assert rows["member"]["created_at"] is not None


# ---- None of it is for anybody else ----


def test_every_administration_route_is_shut_to_an_ordinary_account(client, signed_in):
    calls = (
        lambda: client.get("/api/admin/queue"),
        lambda: client.post("/api/admin/queue/1/approve", json={}),
        lambda: client.post("/api/admin/queue/1/reject", json={"note": "no"}),
        lambda: client.get("/api/admin/invites"),
        lambda: client.post("/api/admin/invites", json={}),
        lambda: client.delete("/api/admin/invites/anything"),
        lambda: client.get("/api/admin/users"),
    )
    for call in calls:
        response = call()
        assert response.status_code == 403
        assert response.json() == {"detail": "This needs an administrator account."}


def test_every_administration_route_needs_a_session(client):
    assert client.get("/api/admin/invites").status_code == 401
    assert client.post("/api/admin/invites", json={}).status_code == 401
    assert client.get("/api/admin/users").status_code == 401
