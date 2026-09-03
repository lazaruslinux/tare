"""The arithmetic in docs/HEALTH-MATH.md, case by case.

Every figure here was worked by hand from the numbered decisions before any of
it was written, so a change to the code that changes an answer fails rather
than being blessed by a test that followed it. Ages are counted on 2026-09-02,
which is the day the cases were worked on.
"""

import datetime as dt

import pytest

from app import health

TODAY = dt.date(2026, 9, 2)


@pytest.fixture()
def case_a():
    """Female, 165 cm, 70 kg, born 1996-03-15, Not much, losing at 0.45.

    The case where the quarter-of-maintenance cap binds and the pace that
    really happens is slower than the one that was picked.
    """
    age = health.age_on(dt.date(1996, 3, 15), TODAY)
    resting = health.rmr_mifflin("female", 70, 165, age)
    return {
        "age": age,
        "kg": 70,
        "cm": 165,
        "resting": resting,
        "maintenance": health.maintenance(resting, "not_much"),
        "bmi": health.bmi(70, 165),
    }


@pytest.fixture()
def case_b():
    """Male, 180 cm, 95 kg, 45, Not much, Maintain."""
    resting = health.rmr_mifflin("male", 95, 180, 45)
    return {
        "kg": 95,
        "cm": 180,
        "resting": resting,
        "maintenance": health.maintenance(resting, "not_much"),
        "bmi": health.bmi(95, 180),
    }


@pytest.fixture()
def case_c():
    """Female, 155 cm, 50 kg, 25, Not much, losing at 0.45: the floor binds."""
    resting = health.rmr_mifflin("female", 50, 155, 25)
    return {
        "kg": 50,
        "cm": 155,
        "resting": resting,
        "maintenance": health.maintenance(resting, "not_much"),
        "bmi": health.bmi(50, 155),
    }


def test_age_is_counted_the_way_a_birthday_is():
    assert health.age_on(dt.date(1996, 3, 15), TODAY) == 30
    # The day before an eighteenth birthday and the day of it.
    assert health.age_on(dt.date(2008, 9, 3), TODAY) == 17
    assert health.age_on(dt.date(2008, 9, 2), TODAY) == 18


def test_resting_energy_follows_the_published_coefficients(case_a, case_b, case_c):
    assert case_a["resting"] == pytest.approx(1420.25)
    assert case_b["resting"] == pytest.approx(1855.0)
    assert case_c["resting"] == pytest.approx(1182.75)


def test_a_day_is_resting_energy_times_the_activity_level(case_a, case_b, case_c):
    assert case_a["maintenance"] == pytest.approx(1704.3)
    assert case_b["maintenance"] == pytest.approx(2226.0)
    assert case_c["maintenance"] == pytest.approx(1419.3)
    # And the four levels are the four multipliers, nothing in between.
    assert health.maintenance(1000, "light") == pytest.approx(1375.0)
    assert health.maintenance(1000, "moderate") == pytest.approx(1550.0)
    assert health.maintenance(1000, "heavy") == pytest.approx(1725.0)


def test_lean_mass_takes_over_when_body_fat_is_known():
    # 95 kg at 25 percent leaves 71.25 kg of lean mass.
    assert health.rmr_cunningham(95, 25) == pytest.approx(1909.0)
    assert health.maintenance(health.rmr_cunningham(95, 25), "not_much") == pytest.approx(
        2290.8
    )


def test_the_cap_binds_before_the_chosen_goal_rate_does(case_a):
    worked = health.budget(case_a["maintenance"], "lose", 0.45, "female", False)
    # The first step asks for 450 a day; a quarter of 1704.3 is 426.075, and
    # that wins.
    assert worked.calories == pytest.approx(1278.225)
    assert health.round_for_display(worked.calories, "calories") == 1280
    assert worked.notes == ("cap",)
    assert round(worked.weekly_rate_kg, 2) == 0.43


