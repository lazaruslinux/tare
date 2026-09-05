from app.foods_api import clean_ingredients


def test_ingredient_list_stops_where_the_package_goes_on() -> None:
    text = (
        "whole wheat flour, water, salt. contains wheat, soy. made in a bakery that "
        "may also use milk. distributed by somebody, inc. www.example.com all rights "
        "reserved. sara lee is a registered trademark"
    )
    assert clean_ingredients(text) == "whole wheat flour, water, salt. contains wheat, soy"


def test_ingredients_word_and_whitespace_go() -> None:
    assert clean_ingredients("INGREDIENTS: Milk,\n  Cream. ") == "Milk, Cream"


def test_clean_list_is_untouched() -> None:
    assert clean_ingredients("organic peanut flour, salt") == "organic peanut flour, salt"


def test_very_long_list_is_capped_at_a_comma() -> None:
    text = ", ".join(f"item{n}" for n in range(200))
    out = clean_ingredients(text)
    assert len(out) <= 600 and not out.endswith(",") and out.startswith("item0, item1")
