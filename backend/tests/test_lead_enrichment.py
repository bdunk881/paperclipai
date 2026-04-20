"""
Domain-specific tests for the Lead Enrichment template (Python).

Validates the template structure, step wiring, config fields,
and sample data shape without requiring a live LLM or CRM.
"""

from templates.lead_enrichment import lead_enrichment
from templates.schemas import StepKind, FieldType, TemplateCategory


# ---------------------------------------------------------------------------
# Top-level template metadata
# ---------------------------------------------------------------------------

class TestTemplateMetadata:
    def test_id(self):
        assert lead_enrichment.id == "tpl-lead-enrich"

    def test_name_contains_lead(self):
        assert "lead" in lead_enrichment.name.lower() or "enrich" in lead_enrichment.name.lower()

    def test_category_is_sales(self):
        assert lead_enrichment.category == TemplateCategory.sales

    def test_version_semver(self):
        parts = lead_enrichment.version.split(".")
        assert len(parts) == 3
        assert all(p.isdigit() for p in parts)

    def test_description_non_empty(self):
        assert len(lead_enrichment.description) > 20


# ---------------------------------------------------------------------------
# Config fields
# ---------------------------------------------------------------------------

class TestConfigFields:
    def setup_method(self):
        self.fields = {f.key: f for f in lead_enrichment.config_fields}

    def test_has_score_threshold(self):
        assert "scoreThreshold" in self.fields
        field = self.fields["scoreThreshold"]
        assert field.required is True
        assert field.type == FieldType.number
        assert field.default_value == 70

    def test_has_crm_target(self):
        assert "crmTarget" in self.fields
        field = self.fields["crmTarget"]
        assert field.required is True
        assert field.type == FieldType.string
        assert field.options is not None
        assert "salesforce" in field.options
        assert "hubspot" in field.options

    def test_has_icp_description(self):
        assert "icpDescription" in self.fields
        field = self.fields["icpDescription"]
        assert field.required is False
        assert isinstance(field.default_value, str)
        assert len(field.default_value) > 0

    def test_non_required_fields_have_defaults(self):
        for field in lead_enrichment.config_fields:
            if not field.required:
                assert field.default_value is not None, (
                    f"Non-required field '{field.key}' must have a default_value"
                )


# ---------------------------------------------------------------------------
# Step structure
# ---------------------------------------------------------------------------

class TestSteps:
    def setup_method(self):
        self.steps = lead_enrichment.steps
        self.steps_by_id = {s.id: s for s in self.steps}

    def test_at_least_four_steps(self):
        assert len(self.steps) >= 4

    def test_first_step_is_trigger(self):
        assert self.steps[0].kind == StepKind.trigger

    def test_last_step_is_output(self):
        assert self.steps[-1].kind == StepKind.output

    def test_trigger_outputs_lead_fields(self):
        trigger = self.steps[0]
        for key in ("email", "name", "company"):
            assert key in trigger.output_keys

    def test_has_enrich_step(self):
        assert "step_enrich" in self.steps_by_id

    def test_enrich_is_transform(self):
        assert self.steps_by_id["step_enrich"].kind == StepKind.transform

    def test_enrich_outputs_firmographic_data(self):
        enrich = self.steps_by_id["step_enrich"]
        for key in ("employees", "revenue", "industry"):
            assert key in enrich.output_keys

    def test_has_score_step(self):
        assert "step_score" in self.steps_by_id

    def test_score_is_llm(self):
        assert self.steps_by_id["step_score"].kind == StepKind.llm

    def test_score_outputs_lead_score(self):
        score = self.steps_by_id["step_score"]
        assert "leadScore" in score.output_keys
        assert "fitReason" in score.output_keys

    def test_score_has_prompt_template(self):
        prompt = self.steps_by_id["step_score"].prompt_template
        assert prompt is not None
        assert len(prompt) > 0

    def test_score_prompt_contains_icp_placeholder(self):
        prompt = self.steps_by_id["step_score"].prompt_template
        assert "{{icpDescription}}" in prompt

    def test_score_prompt_references_lead_details(self):
        prompt = self.steps_by_id["step_score"].prompt_template
        for placeholder in ("{{industry}}", "{{employees}}"):
            assert placeholder in prompt

    def test_has_qualify_step(self):
        assert "step_qualify" in self.steps_by_id

    def test_qualify_is_condition(self):
        assert self.steps_by_id["step_qualify"].kind == StepKind.condition

    def test_qualify_condition_references_lead_score(self):
        condition = self.steps_by_id["step_qualify"].condition
        assert condition is not None
        assert "leadScore" in condition

    def test_qualify_condition_references_threshold(self):
        condition = self.steps_by_id["step_qualify"].condition
        assert "scoreThreshold" in condition

    def test_has_crm_sync_step(self):
        assert "step_crm_sync" in self.steps_by_id

    def test_crm_sync_is_action(self):
        assert self.steps_by_id["step_crm_sync"].kind == StepKind.action

    def test_crm_sync_action_name(self):
        assert self.steps_by_id["step_crm_sync"].action == "crm.upsertLead"

    def test_crm_sync_outputs_crm_id(self):
        assert "crmId" in self.steps_by_id["step_crm_sync"].output_keys

    def test_step_ids_are_unique(self):
        ids = [s.id for s in self.steps]
        assert len(set(ids)) == len(ids)

    def test_all_llm_steps_have_prompt_templates(self):
        llm_steps = [s for s in self.steps if s.kind == StepKind.llm]
        assert len(llm_steps) >= 1
        for step in llm_steps:
            assert step.prompt_template is not None
            assert len(step.prompt_template) > 0

    def test_step_wiring_no_missing_inputs(self):
        """Every step's inputKeys must be produced by a prior step or a config field."""
        available_keys: set[str] = set()
        config_keys = {f.key for f in lead_enrichment.config_fields}
        errors = []

        for step in self.steps:
            for key in step.input_keys:
                if key not in available_keys and key not in config_keys:
                    errors.append(
                        f"Step '{step.id}': input key '{key}' not available from prior steps or config"
                    )
            available_keys.update(step.output_keys)

        assert errors == [], "\n".join(errors)


# ---------------------------------------------------------------------------
# Sample data
# ---------------------------------------------------------------------------

class TestSampleData:
    def test_sample_input_is_non_empty(self):
        assert len(lead_enrichment.sample_input) > 0

    def test_sample_input_has_email(self):
        assert "email" in lead_enrichment.sample_input

    def test_sample_input_has_company(self):
        assert "company" in lead_enrichment.sample_input

    def test_expected_output_is_non_empty(self):
        assert len(lead_enrichment.expected_output) > 0

    def test_expected_output_has_lead_score(self):
        assert "leadScore" in lead_enrichment.expected_output
        assert isinstance(lead_enrichment.expected_output["leadScore"], int)

    def test_expected_output_score_in_range(self):
        score = lead_enrichment.expected_output["leadScore"]
        assert 0 <= score <= 100

    def test_expected_output_has_qualified(self):
        assert "qualified" in lead_enrichment.expected_output
        assert isinstance(lead_enrichment.expected_output["qualified"], bool)
