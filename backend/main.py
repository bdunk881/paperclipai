"""
FastAPI entrypoint for the staging Python backend.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, status

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
