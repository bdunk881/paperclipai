"""
Unit tests for the Social Media Scheduler template (Python).

Validates template structure, step wiring, config fields,
and sample data shape without requiring a live LLM or social API.
"""

from templates.social_media_scheduler import social_media_scheduler
from templates.schemas import StepKind, FieldType, TemplateCategory


# ---------------------------------------------------------------------------
# Top-level template metadata
# ---------------------------------------------------------------------------

class TestTemplateMetadata:
    def test_id(self):
        assert social_media_scheduler.id == "tpl-social-scheduler"

    def test_name_contains_social_or_scheduler(self):
        name_lower = social_media_scheduler.name.lower()
        assert "social" in name_lower or "scheduler" in name_lower or "schedule" in name_lower

    def test_category_is_content(self):
        assert social_media_scheduler.category == TemplateCategory.content

    def test_version_semver(self):
        parts = social_media_scheduler.version.split(".")
        assert len(parts) == 3
        assert all(p.isdigit() for p in parts)

    def test_description_non_empty(self):
        assert len(social_media_scheduler.description) > 20


# ---------------------------------------------------------------------------
# Config fields
# ---------------------------------------------------------------------------

class TestConfigFields:
    def setup_method(self):
        self.fields = {f.key: f for f in social_media_scheduler.config_fields}

    def test_has_brand_voice(self):
        assert "brandVoice" in self.fields

    def test_brand_voice_is_required(self):
        assert self.fields["brandVoice"].required is True

    def test_brand_voice_is_string(self):
        assert self.fields["brandVoice"].type == FieldType.string

    def test_brand_voice_has_options(self):
        opts = self.fields["brandVoice"].options
        assert opts is not None
        assert len(opts) >= 2

    def test_has_platforms(self):
        assert "platforms" in self.fields

    def test_platforms_not_required(self):
        assert self.fields["platforms"].required is False

    def test_platforms_has_default_value(self):
        default = self.fields["platforms"].default_value
        assert default is not None
        assert isinstance(default, list)
        assert len(default) > 0

    def test_platforms_options_include_common_channels(self):
        opts = self.fields["platforms"].options
        assert opts is not None
        known = {"twitter", "linkedin", "instagram", "facebook", "tiktok"}
        assert any(o in known for o in opts)

    def test_has_posts_per_platform(self):
        assert "postsPerPlatform" in self.fields

    def test_posts_per_platform_is_number(self):
        assert self.fields["postsPerPlatform"].type == FieldType.number

    def test_posts_per_platform_has_positive_default(self):
        default = self.fields["postsPerPlatform"].default_value
        assert isinstance(default, (int, float))
        assert default >= 1

    def test_has_hashtag_strategy(self):
        assert "hashtagStrategy" in self.fields

    def test_hashtag_strategy_not_required(self):
        assert self.fields["hashtagStrategy"].required is False

    def test_hashtag_strategy_has_default(self):
        assert self.fields["hashtagStrategy"].default_value is not None

    def test_non_required_fields_have_defaults(self):
        for field in social_media_scheduler.config_fields:
            if not field.required:
                assert field.default_value is not None, (
                    f"Non-required field '{field.key}' must have a default_value"
                )


# ---------------------------------------------------------------------------
# Step structure
# ---------------------------------------------------------------------------

class TestSteps:
    def setup_method(self):
        self.steps = social_media_scheduler.steps
        self.steps_by_id = {s.id: s for s in self.steps}

    def test_at_least_four_steps(self):
        assert len(self.steps) >= 4

    def test_first_step_is_trigger(self):
        assert self.steps[0].kind == StepKind.trigger

    def test_last_step_is_output(self):
        assert self.steps[-1].kind == StepKind.output

    def test_trigger_outputs_campaign_fields(self):
        trigger = self.steps[0]
        for key in ("campaignName", "topic", "audience"):
            assert key in trigger.output_keys, (
                f"Expected '{key}' in trigger outputKeys"
            )

    def test_has_strategy_step(self):
        assert "step_strategy" in self.steps_by_id

    def test_strategy_is_llm(self):
        assert self.steps_by_id["step_strategy"].kind == StepKind.llm

    def test_strategy_outputs_schedule_plan(self):
        assert "schedulePlan" in self.steps_by_id["step_strategy"].output_keys

    def test_strategy_prompt_contains_campaign_placeholder(self):
        prompt = self.steps_by_id["step_strategy"].prompt_template
        assert prompt is not None
        assert "{{campaignName}}" in prompt or "{{topic}}" in prompt

    def test_has_generate_posts_step(self):
        assert "step_generate_posts" in self.steps_by_id

    def test_generate_posts_is_llm(self):
        assert self.steps_by_id["step_generate_posts"].kind == StepKind.llm

    def test_generate_posts_outputs_posts(self):
        assert "posts" in self.steps_by_id["step_generate_posts"].output_keys

    def test_generate_posts_prompt_contains_brand_voice_placeholder(self):
        prompt = self.steps_by_id["step_generate_posts"].prompt_template
        assert prompt is not None
        assert "{{brandVoice}}" in prompt

    def test_has_schedule_step(self):
        assert "step_schedule" in self.steps_by_id

    def test_schedule_is_action(self):
        assert self.steps_by_id["step_schedule"].kind == StepKind.action

    def test_schedule_outputs_schedule_ids(self):
        assert "scheduleIds" in self.steps_by_id["step_schedule"].output_keys

    def test_schedule_outputs_total_scheduled(self):
        assert "totalScheduled" in self.steps_by_id["step_schedule"].output_keys

    def test_step_ids_are_unique(self):
        ids = [s.id for s in self.steps]
        assert len(set(ids)) == len(ids)

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

    def test_step_wiring_no_missing_inputs(self):
        """Every step's inputKeys must be produced by a prior step or a config field."""
        available_keys: set[str] = set()
        config_keys = {f.key for f in social_media_scheduler.config_fields}
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
        assert len(social_media_scheduler.sample_input) > 0

    def test_sample_input_has_campaign_name(self):
        assert "campaignName" in social_media_scheduler.sample_input
        assert isinstance(social_media_scheduler.sample_input["campaignName"], str)

    def test_sample_input_has_topic(self):
        assert "topic" in social_media_scheduler.sample_input
        assert isinstance(social_media_scheduler.sample_input["topic"], str)

    def test_sample_input_has_audience(self):
        assert "audience" in social_media_scheduler.sample_input

    def test_sample_input_has_date_range(self):
        assert "startDate" in social_media_scheduler.sample_input
        assert "endDate" in social_media_scheduler.sample_input

    def test_expected_output_is_non_empty(self):
        assert len(social_media_scheduler.expected_output) > 0

    def test_expected_output_has_total_scheduled(self):
        assert "totalScheduled" in social_media_scheduler.expected_output
        assert isinstance(social_media_scheduler.expected_output["totalScheduled"], (int, float))
        assert social_media_scheduler.expected_output["totalScheduled"] > 0

    def test_expected_output_has_schedule_ids(self):
        assert "scheduleIds" in social_media_scheduler.expected_output
        assert isinstance(social_media_scheduler.expected_output["scheduleIds"], list)

    def test_expected_output_has_event(self):
        assert "event" in social_media_scheduler.expected_output
        assert isinstance(social_media_scheduler.expected_output["event"], dict)
