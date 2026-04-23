"""
Contract tests for the staging FastAPI knowledge routes.
"""

from fastapi.testclient import TestClient

from knowledge import knowledge_store
from main import app


client = TestClient(app)
AUTH_HEADERS = {"X-User-Id": "test-user"}


def setup_function() -> None:
    knowledge_store.clear()


def test_create_base_ingest_document_and_search() -> None:
    create_res = client.post(
        "/api/knowledge/bases",
        headers=AUTH_HEADERS,
        json={
            "name": "Support KB",
            "description": "Customer support content",
            "tags": ["support"],
            "chunkingConfig": {"maxCharacters": 120},
        },
    )

    assert create_res.status_code == 201
    base = create_res.json()
    assert base["name"] == "Support KB"
    assert base["tags"] == ["support"]

    ingest_res = client.post(
        f"/api/knowledge/bases/{base['id']}/documents",
        headers=AUTH_HEADERS,
        json={
            "filename": "refunds.txt",
            "mimeType": "text/plain",
            "content": (
                "Customers may request a refund within 30 days. "
                "Billing escalations go to finance. "
                "Refund approvals require the original order number."
            ),
        },
    )

    assert ingest_res.status_code == 201
    ingest_body = ingest_res.json()
    assert ingest_body["document"]["status"] == "ready"
    assert ingest_body["total"] >= 1

    search_res = client.post(
        "/api/knowledge/search",
        headers=AUTH_HEADERS,
        json={"query": "refund policy", "knowledgeBaseIds": [base["id"]]},
    )

    assert search_res.status_code == 200
    body = search_res.json()
    assert body["total"] >= 1
    assert body["results"][0]["document"]["filename"] == "refunds.txt"
    assert body["results"][0]["knowledgeBase"]["id"] == base["id"]


def test_lists_and_updates_bases_for_current_user_only() -> None:
    first = client.post("/api/knowledge/bases", headers=AUTH_HEADERS, json={"name": "Ops KB"})
    other = client.post(
        "/api/knowledge/bases",
        headers={"X-User-Id": "other-user"},
        json={"name": "Other KB"},
    )

    assert first.status_code == 201
    assert other.status_code == 201

    list_res = client.get("/api/knowledge/bases", headers=AUTH_HEADERS)
    assert list_res.status_code == 200
    payload = list_res.json()
    assert payload["total"] == 1
    assert payload["bases"][0]["name"] == "Ops KB"

    update_res = client.patch(
        f"/api/knowledge/bases/{first.json()['id']}",
        headers=AUTH_HEADERS,
        json={"description": "Runbooks and operating notes", "tags": ["ops", "runbook"]},
    )
    assert update_res.status_code == 200
    assert update_res.json()["description"] == "Runbooks and operating notes"
    assert update_res.json()["tags"] == ["ops", "runbook"]


def test_requires_user_identity_header() -> None:
    response = client.post("/api/knowledge/bases", json={"name": "No Auth"})
    assert response.status_code == 401
    assert "header is required" in response.json()["detail"]
