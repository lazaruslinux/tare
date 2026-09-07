"""Uploading a picture of a label, and who may see it afterwards.

What arrives is never what is stored. Every case here is about that: the bytes
are capped, decoded to prove they are an image, re-encoded by this server, and
stripped of everything the camera wrote into them.
"""

import datetime as dt
import io
import os

from PIL import Image

from app import caps, models, photos, thumbs
from app.models import now_utc
from app.routers import photos as photos_router
from tests.conftest import PASSWORD


def on_disk(name):
    return os.path.isfile(photos.path_for(name))


def picture(size=(240, 180), colour=(120, 160, 130), exif=None, fmt="JPEG"):
    """Bytes of a real image, made here rather than kept as a fixture file."""
    out = io.BytesIO()
    image = Image.new("RGB", size, colour)
    if exif is None:
        image.save(out, format=fmt)
    else:
        image.save(out, format=fmt, exif=exif)
    return out.getvalue()


def upload(client, raw=None, name="label.jpg", kind="image/jpeg", purpose="front"):
    return client.post(
        "/api/photos",
        files={"file": (name, raw if raw is not None else picture(), kind)},
        data={"purpose": purpose},
    )


def sign_in(client, username):
    response = client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200


def test_a_photo_is_stored_as_a_webp_this_server_built(client, db_session, signed_in, media_dir):
    response = upload(client)
    assert response.status_code == 201
    photo_id = response.json()["photo_id"]

    row = db_session.get(models.FoodPhoto, photo_id)
    assert row.status == "pending"
    assert row.food_id is None
    assert row.uploaded_by_id == signed_in.id
    # The name is the server's, and the food it belongs to is not decided yet.
    assert row.path.endswith(".webp")
    assert "/" not in row.path

    stored = (media_dir / "food-photos" / row.path).read_bytes()
    assert stored[:4] == b"RIFF"
    assert stored[8:12] == b"WEBP"


def test_a_front_photo_is_scaled_down_to_something_worth_serving(
    client, db_session, signed_in
):
    response = upload(client, picture(size=(2000, 1000)))
    row = db_session.get(models.FoodPhoto, response.json()["photo_id"])

    with Image.open(photos.path_for(row.path)) as stored:
        assert max(stored.size) <= photos.MAX_EDGES["front"]
        # The shape is kept: a picture squashed to fit is not the food.
        assert stored.size == (1200, 600)


def test_a_label_photo_keeps_the_detail_its_small_print_needs(
    client, db_session, signed_in
):
    response = upload(client, picture(size=(2000, 1000)), purpose="label")
    row = db_session.get(models.FoodPhoto, response.json()["photo_id"])

    with Image.open(photos.path_for(row.path)) as stored:
        assert max(stored.size) <= photos.MAX_EDGES["label"]
        # Bigger than a front of the same photo, which is the whole point.
        assert stored.size == (1600, 800)


def test_a_small_photo_is_not_stretched(client, db_session, signed_in):
    response = upload(client, picture(size=(320, 240)))
    row = db_session.get(models.FoodPhoto, response.json()["photo_id"])

    with Image.open(photos.path_for(row.path)) as stored:
        assert stored.size == (320, 240)


def test_what_the_camera_wrote_into_the_file_does_not_survive(client, db_session, signed_in):
    original = Image.Exif()
    # Make, and the orientation that says the photo was taken sideways.
    original[271] = "A Phone Company"
    original[274] = 6
    response = upload(client, picture(size=(200, 100), exif=original.tobytes()))
    row = db_session.get(models.FoodPhoto, response.json()["photo_id"])

    with Image.open(photos.path_for(row.path)) as stored:
        assert "exif" not in stored.info
        assert dict(stored.getexif()) == {}
        # Rotated on the way in rather than left to a viewer, because the tag
        # that said to rotate it has just been thrown away.
        assert stored.size == (100, 200)


def test_a_photo_past_the_ceiling_is_refused_in_one_sentence(client, signed_in):
    response = upload(client, b"\xff\xd8" + bytes(photos.MAX_UPLOAD_BYTES))
    assert response.status_code == 413
    assert response.json() == {"detail": "A photo must be at most 10 MB."}


