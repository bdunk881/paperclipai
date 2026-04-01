"""
Template: Content Generator

Accepts a topic brief, generates a structured blog post outline, writes the
full draft, derives social media snippets, applies brand formatting, and
pushes all assets to the content queue.
"""

from .schemas import (
    ConfigField,
    FieldType,
    StepKind,
    TemplateCategory,
    WorkflowStep,
    WorkflowTemplate,
)

content_generator = WorkflowTemplate(
    id="tpl-content-gen",
    name="Content Generator",
    description=(
        "Generates SEO-optimised blog posts, social snippets, and email "
        "newsletters from a topic brief, then queues them for publication."
    ),
    category=TemplateCategory.content,
    version="1.0.0",
    configFields=[
        ConfigField(
            key="brandVoice",
            label="Brand Voice",
            type=FieldType.string,
            required=True,
            options=["authoritative", "playful", "technical", "conversational"],
            description="Writing style applied to all generated content.",
        ),
        ConfigField(
            key="targetWordCount",
            label="Target Word Count",
            type=FieldType.number,
            required=False,
            defaultValue=800,
            description="Approximate word count for the main blog post.",
        ),
        ConfigField(
            key="outputFormats",
            label="Output Formats",
            type=FieldType.string_list,
            required=False,
            defaultValue=["blog", "twitter", "linkedin"],
            options=["blog", "twitter", "linkedin", "email"],
            description="Content types to generate for each brief.",
        ),
        ConfigField(
            key="seoFocus",
            label="SEO Focus",
            type=FieldType.boolean,
            required=False,
            defaultValue=True,
            description=(
                "When enabled, the draft step optimises headings and "
                "meta description for search engines."
            ),
        ),
    ],
    steps=[
        WorkflowStep(
            id="step_trigger",
            name="Receive Brief",
            kind=StepKind.trigger,
            description="Topic brief submitted via API, form, or content calendar.",
            inputKeys=[],
            outputKeys=["topic", "keywords", "audience", "tone"],
        ),
        WorkflowStep(
            id="step_outline",
            name="Generate Outline",
            kind=StepKind.llm,
            description=(
                "Creates a structured H2/H3 outline with key talking points "
                "for each section."
            ),
            inputKeys=["topic", "keywords", "audience"],
            outputKeys=["outline", "metaDescription"],
            promptTemplate=(
                "You are a content strategist with expertise in SEO.\n\n"
                "Topic: {{topic}}\n"
                "Target audience: {{audience}}\n"
                "Keywords to include: {{keywords}}\n\n"
                "Create a detailed blog post outline with H2 and H3 headings "
                "and bullet-point talking points for each section.\n\n"
                "Also write a 155-character meta description for SEO.\n\n"
                "Respond with a JSON object:\n"
                "- outline: markdown string with the full outline\n"
                "- metaDescription: string\n\n"
                "Respond ONLY with the JSON object."
            ),
        ),
        WorkflowStep(
            id="step_draft",
            name="Write Draft",
            kind=StepKind.llm,
            description=(
                "Writes the complete blog post from the outline, matching "
                "the configured brand voice and target word count."
            ),
            inputKeys=["outline", "topic", "audience", "brandVoice", "targetWordCount", "seoFocus"],
            outputKeys=["blogPost"],
            promptTemplate=(
                "You are a {{brandVoice}} content writer.\n\n"
                "Write a ~{{targetWordCount}}-word blog post based on this outline:\n"
                "{{outline}}\n\n"
                "Topic: {{topic}}\n"
                "Audience: {{audience}}\n"
                "{% if seoFocus %}Optimise headings and structure for SEO.{% endif %}\n\n"
                "Write the complete post in markdown. Do not include a title in "
                "your response — the outline already defines it.\n\n"
                "Respond with only the markdown blog post body."
            ),
        ),
        WorkflowStep(
            id="step_social",
            name="Create Social Snippets",
            kind=StepKind.llm,
            description=(
                "Derives platform-native social media posts from the blog draft."
            ),
            inputKeys=["blogPost", "topic", "brandVoice"],
            outputKeys=["tweet", "linkedinPost"],
            promptTemplate=(
                "You are a {{brandVoice}} social media copywriter.\n\n"
                "Based on this blog post:\n{{blogPost}}\n\n"
                "Write:\n"
                "1. A Twitter/X thread starter (max 280 characters, punchy hook)\n"
                "2. A LinkedIn post (max 1300 characters, professional, includes "
                "   a call to action)\n\n"
                "Respond with a JSON object:\n"
                "- tweet: string\n"
                "- linkedinPost: string\n\n"
                "Respond ONLY with the JSON object."
            ),
        ),
        WorkflowStep(
            id="step_format",
            name="Apply Brand Formatting",
            kind=StepKind.transform,
            description=(
                "Applies brand templates: adds header/footer, internal links, "
                "and CTA blocks."
            ),
            inputKeys=["blogPost", "metaDescription", "topic"],
            outputKeys=["formattedPost"],
            action="content.applyBrandTemplate",
        ),
        WorkflowStep(
            id="step_output",
            name="Queue for Publication",
            kind=StepKind.output,
            description="Pushes all generated assets to the content publication queue.",
            inputKeys=["formattedPost", "tweet", "linkedinPost", "metaDescription"],
            outputKeys=["queueId"],
            action="content.queue",
        ),
    ],
    sampleInput={
        "topic": "AI Workflow Automation for Startups",
        "keywords": ["no-code", "automation", "productivity", "AI agents"],
        "audience": "startup founders",
        "tone": "inspiring",
    },
    expectedOutput={
        "blogPost": "...",
        "tweet": "...",
        "linkedinPost": "...",
        "queueId": "cq-00042",
    },
)