def test_the_floor_is_the_last_word_and_says_it_will_take_longer(case_c):
    worked = health.budget(case_c["maintenance"], "lose", 0.45, "female", False)
    # The cap gives 1064.475, which is under the floor for a female member.
    assert worked.calories == 1200.0
    assert set(worked.notes) == {"cap", "floor"}
    assert round(worked.weekly_rate_kg, 2) == 0.22


def test_the_male_floor_is_the_higher_one():
    worked = health.budget(1400, "lose", 0.45, "male", False)
    assert worked.calories == 1500.0
    assert "floor" in worked.notes


def test_maintaining_is_the_day_itself(case_b):
    worked = health.budget(case_b["maintenance"], "maintain", None, "male", False)
    assert health.round_for_display(worked.calories, "calories") == 2230
    assert worked.weekly_rate_kg == 0
    assert worked.notes == ()


def test_the_direction_is_read_off_the_two_weights():
    assert health.direction(80.0, 75.0) == "lose"
    assert health.direction(80.0, 85.0) == "gain"
    assert health.direction(80.0, 80.0) == "maintain"
    # No goal weight, or nobody on the scale yet, is nothing to aim at.
    assert health.direction(80.0, None) == "maintain"
    assert health.direction(None, 75.0) == "maintain"


def test_the_steps_are_the_three_and_the_two():
    assert health.steps_for("lose") == (0.45, 0.7, 0.9)
    assert health.steps_for("gain") == (0.25, 0.45)
    assert health.steps_for("maintain") == ()


def test_a_rate_off_the_direction_s_steps_falls_back_to_its_first(case_a):
    # 0.9 belongs to losing, and a turned-around goal leaves it behind.
    worked = health.budget(2000, "gain", 0.9, "male", False)
    assert worked.calories == pytest.approx(2250.0)
    assert worked.notes == ()


def test_gaining_is_capped_at_a_fifth_of_the_day():
    # A fifth of 2000 is 400, so the 450 step is eased back.
    worked = health.budget(2000, "gain", 0.45, "male", False)
    assert worked.calories == pytest.approx(2400.0)
    assert "cap" in worked.notes
    assert round(worked.weekly_rate_kg, 2) == 0.4
    # And the 250 step sits inside it untouched.
    gentle = health.budget(2000, "gain", 0.25, "male", False)
    assert gentle.calories == pytest.approx(2250.0)
    assert gentle.notes == ()


def test_pregnancy_leaves_the_day_alone(case_a):
    worked = health.budget(case_a["maintenance"], "lose", 0.45, "female", True)
    assert worked.calories == pytest.approx(case_a["maintenance"])
    assert worked.notes == ("pregnancy",)
    assert worked.weekly_rate_kg == 0


def test_protein_is_per_kilogram_by_goal_then_held_inside_the_range(case_a, case_b):
    losing = health.macros(1278.225, 70, "lose", 30, case_a["bmi"])
    # 1.6 x 70 is 112, and 35 percent of the budget is 111.85, so the ceiling
    # wins by a whisker and still reads as 112.
    assert health.round_for_display(losing.protein_g, "grams") == 112
    assert health.round_for_display(losing.fat_g, "grams") == 43
    assert health.round_for_display(losing.carbs_g, "grams") == 112
    assert losing.carbs_low is True

    keeping = health.macros(2226.0, 95, "maintain", 45, case_b["bmi"])
    assert health.round_for_display(keeping.protein_g, "grams") == 133
    assert health.round_for_display(keeping.fat_g, "grams") == 74
    assert health.round_for_display(keeping.carbs_g, "grams") == 257
    assert keeping.carbs_low is False


def test_the_ceiling_holds_at_a_high_body_weight():
    # 1.6 x 160 kg is 256 g, which is far over 35 percent of a 2,000 budget.
    split = health.macros(2000, 160, "lose", 40, 45.0)
    assert split.protein_g == pytest.approx(175.0)


def test_the_floor_of_the_range_lifts_a_very_small_target():
    # 1.4 x 40 kg is 56 g, under 10 percent of a 2,600 budget.
    split = health.macros(2600, 40, "maintain", 30, 16.0)
    assert split.protein_g == pytest.approx(65.0)


