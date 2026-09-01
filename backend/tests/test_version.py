from app.config import VERSION


def test_version_endpoint_answers(client):
    response = client.get("/api/version")
    assert response.status_code == 200
    assert response.json() == {"version": VERSION}


def test_docs_routes_are_not_served(client):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404
