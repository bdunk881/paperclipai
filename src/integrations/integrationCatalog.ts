/**
 * API Integration Catalog — 34 curated REST/webhook integrations across 15 verticals.
 *
 * Each entry is a complete IntegrationManifest that the framework uses to:
 *  - Render the connection wizard UI
 *  - Build authenticated HTTP requests
 *  - Register webhook relay endpoints
 *
 * Add new integrations here without any other code changes (config-driven registry).
 */

import {
  IntegrationManifest,
  IntegrationCategory,
} from "./integrationManifest";

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------

const salesforce: IntegrationManifest = {
  slug: "salesforce",
  name: "Salesforce",
  description: "Create and update leads, contacts, opportunities, and accounts in Salesforce CRM.",
  category: "crm",
  icon: "salesforce",
  authKind: "oauth2_pkce",
  oauth2Config: {
    authorizationUrl: "https://login.salesforce.com/services/oauth2/authorize",
    tokenUrl: "https://login.salesforce.com/services/oauth2/token",
    scopes: ["api", "refresh_token", "offline_access"],
    clientIdHint: "Connected App Consumer Key",
    clientSecretHint: "Connected App Consumer Secret",
  },
  baseUrl: "https://{{instanceDomain}}.salesforce.com",
  setupInstructions:
    "1. In Salesforce Setup, navigate to App Manager → New Connected App.\n" +
    "2. Enable OAuth settings and add the AutoFlow callback URL.\n" +
    "3. Copy the Consumer Key and Consumer Secret.\n" +
    "4. Enter your Salesforce instance domain (e.g. 'mycompany' for mycompany.salesforce.com).",
  actions: [
    {
      id: "contacts.create",
      name: "Create Contact",
      description: "Create a new contact record",
      method: "POST",
      path: "/services/data/v59.0/sobjects/Contact",
      inputSchema: [
        { key: "FirstName", label: "First Name", type: "string", required: false },
        { key: "LastName", label: "Last Name", type: "string", required: true },
        { key: "Email", label: "Email", type: "string", required: false },
        { key: "Phone", label: "Phone", type: "string", required: false },
        { key: "AccountId", label: "Account ID", type: "string", required: false },
      ],
      outputKeys: ["id", "success", "errors"],
    },
    {
      id: "leads.create",
      name: "Create Lead",
      description: "Create a new lead record",
      method: "POST",
      path: "/services/data/v59.0/sobjects/Lead",
      inputSchema: [
        { key: "FirstName", label: "First Name", type: "string", required: false },
        { key: "LastName", label: "Last Name", type: "string", required: true },
        { key: "Company", label: "Company", type: "string", required: true },
        { key: "Email", label: "Email", type: "string", required: false },
        { key: "LeadSource", label: "Lead Source", type: "string", required: false },
      ],
      outputKeys: ["id", "success"],
    },
    {
      id: "opportunities.update",
      name: "Update Opportunity",
      description: "Update an existing opportunity",
      method: "PATCH",
      path: "/services/data/v59.0/sobjects/Opportunity/{{opportunityId}}",
      inputSchema: [
        { key: "opportunityId", label: "Opportunity ID", type: "string", required: true },
        { key: "StageName", label: "Stage Name", type: "string", required: false },
        { key: "Amount", label: "Amount", type: "number", required: false },
        { key: "CloseDate", label: "Close Date", type: "string", required: false },
      ],
      outputKeys: [],
    },
  ],
  triggers: [
    {
      id: "lead.created",
      name: "New Lead",
      description: "Fires when a new lead is created",
      kind: "webhook",
      webhookEventTypes: ["LeadCreated"],
    },
    {
      id: "opportunity.stage_changed",
      name: "Opportunity Stage Changed",
      description: "Fires when an opportunity stage changes",
      kind: "webhook",
      webhookEventTypes: ["OpportunityStageChanged"],
    },
  ],
  verified: true,
  docsUrl: "https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/",
};

const hubspot: IntegrationManifest = {
  slug: "hubspot",
  name: "HubSpot",
  description: "Manage contacts, companies, deals, and pipelines in HubSpot CRM.",
  category: "crm",
  icon: "hubspot",
  authKind: "oauth2_pkce",
  oauth2Config: {
    authorizationUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write", "crm.objects.deals.read", "crm.objects.deals.write"],
    clientIdHint: "App Client ID from HubSpot Developer Account",
    clientSecretHint: "App Client Secret",
  },
  baseUrl: "https://api.hubapi.com",
  setupInstructions:
    "1. Go to HubSpot Developer Account → Apps → Create App.\n" +
    "2. Add the AutoFlow redirect URL under Auth settings.\n" +
    "3. Copy the Client ID and Client Secret.",
  actions: [
    {
      id: "contacts.upsert",
      name: "Upsert Contact",
      description: "Create or update a contact by email",
      method: "POST",
      path: "/crm/v3/objects/contacts",
      inputSchema: [
        { key: "email", label: "Email", type: "string", required: true },
        { key: "firstname", label: "First Name", type: "string", required: false },
        { key: "lastname", label: "Last Name", type: "string", required: false },
        { key: "phone", label: "Phone", type: "string", required: false },
        { key: "company", label: "Company", type: "string", required: false },
      ],
      outputKeys: ["id", "properties", "createdAt", "updatedAt"],
    },
    {
      id: "deals.create",
      name: "Create Deal",
      description: "Create a new deal in HubSpot",
      method: "POST",
      path: "/crm/v3/objects/deals",
      inputSchema: [
        { key: "dealname", label: "Deal Name", type: "string", required: true },
        { key: "amount", label: "Amount", type: "number", required: false },
        { key: "dealstage", label: "Deal Stage", type: "string", required: false },
        { key: "closedate", label: "Close Date (Unix ms)", type: "number", required: false },
      ],
      outputKeys: ["id", "properties"],
    },
    {
      id: "contacts.search",
      name: "Search Contacts",
      description: "Search contacts by email, name, or property",
      method: "POST",
      path: "/crm/v3/objects/contacts/search",
      inputSchema: [
        { key: "query", label: "Search Query", type: "string", required: true },
        { key: "limit", label: "Limit", type: "number", required: false },
      ],
      outputKeys: ["results", "total", "paging"],
    },
  ],
  triggers: [
    {
      id: "contact.created",
      name: "New Contact",
      description: "Fires when a contact is created",
      kind: "webhook",
      webhookEventTypes: ["contact.creation"],
    },
    {
      id: "deal.stage_changed",
      name: "Deal Stage Changed",
      description: "Fires when a deal stage changes",
      kind: "webhook",
      webhookEventTypes: ["deal.propertyChange"],
    },
  ],
  verified: true,
  docsUrl: "https://developers.hubspot.com/docs/api/overview",
};

const pipedrive: IntegrationManifest = {
  slug: "pipedrive",
  name: "Pipedrive",
  description: "Manage deals, contacts, and pipelines in Pipedrive.",
  category: "crm",
  icon: "pipedrive",
  authKind: "api_key",
  authHeaderKey: "X-API-Key",
  baseUrl: "https://api.pipedrive.com",
  setupInstructions:
    "1. In Pipedrive, go to Settings → Personal Preferences → API.\n" +
    "2. Copy your API Token and paste it here.",
  actions: [
    {
      id: "persons.create",
      name: "Create Person",
      description: "Add a new person to Pipedrive",
      method: "POST",
      path: "/v1/persons",
      inputSchema: [
        { key: "name", label: "Full Name", type: "string", required: true },
        { key: "email", label: "Email", type: "string", required: false },
        { key: "phone", label: "Phone", type: "string", required: false },
      ],
      outputKeys: ["data", "success"],
    },
    {
      id: "deals.create",
      name: "Create Deal",
      description: "Add a new deal",
      method: "POST",
      path: "/v1/deals",
      inputSchema: [
        { key: "title", label: "Deal Title", type: "string", required: true },
        { key: "value", label: "Value", type: "number", required: false },
        { key: "person_id", label: "Person ID", type: "number", required: false },
        { key: "stage_id", label: "Stage ID", type: "number", required: false },
      ],
      outputKeys: ["data", "success"],
    },
  ],
  triggers: [
    {
      id: "deal.created",
      name: "New Deal",
      description: "Fires when a new deal is added",
      kind: "webhook",
      webhookEventTypes: ["added.deal"],
    },
  ],
  verified: true,
  docsUrl: "https://developers.pipedrive.com/docs/api/v1",
};

// ---------------------------------------------------------------------------
// Communication
// ---------------------------------------------------------------------------

const slack: IntegrationManifest = {
  slug: "slack",
  name: "Slack",
  description: "Send messages, create channels, and manage users in Slack.",
  category: "communication",
  icon: "slack",
  authKind: "oauth2_pkce",
  oauth2Config: {
    authorizationUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: ["chat:write", "channels:read", "users:read"],
    clientIdHint: "Slack App Client ID",
    clientSecretHint: "Slack App Client Secret",
  },
  baseUrl: "https://slack.com/api",
  setupInstructions:
    "1. Go to api.slack.com/apps and create a new app.\n" +
    "2. Add OAuth scopes: chat:write, channels:read, users:read.\n" +
    "3. Add the AutoFlow redirect URL under OAuth & Permissions.\n" +
    "4. Copy the Client ID and Client Secret.",
  actions: [
    {
      id: "messages.send",
      name: "Send Message",
      description: "Post a message to a channel or DM",
      method: "POST",
      path: "/chat.postMessage",
      inputSchema: [
        { key: "channel", label: "Channel ID or @user", type: "string", required: true },
        { key: "text", label: "Message Text", type: "string", required: true },
        { key: "blocks", label: "Block Kit JSON", type: "object", required: false },
      ],
      outputKeys: ["ok", "ts", "channel", "message"],
    },
    {
      id: "channels.list",
      name: "List Channels",
      description: "List public channels in the workspace",
      method: "GET",
      path: "/conversations.list",
      inputSchema: [
        { key: "limit", label: "Limit", type: "number", required: false },
      ],
      outputKeys: ["ok", "channels"],
    },
  ],
  triggers: [
    {
      id: "message.received",
      name: "New Message",
      description: "Fires when a message is posted in a channel",
      kind: "webhook",
      webhookEventTypes: ["message"],
    },
    {
      id: "app.mention",
      name: "App Mention",
      description: "Fires when the app is @-mentioned",
      kind: "webhook",
      webhookEventTypes: ["app_mention"],
    },
  ],
  verified: true,
  docsUrl: "https://api.slack.com/methods",
};