def test_a_file_that_is_not_an_image_is_refused_in_one_sentence(client, signed_in):
    response = upload(client, b"this is not a picture of anything")
    assert response.status_code == 400
    assert response.json() == {"detail": "That file is not an image this server can read."}


def test_a_canvas_bigger_than_this_server_will_decode_is_refused(
    client, signed_in, monkeypatch
):
    # The real ceiling is twenty-five million pixels, and building an image
    # that size to prove the guard is worse than moving the guard.
    monkeypatch.setattr(photos, "MAX_PIXELS", 1000)
    response = upload(client, picture(size=(200, 200)))
    assert response.status_code == 400
    assert response.json() == {"detail": "That image is too large to work with."}


def test_nothing_at_all_is_refused_in_one_sentence(client, signed_in):
    response = client.post("/api/photos", files={"file": ("label.jpg", b"", "image/jpeg")})
    assert response.status_code == 400
    assert response.json() == {"detail": "Choose a picture to attach."}


def test_a_photo_waiting_on_a_decision_is_the_uploader_s_and_nobody_else_s(
    client, make_user, signed_in
):
    photo_id = upload(client).json()["photo_id"]
    assert client.get(f"/api/photos/{photo_id}.webp").status_code == 200

    make_user("stranger")
    sign_in(client, "stranger")
    missing = client.get(f"/api/photos/{photo_id}.webp")
    assert missing.status_code == 404
    assert missing.json() == {"detail": "There is no such photo."}


def test_an_administrator_sees_a_photo_that_is_waiting(client, make_user, signed_in):
    photo_id = upload(client).json()["photo_id"]
    make_user("reviewer", admin=True)
    sign_in(client, "reviewer")
    assert client.get(f"/api/photos/{photo_id}.webp").status_code == 200


def test_a_published_photo_is_everybody_s(client, db_session, make_user, signed_in):
    photo_id = upload(client).json()["photo_id"]
    db_session.get(models.FoodPhoto, photo_id).status = "approved"
    db_session.commit()

    make_user("stranger")
    sign_in(client, "stranger")
    response = client.get(f"/api/photos/{photo_id}.webp")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/webp"


def test_an_upload_nobody_ever_sent_is_swept_up_by_the_next_one(
    client, db_session, signed_in
):
    orphan_id = upload(client).json()["photo_id"]
    orphan = db_session.get(models.FoodPhoto, orphan_id)
    name = orphan.path
    # Aged past the window rather than waited out.
    orphan.created_at = now_utc() - dt.timedelta(hours=25)
    db_session.commit()

    upload(client)

    assert db_session.get(models.FoodPhoto, orphan_id) is None
    assert not on_disk(name)


def test_an_upload_that_was_sent_with_something_is_left_alone(
    client, db_session, signed_in
):
    food = models.Food(status="pending", owner_id=signed_in.id, name="A bar", base_unit="g")
    db_session.add(food)
    db_session.commit()

    kept_id = upload(client).json()["photo_id"]
    kept = db_session.get(models.FoodPhoto, kept_id)
    kept.created_at = now_utc() - dt.timedelta(hours=25)
    # Claimed by a submission, which is what food_id being set means.
    kept.food_id = food.id
    db_session.commit()

    upload(client)
    assert db_session.get(models.FoodPhoto, kept_id) is not None


def test_uploading_needs_a_session(client):
    assert upload(client).status_code == 401


# ---- The label photo, which is evidence rather than a picture of a food ----


def test_a_photo_is_of_the_front_unless_it_says_otherwise(client, db_session, signed_in):
    front = upload(client).json()["photo_id"]
    label = upload(client, purpose="label").json()["photo_id"]
    assert db_session.get(models.FoodPhoto, front).purpose == "front"
    assert db_session.get(models.FoodPhoto, label).purpose == "label"


