import datetime as dt

from app import models
from app.routers import foods as foods_router
from app.routers.foods import MISSING_FOOD, NOT_YOURS
from tests.conftest import PASSWORD

# The smallest panel a private food is allowed to carry.
PANEL = {"calories": 165, "protein_g": 31, "carbs_g": 0, "fat_g": 3.6}


def body(**overrides):
    sent = {"name": "Chicken breast", "base_unit": "g", **PANEL}
    sent.update(overrides)
    return sent


def create(client, **overrides):
    return client.post("/api/foods", json=body(**overrides))


def sign_in(client, username):
    response = client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200


def put_food(db, owner, *, name="Kept food", status="custom", **fields):
    """A food straight into the database, for the states no route writes yet."""
    food = models.Food(
        status=status,
        owner_id=None if owner is None else owner.id,
        name=name,
        base_unit="g",
        **PANEL,
        **fields,
    )
    db.add(food)
    db.commit()
    return food


def test_a_food_is_created_with_the_minimum_panel(client, db_session, signed_in):
    response = create(client)
    assert response.status_code == 201
    made = response.json()
    assert made["name"] == "Chicken breast"
    assert made["calories"] == 165
    assert made["status"] == "custom"
    assert made["mine"] is True
    assert made["saturated_fat_g"] is None
    # No published picture, which is what a food nobody has photographed says.
    assert made["photo_url"] is None

    kept = db_session.get(models.Food, made["id"])
    assert (kept.owner_id, kept.created_by_id, kept.source) == (signed_in.id, signed_in.id, "user")


def test_the_name_is_trimmed_and_a_blank_one_is_refused(client, signed_in):
    assert create(client, name="  Oat milk  ").json()["name"] == "Oat milk"
    response = create(client, name="   ")
    assert response.status_code == 400
    assert response.json() == {"detail": "A food needs a name."}


def test_the_four_headline_numbers_are_required(client, signed_in):
    response = create(client, fat_g=None)
    assert response.status_code == 400
    assert response.json() == {"detail": "Calories, protein, carbs, and fat are all needed."}


def test_the_other_six_may_be_left_out(client, signed_in):
    response = create(client, sodium_mg=54)
    assert response.status_code == 201
    assert response.json()["sodium_mg"] == 54
    assert response.json()["fiber_g"] is None


def test_negative_nutrition_is_refused(client, signed_in):
    assert create(client, calories=-1).status_code == 400
    assert create(client, fiber_g=-0.5).status_code == 400


def test_a_density_is_held_between_its_bounds(client, signed_in):
    assert create(client, density_g_per_ml=0.2).status_code == 201
    assert create(client, density_g_per_ml=3.0).status_code == 201
    assert create(client, density_g_per_ml=0.19).status_code == 400
    assert create(client, density_g_per_ml=3.01).status_code == 400


def test_servings_are_capped_and_have_to_be_an_amount(client, signed_in):
    eight = [{"name": f"{n} slice", "base_amount": 28, "position": n} for n in range(8)]
    assert create(client, servings=eight).status_code == 201
    nine = [*eight, {"name": "9 slice", "base_amount": 28}]
    assert create(client, servings=nine).status_code == 400
    assert create(client, servings=[{"name": "1 slice", "base_amount": 0}]).status_code == 400
    assert create(client, servings=[{"name": "1 slice", "base_amount": -28}]).status_code == 400

    response = create(client, servings=[{"name": "  ", "base_amount": 28}])
    assert response.status_code == 400
    assert response.json() == {"detail": "Every serving needs a name."}


def test_a_food_reads_back_with_its_servings_in_order(client, signed_in):
    made = create(
        client,
        servings=[
            {"name": "1 breast", "base_amount": 174, "position": 1},
            {"name": "100 g", "base_amount": 100, "position": 0},
        ],
    ).json()
    read = client.get(f"/api/foods/{made['id']}")
    assert read.status_code == 200
    assert [s["name"] for s in read.json()["servings"]] == ["100 g", "1 breast"]


def test_an_edit_replaces_the_servings_wholesale(client, db_session, signed_in):
    made = create(
        client,
        servings=[
            {"name": "1 slice", "base_amount": 28, "position": 0},
            {"name": "2 slices", "base_amount": 56, "position": 1},
        ],
    ).json()
    edited = client.patch(
        f"/api/foods/{made['id']}",
        json=body(name="Rye bread", servings=[{"name": "1 thick slice", "base_amount": 34}]),
    )
    assert edited.status_code == 200
    assert edited.json()["name"] == "Rye bread"
    assert [s["name"] for s in edited.json()["servings"]] == ["1 thick slice"]
    assert db_session.query(models.FoodServing).count() == 1


