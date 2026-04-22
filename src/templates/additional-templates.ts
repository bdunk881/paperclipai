import { WorkflowTemplate } from "../types/workflow";
import { createPipelineTemplate } from "./templateFactory";

export const crmPipelineTemplate: WorkflowTemplate = createPipelineTemplate({
  id: "tpl-crm-pipeline",
  name: "CRM Pipeline Manager",
  description:
    "Normalizes inbound opportunity updates, scores urgency, and routes them into the right CRM pipeline stage.",
  category: "sales",
  inputLabel: "Opportunity Update",
  inputKey: "opportunityPayload",
  primaryEntity: "Opportunity",
  objective: "pipeline hygiene and routing",
  system: "CRM",
  destination: "crm_pipeline",
  action: "crm.pipelineRoute",
  scoreLabel: "Deal Priority Threshold",
  scoreKey: "dealPriorityScore",
});

export const emailCampaignTemplate: WorkflowTemplate = createPipelineTemplate({
  id: "tpl-email-campaign",
  name: "Email Campaign Orchestrator",
  description:
    "Turns campaign briefs into send-ready email sequences, scoring confidence before scheduling delivery.",
  category: "marketing",
  inputLabel: "Campaign Brief",
  inputKey: "campaignBrief",
  primaryEntity: "Campaign",
  objective: "campaign drafting and scheduling",
  system: "ESP",
  destination: "email_campaigns",
  action: "email.scheduleCampaign",
  scoreLabel: "Send Readiness Threshold",
  scoreKey: "sendReadinessScore",
});

export const slackNotificationTemplate: WorkflowTemplate = createPipelineTemplate({
  id: "tpl-slack-notify",
  name: "Slack Notification Router",
  description:
    "Summarizes event payloads and posts them to the correct Slack audience with escalation routing.",
  category: "operations",
  inputLabel: "Notification Event",
  inputKey: "notificationPayload",
  primaryEntity: "Event",
  objective: "team notification routing",
  system: "Slack",
  destination: "slack_alerts",
  action: "slack.dispatchNotification",
  scoreLabel: "Escalation Threshold",
  scoreKey: "escalationScore",
});

export const githubIssueTriageTemplate: WorkflowTemplate = createPipelineTemplate({
  id: "tpl-github-triage",
  name: "GitHub Issue Triage",
  description:
    "Classifies inbound GitHub issues, sets urgency, and routes them to the correct engineering queue.",
  category: "engineering",
  inputLabel: "GitHub Issue",
  inputKey: "issuePayload",
  primaryEntity: "Issue",
  objective: "engineering triage",
  system: "GitHub",
  destination: "engineering_triage",
  action: "github.triageIssue",
  scoreLabel: "Severity Threshold",
  scoreKey: "severityScore",
});

export const invoiceProcessingTemplate: WorkflowTemplate = createPipelineTemplate({
  id: "tpl-invoice-processing",
  name: "Invoice Processing",
  description:
    "Extracts invoice details, scores confidence, and pushes records into finance review or auto-booking.",
  category: "finance",
  inputLabel: "Invoice Document",
  inputKey: "invoicePayload",
  primaryEntity: "Invoice",
  objective: "invoice extraction and booking",
  system: "ERP",
  destination: "finance_ops",
  action: "finance.processInvoice",
  scoreLabel: "Auto-Book Threshold",
  scoreKey: "autoBookScore",
});

export const leadScoringTemplate: WorkflowTemplate = createPipelineTemplate({
  id: "tpl-lead-scoring",
  name: "Lead Scoring",
  description:
    "Scores inbound leads against the ICP, then routes them to nurture or immediate follow-up.",
  category: "sales",
  inputLabel: "Lead Snapshot",
  inputKey: "leadPayload",
  primaryEntity: "Lead",
  objective: "sales qualification",
  system: "CRM",
  destination: "lead_scoring",
  action: "crm.scoreLead",
  scoreLabel: "MQL Threshold",
  scoreKey: "mqlScore",
});

export const customerOnboardingTemplate: WorkflowTemplate = createPipelineTemplate({
  id: "tpl-customer-onboarding",
  name: "Customer Onboarding",
  description:
    "Generates onboarding plans, scores implementation risk, and routes new customers into the right success motions.",
  category: "operations",
  inputLabel: "Customer Profile",
  inputKey: "customerPayload",
  primaryEntity: "Customer",
  objective: "onboarding orchestration",
  system: "CSM",
  destination: "customer_onboarding",
  action: "success.launchOnboarding",
  scoreLabel: "Risk Threshold",
  scoreKey: "riskScore",
});

export const socialMonitoringTemplate: WorkflowTemplate = createPipelineTemplate({
  id: "tpl-social-monitoring",
  name: "Social Monitoring",
  description:
    "Summarizes social mentions, scores brand risk, and routes high-priority mentions into response workflows.",
  category: "marketing",
  inputLabel: "Social Mention Batch",
  inputKey: "mentionPayload",
  primaryEntity: "Mention",
  objective: "brand monitoring",
  system: "Social Hub",
  destination: "social_monitoring",
  action: "social.routeMention",
  scoreLabel: "Response Threshold",
  scoreKey: "responsePriorityScore",
});

export const supportTicketRoutingTemplate: WorkflowTemplate = createPipelineTemplate({
  id: "tpl-support-routing",
  name: "Support Ticket Routing",
  description:
    "Analyzes support requests and routes them to the correct team, queue, and SLA path.",
  category: "support",
  inputLabel: "Support Request",
  inputKey: "supportPayload",
  primaryEntity: "Support Ticket",
  objective: "support queue routing",
  system: "Helpdesk",
  destination: "support_routing",
  action: "support.routeTicket",
  scoreLabel: "Escalation Threshold",
  scoreKey: "routingConfidenceScore",
});

export const dataSyncTemplate: WorkflowTemplate = createPipelineTemplate({
  id: "tpl-data-sync",
  name: "Data Sync Reconciler",
  description:
    "Compares upstream data changes, scores sync risk, and routes them into safe reconciliation paths.",
  category: "operations",
  inputLabel: "Sync Delta",
  inputKey: "syncPayload",
  primaryEntity: "Sync Change",
  objective: "data reconciliation",
  system: "Data Warehouse",
  destination: "data_sync",
  action: "data.reconcileDelta",
  scoreLabel: "Conflict Threshold",
  scoreKey: "conflictRiskScore",
});

export const ADDITIONAL_WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  crmPipelineTemplate,
  emailCampaignTemplate,
  slackNotificationTemplate,
  githubIssueTriageTemplate,
  invoiceProcessingTemplate,
  leadScoringTemplate,
  customerOnboardingTemplate,
  socialMonitoringTemplate,
  supportTicketRoutingTemplate,
  dataSyncTemplate,
];
