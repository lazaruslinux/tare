"""Sending feedback, and the one screen that reads it back."""

import re

from app.routers.feedback import BAD_AREA, BAD_KIND, LONG_TEXT, NO_TEXT

HEADER = re.compile(
    r"^## \d{4}-\d{2}-\d{2} \d{2}:\d{2} \w+ \(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\) \| "
    r"member \| Food \| Bug$"
)


def send(client, **changes):
    body = {"area": "food", "kind": "bug", "text": "The scanner stalled."}
    body.update(changes)
    return client.post("/api/feedback", json=body)


def test_two_reports_are_two_blocks_in_the_order_they_were_sent(
    client, signed_in, feedback_path
):
    assert send(client).status_code == 201
    assert send(client, text="The second one.").status_code == 201

    blocks = feedback_path.read_text(encoding="utf-8").split("\n\n")
    assert blocks[-1] == ""
    first, second = blocks[0].splitlines(), blocks[1].splitlines()
    assert HEADER.match(first[0])
    assert first[1] == "The scanner stalled."
    assert len(first) == 2
    assert second[1] == "The second one."
    assert len(second) == 2


def test_a_blank_report_is_refused(client, signed_in):
    response = send(client, text="   ")
    assert response.status_code == 400
    assert response.json() == {"detail": NO_TEXT}


def test_a_report_longer_than_the_cap_is_refused(client, signed_in):
    response = send(client, text="x" * 2001)
    assert response.status_code == 400
    assert response.json() == {"detail": LONG_TEXT}


def test_an_area_tare_does_not_have_is_refused(client, signed_in):
    response = send(client, area="kitchen")
    assert response.status_code == 400
    assert response.json() == {"detail": BAD_AREA}


def test_a_kind_tare_does_not_have_is_refused(client, signed_in):
    response = send(client, kind="rant")
    assert response.status_code == 400
    assert response.json() == {"detail": BAD_KIND}


def test_a_member_cannot_read_the_log(client, signed_in):
    assert client.get("/api/feedback").status_code == 403


def test_an_administrator_reads_what_was_sent(admin_client):
    assert send(admin_client).status_code == 201
    assert "The scanner stalled." in admin_client.get("/api/feedback").json()["text"]


def test_a_log_nobody_has_written_to_reads_as_empty(admin_client):
    assert admin_client.get("/api/feedback").json() == {"text": ""}


def test_the_twenty_first_report_in_an_hour_is_refused(client, signed_in):
    for _ in range(20):
        assert send(client).status_code == 201
    assert send(client).status_code == 429
