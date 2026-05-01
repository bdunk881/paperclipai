"""
Domain-specific tests for the Content Generator template (Python).

Validates the template structure, step wiring, config fields,
and sample data shape without requiring a live LLM.
"""

from templates.content_generator import content_generator
from templates.schemas import StepKind, FieldType, TemplateCategory


# ---------------------------------------------------------------------------
# Top-level template metadata
# ---------------------------------------------------------------------------

class TestTemplateMetadata:
    def test_id(self):
        assert content_generator.id == "tpl-content-gen"

    def test_name_contains_content(self):
        assert "content" in content_generator.name.lower() or "generator" in content_generator.name.lower()

    def test_category_is_content(self):
        assert content_generator.category == TemplateCategory.content

    def test_version_semver(self):
        parts = content_generator.version.split(".")
        assert len(parts) == 3
        assert all(p.isdigit() for p in parts)

    def test_description_non_empty(self):
        assert len(content_generator.description) > 20


# ---------------------------------------------------------------------------
# Config fields
# ---------------------------------------------------------------------------

class TestConfigFields:
    def setup_method(self):
        self.fields = {f.key: f for f in content_generator.config_fields}

    def test_has_brand_voice(self):
        assert "brandVoice" in self.fields
        field = self.fields["brandVoice"]
        assert field.required is True
        assert field.type == FieldType.string
        assert field.options is not None
        assert "authoritative" in field.options

    def test_brand_voice_has_multiple_options(self):
        options = self.fields["brandVoice"].options
        assert len(options) >= 3

    def test_has_target_word_count(self):
        assert "targetWordCount" in self.fields
        field = self.fields["targetWordCount"]
        assert field.required is False
        assert field.type == FieldType.number
        assert field.default_value is not None
        assert isinstance(field.default_value, int)

    def test_target_word_count_reasonable_default(self):
        default = self.fields["targetWordCount"].default_value
        assert 200 <= default <= 5000

    def test_has_output_formats(self):
        assert "outputFormats" in self.fields
        field = self.fields["outputFormats"]
        assert field.required is False
        assert isinstance(field.default_value, list)
        assert len(field.default_value) > 0

    def test_has_seo_focus(self):
        assert "seoFocus" in self.fields
        field = self.fields["seoFocus"]
        assert field.required is False
        assert field.type == FieldType.boolean

    def test_non_required_fields_have_defaults(self):
        for field in content_generator.config_fields:
            if not field.required:
                assert field.default_value is not None, (
                    f"Non-required field '{field.key}' must have a default_value"
                )


# ---------------------------------------------------------------------------
# Step structure
# ---------------------------------------------------------------------------

class TestSteps:
    def setup_method(self):
        self.steps = content_generator.steps
        self.steps_by_id = {s.id: s for s in self.steps}

    def test_at_least_four_steps(self):
        assert len(self.steps) >= 4

    def test_first_step_is_trigger(self):
        assert self.steps[0].kind == StepKind.trigger

    def test_last_step_is_output(self):
        assert self.steps[-1].kind == StepKind.output

    def test_trigger_outputs_brief_fields(self):
        trigger = self.steps[0]
        for key in ("topic", "keywords", "audience"):
            assert key in trigger.output_keys

    def test_has_outline_step(self):
        assert "step_outline" in self.steps_by_id

    def test_outline_is_llm(self):
        assert self.steps_by_id["step_outline"].kind == StepKind.llm

    def test_outline_outputs_outline_and_meta(self):
        outline = self.steps_by_id["step_outline"]
        assert "outline" in outline.output_keys
        assert "metaDescription" in outline.output_keys

    def test_outline_has_prompt_template(self):
        prompt = self.steps_by_id["step_outline"].prompt_template
        assert prompt is not None
        assert len(prompt) > 0

    def test_outline_prompt_contains_topic_placeholder(self):
        prompt = self.steps_by_id["step_outline"].prompt_template
        assert "{{topic}}" in prompt

    def test_has_draft_step(self):
        assert "step_draft" in self.steps_by_id

    def test_draft_is_llm(self):
        assert self.steps_by_id["step_draft"].kind == StepKind.llm

    def test_draft_outputs_blog_post(self):
        assert "blogPost" in self.steps_by_id["step_draft"].output_keys

    def test_draft_prompt_contains_brand_voice_placeholder(self):
        prompt = self.steps_by_id["step_draft"].prompt_template
        assert prompt is not None
        assert "{{brandVoice}}" in prompt

    def test_has_social_step(self):
        assert "step_social" in self.steps_by_id

    def test_social_is_llm(self):
        assert self.steps_by_id["step_social"].kind == StepKind.llm

    def test_social_outputs_tweet_and_linkedin(self):
        social = self.steps_by_id["step_social"]
        assert "tweet" in social.output_keys
        assert "linkedinPost" in social.output_keys

    def test_has_format_step(self):
        assert "step_format" in self.steps_by_id

    def test_format_is_transform(self):
        assert self.steps_by_id["step_format"].kind == StepKind.transform

    def test_format_outputs_formatted_post(self):
        assert "formattedPost" in self.steps_by_id["step_format"].output_keys

    def test_output_step_takes_all_assets(self):
        output = self.steps[-1]
        assert "formattedPost" in output.input_keys
        assert "tweet" in output.input_keys
        assert "linkedinPost" in output.input_keys

    def test_step_ids_are_unique(self):
        ids = [s.id for s in self.steps]
        assert len(set(ids)) == len(ids)

    def test_all_llm_steps_have_prompt_templates(self):
        llm_steps = [s for s in self.steps if s.kind == StepKind.llm]
        assert len(llm_steps) >= 2
        for step in llm_steps:
            assert step.prompt_template is not None
            assert len(step.prompt_template) > 0

    def test_step_wiring_no_missing_inputs(self):
        """Every step's inputKeys must be produced by a prior step or a config field."""
        available_keys: set[str] = set()
        config_keys = {f.key for f in content_generator.config_fields}
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
        assert len(content_generator.sample_input) > 0

    def test_sample_input_has_topic(self):
        assert "topic" in content_generator.sample_input
        assert isinstance(content_generator.sample_input["topic"], str)

    def test_sample_input_has_keywords(self):
        assert "keywords" in content_generator.sample_input
        assert isinstance(content_generator.sample_input["keywords"], list)

    def test_sample_input_has_audience(self):
        assert "audience" in content_generator.sample_input

    def test_expected_output_is_non_empty(self):
        assert len(content_generator.expected_output) > 0

    def test_expected_output_has_blog_post(self):
        assert "blogPost" in content_generator.expected_output

    def test_expected_output_has_tweet(self):
        assert "tweet" in content_generator.expected_output

    def test_expected_output_has_queue_id(self):
        assert "queueId" in content_generator.expected_output
