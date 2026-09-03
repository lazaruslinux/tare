from pathlib import Path

import sqlalchemy as sa
from alembic import command
from alembic.config import Config

BACKEND = Path(__file__).resolve().parents[1]

IDENTITY_TABLES = {"users", "sessions", "email_tokens", "invites", "ingest_tokens"}
FOOD_TABLES = {"foods", "food_servings"}
DIARY_TABLES = {"diary_entries", "saved_foods"}
COMMUNITY_TABLES = {"food_photos", "food_submissions"}
RECIPE_TABLES = {"recipes", "recipe_ingredients", "meal_templates", "meal_template_items"}
HEALTH_TABLES = {"health_profiles", "weight_entries", "repeat_hidden", "exercise_entries"}


def test_upgrade_head_builds_the_identity_schema(tmp_path):
    database = tmp_path / "tare.db"
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")

    command.upgrade(config, "head")

    engine = sa.create_engine(f"sqlite:///{database}")
    try:
        inspector = sa.inspect(engine)
        tables = set(inspector.get_table_names())
        food_indexes = {index["name"] for index in inspector.get_indexes("foods")}
        photo_indexes = {index["name"] for index in inspector.get_indexes("food_photos")}
        submission_indexes = {
            index["name"] for index in inspector.get_indexes("food_submissions")
        }
        saved_unique = {
            constraint["name"] for constraint in inspector.get_unique_constraints("saved_foods")
        }
        weight_unique = {
            constraint["name"]
            for constraint in inspector.get_unique_constraints("weight_entries")
        }
        user_columns = {column["name"] for column in inspector.get_columns("users")}
        photo_columns = {column["name"] for column in inspector.get_columns("food_photos")}
        serving_columns = {
            column["name"] for column in inspector.get_columns("food_servings")
        }
        submission_columns = {
            column["name"] for column in inspector.get_columns("food_submissions")
        }
    finally:
        engine.dispose()
    assert IDENTITY_TABLES <= tables
    assert FOOD_TABLES <= tables
    assert DIARY_TABLES <= tables
    assert COMMUNITY_TABLES <= tables
    assert RECIPE_TABLES <= tables
    assert HEALTH_TABLES <= tables
    assert "location" in user_columns
    assert "recipe_id" in {column["name"] for column in inspector.get_columns("diary_entries")}
    # The partial indexes are the one thing here a plain column cannot express,
    # so it is worth seeing that the migrations really emitted them.
    assert "uq_foods_barcode_approved" in food_indexes
    assert "uq_food_photos_food_approved" in photo_indexes
    assert "uq_food_submissions_open" in submission_indexes
    # And the one that holds a person to a single open request of each kind
    # about a food that is already shared.
    assert "uq_food_submissions_open_target" in submission_indexes
    # The words a serving was typed in, beside what they came to.
    assert {"amount", "unit", "base_amount"} <= serving_columns
    # The two purposes a picture has, and the panel a request carries.
    assert "purpose" in photo_columns
    assert "label_photo_id" in submission_columns
    # And the pair that stops one food being pinned twice.
    assert "uq_saved_foods_user_food" in saved_unique
    # And the one that holds a member to a single weigh-in a day.
    assert "uq_weight_entries_user_day" in weight_unique
