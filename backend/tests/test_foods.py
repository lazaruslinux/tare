
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


def test_added_sugars_are_kept_apart_from_the_sugars_already_there(client, db_session, signed_in):
    made = create(client, sugar_g=24, added_sugars_g=0).json()
    assert (made["sugar_g"], made["added_sugars_g"]) == (24, 0)
    assert db_session.get(models.Food, made["id"]).added_sugars_g == 0
    # A label that never printed the line leaves it unanswered, which is not
    # the same as none of it.
    assert create(client).json()["added_sugars_g"] is None


def test_the_name_is_trimmed_and_a_blank_one_is_refused(client, signed_in):
    assert create(client, name="  Oat milk  ").json()["name"] == "Oat milk"
    response = create(client, name="   ")
    assert response.status_code == 400
    assert response.json() == {"detail": "A food needs a name."}


def test_a_description_is_kept_and_read_back(client, signed_in):
    made = create(client, description="King Size").json()
    assert made["description"] == "King Size"
    # And a food nobody described says so with an empty string rather than a
    # missing key, so a list row has nothing to guess about.
    assert create(client).json()["description"] == ""


def test_a_description_is_trimmed_onto_one_line(client, signed_in):
    made = create(client, description="  Blueberry\n flavor  ").json()
    assert made["description"] == "Blueberry flavor"


def test_a_description_longer_than_sixty_characters_is_refused(client, signed_in):
    response = create(client, description="x" * 61)
    assert response.status_code == 400
    assert response.json() == {"detail": "A description must be at most 60 characters."}
    assert create(client, description="x" * 60).status_code == 201


def test_an_edit_changes_the_description(client, signed_in):
    made = create(client, description="King Size").json()
    edited = client.patch(
        f"/api/foods/{made['id']}", json=body(description="Blueberry flavor")
    )
    assert edited.status_code == 200
    assert edited.json()["description"] == "Blueberry flavor"


def test_the_four_headline_numbers_are_required(client, signed_in):
    response = create(client, fat_g=None)
    assert response.status_code == 400
    assert response.json() == {"detail": "Calories, protein, carbs, and fat are required."}


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
    eight = [{"name": f"{n} slice", "amount": 28, "unit": "g", "position": n} for n in range(8)]
    assert create(client, servings=eight).status_code == 201
    nine = [*eight, {"name": "9 slice", "amount": 28, "unit": "g"}]
    assert create(client, servings=nine).status_code == 400
    assert create(client, servings=[{"name": "1 slice", "amount": 0, "unit": "g"}]).status_code == 400
    assert (
        create(client, servings=[{"name": "1 slice", "amount": -28, "unit": "g"}]).status_code
        == 400
    )

    response = create(client, servings=[{"name": "  ", "amount": 28, "unit": "g"}])
    assert response.status_code == 400
    assert response.json() == {"detail": "Every serving needs a name."}


def test_a_serving_keeps_the_unit_it_was_typed_in(client, db_session, signed_in):
    """Cheese sold in a one pound block is entered as one pound of it. The
    grams underneath are the server's arithmetic, and the words come back."""
    made = create(
        client,
        name="Cheddar block",
        # 70 calories a block, which is 15.43 per 100 g of a 453.592 g one.
        calories=15.43,
        servings=[{"name": "1 block", "amount": 1, "unit": "lb", "position": 0}],
    ).json()
    stored = db_session.query(models.FoodServing).one()
    assert round(stored.base_amount, 3) == 453.592

    read = client.get(f"/api/foods/{made['id']}").json()["servings"][0]
    assert (read["name"], read["amount"], read["unit"]) == ("1 block", 1, "lb")
    assert round(read["base_amount"], 3) == 453.592
    # And the panel reads back as the label was filled in: 70 a block.
    assert round(read["base_amount"] * 15.43 / 100) == 70


def test_a_serving_of_a_poured_food_is_kept_in_what_it_was_poured_in(client, signed_in):
    made = create(
        client,
        name="Sports drink",
        base_unit="ml",
        servings=[{"name": "1 bottle", "amount": 16.9, "unit": "floz", "position": 0}],
    ).json()
    read = client.get(f"/api/foods/{made['id']}").json()["servings"][0]
    assert (read["amount"], read["unit"]) == (16.9, "floz")
    # 16.9 fl oz is 499.79 mL, and no density was asked of anything.
    assert round(read["base_amount"], 2) == 499.79


def test_a_serving_cannot_leave_the_food_s_own_family(client, signed_in):
    """A cup of a food measured by weight would need a density to mean
    anything, and a serving is the one measurement that assumes nothing."""
    weighed = create(client, servings=[{"name": "1 cup", "amount": 1, "unit": "cup"}])
    assert weighed.status_code == 400
    assert weighed.json() == {"detail": "Pick a weight unit for a food measured by weight."}

    poured = create(
        client, base_unit="ml", servings=[{"name": "1 oz", "amount": 1, "unit": "oz"}]
    )
    assert poured.status_code == 400
    assert poured.json() == {"detail": "Pick a volume unit for a food measured by volume."}

    unknown = create(client, servings=[{"name": "1 handful", "amount": 1, "unit": "handful"}])
    assert unknown.status_code == 400
    assert unknown.json() == {"detail": "That is not a unit Tare knows."}