const twilio: IntegrationManifest = {
  slug: "twilio",
  name: "Twilio",
  description: "Send SMS, voice calls, and WhatsApp messages via Twilio.",
  category: "communication",
  icon: "twilio",
  authKind: "basic",
  baseUrl: "https://api.twilio.com",
  setupInstructions:
    "1. Log in to console.twilio.com.\n" +
    "2. Copy your Account SID (use as username) and Auth Token (use as password).",
  actions: [
    {
      id: "sms.send",
      name: "Send SMS",
      description: "Send an SMS message",
      method: "POST",
      path: "/2010-04-01/Accounts/{{accountSid}}/Messages.json",
      inputSchema: [
        { key: "accountSid", label: "Account SID", type: "string", required: true },
        { key: "To", label: "To Phone Number", type: "string", required: true },
        { key: "From", label: "From Phone Number", type: "string", required: true },
        { key: "Body", label: "Message Body", type: "string", required: true },
      ],
      outputKeys: ["sid", "status", "to", "from", "body"],
    },
  ],
  triggers: [
    {
      id: "sms.received",
      name: "SMS Received",
      description: "Fires when an inbound SMS arrives",
      kind: "webhook",
      webhookEventTypes: ["sms.received"],
    },
  ],
  verified: true,
  docsUrl: "https://www.twilio.com/docs/sms/api",
};

const sendgrid: IntegrationManifest = {
  slug: "sendgrid",
  name: "SendGrid",
  description: "Send transactional and marketing emails via SendGrid.",
  category: "communication",
  icon: "sendgrid",
  authKind: "bearer",
  baseUrl: "https://api.sendgrid.com",
  setupInstructions:
    "1. In SendGrid, go to Settings → API Keys → Create API Key.\n" +
    "2. Select 'Full Access' or restrict to Mail Send.\n" +
    "3. Copy the generated key.",
  actions: [
    {
      id: "email.send",
      name: "Send Email",
      description: "Send a transactional email",
      method: "POST",
      path: "/v3/mail/send",
      inputSchema: [
        { key: "to_email", label: "To Email", type: "string", required: true },
        { key: "to_name", label: "To Name", type: "string", required: false },
        { key: "from_email", label: "From Email", type: "string", required: true },
        { key: "subject", label: "Subject", type: "string", required: true },
        { key: "html_content", label: "HTML Content", type: "string", required: false },
        { key: "text_content", label: "Plain Text Content", type: "string", required: false },
      ],
      outputKeys: [],
    },
    {
      id: "contacts.add",
      name: "Add to Contact List",
      description: "Add an email to a marketing list",
      method: "PUT",
      path: "/v3/marketing/contacts",
      inputSchema: [
        { key: "email", label: "Email", type: "string", required: true },
        { key: "first_name", label: "First Name", type: "string", required: false },
        { key: "last_name", label: "Last Name", type: "string", required: false },
        { key: "list_ids", label: "List IDs (array)", type: "string[]", required: false },
      ],
      outputKeys: ["job_id"],
    },
  ],
  triggers: [
    {
      id: "email.delivered",
      name: "Email Delivered",
      description: "Fires when an email is successfully delivered",
      kind: "webhook",
      webhookEventTypes: ["delivered"],
    },
    {
      id: "email.opened",
      name: "Email Opened",
      description: "Fires when a recipient opens an email",
      kind: "webhook",
      webhookEventTypes: ["open"],
    },
  ],
  verified: true,
  docsUrl: "https://docs.sendgrid.com/api-reference",
};

// ---------------------------------------------------------------------------
// Marketing
// ---------------------------------------------------------------------------

const mailchimp: IntegrationManifest = {
  slug: "mailchimp",
  name: "Mailchimp",
  description: "Manage subscribers, campaigns, and automations in Mailchimp.",
  category: "marketing",
  icon: "mailchimp",
  authKind: "oauth2_pkce",
  oauth2Config: {
    authorizationUrl: "https://login.mailchimp.com/oauth2/authorize",
    tokenUrl: "https://login.mailchimp.com/oauth2/token",
    scopes: [],
    clientIdHint: "Mailchimp Client ID",
    clientSecretHint: "Mailchimp Client Secret",
  },
  baseUrl: "https://{{instanceDomain}}.api.mailchimp.com",
  setupInstructions:
    "1. Go to Mailchimp → Account → Extras → API Keys to find your data center prefix (e.g. us6).\n" +
    "2. Register a new OAuth2 app at mailchimp.com/developer.\n" +
    "3. Provide the AutoFlow redirect URL and copy the Client ID / Secret.",
  actions: [
    {
      id: "members.add",
      name: "Add List Member",
      description: "Subscribe an email to a Mailchimp list",
      method: "POST",
      path: "/3.0/lists/{{listId}}/members",
      inputSchema: [
        { key: "listId", label: "Audience / List ID", type: "string", required: true },
        { key: "email_address", label: "Email", type: "string", required: true },
        { key: "status", label: "Status", type: "string", required: true, options: ["subscribed", "pending", "unsubscribed"] },
        { key: "merge_fields", label: "Merge Fields (JSON)", type: "object", required: false },
      ],
      outputKeys: ["id", "email_address", "status", "list_id"],
    },
    {
      id: "tags.add",
      name: "Add Tags to Member",
      description: "Add tags to an existing list member",
      method: "POST",
      path: "/3.0/lists/{{listId}}/members/{{emailHash}}/tags",
      inputSchema: [
        { key: "listId", label: "List ID", type: "string", required: true },
        { key: "emailHash", label: "MD5 hash of lowercase email", type: "string", required: true },
        { key: "tags", label: "Tags (JSON array)", type: "string[]", required: true },
      ],
      outputKeys: [],
    },
  ],
  triggers: [
    {
      id: "member.subscribed",
      name: "Member Subscribed",
      description: "Fires when someone subscribes to a list",
      kind: "webhook",
      webhookEventTypes: ["subscribe"],
    },
  ],
  verified: true,
  docsUrl: "https://mailchimp.com/developer/marketing/api/",
};

const intercom: IntegrationManifest = {
  slug: "intercom",
  name: "Intercom",
  description: "Create and update contacts, conversations, and messages in Intercom.",
  category: "marketing",
  icon: "intercom",
  authKind: "bearer",
  baseUrl: "https://api.intercom.io",
  setupInstructions:
    "1. In Intercom, go to Settings → Developers → Your Apps.\n" +
    "2. Create a new app and copy the Access Token.",
  actions: [
    {
      id: "contacts.create",
      name: "Create Contact",
      description: "Create or update an Intercom contact",
      method: "POST",
      path: "/contacts",
      inputSchema: [
        { key: "email", label: "Email", type: "string", required: false },
        { key: "name", label: "Name", type: "string", required: false },
        { key: "phone", label: "Phone", type: "string", required: false },
        { key: "role", label: "Role", type: "string", required: false, options: ["user", "lead"] },
      ],
      outputKeys: ["id", "email", "name", "created_at"],
    },
    {
      id: "messages.send",
      name: "Send Message",
      description: "Send an in-app or email message to a contact",
      method: "POST",
      path: "/messages",
      inputSchema: [
        { key: "from_id", label: "From Admin ID", type: "string", required: true },
        { key: "to_id", label: "To Contact ID", type: "string", required: true },
        { key: "message_type", label: "Message Type", type: "string", required: true, options: ["inapp", "email"] },
        { key: "body", label: "Message Body (HTML)", type: "string", required: true },
      ],
      outputKeys: ["id", "message_type", "body"],
    },
  ],
  triggers: [
    {
      id: "conversation.created",
      name: "New Conversation",
      description: "Fires when a new conversation is started",
      kind: "webhook",
      webhookEventTypes: ["conversation.created"],
    },
  ],
  verified: true,
  docsUrl: "https://developers.intercom.com/intercom-api-reference",
};

// ---------------------------------------------------------------------------
// DevTools
// ---------------------------------------------------------------------------

const github: IntegrationManifest = {
  slug: "github",
  name: "GitHub",
  description: "Manage repositories, issues, pull requests, and deployments on GitHub.",
  category: "devtools",
  icon: "github",
  authKind: "bearer",
  baseUrl: "https://api.github.com",
  setupInstructions:
    "1. Go to GitHub Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens.\n" +
    "2. Create a token with repo, issues, and pull_requests permissions.\n" +
    "3. Paste the token here.",
  actions: [
    {
      id: "issues.create",
      name: "Create Issue",
      description: "Open a new issue in a repository",
      method: "POST",
      path: "/repos/{{owner}}/{{repo}}/issues",
      inputSchema: [
        { key: "owner", label: "Owner (org or user)", type: "string", required: true },
        { key: "repo", label: "Repository Name", type: "string", required: true },
        { key: "title", label: "Title", type: "string", required: true },
        { key: "body", label: "Body (Markdown)", type: "string", required: false },
        { key: "labels", label: "Labels (array)", type: "string[]", required: false },
        { key: "assignees", label: "Assignees (array)", type: "string[]", required: false },
      ],
      outputKeys: ["number", "id", "html_url", "state"],
    },
    {
      id: "issues.comment",
      name: "Add Issue Comment",
      description: "Post a comment on an existing issue",
      method: "POST",
      path: "/repos/{{owner}}/{{repo}}/issues/{{issue_number}}/comments",
      inputSchema: [
        { key: "owner", label: "Owner", type: "string", required: true },
        { key: "repo", label: "Repo", type: "string", required: true },
        { key: "issue_number", label: "Issue Number", type: "number", required: true },
        { key: "body", label: "Comment Body (Markdown)", type: "string", required: true },
      ],
      outputKeys: ["id", "html_url", "body"],
    },
    {
      id: "pull_requests.list",
      name: "List Pull Requests",
      description: "List open pull requests in a repository",
      method: "GET",
      path: "/repos/{{owner}}/{{repo}}/pulls",
      inputSchema: [
        { key: "owner", label: "Owner", type: "string", required: true },
        { key: "repo", label: "Repo", type: "string", required: true },
        { key: "state", label: "State", type: "string", required: false, options: ["open", "closed", "all"] },
      ],
      outputKeys: ["number", "title", "state", "html_url"],
    },
  ],
  triggers: [
    {
      id: "push",
      name: "Push to Branch",
      description: "Fires on every git push",
      kind: "webhook",
      webhookEventTypes: ["push"],
    },
    {
      id: "pull_request.opened",
      name: "Pull Request Opened",
      description: "Fires when a PR is opened",
      kind: "webhook",
      webhookEventTypes: ["pull_request"],
    },
    {
      id: "issue.created",
      name: "Issue Created",
      description: "Fires when an issue is opened",
      kind: "webhook",
      webhookEventTypes: ["issues"],
    },
  ],
  verified: true,
  docsUrl: "https://docs.github.com/en/rest",
};

