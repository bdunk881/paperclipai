"""
Unit tests for the Invoice / PO Data Extraction template (Python).

Validates template structure, step wiring, config fields,
and sample data shape without requiring a live LLM or accounting API.
"""

from templates.invoice_extractor import invoice_extractor
from templates.schemas import StepKind, FieldType, TemplateCategory


# ---------------------------------------------------------------------------
# Top-level template metadata
# ---------------------------------------------------------------------------

class TestTemplateMetadata:
    def test_id(self):
        assert invoice_extractor.id == "tpl-invoice-extractor"

    def test_name_contains_invoice_or_extraction(self):
        name_lower = invoice_extractor.name.lower()
        assert "invoice" in name_lower or "extraction" in name_lower or "po" in name_lower

    def test_category_is_custom(self):
        assert invoice_extractor.category == TemplateCategory.custom

    def test_version_semver(self):
        parts = invoice_extractor.version.split(".")
        assert len(parts) == 3
        assert all(p.isdigit() for p in parts)

    def test_description_non_empty(self):
        assert len(invoice_extractor.description) > 20


# ---------------------------------------------------------------------------
# Config fields
# ---------------------------------------------------------------------------

class TestConfigFields:
    def setup_method(self):
        self.fields = {f.key: f for f in invoice_extractor.config_fields}

    def test_has_accounting_system(self):
        assert "accountingSystem" in self.fields

    def test_accounting_system_is_required(self):
        assert self.fields["accountingSystem"].required is True

    def test_accounting_system_is_string(self):
        assert self.fields["accountingSystem"].type == FieldType.string

    def test_accounting_system_has_options(self):
        opts = self.fields["accountingSystem"].options
        assert opts is not None
        assert len(opts) >= 2

    def test_accounting_system_includes_common_systems(self):
        opts = self.fields["accountingSystem"].options
        known = {"quickbooks", "xero", "netsuite", "sage"}
        assert any(o in known for o in opts)

    def test_has_default_currency(self):
        assert "defaultCurrency" in self.fields

    def test_default_currency_not_required(self):
        assert self.fields["defaultCurrency"].required is False

    def test_default_currency_has_default_value(self):
        assert self.fields["defaultCurrency"].default_value is not None

    def test_has_require_approval_above(self):
        assert "requireApprovalAbove" in self.fields

    def test_require_approval_above_is_number(self):
        assert self.fields["requireApprovalAbove"].type == FieldType.number

    def test_require_approval_above_has_numeric_default(self):
        default = self.fields["requireApprovalAbove"].default_value
        assert isinstance(default, (int, float))
        assert default > 0

    def test_has_notification_email(self):
        assert "notificationEmail" in self.fields

    def test_notification_email_is_required(self):
        assert self.fields["notificationEmail"].required is True

    def test_non_required_fields_have_defaults(self):
        for field in invoice_extractor.config_fields:
            if not field.required:
                assert field.default_value is not None, (
                    f"Non-required field '{field.key}' must have a default_value"
                )


# ---------------------------------------------------------------------------
# Step structure
# ---------------------------------------------------------------------------

