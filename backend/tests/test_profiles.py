"""What members are shown about each other: the list of them, what they have
given the shared database, and the picture they are shown by.

Nothing here is private. The counter is work done for the group, the list is
who else is here, and an avatar is what somebody chose to be seen as. The cases
that matter are the ones about what is counted and what happens to the file a
picture replaced.
"""

import io
import os

from PIL import Image

from app import models, photos
from app.models import now_utc
from app.routers.feed import MEMBERS_PAGE
from tests.conftest import PASSWORD
from tests.test_photos import picture


def sign_in(client, username):
    response = client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200


def offer(db, user, kind="new", status="pending", food=None):
    """One request in the queue, or one that has already been answered."""
    row = models.FoodSubmission(
        kind=kind,
        status=status,
        submitted_by_id=user.id,
        food_id=None if food is None else food.id,
        decided_at=None if status == "pending" else now_utc(),
    )
    db.add(row)
    db.commit()
    return row


def a_food(db, name, status="approved"):
    """One food row, straight in."""
    row = models.Food(status=status, name=name, base_unit="g")
    db.add(row)
    db.commit()
    return row


def given(db, user, name):
    """A food this member offered that was taken, still in the database."""
    food = a_food(db, name)
    offer(db, user, status="approved", food=food)
    return food


def send_avatar(client, raw=None):
    return client.post(
        "/api/account/avatar",
        files={"file": ("me.jpg", raw if raw is not None else picture(), "image/jpeg")},
    )


# The counter
# -----------


def test_the_counter_counts_the_foods_that_were_taken(client, db_session, make_user):
    member = make_user("member")
    given(db_session, member, "Oat bar")
    given(db_session, member, "Rye bread")
    # Still in the queue, so nobody has it yet.
    offer(db_session, member, food=a_food(db_session, "Plum jam", status="pending"))
    # A correction is about somebody else's row rather than a food given to
    # everybody, so it is not one of these.
    offer(
        db_session,
        member,
        kind="edit",
        status="approved",
        food=a_food(db_session, "Whole milk"),
    )
    sign_in(client, "member")

    shown = client.get(f"/api/feed/members/{member.id}").json()
    assert shown["contributions"] == 2
    assert "submitted" not in shown
    assert "approved" not in shown


def test_a_deleted_food_is_no_longer_a_contribution(db_session, make_user, admin_client):
    member = make_user("member")
    given(db_session, member, "Oat bar")
    gone = given(db_session, member, "Rye bread")

    assert admin_client.delete(f"/api/foods/{gone.id}").status_code == 204
    shown = admin_client.get(f"/api/feed/members/{member.id}").json()
    assert shown["contributions"] == 1


def test_a_member_who_shares_nothing_still_shows_the_counter(client, db_session, make_user):
    make_user("member")
    other = make_user("other")
    given(db_session, other, "Oat bar")
    sign_in(client, "member")

    shown = client.get(f"/api/feed/members/{other.id}").json()
    assert "age" not in shown
    assert "sex" not in shown
    assert "location" not in shown
    assert shown["contributions"] == 1


# The list
# --------


def test_the_members_list_is_ordered_by_the_name_each_is_shown_under(
    client, db_session, make_user
):
    make_user("zoe")
    bea = make_user("bea")
    # A display name is the name they are shown under, so it is the name they
    # are sorted by.
    bea.display_name = "Winifred"
    member = make_user("member")
    member.display_name = "Alice"
    db_session.commit()
    sign_in(client, "member")

    rows = client.get("/api/feed/members").json()["items"]
    assert [row["display_name"] for row in rows] == ["Alice", "Winifred", "zoe"]


def test_a_list_row_carries_the_counter_and_no_private_fact(client, db_session, make_user):
    member = make_user("member")
    member.display_name = "Test Member"
    member.location = "Phoenix, AZ"
    member.share_location = True
    given(db_session, member, "Oat bar")
    offer(db_session, member, food=a_food(db_session, "Plum jam", status="pending"))
    db_session.commit()
    sign_in(client, "member")

    row = client.get("/api/feed/members").json()["items"][0]
    assert row == {
        "id": member.id,
        "display_name": "Test Member",
        "role": None,
        "avatar_url": None,
        "member_since": member.created_at.strftime("%Y-%m"),
        "contributions": 1,
        "friend": False,
    }


def test_the_roster_pages_and_keeps_its_order_across_the_seam(client, make_user):
    # Named so the alphabet and the order they were made in disagree. The page
    # size comes from the router, so the seam moves with it.
    for number in range(MEMBERS_PAGE):
        make_user(f"m{99 - number:02d}")
    make_user("member")
    sign_in(client, "member")

    first = client.get("/api/feed/members").json()
    assert len(first["items"]) == MEMBERS_PAGE
    assert first["items"][0]["display_name"] == f"m{100 - MEMBERS_PAGE:02d}"
    assert first["next_offset"] == MEMBERS_PAGE

    second = client.get(f"/api/feed/members?offset={MEMBERS_PAGE}").json()
    assert [row["display_name"] for row in second["items"]] == ["member"]
    assert second["next_offset"] is None

    # The rule the whole list is read by, held page by page.
    names = [row["display_name"] for row in first["items"] + second["items"]]
    assert names == sorted(names)


