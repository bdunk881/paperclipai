// Template + node-kind data lifted from the AutoFlow repo (src/templates/*).
// Pruned to what the prototype renders. Source of truth: README.md + brand brief.

const NODE_KINDS = {
  trigger:   { label: "Trigger",   tone: "orange", glyph: "⚡" },
  action:    { label: "Action",    tone: "indigo", glyph: "◆" },
  llm:       { label: "LLM",       tone: "teal",   glyph: "✦" },
  transform: { label: "Transform", tone: "indigo", glyph: "⇌" },
  condition: { label: "Condition", tone: "indigo", glyph: "◇" },
  output:    { label: "Output",    tone: "indigo", glyph: "→" },
  agent:     { label: "Agent",     tone: "teal",   glyph: "◉" },
};

// Tier costs (cents per 1k tokens, rough — for cost log viz only)
const TIER_INFO = {
  lite:     { label: "lite",     model: "claude-haiku-4-5",  inCost: 0.0025, outCost: 0.0125 },
  standard: { label: "standard", model: "claude-sonnet-4-5", inCost: 0.003,  outCost: 0.015  },
  power:    { label: "power",    model: "claude-opus-4-5",   inCost: 0.015,  outCost: 0.075  },
};

const TEMPLATES = [
  {
    id: "tpl-lead-enrich",
    name: "Lead Enrichment",
    category: "Sales",
    blurb: "Score, enrich, and route inbound leads to your CRM.",
    runs7d: 4218,
    avgCost: "$0.0017",
    avgLatency: "2.4s",
    tags: ["CRM", "Hubspot", "Apollo", "Webhook"],
    color: "indigo",
    sample: {
      leadId: "lead_8a3f2c",
      firstName: "Jordan",
      lastName: "Chen",
      email: "jordan.chen@acmecloud.io",
      companyName: "AcmeCloud",
      source: "landing_page",
    },
    expected: {
      leadScore: 82,
      isHotLead: true,
      crmPipeline: "hot_leads",
    },
    config: [
      { key: "crmIntegration", label: "CRM Integration", type: "select",
        options: ["hubspot", "salesforce", "pipedrive", "attio"], value: "hubspot", required: true },
      { key: "hotLeadThreshold", label: "Hot Lead Threshold", type: "number", value: 70 },
      { key: "idealCustomerProfile", label: "Ideal Customer Profile", type: "textarea",
        value: "Series A SaaS, 50–200 employees, US, AWS-native", required: true },
      { key: "enrichmentProvider", label: "Enrichment Provider", type: "select",
        options: ["clearbit", "apollo", "hunter"], value: "apollo" },
    ],
    nodes: [
      { id: "n1", kind: "trigger",   name: "Receive Lead",         x: 80,   y: 220, tier: null,        action: "webhook.lead" },
      { id: "n2", kind: "action",    name: "Enrich Company",       x: 320,  y: 120, tier: null,        action: "apollo.fetchCompany" },
      { id: "n3", kind: "action",    name: "Enrich Social",        x: 320,  y: 320, tier: null,        action: "apollo.fetchSocial" },
      { id: "n4", kind: "llm",       name: "Score Lead",           x: 600,  y: 220, tier: "standard",  outputKeys: ["leadScore", "scoringRationale", "topSignals"],
        prompt: "You are a B2B sales qualification assistant.\n\nICP: {{idealCustomerProfile}}\n\nLead:\n- {{firstName}} {{lastName}} · {{jobTitle}}\n- {{companyName}} · {{companySize}} · {{industry}}\n\nScore 0–100 against the ICP. Return JSON: leadScore, scoringRationale, topSignals (array of 3)." },
      { id: "n5", kind: "condition", name: "Hot or Nurture?",      x: 880,  y: 220, condition: "leadScore >= hotLeadThreshold" },
      { id: "n6", kind: "action",    name: "Upsert to CRM",        x: 1140, y: 140, tier: null,        action: "hubspot.upsertLead" },
      { id: "n7", kind: "output",    name: "Emit Event",           x: 1140, y: 320, tier: null,        action: "events.emit" },
    ],
    edges: [
      ["n1", "n2"], ["n1", "n3"], ["n2", "n4"], ["n3", "n4"],
      ["n4", "n5"], ["n5", "n6", "hot"], ["n5", "n7", "all"],
    ],
  },
  {
    id: "tpl-content-gen",
    name: "Content Generator",
    category: "Content",
    blurb: "Brief in, brand-voiced draft + SEO meta out, ready to publish.",
    runs7d: 1840,
    avgCost: "$0.011",
    avgLatency: "8.1s",
    tags: ["Brand voice", "SEO", "Markdown"],
    color: "teal",
    sample: {
      briefId: "brief_c9d4a1",
      topic: "How AI workflow automation saves SaaS teams 10+ hours/week",
      audience: "Operations managers at Series A–C SaaS",
      format: "blog_post",
      wordCount: 800,
    },
    expected: {
      seoSlug: "ai-workflow-automation-saas-teams",
      confidenceScore: 88,
      queuedTo: "publish_queue",
    },
    config: [
      { key: "brandName", label: "Brand Name", type: "text", value: "AutoFlow", required: true },
      { key: "brandVoice", label: "Brand Voice", type: "textarea",
        value: "Conversational, data-driven, second person, no jargon.", required: true },
      { key: "outputFormat", label: "Output Format", type: "select",
        options: ["blog_post", "linkedin_post", "email", "twitter_thread", "landing_page"], value: "blog_post" },
      { key: "autoPublishThreshold", label: "Auto-publish Threshold", type: "number", value: 80 },
    ],
    nodes: [
      { id: "n1", kind: "trigger",   name: "Receive Brief",        x: 80,   y: 220, action: "queue.brief" },
      { id: "n2", kind: "llm",       name: "Generate Draft",       x: 340,  y: 220, tier: "standard", outputKeys: ["rawDraft", "draftWordCount"],
        prompt: "Write a {{format}} on '{{topic}}' for {{audience}}. ~{{wordCount}} words. Markdown with H1/H2/H3." },
      { id: "n3", kind: "llm",       name: "Brand Voice + SEO",    x: 620,  y: 220, tier: "standard", outputKeys: ["finalContent", "seoTitle", "seoSlug", "metaDescription", "tags", "confidenceScore"],
        prompt: "You are a brand editor for {{brandName}}. Voice: {{brandVoice}}. Rewrite the draft and produce SEO meta. Return JSON." },
      { id: "n4", kind: "transform", name: "Assemble Document",    x: 880,  y: 220, action: "doc.assemble" },
      { id: "n5", kind: "condition", name: "Auto-publish?",        x: 1120, y: 220, condition: "confidenceScore >= autoPublishThreshold" },
      { id: "n6", kind: "action",    name: "Push to Queue",        x: 1380, y: 140, action: "queue.push" },
      { id: "n7", kind: "output",    name: "Emit Event",           x: 1380, y: 320, action: "events.emit" },
    ],
    edges: [
      ["n1","n2"], ["n2","n3"], ["n3","n4"], ["n4","n5"],
      ["n5","n6","publish"], ["n5","n7","all"],
    ],
  },
  {
    id: "tpl-support-bot",
    name: "Customer Support Bot",
    category: "Support",
    blurb: "Classify tickets, auto-respond to common ones, escalate the rest.",
    runs7d: 9320,
    avgCost: "$0.0009",
    avgLatency: "1.2s",
    tags: ["Email", "Zendesk", "Slack"],
    color: "orange",
    sample: {
      ticketId: "TKT-00147",
      customerEmail: "alice@example.com",
      subject: "Can't log into my account",
      body: "Trying to log in for an hour, keep getting 'invalid password' even after reset.",
      channel: "email",
    },
    expected: {
      intent: "general",
      sentiment: "frustrated",
      resolution: "auto_responded",
    },
    config: [
      { key: "brandName", label: "Brand / Product Name", type: "text", value: "AutoFlow", required: true },
      { key: "escalationEmail", label: "Escalation Email", type: "text", value: "support@autoflow.com", required: true },
      { key: "toneOfVoice", label: "Response Tone", type: "text", value: "professional and friendly" },
    ],
    nodes: [
      { id: "n1", kind: "trigger",   name: "Receive Ticket",       x: 80,   y: 220, action: "zendesk.ticket" },
      { id: "n2", kind: "llm",       name: "Classify Intent",      x: 340,  y: 220, tier: "lite", outputKeys: ["intent", "sentiment", "summary"],
        prompt: "Classify the support ticket. Return JSON: intent (general|billing|refund|bug), sentiment, summary." },
      { id: "n3", kind: "condition", name: "Auto-respond?",        x: 600,  y: 220, condition: "autoRespondCategories.includes(intent)" },
      { id: "n4", kind: "llm",       name: "Draft Response",       x: 860,  y: 120, tier: "standard", outputKeys: ["draftResponse"],
        prompt: "You are a {{toneOfVoice}} support agent for {{brandName}}. Write an empathetic email body." },
      { id: "n5", kind: "action",    name: "Send / Escalate",      x: 1120, y: 220, action: "support.dispatch" },
      { id: "n6", kind: "output",    name: "Emit Resolution",      x: 1380, y: 220, action: "events.emit" },
    ],
    edges: [
      ["n1","n2"], ["n2","n3"], ["n3","n4","auto"], ["n3","n5","escalate"], ["n4","n5"], ["n5","n6"],
    ],
  },
];

window.AF_DATA = { NODE_KINDS, TIER_INFO, TEMPLATES };
