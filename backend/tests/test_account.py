import datetime as dt


def patch(client, **fields):
    return client.patch("/api/account", json=fields)


def test_the_display_name_is_trimmed(client, db_session, signed_in):
    response = patch(client, display_name="  Casey  ")
    assert response.status_code == 200
    assert response.json()["display_name"] == "Casey"
    db_session.refresh(signed_in)
    assert signed_in.display_name == "Casey"


def test_a_blank_display_name_clears_it(client, db_session, signed_in):
    patch(client, display_name="Casey")
    assert patch(client, display_name="   ").json()["display_name"] is None
    assert patch(client, display_name=None).json()["display_name"] is None
    db_session.refresh(signed_in)
    assert signed_in.display_name is None


def test_a_display_name_has_a_ceiling(client, signed_in):
    response = patch(client, display_name="x" * 61)
    assert response.status_code == 400
    assert response.json()["detail"] == "Display name must be at most 60 characters."


def test_units_can_be_switched(client, db_session, signed_in):
    assert patch(client, units="metric").json()["units"] == "metric"
    db_session.refresh(signed_in)
    assert signed_in.units == "metric"


def test_units_outside_the_two_are_refused(client, signed_in):
    response = patch(client, units="stones")
    assert response.status_code == 400
    assert response.json() == {"detail": "Units must be either imperial or metric."}


def test_the_timezone_can_be_moved(client, db_session, signed_in):
    assert patch(client, timezone="America/Phoenix").json()["timezone"] == "America/Phoenix"
    db_session.refresh(signed_in)
    assert signed_in.timezone == "America/Phoenix"


def test_an_unknown_timezone_is_refused_here(client, signed_in):
    response = patch(client, timezone="Mars/Olympus")
    assert response.status_code == 400
    assert response.json() == {"detail": "That is not a known time zone."}


def test_the_birthdate_is_stored_and_can_be_cleared(client, db_session, signed_in):
    assert patch(client, birthdate="1990-04-02").status_code == 200
    db_session.refresh(signed_in)
    assert signed_in.birthdate == dt.date(1990, 4, 2)

    assert patch(client, birthdate=None).status_code == 200
    db_session.refresh(signed_in)
    assert signed_in.birthdate is None


def test_a_field_left_out_is_left_alone(client, db_session, signed_in):
    patch(client, display_name="Casey", units="metric")
    patch(client, timezone="America/Phoenix")
    db_session.refresh(signed_in)
    assert (signed_in.display_name, signed_in.units) == ("Casey", "metric")


def test_settings_need_a_session(client):
    assert patch(client, units="metric").status_code == 401
