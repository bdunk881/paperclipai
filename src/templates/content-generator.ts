/**
 * Template: Content Generator
 *
 * Accepts a brief/topic, generates an AI draft, applies brand formatting,
 * and outputs the content to a publishing queue or storage.
 *
 * Steps:
 *   1. trigger     — Receive content brief (topic, format, audience)
 *   2. llm         — Generate initial draft
 *   3. llm         — Apply brand voice rewrite + SEO meta (title, slug, tags)
 *   4. transform   — Assemble final content document
 *   5. condition   — Route: auto-publish vs. human review
 *   6. action      — Push to publishing queue or review queue
 *   7. output      — Emit content-generated event
 */

import { WorkflowTemplate } from "../types/workflow";

export const contentGenerator: WorkflowTemplate = {
  id: "tpl-content-gen",
  name: "Content Generator",
  description:
    "Takes a content brief, generates an AI-written draft, applies your brand voice and SEO metadata, then routes it to publish or review.",
  category: "content",
  version: "1.0.0",

  configFields: [
    {
      key: "brandVoice",
      label: "Brand Voice",
      type: "string",
      required: true,
      description:
        "Describe your brand's writing style (e.g. 'conversational, data-driven, no jargon, second person').",
    },
    {
      key: "brandName",
      label: "Brand Name",
      type: "string",
      required: true,
    },
    {
      key: "targetAudience",
      label: "Default Target Audience",
      type: "string",
      required: false,
      defaultValue: "B2B SaaS professionals",
      description: "Used when the brief does not specify an audience.",
    },
    {
      key: "outputFormat",
      label: "Output Format",
      type: "string",
      required: false,
      defaultValue: "blog_post",
      options: ["blog_post", "linkedin_post", "email", "twitter_thread", "landing_page"],
    },
    {
      key: "autoPublishThreshold",
      label: "Auto-publish Confidence Threshold",
      type: "number",
      required: false,
      defaultValue: 80,
      description:
        "LLM self-assessed confidence score (0–100). Content above this goes straight to queue.",
    },
    {
      key: "publishQueueTopic",
      label: "Publish Queue Topic / Endpoint",
      type: "string",
      required: true,
      description: "Message queue topic or webhook URL for approved content.",
    },
    {
      key: "reviewQueueTopic",
      label: "Review Queue Topic / Endpoint",
      type: "string",
      required: true,
      description: "Topic or URL for content requiring human review.",
    },
  ],

  steps: [
    {
      id: "step_trigger",
      name: "Receive Brief",
      kind: "trigger",
      description: "Accepts a content brief payload.",
      inputKeys: [],
      outputKeys: ["briefId", "topic", "keywords", "audience", "format", "wordCount", "notes"],
    },
    {
      id: "step_draft",
      name: "Generate Draft",
      kind: "llm",
      description: "Generates a full content draft based on the brief.",
      inputKeys: ["topic", "keywords", "audience", "format", "wordCount", "notes"],
      outputKeys: ["rawDraft", "draftWordCount"],
      promptTemplate:
        "You are an expert content writer.\n\n" +
        "Write a {{format}} on the topic: '{{topic}}'\n\n" +
        "Target audience: {{audience}}\n" +
        "Target word count: ~{{wordCount}} words\n" +
        "Keywords to include naturally: {{keywords}}\n" +
        "Additional notes: {{notes}}\n\n" +
        "Write the full content. Use markdown formatting. " +
        "Include a compelling headline (H1), introduction, body sections (H2/H3), and conclusion.",
    },
    {
      id: "step_brand_rewrite",
      name: "Apply Brand Voice & SEO",
      kind: "llm",
      description:
        "Rewrites the draft to match brand voice and adds SEO metadata.",
      inputKeys: ["brandName", "brandVoice", "rawDraft", "topic", "keywords", "format"],
      outputKeys: [
        "finalContent",
        "seoTitle",
        "seoSlug",
        "metaDescription",
        "tags",
        "confidenceScore",
      ],
      promptTemplate:
        "You are a brand editor for {{brandName}}.\n\n" +
        "Brand voice: {{brandVoice}}\n\n" +
        "Original draft:\n{{rawDraft}}\n\n" +
        "Your tasks:\n" +
        "1. Rewrite the draft to match the brand voice while preserving the key ideas.\n" +
        "2. Ensure it is appropriately formatted for a {{format}}.\n" +
        "3. Generate SEO metadata.\n\n" +
        "Respond with a JSON object:\n" +
        "- finalContent: the full rewritten content in markdown\n" +
        "- seoTitle: SEO-optimised page title (max 60 chars)\n" +
        "- seoSlug: URL slug (lowercase, hyphens, max 60 chars)\n" +
        "- metaDescription: meta description (max 155 chars)\n" +
        "- tags: array of 3–5 topic tags\n" +
        "- confidenceScore: integer 0–100 reflecting how well this meets the brief\n\n" +
        "Respond ONLY with the JSON object.",
    },
    {
      id: "step_assemble",
      name: "Assemble Content Document",
      kind: "transform",
      description: "Packages the final content with all metadata into a publish-ready document.",
      inputKeys: [
        "briefId",
        "topic",
        "format",
        "finalContent",
        "seoTitle",
        "seoSlug",
        "metaDescription",
        "tags",
        "draftWordCount",
        "confidenceScore",
      ],
      outputKeys: ["contentDocument"],
    },
    {
      id: "step_route",
      name: "Route: Publish or Review",
      kind: "condition",
      description:
        "Auto-publishes high-confidence content; routes low-confidence content for human review.",
      inputKeys: ["confidenceScore", "autoPublishThreshold"],
      outputKeys: ["autoPublish"],
      condition: "confidenceScore >= autoPublishThreshold",
    },
    {
      id: "step_queue",
      name: "Push to Queue",
      kind: "action",
      description: "Delivers the content document to the appropriate downstream queue.",
      inputKeys: [
        "autoPublish",
        "contentDocument",
        "publishQueueTopic",
        "reviewQueueTopic",
      ],
      outputKeys: ["queueMessageId", "queuedTo"],
      action: "queue.push",
    },
    {
      id: "step_output",
      name: "Emit Content Generated",
      kind: "output",
      description: "Records the content generation event for analytics.",
      inputKeys: ["briefId", "seoSlug", "confidenceScore", "queuedTo"],
      outputKeys: ["event"],
      action: "events.emit",
    },
  ],

  sampleInput: {
    briefId: "brief_c9d4a1",
    topic: "How AI workflow automation saves SaaS teams 10+ hours per week",
    keywords: ["AI automation", "workflow automation", "SaaS productivity", "no-code AI"],
    audience: "Operations managers at Series A–C SaaS companies",
    format: "blog_post",
    wordCount: 800,
    notes: "Include a concrete example with numbers. CTA at the end to try AutoFlow free.",
  },

  expectedOutput: {
    briefId: "brief_c9d4a1",
    seoSlug: "ai-workflow-automation-saas-teams-save-time",
    confidenceScore: 88,
    queuedTo: "publish_queue",
    event: {
      type: "content.generated",
      autoPublished: true,
    },
  },
};
