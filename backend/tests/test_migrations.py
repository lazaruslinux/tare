from pathlib import Path

import sqlalchemy as sa
from alembic import command
from alembic.config import Config

BACKEND = Path(__file__).resolve().parents[1]

IDENTITY_TABLES = {"users", "sessions", "email_tokens", "invites", "ingest_tokens"}
FOOD_TABLES = {"foods", "food_servings"}
DIARY_TABLES = {"diary_entries", "saved_foods", "kept_foods", "auto_logs", "auto_log_days"}
COMMUNITY_TABLES = {"food_photos", "food_submissions"}
RECIPE_TABLES = {"recipes", "recipe_ingredients", "meal_templates", "meal_template_items"}
HEALTH_TABLES = {
    "health_profiles",
    "weight_entries",
    "repeat_hidden",
    "exercise_entries",
    "journal_days",
}
FITNESS_TABLES = {
    "fitness_daily",
    "fitness_intraday",
    "workouts",
    "workout_routes",
    "workout_samples",
    "ingest_log",
}


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
        kept_unique = {
            constraint["name"] for constraint in inspector.get_unique_constraints("kept_foods")
        }
        weight_unique = {
            constraint["name"]
            for constraint in inspector.get_unique_constraints("weight_entries")
        }
        user_columns = {column["name"] for column in inspector.get_columns("users")}
        journal_columns = {column["name"] for column in inspector.get_columns("journal_days")}
        photo_columns = {column["name"] for column in inspector.get_columns("food_photos")}
        food_columns = {column["name"] for column in inspector.get_columns("foods")}
        serving_columns = {
            column["name"] for column in inspector.get_columns("food_servings")
        }
        submission_columns = {
            column["name"] for column in inspector.get_columns("food_submissions")
        }
        submission_checks = " ".join(
            str(check["sqltext"])
            for check in inspector.get_check_constraints("food_submissions")
        )
        log_columns = {column["name"] for column in inspector.get_columns("ingest_log")}
        daily_columns = {column["name"] for column in inspector.get_columns("fitness_daily")}
        intraday_columns = {
            column["name"] for column in inspector.get_columns("fitness_intraday")
        }
        weight_columns = {column["name"] for column in inspector.get_columns("weight_entries")}
        daily_unique = {
            constraint["name"]
            for constraint in inspector.get_unique_constraints("fitness_daily")
        }
    finally:
        engine.dispose()
    assert IDENTITY_TABLES <= tables
    assert FOOD_TABLES <= tables
    assert DIARY_TABLES <= tables
    assert COMMUNITY_TABLES <= tables
    assert RECIPE_TABLES <= tables
    assert HEALTH_TABLES <= tables
    assert FITNESS_TABLES <= tables
    # The record of a sync keeps the counting and never the export itself.
    assert "payload" not in log_columns
    assert {"dialect", "items", "accepted", "flagged", "skipped", "error"} <= log_columns
    # How large a file was, and the mark on every row one of them wrote.
    assert "bytes" in log_columns
    assert "source" in daily_columns
    assert "source" in intraday_columns
    assert "via" in weight_columns
    # And one figure per metric per day, whatever the metric turns out to be.
    assert "uq_fitness_daily_day_metric" in daily_unique
    assert "location" in user_columns
    # The facts a member may show other members, each off until it is on, and
    # the clock they read times on.
    assert {
        "share_age",
        "share_sex",
        "share_location",
        "share_workouts",
        "share_journal",
        "share_weight_loss",
        "clock",
    } <= user_columns
    assert journal_columns == {"user_id", "date", "completed_at"}
    entry_columns = {column["name"] for column in inspector.get_columns("diary_entries")}
    assert "recipe_id" in entry_columns
    # Which standing auto-log wrote a row, and the one instruction a member
    # may have per food per meal.
    assert "auto_log_id" in entry_columns
    assert "uq_auto_logs_user_food_slot" in {
        constraint["name"] for constraint in inspector.get_unique_constraints("auto_logs")
    }
    # The partial indexes are the one thing here a plain column cannot express,
    # so it is worth seeing that the migrations really emitted them.
    assert "uq_foods_barcode_approved" in food_indexes
    assert "uq_food_photos_food_approved" in photo_indexes
    assert "uq_food_submissions_open" in submission_indexes
    # And the one that holds a person to a single open request of each kind
    # about a food that is already shared.
    assert "uq_food_submissions_open_target" in submission_indexes
    # The short line under a food's name, the aisle it is browsed under, and
    # the panel it keeps.
    assert {"description", "section", "label_photo_id"} <= food_columns
    # The words a serving was typed in, beside what they came to.
    assert {"amount", "unit", "base_amount"} <= serving_columns
    # The two purposes a picture has, and the panel a request carries.
    assert "purpose" in photo_columns
    assert "label_photo_id" in submission_columns
    # What a reviewer changed before approving, and whether it has been read.
    assert {"edited", "changes", "seen_at"} <= submission_columns
    # And the four things a request can be, the newest of which is a report.
    for kind in ("new", "edit", "photo", "report"):
        assert f"'{kind}'" in submission_checks
    # And the pair that stops one food being pinned twice.
    assert "uq_saved_foods_user_food" in saved_unique
    # And the one that stops a food sitting twice on one person's own list.
    assert "uq_kept_foods_user_food" in kept_unique
    # And the one that holds a member to a single weigh-in a day.
    assert "uq_weight_entries_user_day" in weight_unique
