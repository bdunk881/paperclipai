"""
Unit tests for the Meeting Notes Summarizer template (Python).

Validates template structure, step wiring, config fields,
and sample data shape without requiring a live LLM or messaging API.
"""

from templates.meeting_notes_summarizer import meeting_notes_summarizer
from templates.schemas import StepKind, FieldType, TemplateCategory


# ---------------------------------------------------------------------------
# Top-level template metadata
# ---------------------------------------------------------------------------

class TestTemplateMetadata:
    def test_id(self):
        assert meeting_notes_summarizer.id == "tpl-meeting-summarizer"

    def test_name_contains_meeting_or_summarizer(self):
        name_lower = meeting_notes_summarizer.name.lower()
        assert "meeting" in name_lower or "summar" in name_lower or "notes" in name_lower

    def test_category_is_custom(self):
        assert meeting_notes_summarizer.category == TemplateCategory.custom

    def test_version_semver(self):
        parts = meeting_notes_summarizer.version.split(".")
        assert len(parts) == 3
        assert all(p.isdigit() for p in parts)

    def test_description_non_empty(self):
        assert len(meeting_notes_summarizer.description) > 20


# ---------------------------------------------------------------------------
# Config fields
# ---------------------------------------------------------------------------

class TestConfigFields:
    def setup_method(self):
        self.fields = {f.key: f for f in meeting_notes_summarizer.config_fields}

    def test_has_delivery_channels(self):
        assert "deliveryChannels" in self.fields

    def test_delivery_channels_not_required(self):
        assert self.fields["deliveryChannels"].required is False

    def test_delivery_channels_has_list_default(self):
        default = self.fields["deliveryChannels"].default_value
        assert default is not None
        assert isinstance(default, list)
        assert len(default) > 0

    def test_delivery_channels_options_include_slack_and_email(self):
        opts = self.fields["deliveryChannels"].options
        assert opts is not None
        assert "slack" in opts
        assert "email" in opts

    def test_has_slack_channel(self):
        assert "slackChannel" in self.fields

    def test_slack_channel_not_required(self):
        assert self.fields["slackChannel"].required is False

    def test_slack_channel_has_string_default(self):
        default = self.fields["slackChannel"].default_value
        assert isinstance(default, str)
        assert len(default) > 0

    def test_has_summary_language(self):
        assert "summaryLanguage" in self.fields

    def test_summary_language_has_default(self):
        assert self.fields["summaryLanguage"].default_value is not None

    def test_has_include_verbatim_quotes(self):
        assert "includeVerbatimQuotes" in self.fields

    def test_include_verbatim_quotes_is_boolean(self):
        assert self.fields["includeVerbatimQuotes"].type == FieldType.boolean

    def test_include_verbatim_quotes_has_boolean_default(self):
        default = self.fields["includeVerbatimQuotes"].default_value
        assert isinstance(default, bool)

    def test_non_required_fields_have_defaults(self):
        for field in meeting_notes_summarizer.config_fields:
            if not field.required:
                assert field.default_value is not None, (
                    f"Non-required field '{field.key}' must have a default_value"
                )


# ---------------------------------------------------------------------------
# Step structure
# ---------------------------------------------------------------------------

