"""
Persistent agent-management primitives for the staging FastAPI backend.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime, timezone
import os
from typing import Any, Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, Field
from sqlalchemy import JSON, DateTime, Float, Integer, String, Text, create_engine, delete, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool


AgentStatus = Literal["running", "paused", "idle", "error"]
RunStatus = Literal["queued", "running", "completed", "failed", "blocked"]
RoutineStatus = Literal["active", "paused"]
RoutineScheduleType = Literal["manual", "interval", "cron"]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _isoformat(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _month_key(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m")


def _resolve_database_url() -> str:
    return os.getenv("AUTOFLOW_BACKEND_DATABASE_URL") or "sqlite+pysqlite:///./autoflow_backend.sqlite3"


def _build_engine(url: str):
    kwargs: dict[str, Any] = {"future": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
        if ":memory:" in url:
            kwargs["poolclass"] = StaticPool
    return create_engine(url, **kwargs)


class Base(DeclarativeBase):
    pass


class AgentRow(Base):
    __tablename__ = "autoflow_agents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(255), index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text(), nullable=True)
    role_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    model: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    instructions: Mapped[str] = mapped_column(Text(), default="")
    status: Mapped[str] = mapped_column(String(32), default="idle", index=True)
    budget_monthly_usd: Mapped[float] = mapped_column(Float(), default=0)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON(), default=dict)
    last_heartbeat_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)


class AgentHeartbeatRow(Base):
    __tablename__ = "autoflow_agent_heartbeats"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    agent_id: Mapped[str] = mapped_column(String(36), index=True)
    user_id: Mapped[str] = mapped_column(String(255), index=True)
    status: Mapped[str] = mapped_column(String(32))
    summary: Mapped[Optional[str]] = mapped_column(Text(), nullable=True)
    token_usage: Mapped[int] = mapped_column(Integer(), default=0)
    cost_usd: Mapped[float] = mapped_column(Float(), default=0)
    run_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_by_run_id: Mapped[str] = mapped_column(String(255))
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)


class AgentRunRow(Base):
    __tablename__ = "autoflow_agent_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    agent_id: Mapped[str] = mapped_column(String(36), index=True)
    user_id: Mapped[str] = mapped_column(String(255), index=True)
    external_run_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    summary: Mapped[Optional[str]] = mapped_column(Text(), nullable=True)
    token_usage: Mapped[int] = mapped_column(Integer(), default=0)
    cost_usd: Mapped[float] = mapped_column(Float(), default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_run_id: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)


class AgentBudgetRow(Base):
    __tablename__ = "autoflow_agent_budgets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    agent_id: Mapped[str] = mapped_column(String(36), index=True)
    user_id: Mapped[str] = mapped_column(String(255), index=True)
    monthly_usd: Mapped[float] = mapped_column(Float())
    note: Mapped[Optional[str]] = mapped_column(Text(), nullable=True)
    created_by_run_id: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)


class RoutineRow(Base):
    __tablename__ = "autoflow_routines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(255), index=True)
    agent_id: Mapped[str] = mapped_column(String(36), index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text(), nullable=True)
    schedule_type: Mapped[str] = mapped_column(String(32))
    cron_expression: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    interval_minutes: Mapped[Optional[int]] = mapped_column(Integer(), nullable=True)
    prompt: Mapped[Optional[str]] = mapped_column(Text(), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON(), default=dict)
    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    next_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now)


class Agent(BaseModel):
    id: str
    user_id: str = Field(alias="userId")
    name: str
    description: str | None = None
    role_key: str | None = Field(default=None, alias="roleKey")
    model: str | None = None
    instructions: str
    status: AgentStatus
    budget_monthly_usd: float = Field(alias="budgetMonthlyUsd")
    metadata: dict[str, Any] = Field(default_factory=dict)
    last_heartbeat_at: str | None = Field(default=None, alias="lastHeartbeatAt")
    last_run_at: str | None = Field(default=None, alias="lastRunAt")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class AgentHeartbeat(BaseModel):
    id: str
    agent_id: str = Field(alias="agentId")
    user_id: str = Field(alias="userId")
    status: AgentStatus
    summary: str | None = None
    token_usage: int = Field(alias="tokenUsage")
    cost_usd: float = Field(alias="costUsd")
    run_id: str | None = Field(default=None, alias="runId")
    created_by_run_id: str = Field(alias="createdByRunId")
    recorded_at: str = Field(alias="recordedAt")

    model_config = {"populate_by_name": True}


class AgentRun(BaseModel):
    id: str
    agent_id: str = Field(alias="agentId")
    user_id: str = Field(alias="userId")
    run_id: str | None = Field(default=None, alias="runId")
    status: RunStatus
    summary: str | None = None
    token_usage: int = Field(alias="tokenUsage")
    cost_usd: float = Field(alias="costUsd")
    started_at: str = Field(alias="startedAt")
    completed_at: str | None = Field(default=None, alias="completedAt")
    created_by_run_id: str = Field(alias="createdByRunId")
    created_at: str = Field(alias="createdAt")

    model_config = {"populate_by_name": True}


class AgentBudgetSnapshot(BaseModel):
    agent_id: str = Field(alias="agentId")
    user_id: str = Field(alias="userId")
    monthly_usd: float = Field(alias="monthlyUsd")
    spent_usd: float = Field(alias="spentUsd")
    remaining_usd: float = Field(alias="remainingUsd")
    current_period: str = Field(alias="currentPeriod")
    auto_paused: bool = Field(alias="autoPaused")
    last_updated_at: str | None = Field(default=None, alias="lastUpdatedAt")

    model_config = {"populate_by_name": True}


class TokenUsageBucket(BaseModel):
    date: str
    tokens: int
    cost_usd: float = Field(alias="costUsd")

    model_config = {"populate_by_name": True}


class TokenUsageReport(BaseModel):
    agent_id: str = Field(alias="agentId")
    user_id: str = Field(alias="userId")
    days: int
    total_tokens: int = Field(alias="totalTokens")
    total_cost_usd: float = Field(alias="totalCostUsd")
    daily: list[TokenUsageBucket]

    model_config = {"populate_by_name": True}


class Routine(BaseModel):
    id: str
    user_id: str = Field(alias="userId")
    agent_id: str = Field(alias="agentId")
    name: str
    description: str | None = None
    schedule_type: RoutineScheduleType = Field(alias="scheduleType")
    cron_expression: str | None = Field(default=None, alias="cronExpression")
    interval_minutes: int | None = Field(default=None, alias="intervalMinutes")
    prompt: str | None = None
    status: RoutineStatus
    metadata: dict[str, Any] = Field(default_factory=dict)
    last_run_at: str | None = Field(default=None, alias="lastRunAt")
    next_run_at: str | None = Field(default=None, alias="nextRunAt")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class CreateAgentInput(BaseModel):
    name: str
    description: str | None = None
    role_key: str | None = Field(default=None, alias="roleKey")
    model: str | None = None
    instructions: str = ""
    status: AgentStatus = "idle"
    budget_monthly_usd: float = Field(default=0, alias="budgetMonthlyUsd")
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class UpdateAgentInput(BaseModel):
    name: str | None = None
    description: str | None = None
    role_key: str | None = Field(default=None, alias="roleKey")
    model: str | None = None
    instructions: str | None = None
    status: AgentStatus | None = None
    budget_monthly_usd: float | None = Field(default=None, alias="budgetMonthlyUsd")
    metadata: dict[str, Any] | None = None

    model_config = {"populate_by_name": True}


class RecordHeartbeatInput(BaseModel):
    status: AgentStatus
    summary: str | None = None
    token_usage: int = Field(default=0, alias="tokenUsage")
    cost_usd: float = Field(default=0, alias="costUsd")
    run_id: str | None = Field(default=None, alias="runId")
    recorded_at: str | None = Field(default=None, alias="recordedAt")

    model_config = {"populate_by_name": True}


class RecordRunInput(BaseModel):
    status: RunStatus
    summary: str | None = None
    token_usage: int = Field(default=0, alias="tokenUsage")
    cost_usd: float = Field(default=0, alias="costUsd")
    run_id: str | None = Field(default=None, alias="runId")
    started_at: str | None = Field(default=None, alias="startedAt")
    completed_at: str | None = Field(default=None, alias="completedAt")

    model_config = {"populate_by_name": True}


class SetBudgetInput(BaseModel):
    monthly_usd: float = Field(alias="monthlyUsd")
    note: str | None = None

    model_config = {"populate_by_name": True}


class CreateRoutineInput(BaseModel):
    agent_id: str = Field(alias="agentId")
    name: str
    description: str | None = None
    schedule_type: RoutineScheduleType = Field(alias="scheduleType")
    cron_expression: str | None = Field(default=None, alias="cronExpression")
    interval_minutes: int | None = Field(default=None, alias="intervalMinutes")
    prompt: str | None = None
    status: RoutineStatus = "active"
    metadata: dict[str, Any] = Field(default_factory=dict)
    next_run_at: str | None = Field(default=None, alias="nextRunAt")

    model_config = {"populate_by_name": True}


class UpdateRoutineInput(BaseModel):
    name: str | None = None
    description: str | None = None
    schedule_type: RoutineScheduleType | None = Field(default=None, alias="scheduleType")
    cron_expression: str | None = Field(default=None, alias="cronExpression")
    interval_minutes: int | None = Field(default=None, alias="intervalMinutes")
    prompt: str | None = None
    status: RoutineStatus | None = None
    metadata: dict[str, Any] | None = None
    last_run_at: str | None = Field(default=None, alias="lastRunAt")
    next_run_at: str | None = Field(default=None, alias="nextRunAt")

    model_config = {"populate_by_name": True}


def _parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _require_schedule_fields(
    schedule_type: RoutineScheduleType,
    cron_expression: str | None,
    interval_minutes: int | None,
) -> None:
    if schedule_type == "cron" and not (cron_expression and cron_expression.strip()):
        raise ValueError("cronExpression is required when scheduleType is cron")
    if schedule_type == "interval" and (interval_minutes is None or interval_minutes <= 0):
        raise ValueError("intervalMinutes must be a positive integer when scheduleType is interval")


class AgentStore:
    def __init__(self) -> None:
        self.engine = _build_engine(_resolve_database_url())
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, expire_on_commit=False, future=True)
        Base.metadata.create_all(self.engine)

    def _session(self) -> Session:
        return self.SessionLocal()

    def clear(self) -> None:
        with self._session() as session:
            for model in (RoutineRow, AgentBudgetRow, AgentRunRow, AgentHeartbeatRow, AgentRow):
                session.execute(delete(model))
            session.commit()

    def _get_agent_row(self, session: Session, agent_id: str, user_id: str) -> AgentRow | None:
        return session.scalar(select(AgentRow).where(AgentRow.id == agent_id, AgentRow.user_id == user_id))

    def _agent_to_model(self, row: AgentRow) -> Agent:
        return Agent(
            id=row.id,
            userId=row.user_id,
            name=row.name,
            description=row.description,
            roleKey=row.role_key,
            model=row.model,
            instructions=row.instructions,
            status=row.status,
            budgetMonthlyUsd=round(row.budget_monthly_usd, 2),
            metadata=row.metadata_json or {},
            lastHeartbeatAt=_isoformat(row.last_heartbeat_at),
            lastRunAt=_isoformat(row.last_run_at),
            createdAt=_isoformat(row.created_at),
            updatedAt=_isoformat(row.updated_at),
        )

    def _heartbeat_to_model(self, row: AgentHeartbeatRow) -> AgentHeartbeat:
        return AgentHeartbeat(
            id=row.id,
            agentId=row.agent_id,
            userId=row.user_id,
            status=row.status,
            summary=row.summary,
            tokenUsage=row.token_usage,
            costUsd=round(row.cost_usd, 4),
            runId=row.run_id,
            createdByRunId=row.created_by_run_id,
            recordedAt=_isoformat(row.recorded_at),
        )

    def _run_to_model(self, row: AgentRunRow) -> AgentRun:
        return AgentRun(
            id=row.id,
            agentId=row.agent_id,
            userId=row.user_id,
            runId=row.external_run_id,
            status=row.status,
            summary=row.summary,
            tokenUsage=row.token_usage,
            costUsd=round(row.cost_usd, 4),
            startedAt=_isoformat(row.started_at),
            completedAt=_isoformat(row.completed_at),
            createdByRunId=row.created_by_run_id,
            createdAt=_isoformat(row.created_at),
        )

    def _routine_to_model(self, row: RoutineRow) -> Routine:
        return Routine(
            id=row.id,
            userId=row.user_id,
            agentId=row.agent_id,
            name=row.name,
            description=row.description,
            scheduleType=row.schedule_type,
            cronExpression=row.cron_expression,
            intervalMinutes=row.interval_minutes,
            prompt=row.prompt,
            status=row.status,
            metadata=row.metadata_json or {},
            lastRunAt=_isoformat(row.last_run_at),
            nextRunAt=_isoformat(row.next_run_at),
            createdAt=_isoformat(row.created_at),
            updatedAt=_isoformat(row.updated_at),
        )

    def create_agent(self, user_id: str, payload: CreateAgentInput) -> Agent:
        now = _utc_now()
        row = AgentRow(
            id=str(uuid4()),
            user_id=user_id,
            name=payload.name.strip(),
            description=payload.description,
            role_key=payload.role_key,
            model=payload.model,
            instructions=payload.instructions,
            status=payload.status,
            budget_monthly_usd=payload.budget_monthly_usd,
            metadata_json=payload.metadata,
            created_at=now,
            updated_at=now,
        )
        with self._session() as session:
            session.add(row)
            session.commit()
            session.refresh(row)
            return self._agent_to_model(row)

    def list_agents(self, user_id: str, status: AgentStatus | None = None) -> list[Agent]:
        with self._session() as session:
            statement = select(AgentRow).where(AgentRow.user_id == user_id).order_by(AgentRow.created_at.desc())
            if status is not None:
                statement = statement.where(AgentRow.status == status)
            return [self._agent_to_model(row) for row in session.scalars(statement).all()]

    def get_agent(self, agent_id: str, user_id: str) -> Agent | None:
        with self._session() as session:
            row = self._get_agent_row(session, agent_id, user_id)
            return None if row is None else self._agent_to_model(row)

    def update_agent(self, agent_id: str, user_id: str, payload: UpdateAgentInput) -> Agent | None:
        with self._session() as session:
            row = self._get_agent_row(session, agent_id, user_id)
            if row is None:
                return None
            if payload.name is not None and payload.name.strip():
                row.name = payload.name.strip()
            if payload.description is not None:
                row.description = payload.description
            if payload.role_key is not None:
                row.role_key = payload.role_key
            if payload.model is not None:
                row.model = payload.model
            if payload.instructions is not None:
                row.instructions = payload.instructions
            if payload.status is not None:
                row.status = payload.status
            if payload.budget_monthly_usd is not None:
                row.budget_monthly_usd = payload.budget_monthly_usd
            if payload.metadata is not None:
                row.metadata_json = payload.metadata
            row.updated_at = _utc_now()
            session.commit()
            session.refresh(row)
            return self._agent_to_model(row)

    def delete_agent(self, agent_id: str, user_id: str) -> bool:
        with self._session() as session:
            row = self._get_agent_row(session, agent_id, user_id)
            if row is None:
                return False
            session.execute(delete(RoutineRow).where(RoutineRow.agent_id == row.id, RoutineRow.user_id == user_id))
            session.execute(delete(AgentBudgetRow).where(AgentBudgetRow.agent_id == row.id, AgentBudgetRow.user_id == user_id))
            session.execute(delete(AgentRunRow).where(AgentRunRow.agent_id == row.id, AgentRunRow.user_id == user_id))
            session.execute(
                delete(AgentHeartbeatRow).where(AgentHeartbeatRow.agent_id == row.id, AgentHeartbeatRow.user_id == user_id)
            )
            session.delete(row)
            session.commit()
            return True

    def record_heartbeat(self, agent_id: str, user_id: str, payload: RecordHeartbeatInput, run_id: str) -> AgentHeartbeat | None:
        with self._session() as session:
            agent = self._get_agent_row(session, agent_id, user_id)
            if agent is None:
                return None
            timestamp = _parse_timestamp(payload.recorded_at) or _utc_now()
            row = AgentHeartbeatRow(
                id=str(uuid4()),
                agent_id=agent_id,
                user_id=user_id,
                status=payload.status,
                summary=payload.summary,
                token_usage=payload.token_usage,
                cost_usd=payload.cost_usd,
                run_id=payload.run_id,
                created_by_run_id=run_id,
                recorded_at=timestamp,
            )
            session.add(row)
            agent.last_heartbeat_at = timestamp
            if agent.status != "paused" or payload.status == "error":
                agent.status = payload.status
            agent.updated_at = _utc_now()
            session.commit()
            session.refresh(row)
            return self._heartbeat_to_model(row)

    def get_latest_heartbeat(self, agent_id: str, user_id: str) -> AgentHeartbeat | None:
        with self._session() as session:
            if self._get_agent_row(session, agent_id, user_id) is None:
                return None
            row = session.scalar(
                select(AgentHeartbeatRow)
                .where(AgentHeartbeatRow.agent_id == agent_id, AgentHeartbeatRow.user_id == user_id)
                .order_by(AgentHeartbeatRow.recorded_at.desc())
            )
            return None if row is None else self._heartbeat_to_model(row)

    def record_run(self, agent_id: str, user_id: str, payload: RecordRunInput, run_id: str) -> AgentRun | None:
        with self._session() as session:
            agent = self._get_agent_row(session, agent_id, user_id)
            if agent is None:
                return None
            started_at = _parse_timestamp(payload.started_at) or _utc_now()
            completed_at = _parse_timestamp(payload.completed_at)
            row = AgentRunRow(
                id=str(uuid4()),
                agent_id=agent_id,
                user_id=user_id,
                external_run_id=payload.run_id,
                status=payload.status,
                summary=payload.summary,
                token_usage=payload.token_usage,
                cost_usd=payload.cost_usd,
                started_at=started_at,
                completed_at=completed_at,
                created_by_run_id=run_id,
                created_at=_utc_now(),
            )
            session.add(row)
            agent.last_run_at = completed_at or started_at
            if agent.status != "paused":
                agent.status = "running" if payload.status in {"queued", "running"} else "idle"
            agent.updated_at = _utc_now()
            session.flush()
            spent = self._current_period_spend(session, agent_id, user_id, agent.last_run_at or _utc_now())
            if agent.budget_monthly_usd > 0 and spent >= agent.budget_monthly_usd:
                agent.status = "paused"
            session.commit()
            session.refresh(row)
            return self._run_to_model(row)

    def list_runs(self, agent_id: str, user_id: str, limit: int = 20) -> list[AgentRun] | None:
        with self._session() as session:
            if self._get_agent_row(session, agent_id, user_id) is None:
                return None
            statement = (
                select(AgentRunRow)
                .where(AgentRunRow.agent_id == agent_id, AgentRunRow.user_id == user_id)
                .order_by(AgentRunRow.started_at.desc())
                .limit(max(limit, 1))
            )
            return [self._run_to_model(row) for row in session.scalars(statement).all()]

    def _current_period_spend(self, session: Session, agent_id: str, user_id: str, anchor: datetime) -> float:
        rows = session.scalars(
            select(AgentRunRow).where(AgentRunRow.agent_id == agent_id, AgentRunRow.user_id == user_id)
        ).all()
        month = _month_key(anchor)
        return round(sum(row.cost_usd for row in rows if _month_key(row.started_at) == month), 4)

    def get_budget(self, agent_id: str, user_id: str) -> AgentBudgetSnapshot | None:
        with self._session() as session:
            agent = self._get_agent_row(session, agent_id, user_id)
            if agent is None:
                return None
            anchor = agent.last_run_at or agent.created_at
            spent = self._current_period_spend(session, agent_id, user_id, anchor)
            last_update = session.scalar(
                select(AgentBudgetRow)
                .where(AgentBudgetRow.agent_id == agent_id, AgentBudgetRow.user_id == user_id)
                .order_by(AgentBudgetRow.created_at.desc())
            )
            return AgentBudgetSnapshot(
                agentId=agent.id,
                userId=user_id,
                monthlyUsd=round(agent.budget_monthly_usd, 2),
                spentUsd=round(spent, 4),
                remainingUsd=round(max(agent.budget_monthly_usd - spent, 0), 4),
                currentPeriod=_month_key(anchor),
                autoPaused=bool(agent.budget_monthly_usd > 0 and spent >= agent.budget_monthly_usd and agent.status == "paused"),
                lastUpdatedAt=_isoformat(last_update.created_at) if last_update else _isoformat(agent.updated_at),
            )

    def set_budget(self, agent_id: str, user_id: str, payload: SetBudgetInput, run_id: str) -> AgentBudgetSnapshot | None:
        with self._session() as session:
            agent = self._get_agent_row(session, agent_id, user_id)
            if agent is None:
                return None
            agent.budget_monthly_usd = payload.monthly_usd
            agent.updated_at = _utc_now()
            session.add(
                AgentBudgetRow(
                    id=str(uuid4()),
                    agent_id=agent_id,
                    user_id=user_id,
                    monthly_usd=payload.monthly_usd,
                    note=payload.note,
                    created_by_run_id=run_id,
                    created_at=_utc_now(),
                )
            )
            session.commit()
        return self.get_budget(agent_id, user_id)

    def get_token_usage(self, agent_id: str, user_id: str, days: int = 30) -> TokenUsageReport | None:
        with self._session() as session:
            agent = self._get_agent_row(session, agent_id, user_id)
            if agent is None:
                return None
            runs = session.scalars(
                select(AgentRunRow).where(AgentRunRow.agent_id == agent_id, AgentRunRow.user_id == user_id)
            ).all()
            buckets: dict[str, dict[str, float]] = defaultdict(lambda: {"tokens": 0, "costUsd": 0.0})
            now = _utc_now()
            for row in runs:
                stamp = row.completed_at or row.started_at
                if (now - stamp.astimezone(timezone.utc)).days >= max(days, 1):
                    continue
                key = stamp.astimezone(timezone.utc).date().isoformat()
                buckets[key]["tokens"] += row.token_usage
                buckets[key]["costUsd"] += row.cost_usd
            ordered = sorted(buckets.items())
            daily = [
                TokenUsageBucket(date=day, tokens=int(values["tokens"]), costUsd=round(values["costUsd"], 4))
                for day, values in ordered
            ]
            return TokenUsageReport(
                agentId=agent_id,
                userId=user_id,
                days=max(days, 1),
                totalTokens=sum(bucket.tokens for bucket in daily),
                totalCostUsd=round(sum(bucket.cost_usd for bucket in daily), 4),
                daily=daily,
            )

    def create_routine(self, user_id: str, payload: CreateRoutineInput) -> Routine | None:
        _require_schedule_fields(payload.schedule_type, payload.cron_expression, payload.interval_minutes)
        with self._session() as session:
            if self._get_agent_row(session, payload.agent_id, user_id) is None:
                return None
            now = _utc_now()
            row = RoutineRow(
                id=str(uuid4()),
                user_id=user_id,
                agent_id=payload.agent_id,
                name=payload.name.strip(),
                description=payload.description,
                schedule_type=payload.schedule_type,
                cron_expression=payload.cron_expression,
                interval_minutes=payload.interval_minutes,
                prompt=payload.prompt,
                status=payload.status,
                metadata_json=payload.metadata,
                next_run_at=_parse_timestamp(payload.next_run_at),
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            session.commit()
            session.refresh(row)
            return self._routine_to_model(row)

    def list_routines(
        self,
        user_id: str,
        agent_id: str | None = None,
        status: RoutineStatus | None = None,
    ) -> list[Routine]:
        with self._session() as session:
            statement = select(RoutineRow).where(RoutineRow.user_id == user_id).order_by(RoutineRow.created_at.desc())
            if agent_id is not None:
                statement = statement.where(RoutineRow.agent_id == agent_id)
            if status is not None:
                statement = statement.where(RoutineRow.status == status)
            return [self._routine_to_model(row) for row in session.scalars(statement).all()]

    def update_routine(self, routine_id: str, user_id: str, payload: UpdateRoutineInput) -> Routine | None:
        with self._session() as session:
            row = session.scalar(select(RoutineRow).where(RoutineRow.id == routine_id, RoutineRow.user_id == user_id))
            if row is None:
                return None
            schedule_type = payload.schedule_type or row.schedule_type
            cron_expression = payload.cron_expression if payload.cron_expression is not None else row.cron_expression
            interval_minutes = payload.interval_minutes if payload.interval_minutes is not None else row.interval_minutes
            _require_schedule_fields(schedule_type, cron_expression, interval_minutes)
            if payload.name is not None and payload.name.strip():
                row.name = payload.name.strip()
            if payload.description is not None:
                row.description = payload.description
            row.schedule_type = schedule_type
            row.cron_expression = cron_expression
            row.interval_minutes = interval_minutes
            if payload.prompt is not None:
                row.prompt = payload.prompt
            if payload.status is not None:
                row.status = payload.status
            if payload.metadata is not None:
                row.metadata_json = payload.metadata
            if payload.last_run_at is not None:
                row.last_run_at = _parse_timestamp(payload.last_run_at)
            if payload.next_run_at is not None:
                row.next_run_at = _parse_timestamp(payload.next_run_at)
            row.updated_at = _utc_now()
            session.commit()
            session.refresh(row)
            return self._routine_to_model(row)


agent_store = AgentStore()