def test_sixty_five_and_over_never_drops_under_the_older_adult_figure():
    at_65 = health.macros(2000, 70, "maintain", 65, 24.0)
    # 1.4 already clears 1.2, so the rule changes nothing and is still applied.
    assert at_65.protein_g == pytest.approx(98.0)


def test_the_ceilings_follow_the_budget(case_a):
    limits = health.ceilings(1278.225, "female")
    assert health.round_for_display(limits.fiber_g, "grams") == 18
    assert health.round_for_display(limits.saturated_fat_g_max, "grams") == 14
    assert limits.sodium_mg_max == 2300
    assert limits.cholesterol_mg_max == 300


def test_added_sugars_is_a_figure_by_sex_and_not_a_share():
    # The heart association's two numbers, and the higher of them for somebody
    # who has not said which they are.
    assert health.ceilings(1278.225, "female").sugar_g_max == 25
    assert health.ceilings(1278.225, "male").sugar_g_max == 36
    assert health.ceilings(1278.225, None).sugar_g_max == 36
    # And it does not move when the budget does.
    assert health.ceilings(3000.0, "female").sugar_g_max == 25


def test_the_no_profile_targets_are_the_published_ones():
    assert health.DEFAULTS_2000 == {
        "calories": 2000.0,
        "protein_g": 100.0,
        "carbs_g": 250.0,
        "fat_g": 67.0,
        "fiber_g": 28.0,
        "saturated_fat_g_max": 20.0,
        "sugar_g_max": 36.0,
        "sodium_mg_max": 2300.0,
        "cholesterol_mg_max": 300.0,
    }


def test_exercise_credit_takes_the_resting_share_back_out():
    # Walking 30 minutes at the catalogue's moderate value, at 70 kg.
    assert health.exercise_kcal(3.8, 70, 30) == pytest.approx(102.9)
    # An activity worth one is worth nothing extra, which is the whole point of
    # taking the one off.
    assert health.exercise_kcal(1.0, 70, 30) == 0


def test_the_trend_is_smoothed_and_seeded_by_the_first_reading():
    assert health.trend([80, 81, 79]) == pytest.approx([80, 80.1, 79.99])
    assert health.trend([]) == []


def test_a_day_without_a_weigh_in_carries_the_trend_forward():
    line = health.trend_by_day(
        [(dt.date(2026, 9, 1), 80.0), (dt.date(2026, 9, 4), 81.0)]
    )
    assert [day.day for day, _ in line] == [1, 2, 3, 4]
    assert [round(value, 3) for _, value in line] == [80.0, 80.0, 80.0, 80.1]


def test_the_projection_names_a_day(case_a):
    worked = health.budget(case_a["maintenance"], "lose", 0.45, "female", False)
    expected = TODAY + dt.timedelta(days=round(5 / worked.weekly_rate_kg * 7))
    assert health.projection(70, 65, worked.weekly_rate_kg, TODAY) == expected.isoformat()
    assert expected.isoformat().startswith("2026-11")
    # Nothing to project towards, and nothing moving towards it.
    assert health.projection(70, None, worked.weekly_rate_kg, TODAY) is None
    assert health.projection(70, 65, 0, TODAY) is None
    assert health.projection(70, 70, worked.weekly_rate_kg, TODAY) is None


def test_the_clinician_sentences_appear_only_on_their_own_trigger():
    assert health.nudges(17.0, "lose", None) == ("below_range",)
    # The same numbers with no loss goal say nothing.
    assert health.nudges(17.0, "maintain", None) == ()
    assert health.nudges(24.0, "lose", 17.0) == ("goal_below_range",)
    assert health.nudges(41.0, "lose", None) == ("high_weight",)
    assert health.nudges(None, "lose", None) == ()