def test_an_edit_without_a_servings_list_leaves_them_alone(client, signed_in):
    made = create(client, servings=[{"name": "1 slice", "base_amount": 28}]).json()
    edited = client.patch(f"/api/foods/{made['id']}", json=body(name="Chicken thigh"))
    assert edited.status_code == 200
    assert [s["name"] for s in edited.json()["servings"]] == ["1 slice"]


def test_deleting_a_food_takes_its_servings(client, db_session, signed_in):
    made = create(client, servings=[{"name": "1 slice", "base_amount": 28}]).json()
    assert client.delete(f"/api/foods/{made['id']}").status_code == 204
    assert db_session.get(models.Food, made["id"]) is None
    assert db_session.query(models.FoodServing).count() == 0


def test_the_food_list_is_newest_first(client, signed_in):
    create(client, name="First one")
    create(client, name="Second one")
    listed = client.get("/api/foods/mine").json()
    assert [row["name"] for row in listed] == ["Second one", "First one"]


def eaten(db, user, food, on):
    """One diary entry, straight in, on the day a case needs it on."""
    db.add(
        models.DiaryEntry(
            user_id=user.id,
            date_for=dt.date.fromisoformat(on),
            slot="breakfast",
            name=food["name"],
            food_id=food["id"],
            calories=100,
        )
    )
    db.commit()


def test_the_food_list_leads_with_what_was_eaten_last(client, db_session, signed_in):
    older = create(client, name="First one").json()
    create(client, name="Second one")
    newest = create(client, name="Third one").json()

    # The oldest food, eaten today, and the newest, eaten a week ago.
    eaten(db_session, signed_in, older, "2026-09-02")
    eaten(db_session, signed_in, newest, "2026-08-26")

    listed = client.get("/api/foods/mine").json()
    assert [row["name"] for row in listed] == ["First one", "Third one", "Second one"]
    assert [row["last_logged"] for row in listed] == ["2026-09-02", "2026-08-26", None]


def test_a_food_nobody_logged_falls_below_every_one_that_was(client, db_session, signed_in):
    logged = create(client, name="Eaten once").json()
    create(client, name="Never eaten")
    eaten(db_session, signed_in, logged, "2020-01-01")

    listed = client.get("/api/foods/mine").json()
    assert [row["name"] for row in listed] == ["Eaten once", "Never eaten"]


def test_only_my_own_meals_count_towards_when_a_food_was_last_eaten(
    client, db_session, make_user, signed_in
):
    shared_food = put_food(db_session, None, name="Shared bar", status="approved")
    mine = create(client, name="Mine").json()
    eaten(db_session, signed_in, mine, "2020-01-01")
    # Somebody else ate the shared food today, which is none of my business.
    stranger = make_user("stranger")
    eaten(db_session, stranger, {"id": shared_food.id, "name": "Shared bar"}, "2026-09-02")

    listed = client.get("/api/foods/mine").json()
    assert [row["name"] for row in listed] == ["Mine"]
    assert listed[0]["last_logged"] == "2020-01-01"


def test_the_list_stops_at_the_cap(client, monkeypatch, signed_in):
    assert foods_router.MY_LIST_CAP == 1000
    monkeypatch.setattr(foods_router, "MY_LIST_CAP", 2)
    for index in range(3):
        create(client, name=f"Bean number {index}")
    assert len(client.get("/api/foods/mine").json()) == 2


def test_search_ranks_the_name_by_where_the_word_sits(client, signed_in):
    for name in ("Unchicken pie", "Roast chicken", "Chicken breast"):
        create(client, name=name)
    found = client.get("/api/foods/search", params={"q": "chicken"}).json()
    assert [row["name"] for row in found] == ["Chicken breast", "Roast chicken", "Unchicken pie"]


def test_search_breaks_a_tie_on_the_shorter_name(client, signed_in):
    create(client, name="Milk chocolate, dark, imported")
    create(client, name="Milk")
    found = client.get("/api/foods/search", params={"q": "milk"}).json()
    assert [row["name"] for row in found][0] == "Milk"


def test_search_wants_two_characters(client, signed_in):
    create(client, name="Chicken breast")
    assert client.get("/api/foods/search", params={"q": "c"}).json() == []
    assert client.get("/api/foods/search", params={"q": " "}).json() == []
    assert len(client.get("/api/foods/search", params={"q": "ch"}).json()) == 1


def test_search_stops_at_twenty_five(client, signed_in):
    for n in range(30):
        create(client, name=f"Bean number {n}")
    assert len(client.get("/api/foods/search", params={"q": "bean"}).json()) == 25


def test_a_wildcard_in_the_query_is_a_character_like_any_other(client, signed_in):
    create(client, name="Chicken breast")
    assert client.get("/api/foods/search", params={"q": "%%"}).json() == []