const jira: IntegrationManifest = {
  slug: "jira",
  name: "Jira",
  description: "Create and manage issues, sprints, and projects in Jira.",
  category: "devtools",
  icon: "jira",
  authKind: "basic",
  baseUrl: "https://{{instanceDomain}}.atlassian.net",
  setupInstructions:
    "1. In Jira, go to Account Settings → Security → API Tokens.\n" +
    "2. Create a new token.\n" +
    "3. Use your Atlassian email as the username and the API token as the password.\n" +
    "4. Enter your Jira cloud subdomain (e.g. 'mycompany' for mycompany.atlassian.net).",
  actions: [
    {
      id: "issues.create",
      name: "Create Issue",
      description: "Create a new Jira issue",
      method: "POST",
      path: "/rest/api/3/issue",
      inputSchema: [
        { key: "project_key", label: "Project Key", type: "string", required: true },
        { key: "summary", label: "Summary", type: "string", required: true },
        { key: "description", label: "Description (Jira markup)", type: "string", required: false },
        { key: "issue_type", label: "Issue Type", type: "string", required: true, options: ["Bug", "Story", "Task", "Epic"] },
        { key: "priority", label: "Priority", type: "string", required: false, options: ["Highest", "High", "Medium", "Low", "Lowest"] },
        { key: "assignee_account_id", label: "Assignee Account ID", type: "string", required: false },
      ],
      outputKeys: ["id", "key", "self"],
    },
    {
      id: "issues.transition",
      name: "Transition Issue",
      description: "Move an issue to a new status",
      method: "POST",
      path: "/rest/api/3/issue/{{issueKey}}/transitions",
      inputSchema: [
        { key: "issueKey", label: "Issue Key (e.g. ENG-123)", type: "string", required: true },
        { key: "transition_id", label: "Transition ID", type: "string", required: true },
      ],
      outputKeys: [],
    },
  ],
  triggers: [
    {
      id: "issue.created",
      name: "Issue Created",
      description: "Fires when a new issue is created",
      kind: "webhook",
      webhookEventTypes: ["jira:issue_created"],
    },
    {
      id: "issue.updated",
      name: "Issue Updated",
      description: "Fires when an issue is updated",
      kind: "webhook",
      webhookEventTypes: ["jira:issue_updated"],
    },
  ],
  verified: true,
  docsUrl: "https://developer.atlassian.com/cloud/jira/platform/rest/v3/",
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const googleDrive: IntegrationManifest = {
  slug: "google-drive",
  name: "Google Drive",
  description: "Upload, read, search, and organize files in Google Drive.",
  category: "storage",
  icon: "google-drive",
  authKind: "oauth2_pkce",
  oauth2Config: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/drive.file"],
    clientIdHint: "Google Cloud OAuth 2.0 Client ID",
    clientSecretHint: "Google Cloud OAuth 2.0 Client Secret",
  },
  baseUrl: "https://www.googleapis.com",
  setupInstructions:
    "1. Create a project in Google Cloud Console.\n" +
    "2. Enable the Google Drive API.\n" +
    "3. Create OAuth 2.0 credentials and add the AutoFlow redirect URL.\n" +
    "4. Copy the Client ID and Client Secret.",
  actions: [
    {
      id: "files.list",
      name: "List Files",
      description: "List files in a folder",
      method: "GET",
      path: "/drive/v3/files",
      inputSchema: [
        { key: "q", label: "Search Query", type: "string", required: false },
        { key: "pageSize", label: "Page Size", type: "number", required: false },
        { key: "fields", label: "Fields to return", type: "string", required: false },
      ],
      outputKeys: ["files", "nextPageToken"],
    },
    {
      id: "files.create",
      name: "Upload File",
      description: "Upload a new file to Google Drive",
      method: "POST",
      path: "/upload/drive/v3/files",
      inputSchema: [
        { key: "name", label: "File Name", type: "string", required: true },
        { key: "mimeType", label: "MIME Type", type: "string", required: true },
        { key: "parents", label: "Parent Folder IDs", type: "string[]", required: false },
      ],
      outputKeys: ["id", "name", "mimeType", "webViewLink"],
    },
  ],
  triggers: [
    {
      id: "file.changed",
      name: "File Changed",
      description: "Fires when a watched file is modified",
      kind: "webhook",
      webhookEventTypes: ["drive#change"],
    },
  ],
  verified: true,
  docsUrl: "https://developers.google.com/drive/api/reference/rest/v3",
};

const awsS3: IntegrationManifest = {
  slug: "aws-s3",
  name: "AWS S3",
  description: "Upload, download, and manage objects in Amazon S3 buckets.",
  category: "storage",
  icon: "aws",
  authKind: "api_key",
  authHeaderKey: "X-Amz-Security-Token",
  baseUrl: "https://s3.{{instanceDomain}}.amazonaws.com",
  setupInstructions:
    "1. Create an IAM user with S3 permissions in AWS Console.\n" +
    "2. Generate an Access Key ID and Secret Access Key.\n" +
    "3. Use the Access Key ID as the API key and enter your region as the instance domain (e.g. 'us-east-1').",
  actions: [
    {
      id: "objects.put",
      name: "Upload Object",
      description: "Upload an object to an S3 bucket",
      method: "PUT",
      path: "/{{bucket}}/{{key}}",
      inputSchema: [
        { key: "bucket", label: "Bucket Name", type: "string", required: true },
        { key: "key", label: "Object Key (path)", type: "string", required: true },
        { key: "content", label: "Content (base64)", type: "string", required: true },
        { key: "contentType", label: "Content-Type", type: "string", required: false },
      ],
      outputKeys: ["ETag", "VersionId"],
    },
    {
      id: "objects.list",
      name: "List Objects",
      description: "List objects in a bucket",
      method: "GET",
      path: "/{{bucket}}",
      inputSchema: [
        { key: "bucket", label: "Bucket Name", type: "string", required: true },
        { key: "prefix", label: "Prefix Filter", type: "string", required: false },
        { key: "max_keys", label: "Max Keys", type: "number", required: false },
      ],
      outputKeys: ["Contents", "NextContinuationToken"],
    },
  ],
  triggers: [
    {
      id: "object.created",
      name: "Object Created",
      description: "Fires when an object is uploaded (via S3 event notification)",
      kind: "webhook",
      webhookEventTypes: ["s3:ObjectCreated:*"],
    },
  ],
  verified: true,
  docsUrl: "https://docs.aws.amazon.com/AmazonS3/latest/API/Welcome.html",
};

const dropbox: IntegrationManifest = {
  slug: "dropbox",
  name: "Dropbox",
  description: "Upload, download, and share files and folders in Dropbox.",
  category: "storage",
  icon: "dropbox",
  authKind: "oauth2_pkce",
  oauth2Config: {
    authorizationUrl: "https://www.dropbox.com/oauth2/authorize",
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    scopes: ["files.content.write", "files.content.read"],
    clientIdHint: "Dropbox App Key",
    clientSecretHint: "Dropbox App Secret",
  },
  baseUrl: "https://api.dropboxapi.com",
  setupInstructions:
    "1. Go to dropbox.com/developers/apps and create a new app.\n" +
    "2. Set the redirect URL to the AutoFlow callback.\n" +
    "3. Copy the App Key and App Secret.",
  actions: [
    {
      id: "files.upload",
      name: "Upload File",
      description: "Upload a file to Dropbox",
      method: "POST",
      path: "/2/files/upload",
      inputSchema: [
        { key: "path", label: "Destination Path (e.g. /folder/file.txt)", type: "string", required: true },
        { key: "content", label: "File content (base64)", type: "string", required: true },
        { key: "mode", label: "Write Mode", type: "string", required: false, options: ["add", "overwrite", "update"] },
      ],
      outputKeys: ["id", "name", "path_lower", "size"],
    },
    {
      id: "files.list",
      name: "List Folder",
      description: "List files and folders in a path",
      method: "POST",
      path: "/2/files/list_folder",
      inputSchema: [
        { key: "path", label: "Folder Path", type: "string", required: true },
        { key: "limit", label: "Limit", type: "number", required: false },
      ],
      outputKeys: ["entries", "has_more", "cursor"],
    },
  ],
  triggers: [
    {
      id: "file.changed",
      name: "File Changed",
      description: "Fires when a watched file or folder changes",
      kind: "webhook",
      webhookEventTypes: ["file_changes"],
    },
  ],
  verified: true,
  docsUrl: "https://www.dropbox.com/developers/documentation/http/documentation",
};

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

