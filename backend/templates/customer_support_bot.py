"""
Template: Customer Support Bot

Ingests support tickets, classifies intent, auto-responds to common issues,
and escalates complex ones to a human agent.
"""

from .schemas import (
    ConfigField,
    FieldType,
    StepKind,
    TemplateCategory,
    WorkflowStep,
    WorkflowTemplate,
)

customer_support_bot = WorkflowTemplate(
    id="tpl-support-bot",
    name="Customer Support Bot",
    description=(
        "Automatically classifies incoming support tickets, drafts responses "
        "for common issues, and escalates complex cases to your support team."
    ),
    category=TemplateCategory.support,
    version="1.0.0",
    config_fields=[
        ConfigField(
            key="brandName",
            label="Brand / Product Name",
            type=FieldType.string,
            required=True,
            description="Used to personalise AI-generated responses.",
        ),
        ConfigField(
            key="escalationEmail",
            label="Escalation Email",
            type=FieldType.string,
            required=True,
            description="Email address to receive complex ticket escalations.",
        ),
        ConfigField(
            key="autoRespondCategories",
            label="Auto-respond Categories",
            type=FieldType.string_list,
            required=False,
            default_value=["general", "billing"],
            options=["general", "billing", "refund", "bug"],
            description="Ticket categories that receive an automatic response.",
        ),
        ConfigField(
            key="escalateCategories",
            label="Escalate Categories",
            type=FieldType.string_list,
            required=False,
            default_value=["bug", "refund"],
            options=["general", "billing", "refund", "bug"],
            description="Ticket categories routed to human agents.",
        ),
        ConfigField(
            key="toneOfVoice",
            label="Response Tone",
            type=FieldType.string,
            required=False,
            default_value="professional and friendly",
            description="Tone used by the AI when drafting responses.",
        ),
    ],
    steps=[
        WorkflowStep(
            id="step_trigger",
            name="Receive Ticket",
            kind=StepKind.trigger,
            description="Accepts an inbound support ticket payload.",
            input_keys=[],
            output_keys=["ticketId", "customerEmail", "subject", "body", "channel"],
        ),
        WorkflowStep(
            id="step_classify",
            name="Classify Intent",
            kind=StepKind.llm,
            description=(
                "Sends the ticket body to the LLM to determine intent "
                "category and sentiment."
            ),
            input_keys=["subject", "body"],
            output_keys=["intent", "sentiment", "summary"],
            prompt_template=(
                "You are a support ticket classifier for {{brandName}}.\n\n"
                "Ticket subject: {{subject}}\n"
                "Ticket body: {{body}}\n\n"
                "Respond with a JSON object with these fields:\n"
                "- intent: one of 'general', 'billing', 'refund', 'bug'\n"
                "- sentiment: one of 'positive', 'neutral', 'frustrated', 'angry'\n"
                "- summary: one-sentence summary of the customer's issue\n\n"
                "Respond ONLY with the JSON object."
            ),
        ),
        WorkflowStep(
            id="step_route",
            name="Route Ticket",
            kind=StepKind.condition,
            description=(
                "Routes the ticket to auto-respond or escalate based on "
                "intent and configuration."
            ),
            input_keys=["intent"],
            output_keys=["shouldAutoRespond"],
            condition="autoRespondCategories.includes(intent)",
        ),
        WorkflowStep(
            id="step_draft_response",
            name="Draft Auto-Response",
            kind=StepKind.llm,
            description=(
                "Generates a helpful, on-brand response for tickets that "
                "qualify for auto-handling."
            ),
            input_keys=["brandName", "toneOfVoice", "summary", "customerEmail"],
            output_keys=["draftResponse"],
            prompt_template=(
                "You are a customer support agent for {{brandName}}. "
                "Your tone is {{toneOfVoice}}.\n\n"
                "Customer issue: {{summary}}\n\n"
                "Write a concise, empathetic email response that resolves or "
                "addresses their concern. "
                "Sign off as '{{brandName}} Support Team'.\n\n"
                "Respond with only the email body text."
            ),
        ),
        WorkflowStep(
            id="step_send_or_escalate",
            name="Send Response or Escalate",
            kind=StepKind.action,
            description=(
                "Either sends the AI-drafted response to the customer or "
                "escalates to a human agent queue."
            ),
            input_keys=[
                "shouldAutoRespond",
                "customerEmail",
                "draftResponse",
                "escalationEmail",
                "ticketId",
                "summary",
                "sentiment",
            ],
            output_keys=["resolution", "escalated"],
            action="support.sendOrEscalate",
        ),
        WorkflowStep(
            id="step_output",
            name="Emit Resolution",
            kind=StepKind.output,
            description="Records the ticket resolution for analytics and audit.",
            input_keys=["ticketId", "intent", "resolution", "escalated"],
            output_keys=["event"],
            action="events.emit",
        ),
    ],
    sample_input={
        "ticketId": "TKT-00147",
        "customerEmail": "alice@example.com",
        "subject": "Can't log into my account",
        "body": (
            "Hi, I've been trying to log in for the past hour but keep getting "
            "an 'invalid password' error even after resetting it. Please help!"
        ),
        "channel": "email",
    },
    expected_output={
        "ticketId": "TKT-00147",
        "intent": "general",
        "sentiment": "frustrated",
        "escalated": False,
        "resolution": "auto_responded",
        "event": {"type": "ticket.resolved", "channel": "email"},
    },
)
