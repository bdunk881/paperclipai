"""
Template: Meeting Notes Summarizer

Accepts a meeting transcript (text or audio transcription), summarises key
discussion points, extracts action items with owners and due dates, and
distributes the summary to attendees via Slack and/or email.
"""

from .schemas import (
    ConfigField,
    FieldType,
    StepKind,
    TemplateCategory,
    WorkflowStep,
    WorkflowTemplate,
)

meeting_notes_summarizer = WorkflowTemplate(
    id="tpl-meeting-summarizer",
    name="Meeting Notes Summarizer",
    description=(
        "Transcribes or accepts meeting text, summarises key points and "
        "decisions, extracts action items with owners and due dates, and "
        "sends the notes to attendees via Slack and/or email."
    ),
    category=TemplateCategory.custom,
    version="1.0.0",
    configFields=[
        ConfigField(
            key="deliveryChannels",
            label="Delivery Channels",
            type=FieldType.string_list,
            required=False,
            defaultValue=["slack", "email"],
            options=["slack", "email"],
            description="Channels used to distribute the meeting summary.",
        ),
        ConfigField(
            key="slackChannel",
            label="Slack Channel",
            type=FieldType.string,
            required=False,
            defaultValue="#general",
            description=(
                "Slack channel to post the summary to (used when slack is "
                "in deliveryChannels)."
            ),
        ),
        ConfigField(
            key="summaryLanguage",
            label="Summary Language",
            type=FieldType.string,
            required=False,
            defaultValue="English",
            description="Language for the generated summary and action items.",
        ),
        ConfigField(
            key="includeVerbatimQuotes",
            label="Include Verbatim Quotes",
            type=FieldType.boolean,
            required=False,
            defaultValue=False,
            description=(
                "When enabled, the summary includes notable verbatim quotes "
                "from the transcript."
            ),
        ),
    ],
    steps=[
        WorkflowStep(
            id="step_trigger",
            name="Receive Transcript",
            kind=StepKind.trigger,
            description=(
                "Accepts a meeting transcript payload — either plain text "
                "or the output of a speech-to-text service."
            ),
            inputKeys=[],
            outputKeys=["meetingId", "title", "attendees", "transcript", "recordedAt"],
        ),
        WorkflowStep(
            id="step_summarise",
            name="Summarise Discussion",
            kind=StepKind.llm,
            description=(
                "Produces a structured summary with an executive overview, "
                "key discussion points, and notable decisions."
            ),
            inputKeys=["title", "transcript", "attendees", "summaryLanguage", "includeVerbatimQuotes"],
            outputKeys=["executiveSummary", "keyPoints", "decisions", "verbatimQuotes"],
            promptTemplate=(
                "You are an expert meeting facilitator and note-taker.\n\n"
                "Meeting title: {{title}}\n"
                "Attendees: {{attendees}}\n"
                "Language: {{summaryLanguage}}\n\n"
                "Transcript:\n{{transcript}}\n\n"
                "Produce a structured summary. "
                "{% if includeVerbatimQuotes %}Include up to 3 notable verbatim quotes.{% endif %}\n\n"
                "Respond with a JSON object:\n"
                "- executiveSummary: 2-3 sentence overview\n"
                "- keyPoints: string[] (bullet-point discussion topics)\n"
                "- decisions: string[] (decisions made during the meeting)\n"
                "- verbatimQuotes: string[] (notable quotes, empty array if not requested)\n\n"
                "Respond ONLY with the JSON object."
            ),
        ),
        WorkflowStep(
            id="step_extract_actions",
            name="Extract Action Items",
            kind=StepKind.llm,
            description=(
                "Identifies all commitments and follow-ups from the transcript, "
                "assigning an owner and inferred due date to each."
            ),
            inputKeys=["transcript", "attendees", "recordedAt", "summaryLanguage"],
            outputKeys=["actionItems"],
            promptTemplate=(
                "You are an expert at extracting action items from meeting transcripts.\n\n"
                "Attendees: {{attendees}}\n"
                "Meeting date: {{recordedAt}}\n"
                "Language: {{summaryLanguage}}\n\n"
                "Transcript:\n{{transcript}}\n\n"
                "Extract every commitment, task, or follow-up mentioned.\n\n"
                "Respond with a JSON object:\n"
                "- actionItems: array of {description, owner, dueDate (ISO 8601 or null), priority ('high'|'medium'|'low')}\n\n"
                "Respond ONLY with the JSON object."
            ),
        ),
        WorkflowStep(
            id="step_has_actions",
            name="Check for Action Items",
            kind=StepKind.condition,
            description="Skips distribution if no action items were found.",
            inputKeys=["actionItems"],
            outputKeys=["hasActionItems"],
            condition="actionItems.length > 0",
        ),
        WorkflowStep(
            id="step_format_notes",
            name="Format Meeting Notes",
            kind=StepKind.transform,
            description=(
                "Assembles the summary, decisions, and action items into a "
                "formatted markdown document ready for distribution."
            ),
            inputKeys=[
                "title",
                "recordedAt",
                "attendees",
                "executiveSummary",
                "keyPoints",
                "decisions",
                "actionItems",
                "verbatimQuotes",
            ],
            outputKeys=["formattedNotes", "slackBlocks"],
            action="notes.formatMarkdown",
        ),
        WorkflowStep(
            id="step_distribute",
            name="Distribute Notes",
            kind=StepKind.action,
            description=(
                "Sends the formatted notes to configured Slack channels and/or "
                "attendee email addresses."
            ),
            inputKeys=[
                "deliveryChannels",
                "slackChannel",
                "attendees",
                "formattedNotes",
                "slackBlocks",
                "title",
            ],
            outputKeys=["distributionIds", "deliveredTo"],
            action="notes.distribute",
        ),
        WorkflowStep(
            id="step_output",
            name="Emit Summary Event",
            kind=StepKind.output,
            description="Records the meeting summary for search and audit.",
            inputKeys=[
                "meetingId",
                "title",
                "actionItems",
                "distributionIds",
                "deliveredTo",
            ],
            outputKeys=["event"],
            action="events.emit",
        ),
    ],
    sampleInput={
        "meetingId": "mtg-00214",
        "title": "Q2 Product Roadmap Review",
        "attendees": ["alice@example.com", "bob@example.com", "carol@example.com"],
        "transcript": (
            "Alice: Let's kick off the Q2 roadmap review. Bob, can you walk us "
            "through the pipeline status?\n"
            "Bob: Sure. We're on track for the v2 launch. The main blocker is the "
            "payment integration — I'll have that unblocked by Friday.\n"
            "Carol: We also need to finalise the pricing page copy. I can handle "
            "that by end of next week.\n"
            "Alice: Great. Let's agree: v2 ships April 28. Bob owns payment "
            "integration by April 4, Carol owns pricing copy by April 11.\n"
            "Bob: Agreed. One more thing — we should run a beta test with 10 "
            "customers before the public launch.\n"
            "Alice: Good call. I'll set that up by April 18."
        ),
        "recordedAt": "2024-04-02T14:00:00Z",
    },
    expectedOutput={
        "actionItems": [
            {"description": "Unblock payment integration", "owner": "bob@example.com", "dueDate": "2024-04-04", "priority": "high"},
            {"description": "Finalise pricing page copy", "owner": "carol@example.com", "dueDate": "2024-04-11", "priority": "medium"},
            {"description": "Set up beta test with 10 customers", "owner": "alice@example.com", "dueDate": "2024-04-18", "priority": "medium"},
        ],
        "deliveredTo": ["#general", "alice@example.com", "bob@example.com", "carol@example.com"],
        "event": {"type": "meeting.summarised", "meetingId": "mtg-00214"},
    },
)