const googleCalendar: IntegrationManifest = {
  slug: "google-calendar",
  name: "Google Calendar",
  description: "Create events, check availability, and manage calendars in Google Calendar.",
  category: "calendar",
  icon: "google-calendar",
  authKind: "oauth2_pkce",
  oauth2Config: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
    clientIdHint: "Google Cloud OAuth 2.0 Client ID",
    clientSecretHint: "Google Cloud OAuth 2.0 Client Secret",
  },
  baseUrl: "https://www.googleapis.com/calendar/v3",
  setupInstructions:
    "1. Create a project in Google Cloud Console and enable the Google Calendar API.\n" +
    "2. Create OAuth 2.0 credentials with the AutoFlow redirect URL.\n" +
    "3. Copy the Client ID and Client Secret.",
  actions: [
    {
      id: "events.create",
      name: "Create Event",
      description: "Create a new calendar event",
      method: "POST",
      path: "/calendars/{{calendarId}}/events",
      inputSchema: [
        { key: "calendarId", label: "Calendar ID (or 'primary')", type: "string", required: true },
        { key: "summary", label: "Event Title", type: "string", required: true },
        { key: "description", label: "Description", type: "string", required: false },
        { key: "start_dateTime", label: "Start Time (ISO 8601)", type: "string", required: true },
        { key: "end_dateTime", label: "End Time (ISO 8601)", type: "string", required: true },
        { key: "attendees", label: "Attendee Emails (array)", type: "string[]", required: false },
      ],
      outputKeys: ["id", "htmlLink", "summary", "start", "end"],
    },
    {
      id: "events.list",
      name: "List Events",
      description: "List upcoming events in a calendar",
      method: "GET",
      path: "/calendars/{{calendarId}}/events",
      inputSchema: [
        { key: "calendarId", label: "Calendar ID", type: "string", required: true },
        { key: "timeMin", label: "From (ISO 8601)", type: "string", required: false },
        { key: "timeMax", label: "To (ISO 8601)", type: "string", required: false },
        { key: "maxResults", label: "Max Results", type: "number", required: false },
      ],
      outputKeys: ["items", "nextPageToken"],
    },
  ],
  triggers: [
    {
      id: "event.created",
      name: "Event Created",
      description: "Fires when a new calendar event is created",
      kind: "polling",
      pollingPath: "/calendars/primary/events?updatedMin={{lastPollAt}}&orderBy=updated",
      pollingIntervalMs: 60000,
    },
  ],
  verified: true,
  docsUrl: "https://developers.google.com/calendar/api/v3/reference",
};

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

const mixpanel: IntegrationManifest = {
  slug: "mixpanel",
  name: "Mixpanel",
  description: "Track user events and query analytics data from Mixpanel.",
  category: "analytics",
  icon: "mixpanel",
  authKind: "basic",
  baseUrl: "https://api.mixpanel.com",
  setupInstructions:
    "1. In Mixpanel, go to Settings → Project Settings → Service Accounts.\n" +
    "2. Create a service account with the desired roles.\n" +
    "3. Use the Service Account username and secret as basic auth credentials.",
  actions: [
    {
      id: "events.track",
      name: "Track Event",
      description: "Ingest a custom event into Mixpanel",
      method: "POST",
      path: "/import",
      inputSchema: [
        { key: "event", label: "Event Name", type: "string", required: true },
        { key: "distinct_id", label: "Distinct ID (user)", type: "string", required: true },
        { key: "time", label: "Time (Unix seconds)", type: "number", required: false },
        { key: "properties", label: "Custom Properties (JSON)", type: "object", required: false },
      ],
      outputKeys: ["num_records_imported", "status"],
    },
  ],
  triggers: [],
  verified: true,
  docsUrl: "https://developer.mixpanel.com/reference",
};

const segment: IntegrationManifest = {
  slug: "segment",
  name: "Segment",
  description: "Send analytics events and user traits to Segment CDP.",
  category: "analytics",
  icon: "segment",
  authKind: "bearer",
  baseUrl: "https://api.segment.io",
  setupInstructions:
    "1. In Segment, go to Sources → Your Source → API Keys.\n" +
    "2. Copy the Write Key and paste it here.",
  actions: [
    {
      id: "track",
      name: "Track Event",
      description: "Send a track call to Segment",
      method: "POST",
      path: "/v1/track",
      inputSchema: [
        { key: "userId", label: "User ID", type: "string", required: true },
        { key: "event", label: "Event Name", type: "string", required: true },
        { key: "properties", label: "Properties (JSON)", type: "object", required: false },
      ],
      outputKeys: ["success"],
    },
    {
      id: "identify",
      name: "Identify User",
      description: "Send an identify call with user traits",
      method: "POST",
      path: "/v1/identify",
      inputSchema: [
        { key: "userId", label: "User ID", type: "string", required: true },
        { key: "traits", label: "Traits (JSON)", type: "object", required: false },
      ],
      outputKeys: ["success"],
    },
  ],
  triggers: [],
  verified: true,
  docsUrl: "https://segment.com/docs/connections/sources/catalog/libraries/server/http-api/",
};

// ---------------------------------------------------------------------------
// E-commerce
// ---------------------------------------------------------------------------

const shopify: IntegrationManifest = {
  slug: "shopify",
  name: "Shopify",
  description: "Manage orders, products, customers, and inventory in Shopify.",
  category: "ecommerce",
  icon: "shopify",
  authKind: "oauth2_pkce",
  oauth2Config: {
    authorizationUrl: "https://{{instanceDomain}}.myshopify.com/admin/oauth/authorize",
    tokenUrl: "https://{{instanceDomain}}.myshopify.com/admin/oauth/access_token",
    scopes: ["read_orders", "write_orders", "read_products", "read_customers"],
    clientIdHint: "Shopify App API Key",
    clientSecretHint: "Shopify App API Secret",
  },
  baseUrl: "https://{{instanceDomain}}.myshopify.com",
  setupInstructions:
    "1. Create a Shopify Partner account and register a new app.\n" +
    "2. Add the AutoFlow redirect URL under App Setup → URL.\n" +
    "3. Copy the API Key and Secret Key.\n" +
    "4. Enter your Shopify store subdomain (e.g. 'mystorename').",
  actions: [
    {
      id: "orders.list",
      name: "List Orders",
      description: "Retrieve recent orders from the store",
      method: "GET",
      path: "/admin/api/2024-01/orders.json",
      inputSchema: [
        { key: "status", label: "Order Status", type: "string", required: false, options: ["open", "closed", "cancelled", "any"] },
        { key: "limit", label: "Limit", type: "number", required: false },
        { key: "created_at_min", label: "Created After (ISO 8601)", type: "string", required: false },
      ],
      outputKeys: ["orders"],
    },
    {
      id: "customers.create",
      name: "Create Customer",
      description: "Create a new customer record",
      method: "POST",
      path: "/admin/api/2024-01/customers.json",
      inputSchema: [
        { key: "first_name", label: "First Name", type: "string", required: false },
        { key: "last_name", label: "Last Name", type: "string", required: false },
        { key: "email", label: "Email", type: "string", required: true },
        { key: "phone", label: "Phone", type: "string", required: false },
      ],
      outputKeys: ["customer"],
    },
  ],
  triggers: [
    {
      id: "order.created",
      name: "New Order",
      description: "Fires when an order is placed",
      kind: "webhook",
      webhookEventTypes: ["orders/create"],
    },
    {
      id: "customer.created",
      name: "New Customer",
      description: "Fires when a customer signs up",
      kind: "webhook",
      webhookEventTypes: ["customers/create"],
    },
  ],
  verified: true,
  docsUrl: "https://shopify.dev/docs/api/admin-rest",
};

const woocommerce: IntegrationManifest = {
  slug: "woocommerce",
  name: "WooCommerce",
  description: "Manage orders, products, and customers in WooCommerce.",
  category: "ecommerce",
  icon: "woocommerce",
  authKind: "basic",
  baseUrl: "https://{{instanceDomain}}/wp-json/wc",
  setupInstructions:
    "1. In your WordPress admin, go to WooCommerce → Settings → Advanced → REST API.\n" +
    "2. Create a new key with Read/Write permissions.\n" +
    "3. Use the Consumer Key as username and Consumer Secret as password.\n" +
    "4. Enter your WordPress site domain as the instance domain.",
  actions: [
    {
      id: "orders.list",
      name: "List Orders",
      description: "Retrieve orders from WooCommerce",
      method: "GET",
      path: "/v3/orders",
      inputSchema: [
        { key: "status", label: "Status", type: "string", required: false, options: ["pending", "processing", "completed", "cancelled"] },
        { key: "per_page", label: "Per Page", type: "number", required: false },
      ],
      outputKeys: ["id", "status", "total", "billing"],
    },
    {
      id: "products.create",
      name: "Create Product",
      description: "Add a new product to the store",
      method: "POST",
      path: "/v3/products",
      inputSchema: [
        { key: "name", label: "Product Name", type: "string", required: true },
        { key: "regular_price", label: "Price", type: "string", required: false },
        { key: "description", label: "Description", type: "string", required: false },
        { key: "type", label: "Type", type: "string", required: false, options: ["simple", "variable", "grouped"] },
      ],
      outputKeys: ["id", "name", "permalink", "price"],
    },
  ],
  triggers: [
    {
      id: "order.created",
      name: "New Order",
      description: "Fires when an order is created",
      kind: "webhook",
      webhookEventTypes: ["order.created"],
    },
  ],
  verified: false,
  docsUrl: "https://woocommerce.github.io/woocommerce-rest-api-docs/",
};

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

const stripe: IntegrationManifest = {
  slug: "stripe",
  name: "Stripe",
  description: "Process payments, manage subscriptions, and query financial data in Stripe.",
  category: "finance",
  icon: "stripe",
  authKind: "bearer",
  baseUrl: "https://api.stripe.com",
  sandboxBaseUrl: "https://api.stripe.com",
  setupInstructions:
    "1. Go to Stripe Dashboard → Developers → API Keys.\n" +
    "2. Copy the Secret Key (use 'sk_test_...' for sandbox, 'sk_live_...' for production).",
  actions: [
    {
      id: "customers.create",
      name: "Create Customer",
      description: "Create a new Stripe customer",
      method: "POST",
      path: "/v1/customers",
      inputSchema: [
        { key: "email", label: "Email", type: "string", required: false },
        { key: "name", label: "Name", type: "string", required: false },
        { key: "phone", label: "Phone", type: "string", required: false },
        { key: "description", label: "Description", type: "string", required: false },
      ],
      outputKeys: ["id", "email", "name", "created"],
    },
    {
      id: "subscriptions.list",
      name: "List Subscriptions",
      description: "List active subscriptions",
      method: "GET",
      path: "/v1/subscriptions",
      inputSchema: [
        { key: "status", label: "Status", type: "string", required: false, options: ["active", "canceled", "past_due", "trialing"] },
        { key: "customer", label: "Customer ID", type: "string", required: false },
        { key: "limit", label: "Limit", type: "number", required: false },
      ],
      outputKeys: ["data", "has_more"],
    },
    {
      id: "invoices.create",
      name: "Create Invoice",
      description: "Create and finalize an invoice for a customer",
      method: "POST",
      path: "/v1/invoices",
      inputSchema: [
        { key: "customer", label: "Customer ID", type: "string", required: true },
        { key: "auto_advance", label: "Auto-finalize", type: "boolean", required: false },
        { key: "description", label: "Description", type: "string", required: false },
      ],
      outputKeys: ["id", "status", "amount_due", "hosted_invoice_url"],
    },
  ],
  triggers: [
    {
      id: "payment.succeeded",
      name: "Payment Succeeded",
      description: "Fires when a payment succeeds",
      kind: "webhook",
      webhookEventTypes: ["payment_intent.succeeded"],
    },
    {
      id: "subscription.created",
      name: "Subscription Created",
      description: "Fires when a new subscription is created",
      kind: "webhook",
      webhookEventTypes: ["customer.subscription.created"],
    },
    {
      id: "invoice.paid",
      name: "Invoice Paid",
      description: "Fires when an invoice is paid",
      kind: "webhook",
      webhookEventTypes: ["invoice.payment_succeeded"],
    },
  ],
  verified: true,
  docsUrl: "https://stripe.com/docs/api",
};