def test_a_purpose_that_is_not_one_of_the_two_is_refused(client, signed_in):
    response = upload(client, purpose="sideways")
    assert response.status_code == 400
    assert response.json() == {"detail": "A photo is of the front or of the label."}


def test_a_label_photo_is_the_uploader_s_and_the_reviewer_s_and_nobody_else_s(
    client, db_session, make_user, signed_in
):
    photo_id = upload(client, purpose="label").json()["photo_id"]
    # Published by hand, which nothing in the app does to a label photo. Even
    # then it is not everybody's: no shared food is holding it, so there is
    # nothing it was published beside.
    db_session.get(models.FoodPhoto, photo_id).status = "approved"
    db_session.commit()

    assert client.get(f"/api/photos/{photo_id}.webp").status_code == 200

    make_user("stranger")
    sign_in(client, "stranger")
    absent = client.get(f"/api/photos/{photo_id}.webp")
    assert absent.status_code == 404
    assert absent.json() == {"detail": "There is no such photo."}

    make_user("reviewer", admin=True)
    sign_in(client, "reviewer")
    assert client.get(f"/api/photos/{photo_id}.webp").status_code == 200


def test_the_panel_a_shared_food_holds_is_read_by_anybody_signed_in(
    client, db_session, make_user, signed_in
):
    """A food publishes its panel. Somebody reading the numbers should be able
    to read the label they came off and report a mismatch."""
    photo_id = upload(client, purpose="label").json()["photo_id"]
    food = models.Food(status="approved", name="A bar", base_unit="g")
    db_session.add(food)
    db_session.commit()
    food.label_photo_id = photo_id
    db_session.commit()

    make_user("stranger")
    sign_in(client, "stranger")
    assert client.get(f"/api/photos/{photo_id}.webp").status_code == 200


def test_a_panel_no_shared_food_holds_stays_shut(client, db_session, make_user, signed_in):
    """Evidence under a request nobody has answered, and the panel on somebody's
    own food, are published by nothing and read by nobody else."""
    waiting_id = upload(client, purpose="label").json()["photo_id"]
    private_id = upload(client, purpose="label").json()["photo_id"]
    offered = models.Food(
        status="pending", owner_id=signed_in.id, name="A bar", base_unit="g"
    )
    mine = models.Food(
        status="custom", owner_id=signed_in.id, name="My bar", base_unit="g"
    )
    db_session.add_all([offered, mine])
    db_session.commit()
    db_session.add(
        models.FoodSubmission(
            kind="new",
            status="pending",
            food_id=offered.id,
            label_photo_id=waiting_id,
            submitted_by_id=signed_in.id,
        )
    )
    offered.label_photo_id = waiting_id
    mine.label_photo_id = private_id
    db_session.commit()

    make_user("stranger")
    sign_in(client, "stranger")
    for photo_id in (waiting_id, private_id):
        absent = client.get(f"/api/photos/{photo_id}.webp")
        assert absent.status_code == 404
        assert absent.json() == {"detail": "There is no such photo."}


def test_a_label_photo_a_request_still_needs_is_not_swept_up(
    client, db_session, signed_in
):
    """A label photo never reaches a food, so the sweep has to ask what points
    at it instead of whether it was attached to one."""
    food = models.Food(status="pending", owner_id=signed_in.id, name="A bar", base_unit="g")
    db_session.add(food)
    db_session.commit()

    kept_id = upload(client, purpose="label").json()["photo_id"]
    loose_id = upload(client, purpose="label").json()["photo_id"]
    for photo_id in (kept_id, loose_id):
        db_session.get(models.FoodPhoto, photo_id).created_at = now_utc() - dt.timedelta(
            hours=25
        )
    db_session.add(
        models.FoodSubmission(
            kind="new",
            status="pending",
            food_id=food.id,
            label_photo_id=kept_id,
            submitted_by_id=signed_in.id,
        )
    )
    db_session.commit()
    loose_name = db_session.get(models.FoodPhoto, loose_id).path

    upload(client)

    assert db_session.get(models.FoodPhoto, kept_id) is not None
    assert db_session.get(models.FoodPhoto, loose_id) is None
    assert not on_disk(loose_name)


