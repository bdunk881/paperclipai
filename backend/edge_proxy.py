from __future__ import annotations

import os

import httpx
from fastapi import Request

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


def resolve_relay_base_url() -> str | None:
    return normalize_https_url(os.getenv(RELAY_BASE_URL_ENV))


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