const quickbooks: IntegrationManifest = {
  slug: "quickbooks",
  name: "QuickBooks",
  description: "Manage customers, invoices, expenses, and financial reports in QuickBooks Online.",
  category: "finance",
  icon: "quickbooks",
  authKind: "oauth2_pkce",
  oauth2Config: {
    authorizationUrl: "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    scopes: ["com.intuit.quickbooks.accounting"],
    clientIdHint: "Intuit Client ID",
    clientSecretHint: "Intuit Client Secret",
  },
  baseUrl: "https://quickbooks.api.intuit.com",
  setupInstructions:
    "1. Sign up at developer.intuit.com and create an app.\n" +
    "2. Under Keys & credentials, copy the Client ID and Client Secret.\n" +
    "3. Add the AutoFlow redirect URL to your app settings.",
  actions: [
    {
      id: "invoices.create",
      name: "Create Invoice",
      description: "Create a new invoice in QuickBooks",
      method: "POST",
      path: "/v3/company/{{companyId}}/invoice",
      inputSchema: [
        { key: "companyId", label: "Company ID (Realm ID)", type: "string", required: true },
        { key: "customer_ref", label: "Customer Reference ID", type: "string", required: true },
        { key: "amount", label: "Amount", type: "number", required: true },
        { key: "description", label: "Description", type: "string", required: false },
      ],
      outputKeys: ["Invoice"],
    },
  ],
  triggers: [],
  verified: true,
  docsUrl: "https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account",
};

// ---------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------

const bamboohr: IntegrationManifest = {
  slug: "bamboohr",
  name: "BambooHR",
  description: "Access employee records, time-off requests, and org data in BambooHR.",
  category: "hr",
  icon: "bamboohr",
  authKind: "basic",
  baseUrl: "https://api.bamboohr.com/api/gateway.php/{{instanceDomain}}",
  setupInstructions:
    "1. In BambooHR, go to your profile → API Keys → Add New Key.\n" +
    "2. Use any string as the username and the API Key as the password.\n" +
    "3. Enter your BambooHR company subdomain as the instance domain.",
  actions: [
    {
      id: "employees.list",
      name: "List Employees",
      description: "Retrieve a directory of employees",
      method: "GET",
      path: "/v1/employees/directory",
      inputSchema: [],
      outputKeys: ["employees"],
    },
    {
      id: "employees.get",
      name: "Get Employee",
      description: "Get an employee's profile fields",
      method: "GET",
      path: "/v1/employees/{{employeeId}}",
      inputSchema: [
        { key: "employeeId", label: "Employee ID", type: "string", required: true },
        { key: "fields", label: "Fields (comma-separated)", type: "string", required: false },
      ],
      outputKeys: ["id", "firstName", "lastName", "email", "jobTitle", "department"],
    },
    {
      id: "timeoff.request",
      name: "Request Time Off",
      description: "Submit a time-off request for an employee",
      method: "POST",
      path: "/v1/employees/{{employeeId}}/timeoff/requests",
      inputSchema: [
        { key: "employeeId", label: "Employee ID", type: "string", required: true },
        { key: "status", label: "Status", type: "string", required: true, options: ["requested", "approved"] },
        { key: "start", label: "Start Date (YYYY-MM-DD)", type: "string", required: true },
        { key: "end", label: "End Date (YYYY-MM-DD)", type: "string", required: true },
        { key: "timeOffTypeId", label: "Time Off Type ID", type: "string", required: true },
      ],
      outputKeys: ["id"],
    },
  ],
  triggers: [
    {
      id: "employee.hired",
      name: "New Employee Hired",
      description: "Fires when a new employee record is created",
      kind: "polling",
      pollingPath: "/v1/employees/changed?since={{lastPollAt}}",
      pollingIntervalMs: 300000,
    },
  ],
  verified: true,
  docsUrl: "https://documentation.bamboohr.com/reference",
};

const workday: IntegrationManifest = {
  slug: "workday",
  name: "Workday",
  description: "Query workers, organizations, and HR data from Workday.",
  category: "hr",
  icon: "workday",
  authKind: "oauth2_client_credentials",
  oauth2Config: {
    authorizationUrl: "https://{{instanceDomain}}.workday.com/ccx/oauth2/authorize",
    tokenUrl: "https://{{instanceDomain}}.workday.com/ccx/oauth2/token",
    scopes: ["Employee_Data", "Staffing"],
    clientIdHint: "Workday Integration System Client ID",
    clientSecretHint: "Workday Integration System Client Secret",
  },
  baseUrl: "https://{{instanceDomain}}.workday.com",
  setupInstructions:
    "1. In Workday, create an Integration System User (ISU).\n" +
    "2. Register an API Client under Workday → OAuth 2.0 Clients.\n" +
    "3. Copy the Client ID and Secret.\n" +
    "4. Enter your Workday tenant subdomain.",
  actions: [
    {
      id: "workers.list",
      name: "List Workers",
      description: "Retrieve a list of workers",
      method: "GET",
      path: "/api/v1/{{tenantId}}/workers",
      inputSchema: [
        { key: "tenantId", label: "Tenant ID", type: "string", required: true },
        { key: "limit", label: "Limit", type: "number", required: false },
      ],
      outputKeys: ["data", "total"],
    },
  ],
  triggers: [],
  verified: false,
  docsUrl: "https://community.workday.com/sites/default/files/file-hosting/productionapi/",
};

// ---------------------------------------------------------------------------
// Additional integrations to reach 30+
// ---------------------------------------------------------------------------

const airtable: IntegrationManifest = {
  slug: "airtable",
  name: "Airtable",
  description: "Read, create, and update records in Airtable bases.",
  category: "storage",
  icon: "airtable",
  authKind: "bearer",
  baseUrl: "https://api.airtable.com",
  setupInstructions:
    "1. Go to airtable.com/account → API → Personal access tokens.\n" +
    "2. Create a token with data.records:read and data.records:write scopes.\n" +
    "3. Paste the token here.",
  actions: [
    {
      id: "records.list",
      name: "List Records",
      description: "List records in a table",
      method: "GET",
      path: "/v0/{{baseId}}/{{tableIdOrName}}",
      inputSchema: [
        { key: "baseId", label: "Base ID", type: "string", required: true },
        { key: "tableIdOrName", label: "Table ID or Name", type: "string", required: true },
        { key: "filterByFormula", label: "Filter Formula", type: "string", required: false },
        { key: "maxRecords", label: "Max Records", type: "number", required: false },
      ],
      outputKeys: ["records", "offset"],
    },
    {
      id: "records.create",
      name: "Create Record",
      description: "Add a new record to a table",
      method: "POST",
      path: "/v0/{{baseId}}/{{tableIdOrName}}",
      inputSchema: [
        { key: "baseId", label: "Base ID", type: "string", required: true },
        { key: "tableIdOrName", label: "Table ID or Name", type: "string", required: true },
        { key: "fields", label: "Fields (JSON)", type: "object", required: true },
      ],
      outputKeys: ["id", "fields", "createdTime"],
    },
  ],
  triggers: [],
  verified: true,
  docsUrl: "https://airtable.com/developers/web/api/introduction",
};

const notion: IntegrationManifest = {
  slug: "notion",
  name: "Notion",
  description: "Read and write pages, databases, and blocks in Notion.",
  category: "storage",
  icon: "notion",
  authKind: "bearer",
  baseUrl: "https://api.notion.com",
  setupInstructions:
    "1. Go to notion.so/my-integrations and create a new integration.\n" +
    "2. Grant it access to relevant pages/databases.\n" +
    "3. Copy the Internal Integration Token.",
  actions: [
    {
      id: "pages.create",
      name: "Create Page",
      description: "Create a new page in a Notion database",
      method: "POST",
      path: "/v1/pages",
      inputSchema: [
        { key: "parent_database_id", label: "Database ID", type: "string", required: true },
        { key: "properties", label: "Properties (JSON)", type: "object", required: true },
        { key: "children", label: "Content Blocks (JSON)", type: "object", required: false },
      ],
      outputKeys: ["id", "url", "created_time"],
    },
    {
      id: "databases.query",
      name: "Query Database",
      description: "Filter and sort records in a Notion database",
      method: "POST",
      path: "/v1/databases/{{databaseId}}/query",
      inputSchema: [
        { key: "databaseId", label: "Database ID", type: "string", required: true },
        { key: "filter", label: "Filter (JSON)", type: "object", required: false },
        { key: "sorts", label: "Sorts (JSON array)", type: "string[]", required: false },
        { key: "page_size", label: "Page Size", type: "number", required: false },
      ],
      outputKeys: ["results", "has_more", "next_cursor"],
    },
  ],
  triggers: [],
  verified: true,
  docsUrl: "https://developers.notion.com/docs",
};