class TestSteps:
    def setup_method(self):
        self.steps = meeting_notes_summarizer.steps
        self.steps_by_id = {s.id: s for s in self.steps}

    def test_at_least_four_steps(self):
        assert len(self.steps) >= 4

    def test_first_step_is_trigger(self):
        assert self.steps[0].kind == StepKind.trigger

    def test_last_step_is_output(self):
        assert self.steps[-1].kind == StepKind.output

    def test_trigger_outputs_transcript_fields(self):
        trigger = self.steps[0]
        for key in ("meetingId", "transcript", "attendees"):
            assert key in trigger.output_keys, (
                f"Expected '{key}' in trigger outputKeys"
            )

    def test_has_summarise_step(self):
        assert "step_summarise" in self.steps_by_id

    def test_summarise_is_llm(self):
        assert self.steps_by_id["step_summarise"].kind == StepKind.llm

    def test_summarise_outputs_executive_summary(self):
        assert "executiveSummary" in self.steps_by_id["step_summarise"].output_keys

    def test_summarise_outputs_key_points(self):
        assert "keyPoints" in self.steps_by_id["step_summarise"].output_keys

    def test_summarise_outputs_decisions(self):
        assert "decisions" in self.steps_by_id["step_summarise"].output_keys

    def test_summarise_prompt_contains_transcript_placeholder(self):
        prompt = self.steps_by_id["step_summarise"].prompt_template
        assert prompt is not None
        assert "{{transcript}}" in prompt

    def test_has_extract_actions_step(self):
        assert "step_extract_actions" in self.steps_by_id

    def test_extract_actions_is_llm(self):
        assert self.steps_by_id["step_extract_actions"].kind == StepKind.llm

    def test_extract_actions_outputs_action_items(self):
        assert "actionItems" in self.steps_by_id["step_extract_actions"].output_keys

    def test_extract_actions_prompt_references_transcript(self):
        prompt = self.steps_by_id["step_extract_actions"].prompt_template
        assert prompt is not None
        assert "{{transcript}}" in prompt

    def test_has_distribute_step(self):
        assert "step_distribute" in self.steps_by_id

    def test_distribute_is_action(self):
        assert self.steps_by_id["step_distribute"].kind == StepKind.action

    def test_distribute_outputs_delivered_to(self):
        assert "deliveredTo" in self.steps_by_id["step_distribute"].output_keys

    def test_at_least_two_llm_steps(self):
        llm_steps = [s for s in self.steps if s.kind == StepKind.llm]
        assert len(llm_steps) >= 2

    def test_all_llm_steps_have_prompt_templates(self):
        llm_steps = [s for s in self.steps if s.kind == StepKind.llm]
        for step in llm_steps:
            assert step.prompt_template is not None, (
                f"LLM step '{step.id}' is missing prompt_template"
            )
            assert len(step.prompt_template) > 0

    def test_step_ids_are_unique(self):
        ids = [s.id for s in self.steps]
        assert len(set(ids)) == len(ids)

    def test_step_wiring_no_missing_inputs(self):
        """Every step's inputKeys must be produced by a prior step or a config field."""
        available_keys: set[str] = set()
        config_keys = {f.key for f in meeting_notes_summarizer.config_fields}
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
        assert len(meeting_notes_summarizer.sample_input) > 0

    def test_sample_input_has_meeting_id(self):
        assert "meetingId" in meeting_notes_summarizer.sample_input

    def test_sample_input_has_transcript(self):
        assert "transcript" in meeting_notes_summarizer.sample_input
        assert isinstance(meeting_notes_summarizer.sample_input["transcript"], str)
        assert len(meeting_notes_summarizer.sample_input["transcript"]) > 20

    def test_sample_input_has_attendees(self):
        assert "attendees" in meeting_notes_summarizer.sample_input
        assert isinstance(meeting_notes_summarizer.sample_input["attendees"], list)
        assert len(meeting_notes_summarizer.sample_input["attendees"]) > 0

    def test_sample_input_has_title(self):
        assert "title" in meeting_notes_summarizer.sample_input

    def test_expected_output_is_non_empty(self):
        assert len(meeting_notes_summarizer.expected_output) > 0

    def test_expected_output_has_action_items(self):
        assert "actionItems" in meeting_notes_summarizer.expected_output
        items = meeting_notes_summarizer.expected_output["actionItems"]
        assert isinstance(items, list)
        assert len(items) > 0

    def test_expected_output_action_items_have_required_fields(self):
        for item in meeting_notes_summarizer.expected_output["actionItems"]:
            assert "description" in item
            assert "owner" in item
            assert "priority" in item

    def test_expected_output_has_delivered_to(self):
        assert "deliveredTo" in meeting_notes_summarizer.expected_output
        assert isinstance(meeting_notes_summarizer.expected_output["deliveredTo"], list)

    def test_expected_output_has_event(self):
        assert "event" in meeting_notes_summarizer.expected_output
        assert isinstance(meeting_notes_summarizer.expected_output["event"], dict)
