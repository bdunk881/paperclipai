from .schemas import (
    ConfigField,
    FieldType,
    RunStatus,
    StepKind,
    StepResult,
    StepStatus,
    TemplateCategory,
    WorkflowRun,
    WorkflowStep,
    WorkflowTemplate,
)
from .customer_support_bot import customer_support_bot
from .lead_enrichment import lead_enrichment
from .content_generator import content_generator

# Registry indexed by template id
TEMPLATE_REGISTRY: dict[str, WorkflowTemplate] = {
    t.id: t
    for t in [
        customer_support_bot,
        lead_enrichment,
        content_generator,
    ]
}

__all__ = [
    # schemas
    "ConfigField",
    "FieldType",
    "RunStatus",
    "StepKind",
    "StepResult",
    "StepStatus",
    "TemplateCategory",
    "WorkflowRun",
    "WorkflowStep",
    "WorkflowTemplate",
    # templates
    "customer_support_bot",
    "lead_enrichment",
    "content_generator",
    # registry
    "TEMPLATE_REGISTRY",
]