const zendesk: IntegrationManifest = {
  slug: "zendesk",
  name: "Zendesk",
  description: "Create and manage support tickets, users, and organizations in Zendesk.",
  category: "support",
  icon: "zendesk",
  authKind: "basic",
  baseUrl: "https://{{instanceDomain}}.zendesk.com/api",
  setupInstructions:
    "1. In Zendesk, go to Admin → Integrations → APIs → Zendesk API → Settings.\n" +
    "2. Enable Token Access and generate an API token.\n" +
    "3. Use your email/token as '{email}/token' for the username and the token as password.\n" +
    "4. Enter your Zendesk subdomain.",
  actions: [
    {
      id: "tickets.create",
      name: "Create Ticket",
      description: "Open a new support ticket",
      method: "POST",
      path: "/v2/tickets.json",
      inputSchema: [
        { key: "subject", label: "Subject", type: "string", required: true },
        { key: "body", label: "Description", type: "string", required: true },
        { key: "requester_email", label: "Requester Email", type: "string", required: false },
        { key: "priority", label: "Priority", type: "string", required: false, options: ["urgent", "high", "normal", "low"] },
        { key: "tags", label: "Tags (array)", type: "string[]", required: false },
      ],
      outputKeys: ["ticket"],
    },
  ],
  triggers: [
    {
      id: "ticket.created",
      name: "New Ticket",
      description: "Fires when a ticket is created",
      kind: "webhook",
      webhookEventTypes: ["ticket.created"],
    },
  ],
  verified: true,
  docsUrl: "https://developer.zendesk.com/api-reference/",
};

const linear: IntegrationManifest = {
  slug: "linear",
  name: "Linear",
  description: "Create and update issues, cycles, and projects in Linear.",
  category: "devtools",
  icon: "linear",
  authKind: "bearer",
  baseUrl: "https://api.linear.app",
  setupInstructions:
    "1. Go to Linear Settings → API → Personal API Keys.\n" +
    "2. Create a new key and paste it here.",
  actions: [
    {
      id: "issues.create",
      name: "Create Issue",
      description: "Create a new issue in a Linear team",
      method: "POST",
      path: "/graphql",
      inputSchema: [
        { key: "teamId", label: "Team ID", type: "string", required: true },
        { key: "title", label: "Title", type: "string", required: true },
        { key: "description", label: "Description (Markdown)", type: "string", required: false },
        { key: "priority", label: "Priority (0-4)", type: "number", required: false },
        { key: "assigneeId", label: "Assignee User ID", type: "string", required: false },
      ],
      outputKeys: ["issue"],
    },
  ],
  triggers: [
    {
      id: "issue.created",
      name: "Issue Created",
      description: "Fires when a new issue is created",
      kind: "webhook",
      webhookEventTypes: ["Issue", "create"],
    },
  ],
  verified: true,
  docsUrl: "https://linear.app/docs/graphql",
};

// ---------------------------------------------------------------------------
// Communication — Gmail
// ---------------------------------------------------------------------------

const gmail: IntegrationManifest = {
  slug: "gmail",
  name: "Gmail",
  description: "Send emails, manage labels, and search messages in Gmail.",
  category: "communication",
  icon: "gmail",
  authKind: "oauth2_pkce",
  oauth2Config: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
    clientIdHint: "Google Cloud OAuth 2.0 Client ID",
    clientSecretHint: "Google Cloud OAuth 2.0 Client Secret",
  },
  baseUrl: "https://gmail.googleapis.com",
  setupInstructions:
    "1. Create a project in Google Cloud Console.\n" +
    "2. Enable the Gmail API.\n" +
    "3. Create OAuth 2.0 credentials and add the AutoFlow redirect URL.\n" +
    "4. Copy the Client ID and Client Secret.",
  actions: [
    {
      id: "messages.send",
      name: "Send Email",
      description: "Send an email message on behalf of the authenticated user",
      method: "POST",
      path: "/gmail/v1/users/me/messages/send",
      inputSchema: [
        { key: "raw", label: "RFC 2822 Base64url-encoded message", type: "string", required: true },
        { key: "threadId", label: "Thread ID (for replies)", type: "string", required: false },
      ],
      outputKeys: ["id", "threadId", "labelIds"],
    },
    {
      id: "messages.list",
      name: "List Messages",
      description: "List messages matching a query",
      method: "GET",
      path: "/gmail/v1/users/me/messages",
      inputSchema: [
        { key: "q", label: "Search query (Gmail syntax)", type: "string", required: false },
        { key: "maxResults", label: "Max Results", type: "number", required: false },
        { key: "labelIds", label: "Label IDs (comma-separated)", type: "string", required: false },
      ],
      outputKeys: ["messages", "nextPageToken", "resultSizeEstimate"],
    },
    {
      id: "messages.get",
      name: "Get Message",
      description: "Retrieve a single message by ID",
      method: "GET",
      path: "/gmail/v1/users/me/messages/{{messageId}}",
      inputSchema: [
        { key: "messageId", label: "Message ID", type: "string", required: true },
        { key: "format", label: "Format", type: "string", required: false, options: ["full", "metadata", "minimal", "raw"] },
      ],
      outputKeys: ["id", "threadId", "snippet", "payload", "labelIds"],
    },
    {
      id: "labels.list",
      name: "List Labels",
      description: "List all labels in the user's mailbox",
      method: "GET",
      path: "/gmail/v1/users/me/labels",
      inputSchema: [],
      outputKeys: ["labels"],
    },
  ],
  triggers: [
    {
      id: "message.received",
      name: "New Email Received",
      description: "Fires when a new email arrives in the inbox",
      kind: "polling",
      pollingPath: "/gmail/v1/users/me/messages?q=after:{{lastPollEpoch}}",
      pollingIntervalMs: 60000,
    },
    {
      id: "message.labeled",
      name: "Message Labeled",
      description: "Fires when a label is applied to a message",
      kind: "polling",
      pollingPath: "/gmail/v1/users/me/messages?q=after:{{lastPollEpoch}}&labelIds={{labelId}}",
      pollingIntervalMs: 120000,
    },
  ],
  verified: true,
  docsUrl: "https://developers.google.com/gmail/api/reference/rest",
};

// ---------------------------------------------------------------------------
// Communication — Microsoft Teams
// ---------------------------------------------------------------------------

const microsoftTeams: IntegrationManifest = {
  slug: "microsoft-teams",
  name: "Microsoft Teams",
  description: "Send messages, manage channels, and schedule meetings in Microsoft Teams.",
  category: "communication",
  icon: "microsoft-teams",
  authKind: "oauth2_pkce",
  oauth2Config: {
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: [
      "https://graph.microsoft.com/Chat.ReadWrite",
      "https://graph.microsoft.com/ChannelMessage.Send",
      "https://graph.microsoft.com/Team.ReadBasic.All",
      "https://graph.microsoft.com/User.Read",
    ],
    clientIdHint: "Azure AD App (client) ID",
    clientSecretHint: "Azure AD App client secret",
  },
  baseUrl: "https://graph.microsoft.com",
  setupInstructions:
    "1. Register an application in Azure Active Directory → App registrations.\n" +
    "2. Add the AutoFlow redirect URL under Authentication.\n" +
    "3. Under API Permissions, add Microsoft Graph delegated permissions: Chat.ReadWrite, ChannelMessage.Send, Team.ReadBasic.All.\n" +
    "4. Copy the Application (client) ID and create a Client Secret.",
  actions: [
    {
      id: "channels.sendMessage",
      name: "Send Channel Message",
      description: "Post a message to a Teams channel",
      method: "POST",
      path: "/v1.0/teams/{{teamId}}/channels/{{channelId}}/messages",
      inputSchema: [
        { key: "teamId", label: "Team ID", type: "string", required: true },
        { key: "channelId", label: "Channel ID", type: "string", required: true },
        { key: "body_content", label: "Message Content (HTML)", type: "string", required: true },
        { key: "body_contentType", label: "Content Type", type: "string", required: false, options: ["html", "text"] },
      ],
      outputKeys: ["id", "createdDateTime", "webUrl"],
    },
    {
      id: "chats.sendMessage",
      name: "Send Chat Message",
      description: "Send a message in a 1:1 or group chat",
      method: "POST",
      path: "/v1.0/chats/{{chatId}}/messages",
      inputSchema: [
        { key: "chatId", label: "Chat ID", type: "string", required: true },
        { key: "body_content", label: "Message Content", type: "string", required: true },
        { key: "body_contentType", label: "Content Type", type: "string", required: false, options: ["html", "text"] },
      ],
      outputKeys: ["id", "createdDateTime"],
    },
    {
      id: "teams.list",
      name: "List Joined Teams",
      description: "List all teams the authenticated user is a member of",
      method: "GET",
      path: "/v1.0/me/joinedTeams",
      inputSchema: [],
      outputKeys: ["value"],
    },
  ],
  triggers: [
    {
      id: "channelMessage.created",
      name: "New Channel Message",
      description: "Fires when a new message is posted in a channel",
      kind: "webhook",
      webhookEventTypes: ["Microsoft.Graph.ChatMessageCreated"],
    },
    {
      id: "teamMember.added",
      name: "Team Member Added",
      description: "Fires when a new member is added to a team",
      kind: "webhook",
      webhookEventTypes: ["Microsoft.Graph.MemberAdded"],
    },
  ],
  verified: true,
  docsUrl: "https://learn.microsoft.com/en-us/graph/api/resources/teams-api-overview",
};

// ---------------------------------------------------------------------------
// Productivity — Google Workspace (unified Drive+Docs+Sheets+Calendar)
// ---------------------------------------------------------------------------

