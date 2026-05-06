from __future__ import annotations

import json
import os
from typing import Iterable
from urllib.parse import urlencode
from uuid import uuid4

import httpx
from fastapi import HTTPException, Request, status


ALLOWED_NATIVE_AUTH_PATHS = {
    "oauth2/v2.0/token",
    "oauth2/v2.0/initiate",
    "oauth2/v2.0/challenge",
    "oauth2/v2.0/introspect",
    "signup/v1.0/start",
    "signup/v1.0/challenge",
    "signup/v1.0/continue",
    "signin/v1.0/start",
    "signin/v1.0/challenge",
    "signin/v1.0/continue",
    "resetpassword/v1.0/challenge",
    "resetpassword/v1.0/start",
    "resetpassword/v1.0/continue",
    "resetpassword/v1.0/poll_completion",
    "resetpassword/v1.0/submit",
}

FORWARDED_NATIVE_AUTH_REQUEST_HEADERS = {
    "accept",
    "content-type",
    "x-correlation-id",
    "x-ms-correlation-id",
    "x-ms-request-id",
    "traceparent",
    "tracestate",
}

FORWARDED_RESPONSE_HEADERS = {
    "cache-control",
    "content-type",
    "location",
    "retry-after",
    "www-authenticate",
}

EXCLUDED_RELAY_REQUEST_HEADERS = {
    "content-length",
    "host",
}

DEFAULT_CIAM_TENANT_SUBDOMAIN = "autoflowciam"
DEFAULT_CIAM_TENANT_ID = "5e4f1080-8afc-4005-b05e-32b21e69363a"
RELAY_BASE_URL_ENV = "FASTAPI_EDGE_RELAY_BASE_URL"
RELAY_HOST_HEADER_ENV = "FASTAPI_EDGE_RELAY_HOST_HEADER"
RELAY_INSECURE_TLS_ENV = "FASTAPI_EDGE_RELAY_INSECURE_TLS"


def normalize_https_url(value: str | None) -> str | None:
    if not value:
        return None

    candidate = value.strip()
    if not candidate:
        return None

    parsed = httpx.URL(candidate)
    if parsed.scheme != "https":
        return None
    if parsed.userinfo:
        return None

    normalized = str(parsed).rstrip("/")
    return normalized or None


def parse_origin_allowlist(value: str | None) -> set[str]:
    if not value:
        return set()

    return {
        origin.strip()
        for origin in value.split(",")
        if origin.strip() and origin.strip() != "*"
    }


def resolve_fallback_ciam_authority() -> str | None:
    tenant_subdomain = (
        os.getenv("AZURE_CIAM_TENANT_SUBDOMAIN")
        or os.getenv("AZURE_TENANT_SUBDOMAIN")
        or DEFAULT_CIAM_TENANT_SUBDOMAIN
    ).strip()
    tenant_id = (
        os.getenv("AZURE_CIAM_TENANT_ID")
        or os.getenv("AZURE_TENANT_ID")
        or DEFAULT_CIAM_TENANT_ID
    ).strip()
    if not tenant_subdomain or not tenant_id:
        return None

    return f"https://{tenant_subdomain}.ciamlogin.com/{tenant_id}"


def resolve_native_auth_proxy_base_urls() -> list[str]:
    values = [
        normalize_https_url(os.getenv("AUTH_NATIVE_AUTH_PROXY_BASE_URL")),
        normalize_https_url(os.getenv("AZURE_CIAM_AUTHORITY")),
        resolve_fallback_ciam_authority(),
    ]
    deduped: list[str] = []
    for value in values:
        if value and value not in deduped:
            deduped.append(value)
    return deduped


def resolve_relay_base_url() -> str | None:
    return normalize_https_url(os.getenv(RELAY_BASE_URL_ENV))


def allowed_origins() -> set[str]:
    return {
        *parse_origin_allowlist(os.getenv("ALLOWED_ORIGINS")),
        *parse_origin_allowlist(os.getenv("AUTH_NATIVE_AUTH_PROXY_ALLOWED_ORIGINS")),
        *parse_origin_allowlist(os.getenv("AUTH_SOCIAL_ALLOWED_REDIRECT_ORIGINS")),
        *parse_origin_allowlist(os.getenv("SOCIAL_AUTH_DASHBOARD_URL")),
    }


def is_allowed_origin(origin: str | None) -> bool:
    if origin is None:
        return True

    normalized = origin.strip()
    if not normalized:
        return True

    return normalized in allowed_origins()


def correlation_id(request: Request) -> str:
    for header_name in ("x-correlation-id", "x-ms-correlation-id"):
        header_value = request.headers.get(header_name)
        if header_value and header_value.strip():
            return header_value.strip()
    return str(uuid4())


def resolve_relay_host_header() -> str | None:
    value = os.getenv(RELAY_HOST_HEADER_ENV)
    if not value:
        return None
    normalized = value.strip()
    return normalized or None


def resolve_relay_insecure_tls() -> bool:
    value = os.getenv(RELAY_INSECURE_TLS_ENV)
    if not value:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def copy_response_headers(headers: httpx.Headers) -> dict[str, str]:
    copied: dict[str, str] = {}
    for header_name in FORWARDED_RESPONSE_HEADERS:
        header_value = headers.get(header_name)
        if header_value and header_value.strip():
            copied[header_name] = header_value.strip()
    return copied


def native_auth_request_headers(request: Request, correlation: str) -> dict[str, str]:
    headers = {
        name: value
        for name, value in request.headers.items()
        if name.lower() in FORWARDED_NATIVE_AUTH_REQUEST_HEADERS and value.strip()
    }
    headers["x-correlation-id"] = correlation
    headers["content-type"] = "application/x-www-form-urlencoded"
    return headers


def relay_request_headers(request: Request) -> dict[str, str]:
    headers = {
        name: value
        for name, value in request.headers.items()
        if name.lower() not in EXCLUDED_RELAY_REQUEST_HEADERS
    }
    relay_host_header = resolve_relay_host_header()
    if relay_host_header:
        headers["host"] = relay_host_header
    return headers


def serialize_form_body(data: dict[str, object]) -> str:
    pairs: list[tuple[str, str]] = []
    for key, raw_value in data.items():
        if raw_value is None:
            continue
        values: Iterable[object] = raw_value if isinstance(raw_value, list) else [raw_value]
        for value in values:
            if value is None:
                continue
            pairs.append((key, str(value)))
    return urlencode(pairs)


async def native_auth_body(request: Request) -> bytes | None:
    raw_body = await request.body()
    if not raw_body:
        return None

    content_type = request.headers.get("content-type", "").lower()
    if "application/x-www-form-urlencoded" in content_type:
        return raw_body

    if "application/json" in content_type:
        try:
            parsed = json.loads(raw_body)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Native auth proxy received invalid JSON payload.",
            ) from exc
        if not isinstance(parsed, dict):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Native auth proxy expects a JSON object payload.",
            )
        return serialize_form_body(parsed).encode("utf-8")

    raise HTTPException(
        status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        detail="Native auth proxy only supports application/json and application/x-www-form-urlencoded payloads.",
    )


async def send_upstream_request(
    method: str,
    url: str,
    headers: dict[str, str],
    body: bytes | None,
    *,
    verify_ssl: bool = True,
) -> httpx.Response:
    async with httpx.AsyncClient(follow_redirects=False, timeout=20.0, verify=verify_ssl) as client:
        return await client.request(method, url, headers=headers, content=body)