class TestSteps:
    def setup_method(self):
        self.steps = invoice_extractor.steps
        self.steps_by_id = {s.id: s for s in self.steps}

    def test_at_least_four_steps(self):
        assert len(self.steps) >= 4

    def test_first_step_is_trigger(self):
        assert self.steps[0].kind == StepKind.trigger

    def test_last_step_is_output(self):
        assert self.steps[-1].kind == StepKind.output

    def test_has_extract_step(self):
        assert "step_extract" in self.steps_by_id

    def test_extract_is_llm(self):
        assert self.steps_by_id["step_extract"].kind == StepKind.llm

    def test_extract_outputs_invoice_fields(self):
        extract = self.steps_by_id["step_extract"]
        for key in ("vendorName", "invoiceNumber", "totalAmount", "lineItems"):
            assert key in extract.output_keys, f"Expected '{key}' in step_extract outputKeys"

    def test_extract_outputs_financial_totals(self):
        extract = self.steps_by_id["step_extract"]
        assert "subtotal" in extract.output_keys
        assert "taxAmount" in extract.output_keys

    def test_extract_prompt_contains_raw_text_placeholder(self):
        prompt = self.steps_by_id["step_extract"].prompt_template
        assert prompt is not None
        assert "{{rawText}}" in prompt

    def test_extract_prompt_non_empty(self):
        prompt = self.steps_by_id["step_extract"].prompt_template
        assert prompt is not None
        assert len(prompt) > 50

    def test_has_validate_step(self):
        assert "step_validate" in self.steps_by_id

    def test_validate_is_transform(self):
        assert self.steps_by_id["step_validate"].kind == StepKind.transform

    def test_validate_outputs_validation_result(self):
        validate = self.steps_by_id["step_validate"]
        assert "validationPassed" in validate.output_keys

    def test_has_approval_gate_step(self):
        assert "step_approval_gate" in self.steps_by_id

    def test_approval_gate_is_condition(self):
        assert self.steps_by_id["step_approval_gate"].kind == StepKind.condition

    def test_approval_gate_outputs_requires_approval(self):
        assert "requiresApproval" in self.steps_by_id["step_approval_gate"].output_keys

    def test_approval_gate_condition_references_total(self):
        condition = self.steps_by_id["step_approval_gate"].condition
        assert condition is not None
        assert "totalAmount" in condition

    def test_has_post_step(self):
        assert "step_post" in self.steps_by_id

    def test_post_is_action(self):
        assert self.steps_by_id["step_post"].kind == StepKind.action

    def test_post_outputs_accounting_record_id(self):
        assert "accountingRecordId" in self.steps_by_id["step_post"].output_keys

    def test_step_ids_are_unique(self):
        ids = [s.id for s in self.steps]
        assert len(set(ids)) == len(ids)

    def test_all_llm_steps_have_prompt_templates(self):
        llm_steps = [s for s in self.steps if s.kind == StepKind.llm]
        assert len(llm_steps) >= 1
        for step in llm_steps:
            assert step.prompt_template is not None
            assert len(step.prompt_template) > 0

    def test_trigger_outputs_raw_text(self):
        trigger = self.steps[0]
        assert "rawText" in trigger.output_keys

    def test_step_wiring_no_missing_inputs(self):
        """Every step's inputKeys must be produced by a prior step or a config field."""
        available_keys: set[str] = set()
        config_keys = {f.key for f in invoice_extractor.config_fields}
        errors = []

        for step in self.steps:
            for key in step.input_keys:
                if key not in available_keys and key not in config_keys:
                    errors.append(
                        f"Step '{step.id}': input key '{key}' not available "
                        f"from prior steps or config"
                    )
            available_keys.update(step.output_keys)

        assert errors == [], "\n".join(errors)


# ---------------------------------------------------------------------------
# Sample data
# ---------------------------------------------------------------------------

class TestSampleData:
    def test_sample_input_is_non_empty(self):
        assert len(invoice_extractor.sample_input) > 0

    def test_sample_input_has_document_id(self):
        assert "documentId" in invoice_extractor.sample_input

    def test_sample_input_has_raw_text(self):
        assert "rawText" in invoice_extractor.sample_input
        assert isinstance(invoice_extractor.sample_input["rawText"], str)
        assert len(invoice_extractor.sample_input["rawText"]) > 20

    def test_sample_input_raw_text_contains_invoice_content(self):
        raw = invoice_extractor.sample_input["rawText"].lower()
        assert any(word in raw for word in ("invoice", "total", "amount", "vendor"))

    def test_expected_output_is_non_empty(self):
        assert len(invoice_extractor.expected_output) > 0

    def test_expected_output_has_invoice_number(self):
        assert "invoiceNumber" in invoice_extractor.expected_output

    def test_expected_output_has_total_amount(self):
        assert "totalAmount" in invoice_extractor.expected_output
        assert isinstance(invoice_extractor.expected_output["totalAmount"], (int, float))
        assert invoice_extractor.expected_output["totalAmount"] > 0

    def test_expected_output_has_validation_passed(self):
        assert "validationPassed" in invoice_extractor.expected_output

    def test_expected_output_has_event(self):
        assert "event" in invoice_extractor.expected_output
        assert isinstance(invoice_extractor.expected_output["event"], dict)