const googleWorkspace: IntegrationManifest = {
  slug: "google-workspace",
  name: "Google Workspace",
  description: "Unified access to Google Drive, Docs, Sheets, and Calendar via a single OAuth2 connection.",
  category: "productivity",
  icon: "google-workspace",
  authKind: "oauth2_pkce",
  oauth2Config: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/calendar",
    ],
    clientIdHint: "Google Cloud OAuth 2.0 Client ID",
    clientSecretHint: "Google Cloud OAuth 2.0 Client Secret",
  },
  baseUrl: "https://www.googleapis.com",
  setupInstructions:
    "1. Create a project in Google Cloud Console.\n" +
    "2. Enable the Google Drive, Docs, Sheets, and Calendar APIs.\n" +
    "3. Create OAuth 2.0 credentials and add the AutoFlow redirect URL.\n" +
    "4. Copy the Client ID and Client Secret.",
  actions: [
    {
      id: "drive.files.list",
      name: "List Drive Files",
      description: "Search and list files in Google Drive",
      method: "GET",
      path: "/drive/v3/files",
      inputSchema: [
        { key: "q", label: "Search Query (Drive API syntax)", type: "string", required: false },
        { key: "pageSize", label: "Page Size", type: "number", required: false },
        { key: "fields", label: "Fields", type: "string", required: false },
      ],
      outputKeys: ["files", "nextPageToken"],
    },
    {
      id: "docs.create",
      name: "Create Google Doc",
      description: "Create a new Google Docs document",
      method: "POST",
      path: "/docs/v1/documents",
      inputSchema: [
        { key: "title", label: "Document Title", type: "string", required: true },
      ],
      outputKeys: ["documentId", "title", "revisionId"],
    },
    {
      id: "sheets.values.get",
      name: "Read Spreadsheet Range",
      description: "Read cell values from a Google Sheets spreadsheet",
      method: "GET",
      path: "/v4/spreadsheets/{{spreadsheetId}}/values/{{range}}",
      inputSchema: [
        { key: "spreadsheetId", label: "Spreadsheet ID", type: "string", required: true },
        { key: "range", label: "Range (e.g. Sheet1!A1:D10)", type: "string", required: true },
        { key: "valueRenderOption", label: "Value Render Option", type: "string", required: false, options: ["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"] },
      ],
      outputKeys: ["range", "majorDimension", "values"],
    },
    {
      id: "sheets.values.update",
      name: "Update Spreadsheet Range",
      description: "Write cell values to a Google Sheets spreadsheet",
      method: "PUT",
      path: "/v4/spreadsheets/{{spreadsheetId}}/values/{{range}}",
      inputSchema: [
        { key: "spreadsheetId", label: "Spreadsheet ID", type: "string", required: true },
        { key: "range", label: "Range", type: "string", required: true },
        { key: "values", label: "Values (2D JSON array)", type: "object", required: true },
        { key: "valueInputOption", label: "Value Input Option", type: "string", required: false, options: ["RAW", "USER_ENTERED"] },
      ],
      outputKeys: ["spreadsheetId", "updatedRange", "updatedRows", "updatedColumns", "updatedCells"],
    },
  ],
  triggers: [
    {
      id: "drive.file.changed",
      name: "Drive File Changed",
      description: "Fires when a file in Google Drive is created or modified",
      kind: "webhook",
      webhookEventTypes: ["drive#change"],
    },
    {
      id: "calendar.event.created",
      name: "Calendar Event Created",
      description: "Fires when a new calendar event is created",
      kind: "polling",
      pollingPath: "/calendar/v3/calendars/primary/events?updatedMin={{lastPollAt}}&orderBy=updated",
      pollingIntervalMs: 60000,
    },
  ],
  verified: true,
  docsUrl: "https://developers.google.com/workspace",
};

// ---------------------------------------------------------------------------
// DevTools — PagerDuty
// ---------------------------------------------------------------------------

const pagerduty: IntegrationManifest = {
  slug: "pagerduty",
  name: "PagerDuty",
  description: "Create incidents, manage on-call schedules, and acknowledge alerts in PagerDuty.",
  category: "devtools",
  icon: "pagerduty",
  authKind: "oauth2_pkce",
  oauth2Config: {
    authorizationUrl: "https://app.pagerduty.com/oauth/authorize",
    tokenUrl: "https://app.pagerduty.com/oauth/token",
    scopes: ["read", "write"],
    clientIdHint: "PagerDuty App OAuth Client ID",
    clientSecretHint: "PagerDuty App OAuth Client Secret",
  },
  baseUrl: "https://api.pagerduty.com",
  setupInstructions:
    "1. Go to PagerDuty → Integrations → App Registration.\n" +
    "2. Register a new OAuth2 app and add the AutoFlow redirect URL.\n" +
    "3. Copy the Client ID and Client Secret.",
  actions: [
    {
      id: "incidents.create",
      name: "Create Incident",
      description: "Trigger a new incident on a PagerDuty service",
      method: "POST",
      path: "/incidents",
      inputSchema: [
        { key: "title", label: "Incident Title", type: "string", required: true },
        { key: "service_id", label: "Service ID", type: "string", required: true },
        { key: "urgency", label: "Urgency", type: "string", required: false, options: ["high", "low"] },
        { key: "body_details", label: "Body Details", type: "string", required: false },
        { key: "escalation_policy_id", label: "Escalation Policy ID", type: "string", required: false },
      ],
      outputKeys: ["incident"],
    },
    {
      id: "incidents.list",
      name: "List Incidents",
      description: "List recent incidents filtered by status or service",
      method: "GET",
      path: "/incidents",
      inputSchema: [
        { key: "statuses[]", label: "Status", type: "string", required: false, options: ["triggered", "acknowledged", "resolved"] },
        { key: "service_ids[]", label: "Service IDs (comma-separated)", type: "string", required: false },
        { key: "limit", label: "Limit", type: "number", required: false },
      ],
      outputKeys: ["incidents", "limit", "offset", "total", "more"],
    },
    {
      id: "incidents.update",
      name: "Update Incident",
      description: "Acknowledge or resolve an incident",
      method: "PUT",
      path: "/incidents/{{incidentId}}",
      inputSchema: [
        { key: "incidentId", label: "Incident ID", type: "string", required: true },
        { key: "status", label: "Status", type: "string", required: true, options: ["acknowledged", "resolved"] },
      ],
      outputKeys: ["incident"],
    },
  ],
  triggers: [
    {
      id: "incident.triggered",
      name: "Incident Triggered",
      description: "Fires when a new incident is triggered",
      kind: "webhook",
      webhookEventTypes: ["incident.trigger"],
    },
    {
      id: "incident.acknowledged",
      name: "Incident Acknowledged",
      description: "Fires when an incident is acknowledged",
      kind: "webhook",
      webhookEventTypes: ["incident.acknowledge"],
    },
  ],
  verified: true,
  docsUrl: "https://developer.pagerduty.com/api-reference/",
};

// ---------------------------------------------------------------------------
// DevTools — Sentry
// ---------------------------------------------------------------------------

const sentry: IntegrationManifest = {
  slug: "sentry",
  name: "Sentry",
  description: "Query issues, manage releases, and resolve errors in Sentry.",
  category: "devtools",
  icon: "sentry",
  authKind: "oauth2_pkce",
  oauth2Config: {
    authorizationUrl: "https://sentry.io/oauth/authorize/",
    tokenUrl: "https://sentry.io/oauth/token/",
    scopes: ["project:read", "event:read", "org:read", "issue:write"],
    clientIdHint: "Sentry OAuth Application Client ID",
    clientSecretHint: "Sentry OAuth Application Client Secret",
  },
  baseUrl: "https://sentry.io/api",
  setupInstructions:
    "1. Go to Sentry → Settings → Developer Settings → New Public Integration.\n" +
    "2. Add the AutoFlow redirect URL.\n" +
    "3. Select required permissions: project:read, event:read, issue:write.\n" +
    "4. Copy the Client ID and Client Secret.",
  actions: [
    {
      id: "issues.list",
      name: "List Issues",
      description: "List issues in a Sentry project",
      method: "GET",
      path: "/0/projects/{{organizationSlug}}/{{projectSlug}}/issues/",
      inputSchema: [
        { key: "organizationSlug", label: "Organization Slug", type: "string", required: true },
        { key: "projectSlug", label: "Project Slug", type: "string", required: true },
        { key: "query", label: "Search Query", type: "string", required: false },
        { key: "sort", label: "Sort By", type: "string", required: false, options: ["date", "new", "priority", "freq"] },
      ],
      outputKeys: ["id", "title", "status", "count", "firstSeen", "lastSeen"],
    },
    {
      id: "issues.update",
      name: "Update Issue",
      description: "Resolve, ignore, or reassign an issue",
      method: "PUT",
      path: "/0/issues/{{issueId}}/",
      inputSchema: [
        { key: "issueId", label: "Issue ID", type: "string", required: true },
        { key: "status", label: "Status", type: "string", required: false, options: ["resolved", "unresolved", "ignored"] },
        { key: "assignedTo", label: "Assigned To (user or team)", type: "string", required: false },
      ],
      outputKeys: ["id", "status", "assignedTo"],
    },
    {
      id: "events.latest",
      name: "Get Latest Event",
      description: "Retrieve the latest event for an issue",
      method: "GET",
      path: "/0/issues/{{issueId}}/events/latest/",
      inputSchema: [
        { key: "issueId", label: "Issue ID", type: "string", required: true },
      ],
      outputKeys: ["eventID", "message", "tags", "context", "entries"],
    },
  ],
  triggers: [
    {
      id: "issue.created",
      name: "New Issue",
      description: "Fires when a new issue is created in Sentry",
      kind: "webhook",
      webhookEventTypes: ["issue.created"],
    },
    {
      id: "error.occurred",
      name: "Error Event",
      description: "Fires when a new error event is captured",
      kind: "webhook",
      webhookEventTypes: ["event.alert"],
    },
  ],
  verified: true,
  docsUrl: "https://docs.sentry.io/api/",
};

// ---------------------------------------------------------------------------
// Identity — Okta
// ---------------------------------------------------------------------------