def test_a_label_photo_under_an_old_decision_is_let_go(client, db_session, signed_in):
    """Evidence outlives the answer long enough to be questioned, then goes."""
    food = models.Food(status="pending", owner_id=signed_in.id, name="A bar", base_unit="g")
    db_session.add(food)
    db_session.commit()

    spent_id = upload(client, purpose="label").json()["photo_id"]
    recent_id = upload(client, purpose="label").json()["photo_id"]
    waiting_id = upload(client, purpose="label").json()["photo_id"]
    decided = [
        (spent_id, photos_router.LABEL_KEEP_DAYS + 1),
        (recent_id, photos_router.LABEL_KEEP_DAYS - 1),
    ]
    for photo_id, days in decided:
        db_session.add(
            models.FoodSubmission(
                kind="new",
                status="rejected",
                food_id=food.id,
                label_photo_id=photo_id,
                submitted_by_id=signed_in.id,
                decided_at=now_utc() - dt.timedelta(days=days),
            )
        )
    db_session.add(
        models.FoodSubmission(
            kind="new",
            status="pending",
            food_id=food.id,
            label_photo_id=waiting_id,
            submitted_by_id=signed_in.id,
        )
    )
    db_session.commit()
    spent_name = db_session.get(models.FoodPhoto, spent_id).path

    upload(client)

    assert db_session.get(models.FoodPhoto, spent_id) is None
    assert not on_disk(spent_name)
    assert db_session.get(models.FoodPhoto, recent_id) is not None
    assert db_session.get(models.FoodPhoto, waiting_id) is not None


def test_the_panel_a_shared_food_keeps_is_never_swept_up(client, db_session, signed_in):
    """A food holds one label for life, whatever became of the request."""
    food = models.Food(status="approved", name="A bar", base_unit="g")
    db_session.add(food)
    db_session.commit()

    kept_id = upload(client, purpose="label").json()["photo_id"]
    db_session.get(models.FoodPhoto, kept_id).created_at = now_utc() - dt.timedelta(hours=25)
    db_session.add(
        models.FoodSubmission(
            kind="new",
            status="approved",
            food_id=food.id,
            label_photo_id=kept_id,
            submitted_by_id=signed_in.id,
            decided_at=now_utc() - dt.timedelta(days=photos_router.LABEL_KEEP_DAYS + 1),
        )
    )
    food.label_photo_id = kept_id
    db_session.commit()

    upload(client)

    assert db_session.get(models.FoodPhoto, kept_id) is not None


def test_a_member_may_only_upload_so_many_pictures_in_one_day(client, db_session, signed_in):
    assert caps.DAILY_PHOTOS == 40
    for _ in range(caps.DAILY_PHOTOS - 1):
        db_session.add(
            models.FoodPhoto(
                uploaded_by_id=signed_in.id,
                path="already.webp",
                status="pending",
                purpose="front",
                created_at=now_utc(),
            )
        )
    db_session.commit()
    assert upload(client).status_code == 201

    refused = upload(client)
    assert refused.status_code == 429
    assert refused.json()["detail"] == caps.TOO_MANY_PHOTOS


# ---- The small copy a list of rows draws ----


def test_a_front_photo_is_stored_with_a_small_square_copy_beside_it(
    client, db_session, signed_in
):
    response = upload(client, picture(size=(400, 200)))
    row = db_session.get(models.FoodPhoto, response.json()["photo_id"])

    small = photos.thumb_name(row.path)
    assert small.endswith(".thumb.webp")
    assert on_disk(small)
    with Image.open(photos.path_for(small)) as thumb:
        # Square, because every row draws it in a square box, and cut out of
        # the middle rather than squashed.
        assert thumb.size == (photos.THUMB_EDGE, photos.THUMB_EDGE)
    # And smaller than the picture it stands for, which is the whole point.
    assert os.path.getsize(photos.path_for(small)) < os.path.getsize(
        photos.path_for(row.path)
    )


