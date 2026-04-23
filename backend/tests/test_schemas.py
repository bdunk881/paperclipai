"""
Unit tests for AutoFlow Pydantic schemas (templates/schemas.py).

Validates schema construction, field aliases, enum values, and serialisation
without requiring a live database or API.
"""

from templates.schemas import (
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


# ---------------------------------------------------------------------------
# Enum smoke tests
# ---------------------------------------------------------------------------

class TestEnums:
    def test_step_kind_values(self):
        assert StepKind.trigger == "trigger"
        assert StepKind.llm == "llm"
        assert StepKind.transform == "transform"
        assert StepKind.condition == "condition"
        assert StepKind.action == "action"
        assert StepKind.output == "output"

    def test_field_type_values(self):
        assert FieldType.string == "string"
        assert FieldType.number == "number"
        assert FieldType.boolean == "boolean"
        assert FieldType.object == "object"
        assert FieldType.string_list == "string[]"
        assert FieldType.object_list == "object[]"

    def test_template_category_values(self):
        assert TemplateCategory.support == "support"
        assert TemplateCategory.sales == "sales"
        assert TemplateCategory.content == "content"
        assert TemplateCategory.custom == "custom"

    def test_run_status_values(self):
        expected = {"pending", "running", "completed", "failed", "escalated"}
        assert {s.value for s in RunStatus} == expected

    def test_step_status_values(self):
        expected = {"success", "failure", "skipped", "running"}
        assert {s.value for s in StepStatus} == expected


# ---------------------------------------------------------------------------
# ConfigField
# ---------------------------------------------------------------------------

class TestConfigField:
    def test_required_fields_construction(self):
        field = ConfigField(key="brandName", label="Brand", type=FieldType.string, required=True)
        assert field.key == "brandName"
        assert field.label == "Brand"
        assert field.type == FieldType.string
        assert field.required is True
        assert field.default_value is None

    def test_optional_fields_with_defaults(self):
        field = ConfigField(
            key="tone",
            label="Tone",
            type=FieldType.string,
            required=False,
            defaultValue="professional",
        )
        assert field.default_value == "professional"
        assert field.required is False

    def test_options_field(self):
        field = ConfigField(
            key="category",
            label="Category",
            type=FieldType.string,
            required=False,
            defaultValue="general",
            options=["general", "billing", "refund"],
        )
        assert field.options == ["general", "billing", "refund"]

    def test_alias_populate_by_name(self):
        # Both camelCase (alias) and snake_case should work
        via_alias = ConfigField(
            key="x", label="X", type=FieldType.string, required=False, defaultValue="v"
        )
        via_snake = ConfigField(
            **{"key": "x", "label": "X", "type": FieldType.string, "required": False, "default_value": "v"}
        )
        assert via_alias.default_value == "v"
        assert via_snake.default_value == "v"


# ---------------------------------------------------------------------------
# WorkflowStep
# ---------------------------------------------------------------------------

class TestWorkflowStep:
    def test_trigger_step_construction(self):
        step = WorkflowStep(
            id="step_trigger",
            name="Trigger",
            kind=StepKind.trigger,
            description="Entry point",
            inputKeys=[],
            outputKeys=["ticketId", "body"],
        )
        assert step.id == "step_trigger"
        assert step.kind == StepKind.trigger
        assert step.input_keys == []
        assert step.output_keys == ["ticketId", "body"]

    def test_llm_step_with_prompt_template(self):
        step = WorkflowStep(
            id="step_llm",
            name="LLM Step",
            kind=StepKind.llm,
            description="Calls LLM",
            inputKeys=["body"],
            outputKeys=["intent"],
            promptTemplate="Classify: {{body}}",
        )
        assert step.prompt_template == "Classify: {{body}}"

    def test_condition_step(self):
        step = WorkflowStep(
            id="step_cond",
            name="Condition",
            kind=StepKind.condition,
            description="Branch",
            inputKeys=["intent"],
            outputKeys=["shouldEscalate"],
            condition="intent === 'refund'",
        )
        assert step.condition == "intent === 'refund'"

    def test_action_step(self):
        step = WorkflowStep(
            id="step_act",
            name="Action",
            kind=StepKind.action,
            description="Send email",
            inputKeys=["draftResponse"],
            outputKeys=["sent"],
            action="email.send",
        )
        assert step.action == "email.send"

    def test_camel_case_alias_accepted(self):
        step = WorkflowStep(
            **{
                "id": "s1",
                "name": "S",
                "kind": "trigger",
                "description": "d",
                "inputKeys": ["a"],
                "outputKeys": ["b"],
            }
        )
        assert step.input_keys == ["a"]
        assert step.output_keys == ["b"]


# ---------------------------------------------------------------------------
# WorkflowTemplate
# ---------------------------------------------------------------------------

class TestWorkflowTemplate:
    def test_minimal_template_construction(self, minimal_template):
        assert minimal_template.id == "tpl-test-minimal"
        assert minimal_template.category == TemplateCategory.custom
        assert len(minimal_template.steps) == 2
        assert len(minimal_template.config_fields) == 1

    def test_camel_case_config_fields_alias(self):
        tpl = WorkflowTemplate(
            **{
                "id": "tpl-x",
                "name": "X",
                "description": "Test",
                "category": "custom",
                "version": "1.0.0",
                "configFields": [
                    {"key": "k", "label": "L", "type": "string", "required": True}
                ],
                "steps": [
                    {
                        "id": "s1",
                        "name": "S",
                        "kind": "trigger",
                        "description": "d",
                        "inputKeys": [],
                        "outputKeys": ["v"],
                    }
                ],
                "sampleInput": {"v": 1},
                "expectedOutput": {"v": 1},
            }
        )
        assert len(tpl.config_fields) == 1
        assert tpl.config_fields[0].key == "k"


# ---------------------------------------------------------------------------
# WorkflowRun + StepResult
# ---------------------------------------------------------------------------

class TestWorkflowRun:
    def test_step_result_construction(self):
        sr = StepResult(
            stepId="step_trigger",
            stepName="Trigger",
            status=StepStatus.success,
            output={"ticketId": "T001"},
            durationMs=42,
        )
        assert sr.step_id == "step_trigger"
        assert sr.status == StepStatus.success
        assert sr.duration_ms == 42

    def test_workflow_run_construction(self):
        run = WorkflowRun(
            id="run-001",
            templateId="tpl-support-bot",
            templateName="Customer Support Bot",
            status=RunStatus.pending,
            startedAt="2024-01-01T00:00:00Z",
            input={"ticketId": "T001"},
        )
        assert run.id == "run-001"
        assert run.template_id == "tpl-support-bot"
        assert run.status == RunStatus.pending
        assert run.completed_at is None

    def test_workflow_run_with_step_results(self):
        sr = StepResult(
            stepId="step_trigger",
            stepName="Trigger",
            status=StepStatus.success,
            output={},
            durationMs=10,
        )
        run = WorkflowRun(
            id="run-002",
            templateId="tpl-support-bot",
            templateName="Customer Support Bot",
            status=RunStatus.running,
            startedAt="2024-01-01T00:00:00Z",
            input={},
            stepResults=[sr],
        )
        assert len(run.step_results) == 1
        assert run.step_results[0].step_id == "step_trigger"
