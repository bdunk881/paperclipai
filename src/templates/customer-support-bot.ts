/**
 * Template: Customer Support Bot
 *
 * Ingests support tickets, classifies intent, auto-responds to common issues,
 * and escalates complex ones to a human agent.
 *
 * Steps:
 *   1. trigger     — Receive ticket via webhook or API
 *   2. llm         — Classify intent (refund / billing / bug / general)
 *   3. condition   — Route: common issue vs. complex
 *   4. llm         — Draft auto-response for common issues
 *   5. action      — Send response OR escalate to human queue
 *   6. output      — Emit resolution event
 */

import { WorkflowTemplate } from "../types/workflow";

export const customerSupportBot: WorkflowTemplate = {
  id: "tpl-support-bot",
  name: "Customer Support Bot",
  description:
    "Automatically classifies incoming support tickets, drafts responses for common issues, and escalates complex cases to your support team.",
  category: "support",
  version: "1.0.0",

  configFields: [
    {
      key: "brandName",
      label: "Brand / Product Name",
      type: "string",
      required: true,
      description: "Used to personalise AI-generated responses.",
    },
    {
      key: "escalationEmail",
      label: "Escalation Email",
      type: "string",
      required: true,
      description: "Email address to receive complex ticket escalations.",
    },
    {
      key: "autoRespondCategories",
      label: "Auto-respond Categories",
      type: "string[]",
      required: false,
      defaultValue: ["general", "billing"],
      options: ["general", "billing", "refund", "bug"],
      description: "Ticket categories that receive an automatic response.",
    },
    {
      key: "escalateCategories",
      label: "Escalate Categories",
      type: "string[]",
      required: false,
      defaultValue: ["bug", "refund"],
      options: ["general", "billing", "refund", "bug"],
      description: "Ticket categories routed to human agents.",
    },
    {
      key: "toneOfVoice",
      label: "Response Tone",
      type: "string",
      required: false,
      defaultValue: "professional and friendly",
      description: "Tone used by the AI when drafting responses.",
    },
  ],

  steps: [
    {
      id: "step_trigger",
      name: "Receive Ticket",
      kind: "trigger",
      description: "Accepts an inbound support ticket payload.",
      inputKeys: [],
      outputKeys: ["ticketId", "customerEmail", "subject", "body", "channel"],
    },
    {
      id: "step_classify",
      name: "Classify Intent",
      kind: "llm",
      description:
        "Sends the ticket body to the LLM to determine intent category and sentiment.",
      inputKeys: ["subject", "body"],
      outputKeys: ["intent", "sentiment", "summary"],
      promptTemplate:
        "You are a support ticket classifier for {{brandName}}.\n\n" +
        "Ticket subject: {{subject}}\n" +
        "Ticket body: {{body}}\n\n" +
        "Respond with a JSON object with these fields:\n" +
        "- intent: one of 'general', 'billing', 'refund', 'bug'\n" +
        "- sentiment: one of 'positive', 'neutral', 'frustrated', 'angry'\n" +
        "- summary: one-sentence summary of the customer's issue\n\n" +
        "Respond ONLY with the JSON object.",
    },
    {
      id: "step_route",
      name: "Route Ticket",
      kind: "condition",
      description:
        "Routes the ticket to auto-respond or escalate based on intent and configuration.",
      inputKeys: ["intent"],
      outputKeys: ["shouldAutoRespond"],
      condition: "autoRespondCategories.includes(intent)",
    },
    {
      id: "step_draft_response",
      name: "Draft Auto-Response",
      kind: "llm",
      description:
        "Generates a helpful, on-brand response for tickets that qualify for auto-handling.",
      inputKeys: ["brandName", "toneOfVoice", "summary", "customerEmail"],
      outputKeys: ["draftResponse"],
      promptTemplate:
        "You are a customer support agent for {{brandName}}. " +
        "Your tone is {{toneOfVoice}}.\n\n" +
        "Customer issue: {{summary}}\n\n" +
        "Write a concise, empathetic email response that resolves or addresses their concern. " +
        "Sign off as '{{brandName}} Support Team'.\n\n" +
        "Respond with only the email body text.",
    },
    {
      id: "step_send_or_escalate",
      name: "Send Response or Escalate",
      kind: "action",
      description:
        "Either sends the AI-drafted response to the customer or escalates to a human agent queue.",
      inputKeys: [
        "shouldAutoRespond",
        "customerEmail",
        "draftResponse",
        "escalationEmail",
        "ticketId",
        "summary",
        "sentiment",
      ],
      outputKeys: ["resolution", "escalated"],
      action: "support.sendOrEscalate",
    },
    {
      id: "step_output",
      name: "Emit Resolution",
      kind: "output",
      description: "Records the ticket resolution for analytics and audit.",
      inputKeys: ["ticketId", "intent", "resolution", "escalated"],
      outputKeys: ["event"],
      action: "events.emit",
    },
  ],

  sampleInput: {
    ticketId: "TKT-00147",
    customerEmail: "alice@example.com",
    subject: "Can't log into my account",
    body: "Hi, I've been trying to log in for the past hour but keep getting an 'invalid password' error even after resetting it. Please help!",
    channel: "email",
  },

  expectedOutput: {
    ticketId: "TKT-00147",
    intent: "general",
    sentiment: "frustrated",
    escalated: false,
    resolution: "auto_responded",
    event: {
      type: "ticket.resolved",
      channel: "email",
    },
  },
};
