"""
Domain-specific tests for the Customer Support Bot template (Python).

Validates the template structure, step wiring, config fields,
and sample data shape without requiring a live LLM.
"""

import pytest
from templates.customer_support_bot import customer_support_bot
from templates.schemas import StepKind, FieldType, TemplateCategory


# ---------------------------------------------------------------------------
# Top-level template metadata
# ---------------------------------------------------------------------------

class TestTemplateMetadata:
    def test_id(self):
        assert customer_support_bot.id == "tpl-support-bot"

    def test_name(self):
        assert "Support" in customer_support_bot.name or "support" in customer_support_bot.name.lower()

    def test_category(self):
        assert customer_support_bot.category == TemplateCategory.support

    def test_version_semver(self):
        parts = customer_support_bot.version.split(".")
        assert len(parts) == 3
        assert all(p.isdigit() for p in parts)

    def test_description_non_empty(self):
        assert len(customer_support_bot.description) > 20


# ---------------------------------------------------------------------------
# Config fields
# ---------------------------------------------------------------------------

class TestConfigFields:
    def setup_method(self):
        self.fields = {f.key: f for f in customer_support_bot.config_fields}

    def test_has_brand_name(self):
        assert "brandName" in self.fields
        assert self.fields["brandName"].required is True
        assert self.fields["brandName"].type == FieldType.string

    def test_has_escalation_email(self):
        assert "escalationEmail" in self.fields
        assert self.fields["escalationEmail"].required is True

    def test_has_auto_respond_categories(self):
        assert "autoRespondCategories" in self.fields
        field = self.fields["autoRespondCategories"]
        assert field.required is False
        assert field.default_value is not None
        assert isinstance(field.default_value, list)

    def test_has_escalate_categories(self):
        assert "escalateCategories" in self.fields
        field = self.fields["escalateCategories"]
        assert field.required is False
        assert isinstance(field.default_value, list)

    def test_has_tone_of_voice(self):
        assert "toneOfVoice" in self.fields
        assert self.fields["toneOfVoice"].required is False
        assert isinstance(self.fields["toneOfVoice"].default_value, str)

    def test_non_required_fields_have_defaults(self):
        for field in customer_support_bot.config_fields:
            if not field.required:
                assert field.default_value is not None, (
                    f"Non-required field '{field.key}' must have a default_value"
                )


# ---------------------------------------------------------------------------
# Step structure
# ---------------------------------------------------------------------------

class TestSteps:
    def setup_method(self):
        self.steps = customer_support_bot.steps
        self.steps_by_id = {s.id: s for s in self.steps}

    def test_at_least_four_steps(self):
        assert len(self.steps) >= 4

    def test_first_step_is_trigger(self):
        assert self.steps[0].kind == StepKind.trigger

    def test_has_classify_step(self):
        assert "step_classify" in self.steps_by_id

    def test_classify_is_llm(self):
        assert self.steps_by_id["step_classify"].kind == StepKind.llm

    def test_classify_outputs_intent_sentiment_summary(self):
        classify = self.steps_by_id["step_classify"]
        assert "intent" in classify.output_keys
        assert "sentiment" in classify.output_keys
        assert "summary" in classify.output_keys

    def test_route_step_is_condition(self):
        assert "step_route" in self.steps_by_id
        route = self.steps_by_id["step_route"]
        assert route.kind == StepKind.condition

    def test_route_condition_references_intent(self):
        route = self.steps_by_id["step_route"]
        assert route.condition is not None
        assert "intent" in route.condition

    def test_all_llm_steps_have_prompt_templates(self):
        llm_steps = [s for s in self.steps if s.kind == StepKind.llm]
        assert len(llm_steps) >= 1
        for step in llm_steps:
            assert step.prompt_template is not None
            assert len(step.prompt_template) > 0

    def test_step_ids_are_unique(self):
        ids = [s.id for s in self.steps]
        assert len(set(ids)) == len(ids)

    def test_step_wiring_no_missing_inputs(self):
        """Every step's inputKeys must be produced by a prior step or a config field."""
        available_keys: set[str] = set()
        config_keys = {f.key for f in customer_support_bot.config_fields}
        errors = []

        for step in self.steps:
            for key in step.input_keys:
                if key not in available_keys and key not in config_keys:
                    errors.append(
                        f"Step '{step.id}': input key '{key}' not available from prior steps or config"
                    )
            available_keys.update(step.output_keys)

        assert errors == [], "\n".join(errors)

    def test_trigger_step_outputs_ticket_fields(self):
        trigger = self.steps[0]
        for key in ("ticketId", "customerEmail", "subject", "body", "channel"):
            assert key in trigger.output_keys


# ---------------------------------------------------------------------------
# Sample data
# ---------------------------------------------------------------------------

class TestSampleData:
    def test_sample_input_is_non_empty(self):
        assert len(customer_support_bot.sample_input) > 0

    def test_sample_input_has_ticket_fields(self, support_bot_input):
        for key in support_bot_input:
            assert key in customer_support_bot.sample_input

    def test_expected_output_is_non_empty(self):
        assert len(customer_support_bot.expected_output) > 0

    def test_expected_output_has_ticket_id(self):
        assert "ticketId" in customer_support_bot.expected_output

    def test_expected_output_has_escalated_flag(self):
        assert "escalated" in customer_support_bot.expected_output
        assert isinstance(customer_support_bot.expected_output["escalated"], bool)
