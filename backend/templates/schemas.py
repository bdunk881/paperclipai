"""
Pydantic schemas for AutoFlow workflow templates and runs.
Shared between the template registry and the API layer.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class StepKind(str, Enum):
    trigger = "trigger"
    llm = "llm"
    transform = "transform"
    condition = "condition"
    action = "action"
    output = "output"


class FieldType(str, Enum):
    string = "string"
    number = "number"
    boolean = "boolean"
    object = "object"
    string_list = "string[]"
    object_list = "object[]"


class TemplateCategory(str, Enum):
    support = "support"
    sales = "sales"
    content = "content"
    custom = "custom"


class ConfigField(BaseModel):
    key: str
    label: str
    type: FieldType
    required: bool
    default_value: Any = Field(
        default=None,
        validation_alias="defaultValue",
        serialization_alias="defaultValue",
    )
    description: str | None = None
    options: list[str] | None = None

    model_config = ConfigDict(populate_by_name=True)


class WorkflowStep(BaseModel):
    id: str
    name: str
    kind: StepKind
    description: str
    input_keys: list[str] = Field(
        default_factory=list,
        validation_alias="inputKeys",
        serialization_alias="inputKeys",
    )
    output_keys: list[str] = Field(
        default_factory=list,
        validation_alias="outputKeys",
        serialization_alias="outputKeys",
    )
    prompt_template: str | None = Field(
        default=None,
        validation_alias="promptTemplate",
        serialization_alias="promptTemplate",
    )
    condition: str | None = None
    action: str | None = None
    config: dict[str, Any] | None = None

    model_config = ConfigDict(populate_by_name=True)


class WorkflowTemplate(BaseModel):
    id: str
    name: str
    description: str
    category: TemplateCategory
    version: str
    config_fields: list[ConfigField] = Field(
        default_factory=list,
        validation_alias="configFields",
        serialization_alias="configFields",
    )
    steps: list[WorkflowStep]
    sample_input: dict[str, Any] = Field(
        default_factory=dict,
        validation_alias="sampleInput",
        serialization_alias="sampleInput",
    )
    expected_output: dict[str, Any] = Field(
        default_factory=dict,
        validation_alias="expectedOutput",
        serialization_alias="expectedOutput",
    )

    model_config = ConfigDict(populate_by_name=True)


# ── Run schemas ──────────────────────────────────────────────────────────────

class RunStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"
    escalated = "escalated"


class StepStatus(str, Enum):
    success = "success"
    failure = "failure"
    skipped = "skipped"
    running = "running"


class StepResult(BaseModel):
    step_id: str = Field(validation_alias="stepId", serialization_alias="stepId")
    step_name: str = Field(validation_alias="stepName", serialization_alias="stepName")
    status: StepStatus
    output: dict[str, Any] = Field(default_factory=dict)
    duration_ms: int = Field(validation_alias="durationMs", serialization_alias="durationMs")
    error: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class WorkflowRun(BaseModel):
    id: str
    template_id: str = Field(validation_alias="templateId", serialization_alias="templateId")
    template_name: str = Field(validation_alias="templateName", serialization_alias="templateName")
    status: RunStatus
    started_at: str = Field(validation_alias="startedAt", serialization_alias="startedAt")
    completed_at: str | None = Field(
        default=None,
        validation_alias="completedAt",
        serialization_alias="completedAt",
    )
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] | None = None
    step_results: list[StepResult] = Field(
        default_factory=list,
        validation_alias="stepResults",
        serialization_alias="stepResults",
    )
    error: str | None = None

    model_config = ConfigDict(populate_by_name=True)