def test_a_correction_is_offered_only_from_enough_of_a_record():
    # Four weeks of trend falling half as fast as steady asked for.
    slow = [80.0 - 0.25 / 7 * day for day in range(28)]
    offered = health.reestimate(slow, 24, 0.5, "lose")
    assert offered is not None
    # Just under a kilogram behind over the 27 days the trend spans, priced at
    # 7,700 a kilogram and spread back over those days.
    assert offered == pytest.approx(-0.25 * 27 / 7 * 7700 / 27, rel=1e-6)

    # The same trend with too few logged days, and too short a record.
    assert health.reestimate(slow, 19, 0.5, "lose") is None
    assert health.reestimate(slow[:20], 24, 0.5, "lose") is None
    # And a trend that is doing what was asked of it.
    on_pace = [80.0 - 0.5 / 7 * day for day in range(28)]
    assert health.reestimate(on_pace, 24, 0.5, "lose") is None
    # Maintaining has no pace to differ from.
    assert health.reestimate(slow, 24, 0.0, "maintain") is None


def test_a_correction_never_breaks_the_floor_or_the_cap():
    # A correction that would take a female member under 1,200.
    assert health.clamp_budget(900, 1500, "female", "lose") == 1200
    # And one that would take the deficit past a quarter of the day.
    assert health.clamp_budget(1000, 2000, "male", "lose") == pytest.approx(1500.0)
    assert health.clamp_budget(3000, 2000, "male", "gain") == pytest.approx(2400.0)


def test_display_rounding_is_by_what_the_number_is():
    assert health.round_for_display(1278.225, "calories") == 1280
    assert health.round_for_display(2290.8, "calories") == 2290
    assert health.round_for_display(42.607, "grams") == 43
    assert health.round_for_display(19.4, "percent") == 19
    assert health.round_for_display(70.123, "kg") == 70.12


def test_every_activity_offers_only_the_efforts_it_has_a_value_for():
    assert len(health.ACTIVITIES) == 17
    for activity in health.ACTIVITIES:
        assert 1 <= len(activity.efforts) <= 3
        # In order, and never repeated.
        efforts = [row.effort for row in activity.efforts]
        assert efforts == sorted(efforts, key=["light", "moderate", "vigorous"].index)
        assert len(set(efforts)) == len(efforts)
        for row in activity.efforts:
            assert row.effort in ("light", "moderate", "vigorous")
            assert row.met > 1.0

    # Swimming, the elliptical, rowing, soccer and tennis have fewer than three
    # published rows, and are offered with fewer chips rather than an invented
    # value.
    assert [row.effort for row in health.ACTIVITY_BY_KEY["swimming"].efforts] == [
        "moderate",
        "vigorous",
    ]
    assert health.met_for("walking", "moderate") == 3.8
    assert health.met_for("swimming", "light") is None
    assert health.met_for("quidditch", "light") is None


def test_a_percentage_split_divides_the_day_the_way_it_was_asked_to():
    split = health.macros_from_percentages(2000, 30, 40, 30)
    assert split.protein_g == pytest.approx(150.0)
    assert split.carbs_g == pytest.approx(200.0)
    assert split.fat_g == pytest.approx(66.6667, abs=0.001)
    # The carbs sentence still belongs to a split that leaves too few of them.
    assert health.macros_from_percentages(1200, 40, 20, 40).carbs_low is True


def test_the_starting_points_are_the_guide_s_own_and_stop_at_the_ceiling():
    assert health.MACRO_PRESETS["lose"] == (35, 35, 30)
    assert health.MACRO_PRESETS["maintain"] == (30, 40, 30)
    assert health.MACRO_PRESETS["gain"] == (35, 45, 20)
    for split in health.MACRO_PRESETS.values():
        assert sum(split) == health.PCT_TOTAL
        assert split[0] <= health.PRESET_PROTEIN_MAX_PCT


def test_each_level_says_what_it_adds_to_a_day(case_b):
    options = {row.level: row for row in health.activity_options(case_b["resting"])}
    assert options["not_much"].adds == pytest.approx(1855 * 0.2)
    assert options["light"].adds == pytest.approx(1855 * 0.375)
    assert options["moderate"].adds == pytest.approx(1855 * 0.55)
    assert options["heavy"].adds == pytest.approx(1855 * 0.725)
    assert options["heavy"].total == pytest.approx(1855 * 1.725)


def test_without_a_profile_no_level_carries_a_number():
    for row in health.activity_options(None):
        assert row.adds is None
        assert row.total is None