def test_a_food_reads_back_with_its_servings_in_order(client, signed_in):
    made = create(
        client,
        servings=[
            {"name": "1 breast", "amount": 174, "unit": "g", "position": 1},
            {"name": "100 g", "amount": 100, "unit": "g", "position": 0},
        ],
    ).json()
    read = client.get(f"/api/foods/{made['id']}")
    assert read.status_code == 200
    assert [s["name"] for s in read.json()["servings"]] == ["100 g", "1 breast"]


def test_an_edit_replaces_the_servings_wholesale(client, db_session, signed_in):
    made = create(
        client,
        servings=[
            {"name": "1 slice", "amount": 28, "unit": "g", "position": 0},
            {"name": "2 slices", "amount": 56, "unit": "g", "position": 1},
        ],
    ).json()
    edited = client.patch(
        f"/api/foods/{made['id']}",
        json=body(name="Rye bread", servings=[{"name": "1 thick slice", "amount": 34, "unit": "g"}]),
    )
    assert edited.status_code == 200
    assert edited.json()["name"] == "Rye bread"
    assert [s["name"] for s in edited.json()["servings"]] == ["1 thick slice"]
    assert db_session.query(models.FoodServing).count() == 1


def test_an_edit_without_a_servings_list_leaves_them_alone(client, signed_in):
    made = create(client, servings=[{"name": "1 slice", "amount": 28, "unit": "g"}]).json()
    edited = client.patch(f"/api/foods/{made['id']}", json=body(name="Chicken thigh"))
    assert edited.status_code == 200
    assert [s["name"] for s in edited.json()["servings"]] == ["1 slice"]


def test_deleting_a_food_takes_its_servings(client, db_session, signed_in):
    made = create(client, servings=[{"name": "1 slice", "amount": 28, "unit": "g"}]).json()
    assert client.delete(f"/api/foods/{made['id']}").status_code == 204
    assert db_session.get(models.Food, made["id"]) is None
    assert db_session.query(models.FoodServing).count() == 0


def test_a_list_row_carries_the_label_serving(client, signed_in):
    """What the label calls one of them, so a row reads per that rather than
    per 100 of anything. Position 0 is the label serving."""
    create(
        client,
        name="Sliced cheese",
        servings=[
            {"name": "1 slice", "amount": 19, "unit": "g", "position": 0},
            {"name": "1 pack", "amount": 340, "unit": "g", "position": 1},
        ],
    )
    create(client, name="Loose rice")

    listed = {row["name"]: row["serving"] for row in client.get("/api/foods/mine").json()}
    assert listed["Sliced cheese"] == {
        "name": "1 slice",
        "amount": 19,
        "unit": "g",
        "base_amount": 19,
    }
    # A food nobody named a serving for reads per 100 of its base unit still.
    assert listed["Loose rice"] is None


def test_the_food_list_is_newest_first(client, signed_in):
    create(client, name="First one")
    create(client, name="Second one")
    listed = client.get("/api/foods/mine").json()
    assert [row["name"] for row in listed] == ["Second one", "First one"]


def test_a_shared_food_nobody_kept_is_not_in_my_list(client, db_session, signed_in):
    put_food(db_session, None, name="Shared bar", status="approved")
    create(client, name="Mine")

    listed = client.get("/api/foods/mine").json()
    assert [row["name"] for row in listed] == ["Mine"]


def test_keeping_a_shared_food_puts_it_at_the_top_of_my_list(
    client, db_session, signed_in
):
    create(client, name="First one")
    create(client, name="Second one")
    shared = put_food(db_session, None, name="Shared bar", status="approved")

    assert client.post(f"/api/foods/{shared.id}/keep").status_code == 201
    listed = client.get("/api/foods/mine").json()
    assert [row["name"] for row in listed] == ["Shared bar", "Second one", "First one"]


def test_keeping_a_food_twice_changes_nothing(client, db_session, signed_in):
    shared = put_food(db_session, None, name="Shared bar", status="approved")

    assert client.post(f"/api/foods/{shared.id}/keep").status_code == 201
    again = client.post(f"/api/foods/{shared.id}/keep")
    assert again.status_code == 200
    assert len(client.get("/api/foods/mine").json()) == 1
    assert client.get(f"/api/foods/{shared.id}").json()["kept"] is True


def test_a_food_of_my_own_is_already_mine(client, signed_in):
    made = create(client).json()

    response = client.post(f"/api/foods/{made['id']}/keep")
    assert response.status_code == 400
    assert response.json()["detail"] == foods_router.ALREADY_YOURS
    # Their own food reads as kept anyway, so one flag answers the question.
    assert client.get(f"/api/foods/{made['id']}").json()["kept"] is True


def test_taking_a_shared_food_off_my_list_leaves_it_shared(
    client, db_session, signed_in
):
    shared = put_food(db_session, None, name="Shared bar", status="approved")
    client.post(f"/api/foods/{shared.id}/keep")

    assert client.delete(f"/api/foods/{shared.id}/keep").status_code == 204
    assert client.get("/api/foods/mine").json() == []
    assert client.get(f"/api/foods/{shared.id}").json()["kept"] is False
    # Still in the shared database for everybody, this account included.
    browsed = client.get("/api/foods/browse", params={"letter": "S"}).json()
    assert [row["name"] for row in browsed["items"]] == ["Shared bar"]
    # And taking off one already off changes nothing.
    assert client.delete(f"/api/foods/{shared.id}/keep").status_code == 204


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
    assert response.json() == {"detail": "This barcode is already in the Tare database."}


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