def test_the_roster_is_searched_by_the_shown_name_and_the_username(
    client, db_session, make_user
):
    bea = make_user("bea")
    bea.display_name = "Winifred"
    make_user("zoe")
    member = make_user("member")
    member.display_name = "Alice"
    db_session.commit()
    sign_in(client, "member")

    def found(query):
        return {row["display_name"] for row in client.get(query).json()["items"]}

    assert found("/api/feed/members?q=WINI") == {"Winifred"}
    assert found("/api/feed/members?q=bea") == {"Winifred"}
    assert found("/api/feed/members?q=zo") == {"zoe"}
    assert found("/api/feed/members?q=nobody") == set()


def test_the_members_list_is_for_members(client, make_user):
    make_user("member")
    assert client.get("/api/feed/members").status_code == 401


# The avatar
# ----------


def test_an_avatar_is_stored_as_a_square_webp_this_server_built(
    client, db_session, signed_in
):
    response = send_avatar(client, picture(size=(240, 180)))
    assert response.status_code == 200

    db_session.refresh(signed_in)
    name = signed_in.avatar_path
    assert name.endswith(".webp")
    assert response.json()["avatar_url"] == f"/api/photos/avatar/{name}"

    with Image.open(photos.path_for(name)) as stored:
        assert stored.format == "WEBP"
        assert stored.size[0] == stored.size[1]
        assert max(stored.size) <= photos.MAX_EDGES["avatar"]


def test_a_tiny_picture_is_stored_as_it_is(client, db_session, signed_in):
    assert send_avatar(client, picture(size=(1, 1), fmt="PNG")).status_code == 200
    db_session.refresh(signed_in)
    assert signed_in.avatar_path.endswith(".webp")
    assert os.path.isfile(photos.path_for(signed_in.avatar_path))


def test_the_account_carries_its_avatar_and_other_members_see_it(
    client, db_session, signed_in, make_user
):
    other = make_user("other")
    send_avatar(client)
    db_session.refresh(signed_in)
    url = f"/api/photos/avatar/{signed_in.avatar_path}"

    assert client.get("/api/auth/me").json()["avatar_url"] == url
    assert client.get(f"/api/feed/members/{signed_in.id}").json()["avatar_url"] == url

    # Anybody signed in may read it: it is what this member chose to be seen as.
    sign_in(client, "other")
    served = client.get(url)
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/webp"
    assert client.get(f"/api/feed/members/{other.id}").json()["avatar_url"] is None


def test_a_new_picture_takes_the_old_file_with_it(client, db_session, signed_in):
    send_avatar(client)
    db_session.refresh(signed_in)
    was = signed_in.avatar_path

    send_avatar(client, picture(colour=(10, 20, 30)))
    db_session.refresh(signed_in)
    assert signed_in.avatar_path != was
    assert not os.path.isfile(photos.path_for(was))
    assert os.path.isfile(photos.path_for(signed_in.avatar_path))


def test_removing_the_picture_clears_the_account_and_the_disk(
    client, db_session, signed_in
):
    send_avatar(client)
    db_session.refresh(signed_in)
    was = signed_in.avatar_path

    assert client.delete("/api/account/avatar").status_code == 204
    db_session.refresh(signed_in)
    assert signed_in.avatar_path is None
    assert not os.path.isfile(photos.path_for(was))
    assert client.get("/api/auth/me").json()["avatar_url"] is None
    # The address it was read from answers like an address that was never used.
    assert client.get(f"/api/photos/avatar/{was}").status_code == 404


def test_a_picture_the_size_a_phone_sends_is_taken(client, signed_in):
    # A real photograph framed to 512 px is well past the small-body cap that
    # holds every other JSON address, so the picture route needs its own room.
    out = io.BytesIO()
    Image.effect_noise((512, 512), 64).convert("RGB").save(out, format="JPEG", quality=90)
    raw = out.getvalue()
    assert len(raw) > 64 * 1024
    assert send_avatar(client, raw).status_code == 200


def test_a_picture_past_the_route_limit_gets_the_route_sentence(client, signed_in):
    response = send_avatar(client, b"x" * (5 * 1024 * 1024 + 1))
    assert response.status_code == 413
    assert response.json() == {"detail": "A picture must be at most 5 MB."}


def test_a_file_that_is_not_an_image_is_refused(client, signed_in):
    response = send_avatar(client, b"not a picture")
    assert response.status_code == 400
    assert "image" in response.json()["detail"]


def test_a_made_up_avatar_name_is_not_a_path(client, signed_in):
    assert client.get("/api/photos/avatar/..%2Fsecret.webp").status_code == 404
    assert client.get("/api/photos/avatar/nothing.webp").status_code == 404