const okta: IntegrationManifest = {
  slug: "okta",
  name: "Okta",
  description: "Manage users, groups, and application assignments in Okta.",
  category: "identity",
  icon: "okta",
  authKind: "oauth2_pkce",
  oauth2Config: {
    authorizationUrl: "https://{{instanceDomain}}.okta.com/oauth2/v1/authorize",
    tokenUrl: "https://{{instanceDomain}}.okta.com/oauth2/v1/token",
    scopes: ["okta.users.manage", "okta.groups.manage", "okta.apps.read"],
    clientIdHint: "Okta Application Client ID",
    clientSecretHint: "Okta Application Client Secret",
  },
  baseUrl: "https://{{instanceDomain}}.okta.com",
  setupInstructions:
    "1. In the Okta Admin Console, go to Applications → Create App Integration.\n" +
    "2. Choose OIDC - OpenID Connect and Web Application.\n" +
    "3. Add the AutoFlow redirect URL under Sign-in redirect URIs.\n" +
    "4. Copy the Client ID and Client Secret.\n" +
    "5. Enter your Okta organization subdomain (e.g. 'mycompany' for mycompany.okta.com).",
  actions: [
    {
      id: "users.list",
      name: "List Users",
      description: "Search and list users in the Okta directory",
      method: "GET",
      path: "/api/v1/users",
      inputSchema: [
        { key: "q", label: "Search Query", type: "string", required: false },
        { key: "filter", label: "Filter Expression", type: "string", required: false },
        { key: "limit", label: "Limit", type: "number", required: false },
      ],
      outputKeys: ["id", "status", "profile", "credentials"],
    },
    {
      id: "users.create",
      name: "Create User",
      description: "Create a new user in Okta",
      method: "POST",
      path: "/api/v1/users",
      inputSchema: [
        { key: "firstName", label: "First Name", type: "string", required: true },
        { key: "lastName", label: "Last Name", type: "string", required: true },
        { key: "email", label: "Email", type: "string", required: true },
        { key: "login", label: "Login (usually email)", type: "string", required: true },
        { key: "activate", label: "Activate on Creation", type: "boolean", required: false },
      ],
      outputKeys: ["id", "status", "profile"],
    },
    {
      id: "groups.addUser",
      name: "Add User to Group",
      description: "Add a user to an Okta group",
      method: "PUT",
      path: "/api/v1/groups/{{groupId}}/users/{{userId}}",
      inputSchema: [
        { key: "groupId", label: "Group ID", type: "string", required: true },
        { key: "userId", label: "User ID", type: "string", required: true },
      ],
      outputKeys: [],
    },
  ],
  triggers: [
    {
      id: "user.created",
      name: "User Created",
      description: "Fires when a new user is created in Okta",
      kind: "webhook",
      webhookEventTypes: ["user.lifecycle.create"],
    },
    {
      id: "user.deactivated",
      name: "User Deactivated",
      description: "Fires when a user is deactivated",
      kind: "webhook",
      webhookEventTypes: ["user.lifecycle.deactivate"],
    },
  ],
  verified: true,
  docsUrl: "https://developer.okta.com/docs/reference/api/",
};

// ---------------------------------------------------------------------------
// E-Sign — DocuSign
// ---------------------------------------------------------------------------

const docusign: IntegrationManifest = {
  slug: "docusign",
  name: "DocuSign",
  description: "Send envelopes, manage templates, and track signature status in DocuSign.",
  category: "esign",
  icon: "docusign",
  authKind: "oauth2_pkce",
  oauth2Config: {
    authorizationUrl: "https://account.docusign.com/oauth/auth",
    tokenUrl: "https://account.docusign.com/oauth/token",
    scopes: ["signature", "extended"],
    clientIdHint: "DocuSign Integration Key (Client ID)",
    clientSecretHint: "DocuSign Secret Key",
  },
  baseUrl: "https://www.docusign.net/restapi",
  sandboxBaseUrl: "https://demo.docusign.net/restapi",
  setupInstructions:
    "1. Go to DocuSign Admin → Settings → Apps and Keys.\n" +
    "2. Create a new integration (app) and note the Integration Key.\n" +
    "3. Add the AutoFlow redirect URL under Additional Settings.\n" +
    "4. Generate a Secret Key.\n" +
    "5. Copy the Integration Key (Client ID) and Secret Key.",
  actions: [
    {
      id: "envelopes.create",
      name: "Create and Send Envelope",
      description: "Create an envelope and send it for signature",
      method: "POST",
      path: "/v2.1/accounts/{{accountId}}/envelopes",
      inputSchema: [
        { key: "accountId", label: "Account ID", type: "string", required: true },
        { key: "emailSubject", label: "Email Subject", type: "string", required: true },
        { key: "templateId", label: "Template ID", type: "string", required: false },
        { key: "signers", label: "Signers (JSON array)", type: "object", required: true },
        { key: "status", label: "Status", type: "string", required: true, options: ["sent", "created"] },
      ],
      outputKeys: ["envelopeId", "status", "statusDateTime", "uri"],
    },
    {
      id: "envelopes.get",
      name: "Get Envelope",
      description: "Retrieve the status and details of an envelope",
      method: "GET",
      path: "/v2.1/accounts/{{accountId}}/envelopes/{{envelopeId}}",
      inputSchema: [
        { key: "accountId", label: "Account ID", type: "string", required: true },
        { key: "envelopeId", label: "Envelope ID", type: "string", required: true },
      ],
      outputKeys: ["envelopeId", "status", "emailSubject", "sentDateTime", "completedDateTime"],
    },
    {
      id: "templates.list",
      name: "List Templates",
      description: "List available envelope templates",
      method: "GET",
      path: "/v2.1/accounts/{{accountId}}/templates",
      inputSchema: [
        { key: "accountId", label: "Account ID", type: "string", required: true },
        { key: "search_text", label: "Search Text", type: "string", required: false },
      ],
      outputKeys: ["envelopeTemplates", "resultSetSize", "totalSetSize"],
    },
  ],
  triggers: [
    {
      id: "envelope.completed",
      name: "Envelope Completed",
      description: "Fires when all recipients have signed an envelope",
      kind: "webhook",
      webhookEventTypes: ["envelope-completed"],
    },
    {
      id: "envelope.sent",
      name: "Envelope Sent",
      description: "Fires when an envelope is sent for signature",
      kind: "webhook",
      webhookEventTypes: ["envelope-sent"],
    },
  ],
  verified: true,
  docsUrl: "https://developers.docusign.com/docs/esign-rest-api/reference/",
};

// ---------------------------------------------------------------------------
// ITSM — ServiceNow
// ---------------------------------------------------------------------------

const servicenow: IntegrationManifest = {
  slug: "servicenow",
  name: "ServiceNow",
  description: "Create incidents, manage change requests, and query the CMDB in ServiceNow.",
  category: "itsm",
  icon: "servicenow",
  authKind: "oauth2_pkce",
  oauth2Config: {
    authorizationUrl: "https://{{instanceDomain}}.service-now.com/oauth_auth.do",
    tokenUrl: "https://{{instanceDomain}}.service-now.com/oauth_token.do",
    scopes: ["useraccount"],
    clientIdHint: "ServiceNow OAuth Application Client ID",
    clientSecretHint: "ServiceNow OAuth Application Client Secret",
  },
  baseUrl: "https://{{instanceDomain}}.service-now.com",
  setupInstructions:
    "1. In ServiceNow, navigate to System OAuth → Application Registry.\n" +
    "2. Create a new OAuth API endpoint for external clients.\n" +
    "3. Add the AutoFlow redirect URL.\n" +
    "4. Copy the Client ID and Client Secret.\n" +
    "5. Enter your ServiceNow instance subdomain (e.g. 'mycompany' for mycompany.service-now.com).",
  actions: [
    {
      id: "incidents.create",
      name: "Create Incident",
      description: "Open a new incident in ServiceNow",
      method: "POST",
      path: "/api/now/table/incident",
      inputSchema: [
        { key: "short_description", label: "Short Description", type: "string", required: true },
        { key: "description", label: "Description", type: "string", required: false },
        { key: "urgency", label: "Urgency", type: "string", required: false, options: ["1", "2", "3"] },
        { key: "impact", label: "Impact", type: "string", required: false, options: ["1", "2", "3"] },
        { key: "assignment_group", label: "Assignment Group (sys_id)", type: "string", required: false },
        { key: "caller_id", label: "Caller (sys_id)", type: "string", required: false },
      ],
      outputKeys: ["result"],
    },
    {
      id: "incidents.list",
      name: "List Incidents",
      description: "Query incidents with optional filters",
      method: "GET",
      path: "/api/now/table/incident",
      inputSchema: [
        { key: "sysparm_query", label: "Encoded Query", type: "string", required: false },
        { key: "sysparm_limit", label: "Limit", type: "number", required: false },
        { key: "sysparm_fields", label: "Fields (comma-separated)", type: "string", required: false },
      ],
      outputKeys: ["result"],
    },
    {
      id: "incidents.update",
      name: "Update Incident",
      description: "Update an existing incident",
      method: "PATCH",
      path: "/api/now/table/incident/{{sysId}}",
      inputSchema: [
        { key: "sysId", label: "Incident sys_id", type: "string", required: true },
        { key: "state", label: "State", type: "string", required: false, options: ["1", "2", "3", "6", "7"] },
        { key: "assigned_to", label: "Assigned To (sys_id)", type: "string", required: false },
        { key: "close_notes", label: "Close Notes", type: "string", required: false },
      ],
      outputKeys: ["result"],
    },
  ],
  triggers: [
    {
      id: "incident.created",
      name: "Incident Created",
      description: "Fires when a new incident is created in ServiceNow",
      kind: "webhook",
      webhookEventTypes: ["incident.created"],
    },
    {
      id: "incident.updated",
      name: "Incident Updated",
      description: "Fires when an incident is updated",
      kind: "webhook",
      webhookEventTypes: ["incident.updated"],
    },
  ],
  verified: true,
  docsUrl: "https://developer.servicenow.com/dev.do#!/reference/api/latest/rest/",
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const INTEGRATION_CATALOG: IntegrationManifest[] = [
  // CRM
  salesforce,
  hubspot,
  pipedrive,
  // Communication
  slack,
  twilio,
  sendgrid,
  gmail,
  microsoftTeams,
  // Support
  zendesk,
  // Marketing
  mailchimp,
  intercom,
  // DevTools
  github,
  jira,
  linear,
  pagerduty,
  sentry,
  // Storage / Data
  googleDrive,
  awsS3,
  dropbox,
  airtable,
  notion,
  // Productivity
  googleWorkspace,
  // Calendar
  googleCalendar,
  // Analytics
  mixpanel,
  segment,
  // E-commerce
  shopify,
  woocommerce,
  // Finance
  stripe,
  quickbooks,
  // HR
  bamboohr,
  workday,
  // Identity
  okta,
  // E-Sign
  docusign,
  // ITSM
  servicenow,
];

export const INTEGRATION_CATALOG_CATEGORIES: IntegrationCategory[] = [
  "analytics",
  "calendar",
  "communication",
  "crm",
  "devtools",
  "ecommerce",
  "esign",
  "finance",
  "hr",
  "identity",
  "itsm",
  "marketing",
  "productivity",
  "storage",
  "support",
];

export function getIntegrationBySlug(slug: string): IntegrationManifest | undefined {
  return INTEGRATION_CATALOG.find((i) => i.slug === slug);
}

export function getIntegrationsByCategory(category: IntegrationCategory): IntegrationManifest[] {
  return INTEGRATION_CATALOG.filter((i) => i.category === category);
}
