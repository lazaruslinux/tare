from pathlib import Path

import sqlalchemy as sa
from alembic import command
from alembic.config import Config

BACKEND = Path(__file__).resolve().parents[1]

IDENTITY_TABLES = {"users", "sessions", "email_tokens", "invites", "ingest_tokens"}
FOOD_TABLES = {"foods", "food_servings"}
DIARY_TABLES = {"diary_entries", "saved_foods", "auto_logs", "auto_log_days"}
COMMUNITY_TABLES = {"food_photos", "food_submissions"}
RECIPE_TABLES = {"recipes", "recipe_ingredients", "meal_templates", "meal_template_items"}
HEALTH_TABLES = {
    "health_profiles",
    "weight_entries",
    "repeat_hidden",
    "exercise_entries",
    "journal_days",
    "day_goals",
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
        recipe_columns = {column["name"] for column in inspector.get_columns("recipes")}
        meal_columns = {column["name"] for column in inspector.get_columns("meal_templates")}
        weight_unique = {
            constraint["name"]
            for constraint in inspector.get_unique_constraints("weight_entries")
        }
        user_columns = {column["name"] for column in inspector.get_columns("users")}
        invite_columns = {column["name"] for column in inspector.get_columns("invites")}
        journal_columns = {column["name"] for column in inspector.get_columns("journal_days")}
        photo_columns = {column["name"] for column in inspector.get_columns("food_photos")}
        food_columns = {column["name"] for column in inspector.get_columns("foods")}
        match_indexes = {index["name"] for index in inspector.get_indexes("micro_matches")}
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
        weight_columns = {
            column["name"]: column for column in inspector.get_columns("weight_entries")
        }
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
    # What the accepted count was made of, kept apart for the uploads card.
    assert {"days", "workouts"} <= log_columns
    # How large a file was, and the mark on every row one of them wrote.
    assert "bytes" in log_columns
    assert "source" in daily_columns
    assert "source" in intraday_columns
    assert "via" in weight_columns
    # A day is the readings on it: a weight that may be absent, the shares a
    # scale prints beside it, and no visceral rating any more.
    assert set(weight_columns) == {
        "id",
        "user_id",
        "date_for",
        "weight_kg",
        "body_fat_pct",
        "body_water_pct",
        "muscle_pct",
        "bone_pct",
        "source",
        "via",
        "created_at",
    }
    assert weight_columns["weight_kg"]["nullable"] is True
    # And one figure per metric per day, whatever the metric turns out to be.
    assert "uq_fitness_daily_day_metric" in daily_unique
    assert "location" in user_columns
    # The second role, and the application an administrator answers.
    assert {"is_reviewer", "reviewer_requested_at"} <= user_columns
    # When the first-run screen was answered, which the account carries rather
    # than the browser it was shown in.
    assert "first_run_at" in user_columns
    # What everybody with a role did, and the stamp an edit is written against.
    assert "review_log" in tables
    assert "updated_at" in food_columns
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
    # And the kept meal a line came out of, which is the same link again.
    assert "meal_id" in entry_columns
    # Which standing auto-log wrote a row, and the one instruction a member
    # may have per food per meal.
    assert "auto_log_id" in entry_columns
    assert "uq_auto_logs_user_food_slot" in {
        constraint["name"] for constraint in inspector.get_unique_constraints("auto_logs")
    }
    # The vitamins a food carries, who supplied them, and the record they came
    # out of, beside the questions an administrator answers about the foods no
    # barcode can match.
    assert {"micros", "micros_source", "micros_ref"} <= food_columns
    assert "micro_matches" in tables
    assert "uq_micro_matches_pending" in match_indexes
    # The partial indexes are the one thing here a plain column cannot express,
    # so it is worth seeing that the migrations really emitted them.
    assert "uq_foods_barcode_approved" in food_indexes
    assert "uq_food_photos_food_approved" in photo_indexes
    # And the pair the daily upload cap counts on.
    assert "ix_food_photos_uploader_created" in photo_indexes
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
    # The list of kept foods is gone: a favorite is the one saved list.
    assert "kept_foods" not in tables
    # And what a scale said a recipe or a meal came to.
    assert "final_weight_g" in recipe_columns
    assert "final_weight_g" in meal_columns
    # And the one that holds a member to a single weigh-in a day.
    assert "uq_weight_entries_user_day" in weight_unique
    # A link seats several people, so how many it holds and how many have gone
    # are on the link, and who came in through it is on the member.
    assert "invite_id" in user_columns
    assert {"seats", "used"} <= invite_columns
    assert "used_by" not in invite_columns
    assert "revoked_at" not in invite_columns


def test_the_kept_list_becomes_favorites_without_doubling_anything(tmp_path):
    """Everything kept is starred afterwards, and a food already starred once
    is starred once."""
    database = tmp_path / "tare.db"
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")

    command.upgrade(config, "0032_reviewers")
    engine = sa.create_engine(f"sqlite:///{database}")
    stamp = "2026-09-01 08:00:00"
    try:
        with engine.begin() as connection:
            connection.execute(
                sa.text(
                    "INSERT INTO users (id, username, password_hash, created_at,"
                    " share_age, share_sex, share_location, share_workouts,"
                    " share_journal, share_weight_loss, clock)"
                    " VALUES (1, 'member', 'x', :at, 0, 0, 0, 0, 0, 0, '12h')"
                ),
                {"at": stamp},
            )
            for food_id, name in ((1, "Rolled oats"), (2, "Greek yoghurt")):
                connection.execute(
                    sa.text(
                        "INSERT INTO foods (id, status, name, brand, description,"
                        " section, base_unit, created_at, updated_at)"
                        " VALUES (:id, 'approved', :name, '', '', 'other', 'g', :at, :at)"
                    ),
                    {"id": food_id, "name": name, "at": stamp},
                )
            # One food on both lists, one only kept, so the copy has a
            # duplicate to skip and a row to write.
            connection.execute(
                sa.text(
                    "INSERT INTO saved_foods (user_id, food_id, created_at)"
                    " VALUES (1, 1, :at)"
                ),
                {"at": stamp},
            )
            for food_id in (1, 2):
                connection.execute(
                    sa.text(
                        "INSERT INTO kept_foods (user_id, food_id, added_at)"
                        " VALUES (1, :food, :at)"
                    ),
                    {"food": food_id, "at": stamp},
                )

        command.upgrade(config, "head")

        with engine.connect() as connection:
            starred = connection.execute(
                sa.text("SELECT user_id, food_id FROM saved_foods ORDER BY food_id")
            ).all()
            tables = set(sa.inspect(engine).get_table_names())
    finally:
        engine.dispose()
    assert starred == [(1, 1), (1, 2)]
    assert "kept_foods" not in tables


def test_every_account_that_already_exists_is_past_the_first_run_screen(tmp_path):
    """Nobody who is already a member is sent back through the questions."""
    database = tmp_path / "tare.db"
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")

    command.upgrade(config, "0034_invite_seats")
    engine = sa.create_engine(f"sqlite:///{database}")
    try:
        with engine.begin() as connection:
            connection.execute(
                sa.text(
                    "INSERT INTO users (id, username, password_hash, created_at,"
                    " share_age, share_sex, share_location, share_workouts,"
                    " share_journal, share_weight_loss, clock)"
                    " VALUES (1, 'member', 'x', :at, 0, 0, 0, 0, 0, 0, '12h')"
                ),
                {"at": "2026-09-01 08:00:00"},
            )

        command.upgrade(config, "head")

        with engine.connect() as connection:
            stamps = connection.execute(sa.text("SELECT first_run_at FROM users")).scalars().all()
    finally:
        engine.dispose()
    assert len(stamps) == 1
    assert stamps[0] is not None


def test_the_three_old_hide_names_become_the_four_new_ones(tmp_path):
    """Calories were part of the numbers card and the heart rate was on the
    card and in the graph both, so one old name can become two new ones."""
    database = tmp_path / "tare.db"
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")

    command.upgrade(config, "0043_micros")
    engine = sa.create_engine(f"sqlite:///{database}")
    was = {
        1: '["avg_hr", "kcal", "route"]',
        2: '["kcal"]',
        3: '["avg_hr"]',
        4: "[]",
    }
    try:
        with engine.begin() as connection:
            for user_id, held in was.items():
                connection.execute(
                    sa.text(
                        "INSERT INTO users (id, username, password_hash, created_at,"
                        " feed_hidden, share_age, share_sex, share_location,"
                        " share_workouts, share_journal, share_weight_loss, clock)"
                        " VALUES (:id, :name, 'x', :at, :held, 0, 0, 0, 0, 0, 0, '12h')"
                    ),
                    {
                        "id": user_id,
                        "name": f"member{user_id}",
                        "at": "2026-09-01 08:00:00",
                        "held": held,
                    },
                )

        command.upgrade(config, "0044_workout_sharing")
        with engine.connect() as connection:
            after = dict(
                connection.execute(sa.text("SELECT id, feed_hidden FROM users")).all()
            )

        command.downgrade(config, "0043_micros")
        with engine.connect() as connection:
            back = dict(
                connection.execute(sa.text("SELECT id, feed_hidden FROM users")).all()
            )
    finally:
        engine.dispose()
    assert after == {
        1: '["stats", "route", "minutes"]',
        2: '["stats"]',
        3: '["stats", "minutes"]',
        4: "[]",
    }
    # Best-effort back: stats says what the two old figures said between them.
    assert back == {
        1: '["avg_hr", "kcal", "route"]',
        2: '["avg_hr", "kcal"]',
        3: '["avg_hr", "kcal"]',
        4: "[]",
    }


def test_the_four_hide_names_become_one_switch_that_starts_off(tmp_path):
    """The breakdown is one thing rather than three, and it is held back by
    default, so every account that did not already hold it comes out holding
    it."""
    database = tmp_path / "tare.db"
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")

    command.upgrade(config, "0044_workout_sharing")
    engine = sa.create_engine(f"sqlite:///{database}")
    was = {
        1: '["stats", "route", "minutes"]',
        2: '["stats"]',
        3: '["route"]',
        4: "[]",
    }
    try:
        with engine.begin() as connection:
            for user_id, held in was.items():
                connection.execute(
                    sa.text(
                        "INSERT INTO users (id, username, password_hash, created_at,"
                        " feed_hidden, share_age, share_sex, share_location,"
                        " share_workouts, share_journal, share_weight_loss, clock)"
                        " VALUES (:id, :name, 'x', :at, :held, 0, 0, 0, 0, 0, 0, '12h')"
                    ),
                    {
                        "id": user_id,
                        "name": f"member{user_id}",
                        "at": "2026-09-01 08:00:00",
                        "held": held,
                    },
                )

        command.upgrade(config, "head")
        with engine.connect() as connection:
            after = dict(
                connection.execute(sa.text("SELECT id, feed_hidden FROM users")).all()
            )

        command.downgrade(config, "0044_workout_sharing")
        with engine.connect() as connection:
            back = dict(
                connection.execute(sa.text("SELECT id, feed_hidden FROM users")).all()
            )
    finally:
        engine.dispose()

    assert after == {
        1: '["details", "route"]',
        2: '["details"]',
        3: '["details", "route"]',
        # Nobody was holding anything, and everybody holds the breakdown now.
        4: '["details"]',
    }
    # Best-effort back: the one name says what the three said between them.
    assert back == {
        1: '["stats", "route", "minutes", "splits"]',
        2: '["stats", "minutes", "splits"]',
        3: '["stats", "route", "minutes", "splits"]',
        4: '["stats", "minutes", "splits"]',
    }
