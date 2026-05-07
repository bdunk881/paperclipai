"""
FastAPI entrypoint for the staging Python backend.
"""

from __future__ import annotations

from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse

from edge_proxy import (
    ALLOWED_NATIVE_AUTH_PATHS,
    copy_response_headers,
    correlation_id,
    cors_headers,
    is_allowed_origin,
    native_auth_body,
    native_auth_request_headers,
    relay_request_headers,
    resolve_native_auth_proxy_base_urls,
    resolve_relay_base_url,
    resolve_relay_insecure_tls,
    send_upstream_request,
)
from knowledge import (
    CreateKnowledgeBaseInput,
    IngestDocumentInput,
    SearchInput,
    UpdateKnowledgeBaseInput,
    knowledge_store,
)


app = FastAPI(
    title="AutoFlow Runtime API",
    version="1.0.0",
    description="Staging FastAPI backend for AutoFlow runtime compatibility.",
)


def resolve_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> str:
    if x_user_id and x_user_id.strip():
        return x_user_id.strip()
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
        if token:
            return token
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="X-User-Id or Authorization header is required",
    )


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


def native_auth_error_response(
    status_code: int,
    detail: str,
    origin: str | None,
    requested_headers: str | None = None,
) -> JSONResponse:
    headers = cors_headers(origin, requested_headers) if origin and is_allowed_origin(origin) else None
    return JSONResponse(status_code=status_code, content={"detail": detail}, headers=headers)


@app.api_route("/api/auth/native/{proxy_path:path}", methods=["POST", "OPTIONS"])
async def native_auth_proxy(proxy_path: str, request: Request) -> Response:
    origin = request.headers.get("origin")
    requested_headers = request.headers.get("access-control-request-headers")

    if proxy_path not in ALLOWED_NATIVE_AUTH_PATHS:
        return native_auth_error_response(
            status.HTTP_404_NOT_FOUND,
            "Native auth proxy path is not allowed",
            origin,
            requested_headers,
        )

    if not is_allowed_origin(origin):
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"detail": "Origin is not allowed for native auth proxy requests."},
        )

    if request.method == "OPTIONS":
        if request.headers.get("access-control-request-method", "").upper() != "POST":
            return native_auth_error_response(
                status.HTTP_405_METHOD_NOT_ALLOWED,
                "Native auth preflight only supports POST requests.",
                origin,
                requested_headers,
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT, headers=cors_headers(origin or "", requested_headers))

    upstream_base_urls = resolve_native_auth_proxy_base_urls()
    if not upstream_base_urls:
        return native_auth_error_response(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Native auth proxy is not configured.",
            origin,
            requested_headers,
        )

    try:
        body = await native_auth_body(request)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else "Native auth proxy request is invalid."
        return native_auth_error_response(exc.status_code, detail, origin, requested_headers)

    correlation = correlation_id(request)
    headers = native_auth_request_headers(request, correlation)
    query = f"?{request.url.query}" if request.url.query else ""

    last_error: httpx.HTTPError | None = None
    for base_url in upstream_base_urls:
        target_url = f"{base_url}/{proxy_path}{query}"
        try:
            upstream_response = await send_upstream_request("POST", target_url, headers, body)
        except httpx.HTTPError as exc:
            last_error = exc
            continue

        response_headers = copy_response_headers(upstream_response.headers)
        if origin:
            response_headers.update(cors_headers(origin, requested_headers))
        return Response(
            content=upstream_response.content,
            status_code=upstream_response.status_code,
            headers=response_headers,
        )

    detail = "Native auth upstream request failed."
    if last_error is not None:
        detail = f"{detail} {last_error}"
    return native_auth_error_response(status.HTTP_502_BAD_GATEWAY, detail, origin, requested_headers)


async def relay_public_edge_request(request: Request) -> Response:
    relay_base_url = resolve_relay_base_url()
    if not relay_base_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Public edge relay is not configured.",
        )

    query = f"?{request.url.query}" if request.url.query else ""
    target_url = f"{relay_base_url}{request.url.path}{query}"
    try:
        upstream_response = await send_upstream_request(
            request.method,
            target_url,
            relay_request_headers(request),
            await request.body(),
            verify_ssl=not resolve_relay_insecure_tls(),
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Public edge relay request failed: {exc}",
        ) from exc

    return Response(
        content=upstream_response.content,
        status_code=upstream_response.status_code,
        headers=copy_response_headers(upstream_response.headers),
    )


@app.api_route("/api/auth/social/{provider}/callback", methods=["GET", "POST"])
async def social_auth_callback_relay(provider: str, request: Request) -> Response:
    return await relay_public_edge_request(request)


@app.get("/api/integrations/callback")
async def unified_oauth_callback_relay(request: Request) -> Response:
    return await relay_public_edge_request(request)


@app.get("/api/integrations/oauth2/{slug}/callback")
async def oauth2_callback_relay(slug: str, request: Request) -> Response:
    return await relay_public_edge_request(request)


@app.get("/api/integrations/{provider}/oauth/callback")
async def integration_oauth_callback_relay(provider: str, request: Request) -> Response:
    return await relay_public_edge_request(request)


@app.api_route("/api/webhooks/{webhook_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def webhook_relay(webhook_path: str, request: Request) -> Response:
    return await relay_public_edge_request(request)


@app.post("/api/knowledge/bases", status_code=status.HTTP_201_CREATED)
def create_knowledge_base(
    payload: CreateKnowledgeBaseInput,
    user_id: Annotated[str, Depends(resolve_user_id)],
) -> dict:
    if not payload.name.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="name is required")
    return knowledge_store.create_base(user_id, payload).model_dump(by_alias=True)


@app.get("/api/knowledge/bases")
def list_knowledge_bases(user_id: Annotated[str, Depends(resolve_user_id)]) -> dict[str, object]:
    bases = [base.model_dump(by_alias=True) for base in knowledge_store.list_bases(user_id)]
    return {"bases": bases, "total": len(bases)}


@app.get("/api/knowledge/bases/{base_id}")
def get_knowledge_base(base_id: str, user_id: Annotated[str, Depends(resolve_user_id)]) -> dict:
    base = knowledge_store.get_base(base_id, user_id)
    if base is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Knowledge base not found: {base_id}")
    return base.model_dump(by_alias=True)


@app.patch("/api/knowledge/bases/{base_id}")
def update_knowledge_base(
    base_id: str,
    payload: UpdateKnowledgeBaseInput,
    user_id: Annotated[str, Depends(resolve_user_id)],
) -> dict:
    base = knowledge_store.update_base(base_id, user_id, payload)
    if base is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Knowledge base not found: {base_id}")
    return base.model_dump(by_alias=True)


@app.post("/api/knowledge/bases/{base_id}/documents", status_code=status.HTTP_201_CREATED)
def ingest_document(
    base_id: str,
    payload: IngestDocumentInput,
    user_id: Annotated[str, Depends(resolve_user_id)],
) -> dict[str, object]:
    if not payload.content.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="content is required")
    result = knowledge_store.ingest_document(base_id, user_id, payload)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Knowledge base not found: {base_id}")
    document, chunks = result
    return {
        "document": document.model_dump(by_alias=True),
        "chunks": [chunk.model_dump(by_alias=True) for chunk in chunks],
        "total": len(chunks),
    }


@app.post("/api/knowledge/search")
def search_knowledge(
    payload: SearchInput,
    user_id: Annotated[str, Depends(resolve_user_id)],
) -> dict[str, object]:
    if not payload.query.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="query is required")
    results = [result.model_dump(by_alias=True) for result in knowledge_store.search(user_id, payload)]
    return {"results": results, "total": len(results)}
