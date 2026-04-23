"""
Lightweight in-memory knowledge-base primitives for the staging FastAPI backend.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone
import math
import re
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


TOKEN_RE = re.compile(r"[a-z0-9]+")
SPLIT_RE = re.compile(r"\n\s*\n|(?<=[.!?])\s+")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _tokenize(value: str) -> list[str]:
    return TOKEN_RE.findall(value.lower())


class KnowledgeBase(BaseModel):
    id: str
    user_id: str = Field(alias="userId")
    name: str
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    chunking_config: dict[str, int] = Field(default_factory=dict, alias="chunkingConfig")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class KnowledgeDocument(BaseModel):
    id: str
    knowledge_base_id: str = Field(alias="knowledgeBaseId")
    user_id: str = Field(alias="userId")
    filename: str
    mime_type: str = Field(alias="mimeType")
    source_type: str = Field(alias="sourceType")
    status: str
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    chunk_count: int = Field(alias="chunkCount")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class KnowledgeChunk(BaseModel):
    id: str
    document_id: str = Field(alias="documentId")
    knowledge_base_id: str = Field(alias="knowledgeBaseId")
    user_id: str = Field(alias="userId")
    chunk_index: int = Field(alias="chunkIndex")
    text: str
    token_count: int = Field(alias="tokenCount")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class SearchResult(BaseModel):
    score: float
    chunk: KnowledgeChunk
    document: KnowledgeDocument
    knowledge_base: KnowledgeBase = Field(alias="knowledgeBase")

    model_config = {"populate_by_name": True}


class CreateKnowledgeBaseInput(BaseModel):
    name: str
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    chunking_config: dict[str, int] = Field(default_factory=dict, alias="chunkingConfig")

    model_config = {"populate_by_name": True}


class UpdateKnowledgeBaseInput(BaseModel):
    name: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    metadata: dict[str, Any] | None = None
    chunking_config: dict[str, int] | None = Field(default=None, alias="chunkingConfig")

    model_config = {"populate_by_name": True}


class IngestDocumentInput(BaseModel):
    filename: str = "inline.txt"
    mime_type: str = Field(default="text/plain", alias="mimeType")
    content: str
    source_type: str = Field(default="inline", alias="sourceType")
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class SearchInput(BaseModel):
    query: str
    knowledge_base_ids: list[str] | None = Field(default=None, alias="knowledgeBaseIds")
    limit: int = 10
    min_score: float = Field(default=0.05, alias="minScore")

    model_config = {"populate_by_name": True}


class KnowledgeStore:
    def __init__(self) -> None:
        self.clear()

    def clear(self) -> None:
        self._bases: dict[str, KnowledgeBase] = {}
        self._documents: dict[str, KnowledgeDocument] = {}
        self._chunks: dict[str, KnowledgeChunk] = {}

    def create_base(self, user_id: str, payload: CreateKnowledgeBaseInput) -> KnowledgeBase:
        now = _utc_now()
        base = KnowledgeBase(
            id=str(uuid4()),
            user_id=user_id,
            name=payload.name.strip(),
            description=payload.description,
            tags=[tag.strip() for tag in payload.tags if tag.strip()],
            metadata=payload.metadata,
            chunking_config=payload.chunking_config,
            created_at=now,
            updated_at=now,
        )
        self._bases[base.id] = base
        return base

    def list_bases(self, user_id: str) -> list[KnowledgeBase]:
        return sorted(
            [base for base in self._bases.values() if base.user_id == user_id],
            key=lambda base: base.updated_at,
            reverse=True,
        )

    def get_base(self, base_id: str, user_id: str) -> KnowledgeBase | None:
        base = self._bases.get(base_id)
        if not base or base.user_id != user_id:
            return None
        return base

    def update_base(
        self,
        base_id: str,
        user_id: str,
        payload: UpdateKnowledgeBaseInput,
    ) -> KnowledgeBase | None:
        current = self.get_base(base_id, user_id)
        if current is None:
            return None
        updated = current.model_copy(
            update={
                "name": payload.name.strip() if isinstance(payload.name, str) and payload.name.strip() else current.name,
                "description": payload.description if payload.description is not None else current.description,
                "tags": [tag.strip() for tag in payload.tags if tag.strip()] if payload.tags is not None else current.tags,
                "metadata": payload.metadata if payload.metadata is not None else current.metadata,
                "chunking_config": (
                    payload.chunking_config if payload.chunking_config is not None else current.chunking_config
                ),
                "updated_at": _utc_now(),
            }
        )
        self._bases[base_id] = updated
        return updated

    def ingest_document(
        self,
        base_id: str,
        user_id: str,
        payload: IngestDocumentInput,
    ) -> tuple[KnowledgeDocument, list[KnowledgeChunk]] | None:
        base = self.get_base(base_id, user_id)
        if base is None:
            return None

        chunks_text = _chunk_text(payload.content, base.chunking_config)
        now = _utc_now()
        document = KnowledgeDocument(
            id=str(uuid4()),
            knowledge_base_id=base.id,
            user_id=user_id,
            filename=payload.filename,
            mime_type=payload.mime_type,
            source_type=payload.source_type,
            status="ready",
            tags=[tag.strip() for tag in payload.tags if tag.strip()],
            metadata=payload.metadata,
            chunk_count=len(chunks_text),
            created_at=now,
            updated_at=now,
        )
        self._documents[document.id] = document

        chunks: list[KnowledgeChunk] = []
        for index, text in enumerate(chunks_text):
            chunk = KnowledgeChunk(
                id=str(uuid4()),
                document_id=document.id,
                knowledge_base_id=base.id,
                user_id=user_id,
                chunk_index=index,
                text=text,
                token_count=len(_tokenize(text)),
                created_at=now,
                updated_at=now,
            )
            self._chunks[chunk.id] = chunk
            chunks.append(chunk)
        return document, chunks

    def search(self, user_id: str, payload: SearchInput) -> list[SearchResult]:
        query_tokens = _tokenize(payload.query)
        if not query_tokens:
            return []
        allowed_base_ids = set(payload.knowledge_base_ids or [])
        results: list[SearchResult] = []

        for chunk in self._chunks.values():
            if chunk.user_id != user_id:
                continue
            if allowed_base_ids and chunk.knowledge_base_id not in allowed_base_ids:
                continue
            score = _score_chunk(payload.query, query_tokens, chunk.text)
            if score < payload.min_score:
                continue
            document = self._documents[chunk.document_id]
            base = self._bases[chunk.knowledge_base_id]
            results.append(
                SearchResult(score=round(score, 4), chunk=chunk, document=document, knowledge_base=base)
            )

        results.sort(key=lambda result: (-result.score, result.chunk.chunk_index, result.document.filename))
        return results[: max(payload.limit, 1)]


def _chunk_text(content: str, chunking_config: dict[str, int]) -> list[str]:
    max_characters = chunking_config.get("maxCharacters", 800)
    segments = [segment.strip() for segment in SPLIT_RE.split(content) if segment.strip()]
    if not segments:
        return [content.strip()]

    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for segment in segments:
        if current and current_len + len(segment) + 1 > max_characters:
            chunks.append(" ".join(current).strip())
            current = [segment]
            current_len = len(segment)
            continue
        current.append(segment)
        current_len += len(segment) + 1
    if current:
        chunks.append(" ".join(current).strip())
    return chunks


def _score_chunk(query: str, query_tokens: Iterable[str], text: str) -> float:
    chunk_tokens = _tokenize(text)
    if not chunk_tokens:
        return 0.0
    overlap = len(set(query_tokens) & set(chunk_tokens))
    lexical_score = overlap / max(len(set(query_tokens)), 1)
    phrase_boost = 0.35 if query.lower() in text.lower() else 0.0
    density_boost = overlap / math.sqrt(max(len(chunk_tokens), 1))
    return lexical_score + phrase_boost + density_boost


knowledge_store = KnowledgeStore()
