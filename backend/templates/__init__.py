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
from .invoice_extractor import invoice_extractor
from .social_media_scheduler import social_media_scheduler
from .meeting_notes_summarizer import meeting_notes_summarizer

# Registry indexed by template id
TEMPLATE_REGISTRY: dict[str, WorkflowTemplate] = {
    t.id: t
    for t in [
        customer_support_bot,
        lead_enrichment,
        content_generator,
        invoice_extractor,
        social_media_scheduler,
        meeting_notes_summarizer,
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
    "invoice_extractor",
    "social_media_scheduler",
    "meeting_notes_summarizer",
    # registry
    "TEMPLATE_REGISTRY",
]
