from app import mail
from app.config import VERSION


def test_version_endpoint_answers(client):
    response = client.get("/api/version")
    assert response.status_code == 200
    # Mail off is the shape of a plain household install, which is what the
    # test suite runs as.
    assert response.json() == {"version": VERSION, "mail": False}


def test_the_version_says_whether_this_instance_can_send_mail(client, monkeypatch):
    monkeypatch.setattr(mail, "configured", lambda: True)
    assert client.get("/api/version").json()["mail"] is True


def test_docs_routes_are_not_served(client):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404
