"""
FastAPI entrypoint for the staging Python backend.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Response, status

from agents import (
    AgentStatus,
    CreateAgentInput,
    CreateRoutineInput,
    RecordHeartbeatInput,
    RecordRunInput,
    RoutineStatus,
    SetBudgetInput,
    UpdateAgentInput,
    UpdateRoutineInput,
    agent_store,
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


def resolve_paperclip_run_id(
    x_paperclip_run_id: Annotated[str | None, Header(alias="X-Paperclip-Run-Id")] = None,
) -> str:
    if x_paperclip_run_id and x_paperclip_run_id.strip():
        return x_paperclip_run_id.strip()
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="X-Paperclip-Run-Id header is required for mutating agent requests",
    )


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/agents", status_code=status.HTTP_201_CREATED)
def create_agent(
    payload: CreateAgentInput,
    user_id: Annotated[str, Depends(resolve_user_id)],
    run_id: Annotated[str, Depends(resolve_paperclip_run_id)],
) -> dict:
    if not payload.name.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="name is required")
    if payload.budget_monthly_usd < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="budgetMonthlyUsd must be non-negative")
    return agent_store.create_agent(user_id, payload).model_dump(by_alias=True)


@app.get("/api/agents")
def list_agents(
    user_id: Annotated[str, Depends(resolve_user_id)],
    status_filter: AgentStatus | None = None,
) -> dict[str, object]:
    agents = [agent.model_dump(by_alias=True) for agent in agent_store.list_agents(user_id, status_filter)]
    return {"agents": agents, "total": len(agents)}


@app.get("/api/agents/{agent_id}")
def get_agent(agent_id: str, user_id: Annotated[str, Depends(resolve_user_id)]) -> dict:
    agent = agent_store.get_agent(agent_id, user_id)
    if agent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent not found: {agent_id}")
    return agent.model_dump(by_alias=True)


@app.patch("/api/agents/{agent_id}")
def update_agent(
    agent_id: str,
    payload: UpdateAgentInput,
    user_id: Annotated[str, Depends(resolve_user_id)],
    run_id: Annotated[str, Depends(resolve_paperclip_run_id)],
) -> dict:
    if payload.name is not None and not payload.name.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="name cannot be blank")
    if payload.budget_monthly_usd is not None and payload.budget_monthly_usd < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="budgetMonthlyUsd must be non-negative")
    agent = agent_store.update_agent(agent_id, user_id, payload)
    if agent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent not found: {agent_id}")
    return agent.model_dump(by_alias=True)


@app.delete("/api/agents/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_agent(
    agent_id: str,
    user_id: Annotated[str, Depends(resolve_user_id)],
    run_id: Annotated[str, Depends(resolve_paperclip_run_id)],
) -> Response:
    if not agent_store.delete_agent(agent_id, user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent not found: {agent_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/api/agents/{agent_id}/heartbeat", status_code=status.HTTP_201_CREATED)
def record_agent_heartbeat(
    agent_id: str,
    payload: RecordHeartbeatInput,
    user_id: Annotated[str, Depends(resolve_user_id)],
    run_id: Annotated[str, Depends(resolve_paperclip_run_id)],
) -> dict:
    if payload.token_usage < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tokenUsage must be non-negative")
    if payload.cost_usd < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="costUsd must be non-negative")
    heartbeat = agent_store.record_heartbeat(agent_id, user_id, payload, run_id)
    if heartbeat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent not found: {agent_id}")
    return heartbeat.model_dump(by_alias=True)


@app.get("/api/agents/{agent_id}/heartbeat")
def get_agent_heartbeat(agent_id: str, user_id: Annotated[str, Depends(resolve_user_id)]) -> dict:
    heartbeat = agent_store.get_latest_heartbeat(agent_id, user_id)
    if heartbeat is None:
        agent = agent_store.get_agent(agent_id, user_id)
        if agent is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent not found: {agent_id}")
        return {"heartbeat": None}
    return heartbeat.model_dump(by_alias=True)


@app.post("/api/agents/{agent_id}/runs", status_code=status.HTTP_201_CREATED)
def record_agent_run(
    agent_id: str,
    payload: RecordRunInput,
    user_id: Annotated[str, Depends(resolve_user_id)],
    run_id: Annotated[str, Depends(resolve_paperclip_run_id)],
) -> dict:
    if payload.token_usage < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tokenUsage must be non-negative")
    if payload.cost_usd < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="costUsd must be non-negative")
    run = agent_store.record_run(agent_id, user_id, payload, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent not found: {agent_id}")
    return run.model_dump(by_alias=True)


@app.get("/api/agents/{agent_id}/runs")
def list_agent_runs(agent_id: str, user_id: Annotated[str, Depends(resolve_user_id)], limit: int = 20) -> dict[str, object]:
    runs = agent_store.list_runs(agent_id, user_id, limit=limit)
    if runs is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent not found: {agent_id}")
    payload = [run.model_dump(by_alias=True) for run in runs]
    return {"runs": payload, "total": len(payload)}


@app.post("/api/agents/{agent_id}/budget")
def set_agent_budget(
    agent_id: str,
    payload: SetBudgetInput,
    user_id: Annotated[str, Depends(resolve_user_id)],
    run_id: Annotated[str, Depends(resolve_paperclip_run_id)],
) -> dict:
    if payload.monthly_usd < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="monthlyUsd must be non-negative")
    budget = agent_store.set_budget(agent_id, user_id, payload, run_id)
    if budget is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent not found: {agent_id}")
    return budget.model_dump(by_alias=True)


@app.get("/api/agents/{agent_id}/budget")
def get_agent_budget(agent_id: str, user_id: Annotated[str, Depends(resolve_user_id)]) -> dict:
    budget = agent_store.get_budget(agent_id, user_id)
    if budget is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent not found: {agent_id}")
    return budget.model_dump(by_alias=True)


@app.get("/api/agents/{agent_id}/token-usage")
def get_agent_token_usage(
    agent_id: str,
    user_id: Annotated[str, Depends(resolve_user_id)],
    days: int = 30,
) -> dict:
    if days <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="days must be positive")
    report = agent_store.get_token_usage(agent_id, user_id, days=days)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent not found: {agent_id}")
    return report.model_dump(by_alias=True)


@app.post("/api/routines", status_code=status.HTTP_201_CREATED)
def create_routine(
    payload: CreateRoutineInput,
    user_id: Annotated[str, Depends(resolve_user_id)],
    run_id: Annotated[str, Depends(resolve_paperclip_run_id)],
) -> dict:
    if not payload.name.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="name is required")
    try:
        routine = agent_store.create_routine(user_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if routine is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent not found for routine: {payload.agent_id}",
        )
    return routine.model_dump(by_alias=True)


@app.get("/api/routines")
def list_routines(
    user_id: Annotated[str, Depends(resolve_user_id)],
    agent_id: str | None = None,
    status_filter: RoutineStatus | None = None,
) -> dict[str, object]:
    routines = [routine.model_dump(by_alias=True) for routine in agent_store.list_routines(user_id, agent_id, status_filter)]
    return {"routines": routines, "total": len(routines)}


@app.patch("/api/routines/{routine_id}")
def update_routine(
    routine_id: str,
    payload: UpdateRoutineInput,
    user_id: Annotated[str, Depends(resolve_user_id)],
    run_id: Annotated[str, Depends(resolve_paperclip_run_id)],
) -> dict:
    if payload.name is not None and not payload.name.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="name cannot be blank")
    try:
        routine = agent_store.update_routine(routine_id, user_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if routine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Routine not found: {routine_id}")
    return routine.model_dump(by_alias=True)


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