def test_a_label_photo_gets_no_small_copy(client, db_session, signed_in):
    response = upload(client, purpose="label")
    row = db_session.get(models.FoodPhoto, response.json()["photo_id"])
    assert not on_disk(photos.thumb_name(row.path))


def test_the_small_copy_is_served_beside_the_picture_it_is_of(client, signed_in):
    photo_id = upload(client).json()["photo_id"]
    response = client.get(f"/api/photos/{photo_id}.thumb.webp")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/webp"


def test_a_picture_with_no_small_copy_answers_that_it_has_none(
    client, db_session, signed_in
):
    photo_id = upload(client).json()["photo_id"]
    row = db_session.get(models.FoodPhoto, photo_id)
    # A picture stored before there were thumbs, which is what the backfill is
    # for. The full-size one is still there and still served.
    os.remove(photos.path_for(photos.thumb_name(row.path)))

    missing = client.get(f"/api/photos/{photo_id}.thumb.webp")
    assert missing.status_code == 404
    assert missing.json() == {"detail": "There is no such photo."}
    assert client.get(f"/api/photos/{photo_id}.webp").status_code == 200


def test_a_small_copy_is_nobody_s_who_may_not_see_the_picture(
    client, make_user, signed_in
):
    photo_id = upload(client).json()["photo_id"]
    make_user("stranger")
    sign_in(client, "stranger")
    assert client.get(f"/api/photos/{photo_id}.thumb.webp").status_code == 404


def test_the_small_copy_goes_with_the_picture(client, db_session, signed_in):
    photo_id = upload(client).json()["photo_id"]
    row = db_session.get(models.FoodPhoto, photo_id)
    name, small = row.path, photos.thumb_name(row.path)

    photos.remove(name)

    assert not on_disk(name)
    assert not on_disk(small)


def test_the_backfill_writes_the_copies_the_stored_pictures_never_had(
    client, db_session, signed_in
):
    rows = [
        db_session.get(models.FoodPhoto, upload(client).json()["photo_id"]) for _ in range(2)
    ]
    label_id = upload(client, purpose="label").json()["photo_id"]
    label = db_session.get(models.FoodPhoto, label_id)
    for row in rows:
        os.remove(photos.path_for(photos.thumb_name(row.path)))

    assert thumbs.backfill(db_session) == 2
    assert all(on_disk(photos.thumb_name(row.path)) for row in rows)
    # A label is read at full size, so the backfill leaves it alone.
    assert not on_disk(photos.thumb_name(label.path))

    # Run again and there is nothing left to do.
    assert thumbs.backfill(db_session) == 0


def test_a_list_row_carries_both_addresses_of_the_picture(client, db_session, signed_in):
    made = client.post(
        "/api/foods",
        json={
            "name": "Rolled oats",
            "base_unit": "g",
            "calories": 379,
            "protein_g": 13,
            "carbs_g": 68,
            "fat_g": 6.5,
        },
    ).json()
    # Nothing attached yet, which is a food with no picture rather than one
    # whose picture failed to load.
    row = next(r for r in client.get("/api/foods/mine").json() if r["id"] == made["id"])
    assert (row["photo_url"], row["thumb_url"]) == (None, None)

    photo_id = upload(client).json()["photo_id"]
    attached = client.post(f"/api/foods/{made['id']}/photo", json={"photo_id": photo_id})
    assert attached.status_code == 204

    row = next(r for r in client.get("/api/foods/mine").json() if r["id"] == made["id"])
    assert row["photo_url"] == f"/api/photos/{photo_id}.webp"
    assert row["thumb_url"] == f"/api/photos/{photo_id}.thumb.webp"

    # And a picture stored before there were thumbs keeps its full-size
    # address and says it has no small copy.
    name = db_session.get(models.FoodPhoto, photo_id).path
    os.remove(photos.path_for(photos.thumb_name(name)))
    row = next(r for r in client.get("/api/foods/mine").json() if r["id"] == made["id"])
    assert row["photo_url"] == f"/api/photos/{photo_id}.webp"
    assert row["thumb_url"] is None
