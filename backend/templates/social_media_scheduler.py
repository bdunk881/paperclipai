"""
Template: Social Media Scheduler

Accepts a campaign brief, generates platform-native posts for multiple
channels using the LLM, schedules them to a publishing queue, and reports
the planned schedule back to the requester.
"""

from .schemas import (
    ConfigField,
    FieldType,
    StepKind,
    TemplateCategory,
    WorkflowStep,
    WorkflowTemplate,
)

social_media_scheduler = WorkflowTemplate(
    id="tpl-social-scheduler",
    name="Social Media Scheduler",
    description=(
        "Generates platform-native social media posts from a campaign brief "
        "and schedules them across your chosen channels."
    ),
    category=TemplateCategory.content,
    version="1.0.0",
    configFields=[
        ConfigField(
            key="brandVoice",
            label="Brand Voice",
            type=FieldType.string,
            required=True,
            options=["professional", "playful", "inspirational", "educational"],
            description="Tone used across all generated posts.",
        ),
        ConfigField(
            key="platforms",
            label="Target Platforms",
            type=FieldType.string_list,
            required=False,
            defaultValue=["twitter", "linkedin", "instagram"],
            options=["twitter", "linkedin", "instagram", "facebook", "tiktok"],
            description="Social channels to post on.",
        ),
        ConfigField(
            key="postsPerPlatform",
            label="Posts per Platform",
            type=FieldType.number,
            required=False,
            defaultValue=3,
            description="Number of posts to generate and schedule per channel.",
        ),
        ConfigField(
            key="hashtagStrategy",
            label="Hashtag Strategy",
            type=FieldType.string,
            required=False,
            defaultValue="moderate",
            options=["none", "minimal", "moderate", "aggressive"],
            description="How many hashtags to include in generated posts.",
        ),
    ],
    steps=[
        WorkflowStep(
            id="step_trigger",
            name="Receive Brief",
            kind=StepKind.trigger,
            description=(
                "Campaign brief submitted with topic, goals, target audience, "
                "and desired posting window."
            ),
            inputKeys=[],
            outputKeys=["campaignName", "topic", "audience", "goals", "startDate", "endDate"],
        ),
        WorkflowStep(
            id="step_strategy",
            name="Plan Content Strategy",
            kind=StepKind.llm,
            description=(
                "Produces a posting strategy: themes, post types, and "
                "a recommended schedule spread across the window."
            ),
            inputKeys=["campaignName", "topic", "audience", "goals", "startDate", "endDate", "platforms", "postsPerPlatform"],
            outputKeys=["contentThemes", "schedulePlan"],
            promptTemplate=(
                "You are a social media strategist.\n\n"
                "Campaign: {{campaignName}}\n"
                "Topic: {{topic}}\n"
                "Target audience: {{audience}}\n"
                "Goals: {{goals}}\n"
                "Posting window: {{startDate}} to {{endDate}}\n"
                "Platforms: {{platforms}}\n"
                "Posts per platform: {{postsPerPlatform}}\n\n"
                "Create a content strategy with:\n"
                "1. 3-5 content themes that support the goals\n"
                "2. A schedule plan: list of {platform, scheduledAt (ISO 8601), theme} "
                "objects spread evenly across the window\n\n"
                "Respond with a JSON object:\n"
                "- contentThemes: string[]\n"
                "- schedulePlan: array of {platform, scheduledAt, theme}\n\n"
                "Respond ONLY with the JSON object."
            ),
        ),
        WorkflowStep(
            id="step_generate_posts",
            name="Generate Posts",
            kind=StepKind.llm,
            description=(
                "Writes a platform-native post for each scheduled slot, "
                "respecting character limits and hashtag strategy."
            ),
            inputKeys=["schedulePlan", "topic", "audience", "brandVoice", "hashtagStrategy"],
            outputKeys=["posts"],
            promptTemplate=(
                "You are a {{brandVoice}} social media copywriter.\n\n"
                "Topic: {{topic}}\n"
                "Audience: {{audience}}\n"
                "Hashtag strategy: {{hashtagStrategy}}\n\n"
                "For each slot in the schedule plan below, write a post "
                "appropriate for that platform.\n"
                "Schedule plan: {{schedulePlan}}\n\n"
                "Platform character limits: twitter=280, linkedin=1300, "
                "instagram=2200, facebook=63206, tiktok=2200.\n\n"
                "Respond with a JSON object:\n"
                "- posts: array of {platform, scheduledAt, copy, hashtags}\n\n"
                "Respond ONLY with the JSON object."
            ),
        ),
        WorkflowStep(
            id="step_review_gate",
            name="Content Review Check",
            kind=StepKind.condition,
            description=(
                "Determines whether any post exceeds its platform character "
                "limit and needs a regeneration pass."
            ),
            inputKeys=["posts"],
            outputKeys=["allPostsValid"],
            condition="posts.every(p => p.copy.length <= platformLimit(p.platform))",
        ),
        WorkflowStep(
            id="step_schedule",
            name="Schedule Posts",
            kind=StepKind.action,
            description=(
                "Pushes each generated post to the social publishing queue "
                "at the planned scheduled time."
            ),
            inputKeys=["posts", "campaignName"],
            outputKeys=["scheduleIds", "totalScheduled"],
            action="social.schedulePosts",
        ),
        WorkflowStep(
            id="step_output",
            name="Emit Schedule Report",
            kind=StepKind.output,
            description=(
                "Records the scheduled campaign and returns a summary of "
                "post counts per platform."
            ),
            inputKeys=["campaignName", "scheduleIds", "totalScheduled", "startDate", "endDate"],
            outputKeys=["event"],
            action="events.emit",
        ),
    ],
    sampleInput={
        "campaignName": "Spring Product Launch",
        "topic": "Introducing AutoFlow 2.0 with AI-powered workflow automation",
        "audience": "startup founders and operations leads",
        "goals": "drive sign-ups for the beta waitlist",
        "startDate": "2024-04-01",
        "endDate": "2024-04-07",
    },
    expectedOutput={
        "totalScheduled": 9,
        "scheduleIds": ["sch-001", "sch-002", "sch-003"],
        "event": {"type": "campaign.scheduled", "campaignName": "Spring Product Launch"},
    },
)
