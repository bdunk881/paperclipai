"""
Shared pytest fixtures for AutoFlow backend tests.
"""

import pytest
from templates.schemas import (
    ConfigField,
    FieldType,
    StepKind,
    TemplateCategory,
    WorkflowStep,
    WorkflowTemplate,
)


@pytest.fixture
def minimal_template() -> WorkflowTemplate:
    """A minimal valid WorkflowTemplate with one trigger and one output step."""
    return WorkflowTemplate(
        id="tpl-test-minimal",
        name="Minimal Test Template",
        description="Used in unit tests",
        category=TemplateCategory.custom,
        version="1.0.0",
        configFields=[
            ConfigField(
                key="apiKey",
                label="API Key",
                type=FieldType.string,
                required=True,
            )
        ],
        steps=[
            WorkflowStep(
                id="step_trigger",
                name="Trigger",
                kind=StepKind.trigger,
                description="Entry point",
                inputKeys=[],
                outputKeys=["payload"],
            ),
            WorkflowStep(
                id="step_output",
                name="Output",
                kind=StepKind.output,
                description="Exit point",
                inputKeys=["payload"],
                outputKeys=["result"],
            ),
        ],
        sampleInput={"payload": "test"},
        expectedOutput={"result": "test"},
    )


@pytest.fixture
def support_bot_input() -> dict:
    return {
        "ticketId": "TKT-00147",
        "customerEmail": "alice@example.com",
        "subject": "Can't log into my account",
        "body": "I've been trying to log in but keep getting an invalid password error.",
        "channel": "email",
    }
