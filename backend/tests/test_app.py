import re

import pytest

from backend.app import app


@pytest.fixture()
def client():
    app.config.update(TESTING=True)
    with app.test_client() as test_client:
        yield test_client


def test_root(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.json == {
        "service": "kubernetes-autoscaling-demo",
        "status": "healthy",
    }


def test_health(client):
    assert client.get("/health").json == {"status": "healthy"}


def test_info(client):
    response = client.get("/info")
    assert response.status_code == 200
    assert response.json["service"] == "kubernetes-autoscaling-demo"
    assert re.match(r"^\d+\.\d+\.\d+$", response.json["python_version"])


def test_cpu(client):
    response = client.get("/cpu?duration=0")
    assert response.status_code == 200
    assert response.json["status"] == "completed"
    assert response.json["requested_duration"] == 0
    assert "iterations" in response.json


def test_work(client):
    response = client.get("/work?duration=0")
    assert response.status_code == 200
    assert response.json["status"] == "completed"
    assert response.json["hostname"]
    assert response.json["request_id"]


@pytest.mark.parametrize("query", ["duration=nope", "duration=NaN", "duration=inf"])
def test_invalid_duration(client, query):
    assert client.get(f"/cpu?{query}").status_code == 400


def test_negative_duration(client):
    assert client.get("/cpu?duration=-1").status_code == 400


def test_duration_above_maximum(client, monkeypatch):
    monkeypatch.setenv("MAX_WORK_DURATION", "0.5")
    assert client.get("/cpu?duration=1").status_code == 400