def test_somebody_else_s_food_is_absent_rather_than_refused(client, make_user, signed_in):
    made = create(client, name="Chicken breast").json()
    make_user("stranger")
    sign_in(client, "stranger")

    assert client.get("/api/foods/search", params={"q": "chicken"}).json() == []
    assert client.get("/api/foods/mine").json() == []
    mine = client.get(f"/api/foods/{made['id']}")
    absent = client.get("/api/foods/999999")
    assert mine.status_code == absent.status_code == 404
    assert mine.json() == absent.json() == {"detail": MISSING_FOOD}


def test_somebody_else_s_food_cannot_be_changed(client, make_user, signed_in):
    made = create(client).json()
    make_user("stranger")
    sign_in(client, "stranger")
    assert client.patch(f"/api/foods/{made['id']}", json=body()).status_code == 404
    assert client.delete(f"/api/foods/{made['id']}").status_code == 404


def test_an_administrator_reads_a_private_food_but_cannot_change_it(
    client, db_session, make_user, admin_client
):
    owner = make_user("member")
    theirs = put_food(db_session, owner, name="Their own bread")

    read = admin_client.get(f"/api/foods/{theirs.id}")
    assert read.status_code == 200
    assert read.json()["name"] == "Their own bread"
    assert read.json()["mine"] is False

    changed = admin_client.patch(f"/api/foods/{theirs.id}", json=body())
    assert changed.status_code == 403
    assert changed.json() == {"detail": NOT_YOURS}
    assert admin_client.delete(f"/api/foods/{theirs.id}").status_code == 403


def test_an_administrator_may_change_the_shared_database(client, db_session, admin_client):
    shared = put_food(db_session, None, name="Shared oats", status="approved")
    changed = admin_client.patch(f"/api/foods/{shared.id}", json=body(name="Rolled oats"))
    assert changed.status_code == 200
    assert changed.json()["name"] == "Rolled oats"
    assert admin_client.delete(f"/api/foods/{shared.id}").status_code == 204


def test_an_approved_food_is_visible_to_everybody(client, db_session, signed_in):
    shared = put_food(db_session, None, name="Shared oats", status="approved")
    assert client.get(f"/api/foods/{shared.id}").status_code == 200
    found = client.get("/api/foods/search", params={"q": "oats"}).json()
    assert [row["name"] for row in found] == ["Shared oats"]
    # Somebody else's row, so it is not in this account's own list.
    assert client.get("/api/foods/mine").json() == []


def test_foods_need_a_session(client):
    assert client.get("/api/foods/search", params={"q": "chicken"}).status_code == 401
    assert client.get("/api/foods/mine").status_code == 401
    assert client.get("/api/foods/1").status_code == 401
    assert client.post("/api/foods", json=body()).status_code == 401
    assert client.patch("/api/foods/1", json=body()).status_code == 401
    assert client.delete("/api/foods/1").status_code == 401


# ---- The barcode a food was scanned from ----

CODE = "034000002405"


def test_a_food_keeps_the_code_it_was_scanned_from(client, db_session, signed_in):
    made = create(client, barcode=CODE)
    assert made.status_code == 201
    assert db_session.get(models.Food, made.json()["id"]).barcode == CODE

    # And the next scan of that packet is answered from here rather than out
    # on somebody else's server.
    answer = client.get(f"/api/barcode/{CODE}").json()
    assert answer["state"] == "mine"
    assert answer["food"]["id"] == made.json()["id"]


def test_the_same_code_twice_in_one_account_is_refused(client, signed_in):
    assert create(client, barcode=CODE).status_code == 201
    response = create(client, name="The same bar again", barcode=CODE)
    assert response.status_code == 400
    assert response.json() == {"detail": "You already have a food with this barcode."}


def test_a_code_the_shared_database_answers_is_refused(client, db_session, signed_in):
    put_food(db_session, None, name="Already shared", status="approved", barcode=CODE)
    response = create(client, barcode=CODE)
    assert response.status_code == 400
    assert response.json() == {"detail": "This barcode is already in the shared database."}


def test_something_that_is_not_a_barcode_is_refused(client, signed_in):
    for asked in ("12345", "not-a-code", "0340000024051234567"):
        response = create(client, barcode=asked)
        assert response.status_code == 400
        assert response.json() == {"detail": "That is not a barcode."}


def test_two_accounts_may_each_keep_a_private_food_with_one_code(
    client, make_user, signed_in
):
    assert create(client, barcode=CODE).status_code == 201
    make_user("stranger")
    sign_in(client, "stranger")
    assert create(client, barcode=CODE).status_code == 201


def test_an_edit_leaves_the_code_where_it_was(client, db_session, signed_in):
    made = create(client, barcode=CODE).json()
    edited = client.patch(
        f"/api/foods/{made['id']}", json=body(name="Renamed", barcode="0000000000000")
    )
    assert edited.status_code == 200
    assert db_session.get(models.Food, made["id"]).barcode == CODE
