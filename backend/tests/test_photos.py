"""Uploading a picture of a label, and who may see it afterwards.

What arrives is never what is stored. Every case here is about that: the bytes
are capped, decoded to prove they are an image, re-encoded by this server, and
stripped of everything the camera wrote into them.
"""

import datetime as dt
import io
import os

from PIL import Image

from app import models, photos
from app.models import now_utc
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


def upload(client, raw=None, name="label.jpg", kind="image/jpeg"):
    return client.post(
        "/api/photos", files={"file": (name, raw if raw is not None else picture(), kind)}
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


def test_a_photo_is_scaled_down_to_something_worth_serving(client, db_session, signed_in):
    response = upload(client, picture(size=(2400, 1200)))
    row = db_session.get(models.FoodPhoto, response.json()["photo_id"])

    with Image.open(photos.path_for(row.path)) as stored:
        assert max(stored.size) == photos.MAX_EDGE
        # The shape is kept: a label squashed to fit is a label nobody can read.
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
