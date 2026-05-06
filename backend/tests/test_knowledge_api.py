"""
Contract tests for the staging FastAPI knowledge routes.
"""

from __future__ import annotations

from typing import Any

import httpx
from fastapi.testclient import TestClient
import pytest

from knowledge import knowledge_store
import main
from main import app


client = TestClient(app)
AUTH_HEADERS = {"X-User-Id": "test-user"}


def setup_function() -> None:
    knowledge_store.clear()


def test_healthcheck() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


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


def test_accepts_bearer_token_as_user_identity() -> None:
    response = client.post(
        "/api/knowledge/bases",
        headers={"Authorization": "Bearer bearer-user"},
        json={"name": "Bearer Auth KB"},
    )

    assert response.status_code == 201
    assert response.json()["userId"] == "bearer-user"


def test_native_auth_proxy_rejects_unapproved_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTH_NATIVE_AUTH_PROXY_ALLOWED_ORIGINS", "https://app.helloautoflow.com")

    response = client.post(
        "/api/auth/native/oauth2/v2.0/initiate",
        headers={"Origin": "https://evil.example.com"},
        json={"client_id": "client-123"},
    )

    assert response.status_code == 403
    assert "Origin is not allowed" in response.json()["detail"]


def test_native_auth_proxy_forwards_json_payload_as_form(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTH_NATIVE_AUTH_PROXY_BASE_URL", "https://ciam.example.com/tenant-guid")
    monkeypatch.setenv("AUTH_NATIVE_AUTH_PROXY_ALLOWED_ORIGINS", "https://app.helloautoflow.com")

    captured: dict[str, Any] = {}

    async def fake_send(
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes | None,
        *,
        verify_ssl: bool = True,
    ) -> httpx.Response:
        captured["method"] = method
        captured["url"] = url
        captured["headers"] = headers
        captured["body"] = body.decode("utf-8") if body else None
        captured["verify_ssl"] = verify_ssl
        return httpx.Response(
            400,
            headers={"content-type": "application/json", "x-ms-request-id": "req-123"},
            content=b'{"error":"invalid_request"}',
            request=httpx.Request(method, url),
        )

    monkeypatch.setattr(main, "send_upstream_request", fake_send)

    response = client.post(
        "/api/auth/native/oauth2/v2.0/initiate?dc=test-dc",
        headers={"Origin": "https://app.helloautoflow.com"},
        json={"client_id": "client-123", "scope": "openid profile"},
    )

    assert response.status_code == 400
    assert response.json()["error"] == "invalid_request"
    assert captured["method"] == "POST"
    assert captured["url"] == "https://ciam.example.com/tenant-guid/oauth2/v2.0/initiate?dc=test-dc"
    assert captured["body"] == "client_id=client-123&scope=openid+profile"
    assert captured["headers"]["content-type"] == "application/x-www-form-urlencoded"
    assert captured["verify_ssl"] is True


def test_public_callback_relay_forwards_redirect_response(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FASTAPI_EDGE_RELAY_BASE_URL", "https://legacy-api.example.com")

    captured: dict[str, Any] = {}

    async def fake_send(
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes | None,
        *,
        verify_ssl: bool = True,
    ) -> httpx.Response:
        captured["method"] = method
        captured["url"] = url
        captured["headers"] = headers
        captured["body"] = body
        captured["verify_ssl"] = verify_ssl
        return httpx.Response(
            302,
            headers={"location": "https://dashboard.example.com/integrations?status=error", "cache-control": "no-store"},
            request=httpx.Request(method, url),
        )

    monkeypatch.setattr(main, "send_upstream_request", fake_send)

    response = client.get("/api/integrations/slack/oauth/callback?error=access_denied", follow_redirects=False)

    assert response.status_code == 302
    assert response.headers["location"] == "https://dashboard.example.com/integrations?status=error"
    assert captured["url"] == "https://legacy-api.example.com/api/integrations/slack/oauth/callback?error=access_denied"
    assert captured["verify_ssl"] is True


def test_webhook_relay_preserves_signature_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FASTAPI_EDGE_RELAY_BASE_URL", "https://legacy-api.example.com")

    captured: dict[str, Any] = {}

    async def fake_send(
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes | None,
        *,
        verify_ssl: bool = True,
    ) -> httpx.Response:
        captured["method"] = method
        captured["url"] = url
        captured["headers"] = headers
        captured["body"] = body.decode("utf-8") if body else None
        captured["verify_ssl"] = verify_ssl
        return httpx.Response(
            400,
            headers={"content-type": "application/json"},
            content=b'{"error":"signature verification failed"}',
            request=httpx.Request(method, url),
        )

    monkeypatch.setattr(main, "send_upstream_request", fake_send)

    response = client.post(
        "/api/webhooks/stripe",
        headers={"Stripe-Signature": "t=12345,v1=abcdef"},
        content='{"id":"evt_123"}',
    )

    assert response.status_code == 400
    assert response.json()["error"] == "signature verification failed"
    assert captured["url"] == "https://legacy-api.example.com/api/webhooks/stripe"
    assert captured["headers"]["stripe-signature"] == "t=12345,v1=abcdef"
    assert captured["body"] == '{"id":"evt_123"}'
    assert captured["verify_ssl"] is True


def test_public_callback_relay_supports_host_header_override_and_insecure_tls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FASTAPI_EDGE_RELAY_BASE_URL", "https://20.75.59.207")
    monkeypatch.setenv("FASTAPI_EDGE_RELAY_HOST_HEADER", "api.helloautoflow.com")
    monkeypatch.setenv("FASTAPI_EDGE_RELAY_INSECURE_TLS", "true")

    captured: dict[str, Any] = {}

    async def fake_send(
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes | None,
        *,
        verify_ssl: bool = True,
    ) -> httpx.Response:
        captured["method"] = method
        captured["url"] = url
        captured["headers"] = headers
        captured["body"] = body
        captured["verify_ssl"] = verify_ssl
        return httpx.Response(
            302,
            headers={"location": "https://dashboard.example.com/integrations?status=error"},
            request=httpx.Request(method, url),
        )

    monkeypatch.setattr(main, "send_upstream_request", fake_send)

    response = client.get("/api/integrations/slack/oauth/callback?error=access_denied", follow_redirects=False)

    assert response.status_code == 302
    assert captured["url"] == "https://20.75.59.207/api/integrations/slack/oauth/callback?error=access_denied"
    assert captured["headers"]["host"] == "api.helloautoflow.com"
    assert captured["verify_ssl"] is False
