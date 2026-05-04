import { useState, useMemo } from "react";
import {
  Search,
  Grid3X3,
  List,
  Crown,
  Lock,
  CheckCircle,
  ExternalLink,
  Zap,
  ArrowRight,
  Filter,
  X,
} from "lucide-react";
import clsx from "clsx";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Integration {
  id: string;
  name: string;
  description: string;
  category: Category;
  connected: boolean;
  premium: boolean;
  official: boolean;
  actions: string[];
}

type Category =
  | "CRM"
  | "Marketing"
  | "Finance"
  | "Communication"
  | "Developer Tools"
  | "Database"
  | "Analytics"
  | "E-Commerce"
  | "HR & Recruiting"
  | "Project Management"
  | "Storage & Files"
  | "Security"
  | "AI & ML"
  | "Customer Support";

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  integrations: string[];
  category: string;
}

/* ------------------------------------------------------------------ */
/*  Data: 14 categories, 160+ integrations                            */
/* ------------------------------------------------------------------ */

const CATEGORIES: Category[] = [
  "CRM",
  "Marketing",
  "Finance",
  "Communication",
  "Developer Tools",
  "Database",
  "Analytics",
  "E-Commerce",
  "HR & Recruiting",
  "Project Management",
  "Storage & Files",
  "Security",
  "AI & ML",
  "Customer Support",
];

const INTEGRATIONS: Integration[] = [
  // ── CRM (14) ──
  { id: "salesforce", name: "Salesforce", description: "CRM platform for sales, service, and marketing automation.", category: "CRM", connected: false, premium: false, official: true, actions: ["create_lead", "update_opportunity", "sync_contacts"] },
  { id: "hubspot", name: "HubSpot", description: "Inbound marketing, sales, and CRM platform.", category: "CRM", connected: false, premium: false, official: true, actions: ["create_contact", "update_deal", "send_email"] },
  { id: "pipedrive", name: "Pipedrive", description: "Sales CRM and pipeline management tool.", category: "CRM", connected: false, premium: false, official: true, actions: ["add_deal", "move_stage", "log_activity"] },
  { id: "zoho-crm", name: "Zoho CRM", description: "Cloud-based CRM for managing sales, marketing, and support.", category: "CRM", connected: false, premium: false, official: true, actions: ["create_record", "update_field", "search_contacts"] },
  { id: "freshsales", name: "Freshsales", description: "AI-powered CRM for high-velocity sales teams.", category: "CRM", connected: false, premium: false, official: false, actions: ["create_lead", "score_lead", "schedule_call"] },
  { id: "close-crm", name: "Close", description: "CRM built for inside sales teams with calling and email.", category: "CRM", connected: false, premium: false, official: false, actions: ["log_call", "send_sequence", "create_lead"] },
  { id: "copper", name: "Copper", description: "Google Workspace-native CRM for relationship management.", category: "CRM", connected: false, premium: true, official: false, actions: ["sync_gmail", "create_opportunity", "log_activity"] },
  { id: "insightly", name: "Insightly", description: "CRM and project management for growing businesses.", category: "CRM", connected: false, premium: false, official: false, actions: ["create_project", "link_contact", "track_milestone"] },
  { id: "attio", name: "Attio", description: "Next-gen CRM with real-time data enrichment.", category: "CRM", connected: false, premium: false, official: true, actions: ["enrich_contact", "create_list", "update_record"] },
  { id: "apollo", name: "Apollo.io", description: "Sales intelligence and engagement platform.", category: "CRM", connected: false, premium: true, official: true, actions: ["find_leads", "enrich_company", "send_sequence"] },
  { id: "monday-crm", name: "monday CRM", description: "Customizable CRM built on monday.com Work OS.", category: "CRM", connected: false, premium: false, official: false, actions: ["create_item", "update_status", "assign_owner"] },
  { id: "capsule", name: "Capsule CRM", description: "Simple yet powerful CRM for small businesses.", category: "CRM", connected: false, premium: false, official: false, actions: ["add_contact", "log_note", "create_task"] },
  { id: "nimble", name: "Nimble", description: "Social CRM with contact enrichment from social profiles.", category: "CRM", connected: false, premium: true, official: false, actions: ["enrich_profile", "tag_contact", "send_message"] },
  { id: "sugarcrm", name: "SugarCRM", description: "Enterprise CRM with AI-driven insights.", category: "CRM", connected: false, premium: true, official: false, actions: ["predict_churn", "create_case", "sync_data"] },

  // ── Marketing (14) ──
  { id: "mailchimp", name: "Mailchimp", description: "Email marketing and audience management platform.", category: "Marketing", connected: false, premium: false, official: true, actions: ["send_campaign", "add_subscriber", "create_segment"] },
  { id: "sendgrid", name: "SendGrid", description: "Cloud-based email delivery and marketing service.", category: "Marketing", connected: false, premium: false, official: true, actions: ["send_email", "create_template", "track_opens"] },
  { id: "marketo", name: "Marketo", description: "Marketing automation for enterprise B2B marketers.", category: "Marketing", connected: false, premium: true, official: true, actions: ["nurture_lead", "score_engagement", "trigger_campaign"] },
  { id: "klaviyo", name: "Klaviyo", description: "Email and SMS marketing for e-commerce brands.", category: "Marketing", connected: false, premium: false, official: true, actions: ["send_flow", "segment_audience", "track_revenue"] },
  { id: "activecampaign", name: "ActiveCampaign", description: "Email marketing, automation, and CRM.", category: "Marketing", connected: false, premium: false, official: false, actions: ["automate_email", "tag_contact", "create_deal"] },
  { id: "brevo", name: "Brevo", description: "All-in-one marketing platform (formerly Sendinblue).", category: "Marketing", connected: false, premium: false, official: false, actions: ["send_sms", "create_campaign", "manage_contacts"] },
  { id: "convertkit", name: "ConvertKit", description: "Email marketing for creators and small businesses.", category: "Marketing", connected: false, premium: false, official: false, actions: ["add_subscriber", "send_broadcast", "create_form"] },
  { id: "google-ads", name: "Google Ads", description: "Online advertising platform by Google.", category: "Marketing", connected: false, premium: true, official: true, actions: ["create_campaign", "adjust_bid", "get_metrics"] },
  { id: "meta-ads", name: "Meta Ads", description: "Advertising across Facebook and Instagram.", category: "Marketing", connected: false, premium: true, official: true, actions: ["create_ad_set", "target_audience", "track_conversions"] },
  { id: "linkedin-ads", name: "LinkedIn Ads", description: "B2B advertising on LinkedIn.", category: "Marketing", connected: false, premium: true, official: false, actions: ["sponsor_content", "target_companies", "track_leads"] },
  { id: "buffer", name: "Buffer", description: "Social media scheduling and analytics.", category: "Marketing", connected: false, premium: false, official: false, actions: ["schedule_post", "analyze_engagement", "manage_queue"] },
  { id: "hootsuite", name: "Hootsuite", description: "Social media management platform.", category: "Marketing", connected: false, premium: true, official: false, actions: ["publish_post", "monitor_mentions", "report_analytics"] },
  { id: "semrush", name: "Semrush", description: "SEO, content marketing, and competitive analysis.", category: "Marketing", connected: false, premium: true, official: false, actions: ["audit_site", "track_keywords", "analyze_competitors"] },
  { id: "ahrefs", name: "Ahrefs", description: "SEO toolset for backlinks, keywords, and site audits.", category: "Marketing", connected: false, premium: true, official: false, actions: ["check_backlinks", "research_keywords", "audit_site"] },

  // ── Finance (12) ──
  { id: "stripe", name: "Stripe", description: "Payment processing and financial infrastructure.", category: "Finance", connected: false, premium: false, official: true, actions: ["create_charge", "manage_subscription", "issue_refund"] },
  { id: "quickbooks", name: "QuickBooks", description: "Accounting and bookkeeping for small business.", category: "Finance", connected: false, premium: false, official: true, actions: ["create_invoice", "record_expense", "run_report"] },
  { id: "xero", name: "Xero", description: "Cloud-based accounting software.", category: "Finance", connected: false, premium: false, official: true, actions: ["send_invoice", "reconcile_bank", "track_expense"] },
  { id: "plaid", name: "Plaid", description: "Connect apps to bank accounts securely.", category: "Finance", connected: false, premium: true, official: true, actions: ["link_account", "get_transactions", "verify_identity"] },
  { id: "square", name: "Square", description: "Payment and point-of-sale solutions.", category: "Finance", connected: false, premium: false, official: true, actions: ["process_payment", "create_invoice", "manage_inventory"] },
  { id: "braintree", name: "Braintree", description: "Payment platform by PayPal for online commerce.", category: "Finance", connected: false, premium: false, official: false, actions: ["charge_card", "create_subscription", "process_refund"] },
  { id: "wise", name: "Wise", description: "International money transfers at real exchange rates.", category: "Finance", connected: false, premium: false, official: false, actions: ["create_transfer", "get_rate", "check_balance"] },
  { id: "chargebee", name: "Chargebee", description: "Subscription billing and revenue management.", category: "Finance", connected: false, premium: true, official: false, actions: ["create_subscription", "apply_coupon", "generate_invoice"] },
  { id: "paddle", name: "Paddle", description: "Payment infrastructure for SaaS companies.", category: "Finance", connected: false, premium: false, official: false, actions: ["create_checkout", "manage_subscription", "handle_tax"] },
  { id: "freshbooks", name: "FreshBooks", description: "Invoicing and accounting for freelancers.", category: "Finance", connected: false, premium: false, official: false, actions: ["create_invoice", "track_time", "record_expense"] },
  { id: "wave", name: "Wave", description: "Free accounting and invoicing software.", category: "Finance", connected: false, premium: false, official: false, actions: ["send_invoice", "scan_receipt", "run_report"] },
  { id: "recurly", name: "Recurly", description: "Subscription management and recurring billing.", category: "Finance", connected: false, premium: true, official: false, actions: ["create_plan", "update_subscription", "retry_payment"] },

  // ── Communication (12) ──
  { id: "slack", name: "Slack", description: "Team messaging and collaboration platform.", category: "Communication", connected: false, premium: false, official: true, actions: ["send_message", "create_channel", "add_reaction"] },
  { id: "discord", name: "Discord", description: "Voice, video, and text communication platform.", category: "Communication", connected: false, premium: false, official: true, actions: ["send_message", "create_thread", "manage_roles"] },
  { id: "teams", name: "Microsoft Teams", description: "Chat, meetings, and collaboration by Microsoft.", category: "Communication", connected: false, premium: false, official: true, actions: ["send_message", "schedule_meeting", "share_file"] },
  { id: "zoom", name: "Zoom", description: "Video conferencing and online meeting platform.", category: "Communication", connected: false, premium: false, official: true, actions: ["create_meeting", "get_recording", "list_participants"] },
  { id: "twilio", name: "Twilio", description: "Cloud communications platform for SMS, voice, and video.", category: "Communication", connected: false, premium: true, official: true, actions: ["send_sms", "make_call", "send_whatsapp"] },
  { id: "sendbird", name: "Sendbird", description: "Chat and messaging API for apps.", category: "Communication", connected: false, premium: true, official: false, actions: ["send_message", "create_group", "moderate_channel"] },
  { id: "intercom-chat", name: "Intercom Chat", description: "Live chat and customer messaging platform.", category: "Communication", connected: false, premium: true, official: true, actions: ["send_message", "assign_conversation", "add_note"] },
  { id: "telegram", name: "Telegram Bot", description: "Messaging platform with bot API.", category: "Communication", connected: false, premium: false, official: false, actions: ["send_message", "send_photo", "create_poll"] },
  { id: "whatsapp", name: "WhatsApp Business", description: "Business messaging via WhatsApp API.", category: "Communication", connected: false, premium: true, official: true, actions: ["send_template", "reply_message", "send_media"] },
  { id: "webex", name: "Webex", description: "Video conferencing and team collaboration by Cisco.", category: "Communication", connected: false, premium: false, official: false, actions: ["create_meeting", "send_message", "share_screen"] },
  { id: "ringcentral", name: "RingCentral", description: "Cloud phone, video, and messaging platform.", category: "Communication", connected: false, premium: true, official: false, actions: ["make_call", "send_sms", "create_meeting"] },
  { id: "vonage", name: "Vonage", description: "Communication APIs for messaging, voice, and video.", category: "Communication", connected: false, premium: false, official: false, actions: ["send_sms", "make_call", "verify_number"] },

  // ── Developer Tools (14) ──
  { id: "github", name: "GitHub", description: "Code hosting and version control with CI/CD.", category: "Developer Tools", connected: false, premium: false, official: true, actions: ["create_issue", "open_pr", "trigger_workflow"] },
  { id: "gitlab", name: "GitLab", description: "DevOps lifecycle platform with CI/CD.", category: "Developer Tools", connected: false, premium: false, official: true, actions: ["create_mr", "run_pipeline", "manage_issues"] },
  { id: "bitbucket", name: "Bitbucket", description: "Git repository hosting by Atlassian.", category: "Developer Tools", connected: false, premium: false, official: true, actions: ["create_pr", "run_pipeline", "manage_repos"] },
  { id: "vercel", name: "Vercel", description: "Frontend deployment and serverless functions.", category: "Developer Tools", connected: false, premium: false, official: true, actions: ["deploy", "check_status", "manage_domains"] },
  { id: "netlify", name: "Netlify", description: "Web hosting and continuous deployment.", category: "Developer Tools", connected: false, premium: false, official: false, actions: ["deploy_site", "manage_forms", "set_env"] },
  { id: "docker-hub", name: "Docker Hub", description: "Container image registry and distribution.", category: "Developer Tools", connected: false, premium: false, official: true, actions: ["push_image", "pull_image", "scan_image"] },
  { id: "npm", name: "npm", description: "JavaScript package registry and manager.", category: "Developer Tools", connected: false, premium: false, official: false, actions: ["publish_package", "check_version", "audit_deps"] },
  { id: "sentry", name: "Sentry", description: "Application monitoring and error tracking.", category: "Developer Tools", connected: false, premium: false, official: true, actions: ["capture_error", "create_alert", "resolve_issue"] },
  { id: "datadog", name: "Datadog", description: "Infrastructure and application monitoring.", category: "Developer Tools", connected: false, premium: true, official: true, actions: ["send_metric", "create_monitor", "query_logs"] },
  { id: "pagerduty", name: "PagerDuty", description: "Incident management and on-call scheduling.", category: "Developer Tools", connected: false, premium: true, official: true, actions: ["trigger_incident", "acknowledge", "resolve"] },
  { id: "circleci", name: "CircleCI", description: "Continuous integration and delivery platform.", category: "Developer Tools", connected: false, premium: false, official: false, actions: ["trigger_build", "get_status", "list_artifacts"] },
  { id: "terraform-cloud", name: "Terraform Cloud", description: "Infrastructure as code collaboration platform.", category: "Developer Tools", connected: false, premium: true, official: false, actions: ["plan_run", "apply_changes", "manage_state"] },
  { id: "postman", name: "Postman", description: "API development and testing platform.", category: "Developer Tools", connected: false, premium: false, official: false, actions: ["run_collection", "monitor_api", "share_workspace"] },
  { id: "sonarqube", name: "SonarQube", description: "Code quality and security analysis.", category: "Developer Tools", connected: false, premium: true, official: false, actions: ["analyze_project", "get_issues", "check_quality_gate"] },

  // ── Database (10) ──
  { id: "postgres", name: "PostgreSQL", description: "Open-source relational database system.", category: "Database", connected: false, premium: false, official: true, actions: ["query", "execute", "list_tables"] },
  { id: "mongodb", name: "MongoDB", description: "NoSQL document database for modern apps.", category: "Database", connected: false, premium: false, official: true, actions: ["find", "insert", "aggregate"] },
  { id: "redis", name: "Redis", description: "In-memory data store for caching and messaging.", category: "Database", connected: false, premium: false, official: true, actions: ["get", "set", "publish"] },
  { id: "mysql", name: "MySQL", description: "Popular open-source relational database.", category: "Database", connected: false, premium: false, official: true, actions: ["query", "execute", "describe_table"] },
  { id: "supabase", name: "Supabase", description: "Open-source Firebase alternative with Postgres.", category: "Database", connected: false, premium: false, official: true, actions: ["query", "insert", "subscribe_realtime"] },
  { id: "firebase", name: "Firebase", description: "Google's app development platform with Firestore.", category: "Database", connected: false, premium: false, official: true, actions: ["get_document", "set_document", "query_collection"] },
  { id: "dynamodb", name: "DynamoDB", description: "Fully managed NoSQL database by AWS.", category: "Database", connected: false, premium: true, official: false, actions: ["put_item", "get_item", "scan_table"] },
  { id: "planetscale", name: "PlanetScale", description: "Serverless MySQL database platform.", category: "Database", connected: false, premium: false, official: false, actions: ["query", "create_branch", "deploy_request"] },
  { id: "neon", name: "Neon", description: "Serverless Postgres with branching.", category: "Database", connected: false, premium: false, official: false, actions: ["query", "create_branch", "manage_compute"] },
  { id: "elasticsearch", name: "Elasticsearch", description: "Distributed search and analytics engine.", category: "Database", connected: false, premium: true, official: false, actions: ["search", "index_document", "create_index"] },

  // ── Analytics (10) ──
  { id: "google-analytics", name: "Google Analytics", description: "Web analytics and audience insights.", category: "Analytics", connected: false, premium: false, official: true, actions: ["get_report", "track_event", "list_audiences"] },
  { id: "mixpanel", name: "Mixpanel", description: "Product analytics for user behavior tracking.", category: "Analytics", connected: false, premium: true, official: true, actions: ["track_event", "create_funnel", "get_retention"] },
  { id: "amplitude", name: "Amplitude", description: "Digital analytics platform for product teams.", category: "Analytics", connected: false, premium: true, official: true, actions: ["track_event", "query_chart", "create_cohort"] },
  { id: "segment", name: "Segment", description: "Customer data platform for data collection and routing.", category: "Analytics", connected: false, premium: true, official: true, actions: ["track", "identify", "route_data"] },
  { id: "posthog", name: "PostHog", description: "Open-source product analytics with session replay.", category: "Analytics", connected: false, premium: false, official: false, actions: ["capture_event", "create_insight", "feature_flag"] },
  { id: "heap", name: "Heap", description: "Auto-capture analytics for web and mobile.", category: "Analytics", connected: false, premium: true, official: false, actions: ["define_event", "build_funnel", "analyze_path"] },
  { id: "looker", name: "Looker", description: "Business intelligence and data analytics by Google.", category: "Analytics", connected: false, premium: true, official: false, actions: ["run_query", "create_dashboard", "schedule_report"] },
  { id: "tableau", name: "Tableau", description: "Visual analytics and business intelligence.", category: "Analytics", connected: false, premium: true, official: false, actions: ["create_viz", "refresh_extract", "publish_workbook"] },
  { id: "hotjar", name: "Hotjar", description: "Heatmaps, session recordings, and user feedback.", category: "Analytics", connected: false, premium: false, official: false, actions: ["get_heatmap", "list_recordings", "create_survey"] },
  { id: "plausible", name: "Plausible", description: "Privacy-friendly, open-source web analytics.", category: "Analytics", connected: false, premium: false, official: false, actions: ["get_stats", "list_pages", "track_goal"] },

  // ── E-Commerce (12) ──
  { id: "shopify", name: "Shopify", description: "E-commerce platform for online stores.", category: "E-Commerce", connected: false, premium: false, official: true, actions: ["create_product", "update_inventory", "process_order"] },
  { id: "woocommerce", name: "WooCommerce", description: "WordPress e-commerce plugin.", category: "E-Commerce", connected: false, premium: false, official: true, actions: ["create_product", "update_order", "manage_coupons"] },
  { id: "bigcommerce", name: "BigCommerce", description: "E-commerce platform for growing businesses.", category: "E-Commerce", connected: false, premium: false, official: false, actions: ["add_product", "fulfill_order", "update_price"] },
  { id: "magento", name: "Magento", description: "Open-source e-commerce by Adobe.", category: "E-Commerce", connected: false, premium: true, official: false, actions: ["manage_catalog", "process_order", "configure_shipping"] },
  { id: "amazon-sp", name: "Amazon SP-API", description: "Sell on Amazon marketplace programmatically.", category: "E-Commerce", connected: false, premium: true, official: true, actions: ["list_product", "get_orders", "update_inventory"] },
  { id: "ebay", name: "eBay", description: "Online marketplace for buying and selling.", category: "E-Commerce", connected: false, premium: false, official: false, actions: ["create_listing", "revise_item", "get_orders"] },
  { id: "etsy", name: "Etsy", description: "Marketplace for handmade and vintage goods.", category: "E-Commerce", connected: false, premium: false, official: false, actions: ["create_listing", "update_inventory", "ship_order"] },
  { id: "printful", name: "Printful", description: "Print-on-demand fulfillment and warehousing.", category: "E-Commerce", connected: false, premium: false, official: false, actions: ["create_order", "sync_product", "get_shipping_rates"] },
  { id: "gumroad", name: "Gumroad", description: "Sell digital products and memberships.", category: "E-Commerce", connected: false, premium: false, official: false, actions: ["create_product", "get_sales", "send_update"] },
  { id: "lemonsqueezy", name: "Lemon Squeezy", description: "Payments, tax, and subscriptions for digital products.", category: "E-Commerce", connected: false, premium: false, official: false, actions: ["create_product", "manage_subscription", "get_orders"] },
  { id: "shipstation", name: "ShipStation", description: "Shipping and order fulfillment platform.", category: "E-Commerce", connected: false, premium: false, official: false, actions: ["create_label", "track_shipment", "batch_ship"] },
  { id: "aftership", name: "AfterShip", description: "Shipment tracking and delivery notifications.", category: "E-Commerce", connected: false, premium: false, official: false, actions: ["track_package", "send_notification", "get_metrics"] },

  // ── HR & Recruiting (10) ──
  { id: "bamboohr", name: "BambooHR", description: "HR software for small and medium businesses.", category: "HR & Recruiting", connected: false, premium: true, official: true, actions: ["add_employee", "request_pto", "run_report"] },
  { id: "workday", name: "Workday", description: "Enterprise cloud for HR and finance.", category: "HR & Recruiting", connected: false, premium: true, official: true, actions: ["create_worker", "submit_timesheet", "run_payroll"] },
  { id: "greenhouse", name: "Greenhouse", description: "Applicant tracking and recruiting platform.", category: "HR & Recruiting", connected: false, premium: true, official: true, actions: ["create_candidate", "schedule_interview", "move_stage"] },
  { id: "lever", name: "Lever", description: "Talent acquisition suite for modern hiring.", category: "HR & Recruiting", connected: false, premium: true, official: false, actions: ["add_candidate", "post_job", "send_offer"] },
  { id: "gusto", name: "Gusto", description: "Payroll, benefits, and HR for small businesses.", category: "HR & Recruiting", connected: false, premium: false, official: false, actions: ["run_payroll", "add_employee", "manage_benefits"] },
  { id: "rippling", name: "Rippling", description: "Unified HR, IT, and finance platform.", category: "HR & Recruiting", connected: false, premium: true, official: false, actions: ["onboard_employee", "manage_devices", "run_payroll"] },
  { id: "deel", name: "Deel", description: "Global payroll and compliance for remote teams.", category: "HR & Recruiting", connected: false, premium: true, official: false, actions: ["create_contract", "process_payment", "manage_compliance"] },
  { id: "ashby", name: "Ashby", description: "All-in-one recruiting platform with analytics.", category: "HR & Recruiting", connected: false, premium: false, official: false, actions: ["create_job", "track_pipeline", "schedule_interview"] },
  { id: "lattice", name: "Lattice", description: "People management for performance and engagement.", category: "HR & Recruiting", connected: false, premium: true, official: false, actions: ["create_review", "set_goal", "run_survey"] },
  { id: "personio", name: "Personio", description: "HR software for SMBs in Europe.", category: "HR & Recruiting", connected: false, premium: false, official: false, actions: ["manage_absence", "track_time", "onboard_hire"] },

  // ── Project Management (12) ──
  { id: "jira", name: "Jira", description: "Issue tracking and agile project management.", category: "Project Management", connected: false, premium: false, official: true, actions: ["create_issue", "update_status", "add_comment"] },
  { id: "asana", name: "Asana", description: "Work management platform for teams.", category: "Project Management", connected: false, premium: false, official: true, actions: ["create_task", "assign_user", "set_due_date"] },
  { id: "linear", name: "Linear", description: "Issue tracking for high-performance teams.", category: "Project Management", connected: false, premium: false, official: true, actions: ["create_issue", "move_state", "set_priority"] },
  { id: "trello", name: "Trello", description: "Visual boards for task and project management.", category: "Project Management", connected: false, premium: false, official: true, actions: ["create_card", "move_card", "add_checklist"] },
  { id: "notion", name: "Notion", description: "All-in-one workspace for notes, docs, and databases.", category: "Project Management", connected: false, premium: false, official: true, actions: ["create_page", "update_database", "query_table"] },
  { id: "monday", name: "monday.com", description: "Work operating system for team collaboration.", category: "Project Management", connected: false, premium: false, official: true, actions: ["create_item", "update_column", "move_group"] },
  { id: "clickup", name: "ClickUp", description: "All-in-one productivity and project management.", category: "Project Management", connected: false, premium: false, official: false, actions: ["create_task", "set_status", "log_time"] },
  { id: "basecamp", name: "Basecamp", description: "Project management and team communication.", category: "Project Management", connected: false, premium: false, official: false, actions: ["create_todo", "post_message", "upload_file"] },
  { id: "shortcut", name: "Shortcut", description: "Project management for software teams.", category: "Project Management", connected: false, premium: false, official: false, actions: ["create_story", "update_state", "link_pr"] },
  { id: "height", name: "Height", description: "Autonomous project management with AI.", category: "Project Management", connected: false, premium: false, official: false, actions: ["create_task", "set_attribute", "automate_workflow"] },
  { id: "airtable", name: "Airtable", description: "Spreadsheet-database hybrid for flexible workflows.", category: "Project Management", connected: false, premium: false, official: true, actions: ["create_record", "update_field", "list_records"] },
  { id: "smartsheet", name: "Smartsheet", description: "Enterprise work management and automation.", category: "Project Management", connected: false, premium: true, official: false, actions: ["add_row", "update_cell", "attach_file"] },

  // ── Storage & Files (10) ──
  { id: "s3", name: "Amazon S3", description: "Object storage for any amount of data.", category: "Storage & Files", connected: false, premium: false, official: true, actions: ["upload_file", "download_file", "list_objects"] },
  { id: "google-drive", name: "Google Drive", description: "Cloud file storage and collaboration.", category: "Storage & Files", connected: false, premium: false, official: true, actions: ["upload_file", "share_file", "create_folder"] },
  { id: "dropbox", name: "Dropbox", description: "Cloud storage and file synchronization.", category: "Storage & Files", connected: false, premium: false, official: true, actions: ["upload_file", "share_link", "list_folder"] },
  { id: "onedrive", name: "OneDrive", description: "Microsoft cloud storage and file sharing.", category: "Storage & Files", connected: false, premium: false, official: true, actions: ["upload_file", "create_link", "sync_folder"] },
  { id: "box", name: "Box", description: "Secure content management and collaboration.", category: "Storage & Files", connected: false, premium: true, official: true, actions: ["upload_file", "create_collaboration", "apply_policy"] },
  { id: "cloudinary", name: "Cloudinary", description: "Image and video management in the cloud.", category: "Storage & Files", connected: false, premium: false, official: false, actions: ["upload_image", "transform_media", "generate_url"] },
  { id: "minio", name: "MinIO", description: "High-performance S3-compatible object storage.", category: "Storage & Files", connected: false, premium: false, official: false, actions: ["put_object", "get_object", "list_buckets"] },
  { id: "backblaze", name: "Backblaze B2", description: "Affordable cloud storage and backup.", category: "Storage & Files", connected: false, premium: false, official: false, actions: ["upload_file", "download_file", "list_files"] },
  { id: "wasabi", name: "Wasabi", description: "Hot cloud storage with no egress fees.", category: "Storage & Files", connected: false, premium: false, official: false, actions: ["put_object", "get_object", "manage_bucket"] },
  { id: "google-sheets", name: "Google Sheets", description: "Cloud spreadsheets with API access.", category: "Storage & Files", connected: false, premium: false, official: true, actions: ["read_range", "write_range", "create_sheet"] },

  // ── Security (10) ──
  { id: "auth0", name: "Auth0", description: "Identity platform for authentication and authorization.", category: "Security", connected: false, premium: true, official: true, actions: ["create_user", "assign_role", "generate_token"] },
  { id: "okta", name: "Okta", description: "Enterprise identity and access management.", category: "Security", connected: false, premium: true, official: true, actions: ["create_user", "assign_app", "configure_mfa"] },
  { id: "clerk", name: "Clerk", description: "Authentication and user management for modern apps.", category: "Security", connected: false, premium: false, official: true, actions: ["create_user", "manage_session", "verify_email"] },
  { id: "vault", name: "HashiCorp Vault", description: "Secrets management and data protection.", category: "Security", connected: false, premium: true, official: false, actions: ["read_secret", "write_secret", "rotate_key"] },
  { id: "1password", name: "1Password", description: "Password management for teams and businesses.", category: "Security", connected: false, premium: true, official: false, actions: ["get_item", "create_vault", "share_secret"] },
  { id: "crowdstrike", name: "CrowdStrike", description: "Endpoint security and threat intelligence.", category: "Security", connected: false, premium: true, official: false, actions: ["scan_endpoint", "get_detections", "isolate_host"] },
  { id: "snyk", name: "Snyk", description: "Developer security for code, dependencies, and containers.", category: "Security", connected: false, premium: false, official: false, actions: ["test_project", "list_vulns", "monitor_deps"] },
  { id: "cloudflare", name: "Cloudflare", description: "CDN, DNS, DDoS protection, and edge computing.", category: "Security", connected: false, premium: false, official: true, actions: ["purge_cache", "create_rule", "manage_dns"] },
  { id: "letsencrypt", name: "Let's Encrypt", description: "Free TLS/SSL certificate authority.", category: "Security", connected: false, premium: false, official: false, actions: ["issue_cert", "renew_cert", "revoke_cert"] },
  { id: "doppler", name: "Doppler", description: "Universal secrets manager for teams.", category: "Security", connected: false, premium: false, official: false, actions: ["get_secrets", "set_secret", "sync_env"] },

  // ── AI & ML (12) ──
  { id: "openai", name: "OpenAI", description: "GPT models, DALL-E, and Whisper APIs.", category: "AI & ML", connected: false, premium: false, official: true, actions: ["chat_completion", "generate_image", "transcribe_audio"] },
  { id: "anthropic", name: "Anthropic", description: "Claude AI models for safe, helpful assistance.", category: "AI & ML", connected: false, premium: false, official: true, actions: ["chat_completion", "analyze_document", "generate_code"] },
  { id: "google-ai", name: "Google AI (Gemini)", description: "Multimodal AI models by Google.", category: "AI & ML", connected: false, premium: false, official: true, actions: ["generate_content", "embed_text", "analyze_image"] },
  { id: "mistral", name: "Mistral AI", description: "Open and efficient large language models.", category: "AI & ML", connected: false, premium: false, official: true, actions: ["chat_completion", "embed_text", "classify"] },
  { id: "huggingface", name: "Hugging Face", description: "Open-source ML model hub and inference API.", category: "AI & ML", connected: false, premium: false, official: true, actions: ["run_inference", "search_models", "deploy_endpoint"] },
  { id: "replicate", name: "Replicate", description: "Run ML models in the cloud with an API.", category: "AI & ML", connected: false, premium: false, official: false, actions: ["run_model", "create_prediction", "get_output"] },
  { id: "cohere", name: "Cohere", description: "NLP models for search, classification, and generation.", category: "AI & ML", connected: false, premium: false, official: false, actions: ["generate", "embed", "classify"] },
  { id: "pinecone", name: "Pinecone", description: "Vector database for ML and AI applications.", category: "AI & ML", connected: false, premium: true, official: true, actions: ["upsert_vectors", "query", "create_index"] },
  { id: "weaviate", name: "Weaviate", description: "Open-source vector search engine.", category: "AI & ML", connected: false, premium: false, official: false, actions: ["add_object", "search", "create_class"] },
  { id: "langchain", name: "LangChain", description: "Framework for building LLM applications.", category: "AI & ML", connected: false, premium: false, official: false, actions: ["run_chain", "create_agent", "use_tool"] },
  { id: "stability", name: "Stability AI", description: "Open-source generative AI models.", category: "AI & ML", connected: false, premium: false, official: false, actions: ["generate_image", "upscale", "edit_image"] },
  { id: "elevenlabs", name: "ElevenLabs", description: "AI voice synthesis and text-to-speech.", category: "AI & ML", connected: false, premium: true, official: false, actions: ["generate_speech", "clone_voice", "stream_audio"] },

  // ── Customer Support (10) ──
  { id: "zendesk", name: "Zendesk", description: "Customer service and support ticketing platform.", category: "Customer Support", connected: false, premium: false, official: true, actions: ["create_ticket", "update_status", "add_comment"] },
  { id: "intercom", name: "Intercom", description: "Customer messaging and support platform.", category: "Customer Support", connected: false, premium: true, official: true, actions: ["create_conversation", "send_message", "tag_user"] },
  { id: "freshdesk", name: "Freshdesk", description: "Cloud-based customer support software.", category: "Customer Support", connected: false, premium: false, official: true, actions: ["create_ticket", "assign_agent", "send_reply"] },
  { id: "helpscout", name: "Help Scout", description: "Help desk and customer support platform.", category: "Customer Support", connected: false, premium: false, official: false, actions: ["create_conversation", "assign_mailbox", "add_note"] },
  { id: "crisp", name: "Crisp", description: "All-in-one business messaging platform.", category: "Customer Support", connected: false, premium: false, official: false, actions: ["send_message", "resolve_conversation", "add_note"] },
  { id: "front", name: "Front", description: "Shared inbox and customer communication hub.", category: "Customer Support", connected: false, premium: true, official: false, actions: ["create_conversation", "assign_teammate", "apply_tag"] },
  { id: "tidio", name: "Tidio", description: "Live chat and chatbot platform.", category: "Customer Support", connected: false, premium: false, official: false, actions: ["send_message", "create_bot", "transfer_agent"] },
  { id: "drift", name: "Drift", description: "Conversational marketing and sales platform.", category: "Customer Support", connected: false, premium: true, official: false, actions: ["start_conversation", "book_meeting", "qualify_lead"] },
  { id: "kayako", name: "Kayako", description: "Unified customer service platform.", category: "Customer Support", connected: false, premium: false, official: false, actions: ["create_case", "assign_team", "send_reply"] },
  { id: "happyfox", name: "HappyFox", description: "Help desk and customer support ticketing.", category: "Customer Support", connected: false, premium: false, official: false, actions: ["create_ticket", "merge_tickets", "automate_reply"] },
];

/* ------------------------------------------------------------------ */
/*  Pre-built workflow templates                                       */
/* ------------------------------------------------------------------ */

const TEMPLATES: WorkflowTemplate[] = [
  { id: "tpl-lead-to-crm", name: "Lead Capture to CRM", description: "Capture form leads, enrich with Apollo, score, and push qualified leads to Salesforce.", integrations: ["apollo", "salesforce", "slack"], category: "Sales" },
  { id: "tpl-support-ticket", name: "Smart Support Triage", description: "Auto-classify support tickets, draft responses with AI, and escalate urgent issues.", integrations: ["zendesk", "openai", "slack"], category: "Support" },
  { id: "tpl-ecommerce-order", name: "Order Fulfillment Pipeline", description: "Sync Shopify orders to warehouse, generate shipping labels, and notify customers.", integrations: ["shopify", "shipstation", "twilio"], category: "E-Commerce" },
  { id: "tpl-content-pipeline", name: "Content Production Pipeline", description: "Generate blog posts from briefs, create social snippets, and schedule distribution.", integrations: ["openai", "buffer", "google-drive"], category: "Content" },
  { id: "tpl-invoice-sync", name: "Invoice Auto-Sync", description: "Match Stripe payments to QuickBooks invoices and reconcile automatically.", integrations: ["stripe", "quickbooks", "slack"], category: "Finance" },
  { id: "tpl-candidate-screen", name: "Candidate Screening Flow", description: "Score applicants from Greenhouse, enrich profiles, and notify hiring managers.", integrations: ["greenhouse", "anthropic", "slack"], category: "HR" },
  { id: "tpl-incident-response", name: "Incident Response Automation", description: "PagerDuty alert triggers Slack war room, gathers logs, and creates post-mortem.", integrations: ["pagerduty", "sentry", "slack"], category: "DevOps" },
  { id: "tpl-social-listening", name: "Social Listening & Response", description: "Monitor brand mentions, analyze sentiment, and auto-respond or escalate.", integrations: ["hootsuite", "anthropic", "hubspot"], category: "Marketing" },
];

/* ------------------------------------------------------------------ */
/*  Fuzzy search helper                                                */
/* ------------------------------------------------------------------ */

function fuzzyMatch(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((term) => lower.includes(term));
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function IntegrationMarketplace() {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<Category | "All">("All");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showTemplates, setShowTemplates] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState(INTEGRATIONS);

  // Derived counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { All: INTEGRATIONS.length };
    for (const i of INTEGRATIONS) {
      counts[i.category] = (counts[i.category] ?? 0) + 1;
    }
    return counts;
  }, []);

  // Filter integrations
  const filtered = useMemo(() => {
    return integrations.filter((i) => {
      const matchCategory = selectedCategory === "All" || i.category === selectedCategory;
      if (!matchCategory) return false;
      if (!search) return true;
      return (
        fuzzyMatch(i.name, search) ||
        fuzzyMatch(i.description, search) ||
        fuzzyMatch(i.category, search) ||
        i.actions.some((a) => fuzzyMatch(a, search))
      );
    });
  }, [integrations, selectedCategory, search]);

  // Filter templates
  const filteredTemplates = useMemo(() => {
    if (!search) return TEMPLATES;
    return TEMPLATES.filter(
      (t) =>
        fuzzyMatch(t.name, search) ||
        fuzzyMatch(t.description, search) ||
        fuzzyMatch(t.category, search)
    );
  }, [search]);

  const connectedCount = integrations.filter((i) => i.connected).length;
  const premiumCount = integrations.filter((i) => i.premium).length;
  const detail = detailId ? integrations.find((i) => i.id === detailId) ?? null : null;

  function toggleConnect(id: string) {
    setIntegrations((prev) =>
      prev.map((i) => (i.id === id ? { ...i, connected: !i.connected } : i))
    );
  }

  return (
    <div className="min-h-full bg-gray-50">
      {/* ── Header ── */}
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Integration Marketplace</h1>
            <p className="text-gray-500 text-sm mt-1">
              Browse and connect {INTEGRATIONS.length}+ integrations across {CATEGORIES.length} categories
            </p>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">{connectedCount}</div>
              <div className="text-xs text-gray-400">connected</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{INTEGRATIONS.length}</div>
              <div className="text-xs text-gray-400">available</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-amber-500">{premiumCount}</div>
              <div className="text-xs text-gray-400">premium</div>
            </div>
          </div>
        </div>

        {/* Search + controls */}
        <div className="flex items-center gap-3 mt-5">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search integrations, categories, or actions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode("grid")}
              className={clsx(
                "p-2 transition",
                viewMode === "grid" ? "bg-gray-900 text-white" : "bg-white text-gray-400 hover:text-gray-600"
              )}
            >
              <Grid3X3 size={14} />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={clsx(
                "p-2 transition",
                viewMode === "list" ? "bg-gray-900 text-white" : "bg-white text-gray-400 hover:text-gray-600"
              )}
            >
              <List size={14} />
            </button>
          </div>
          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition border",
              showTemplates
                ? "bg-blue-50 text-blue-600 border-blue-200"
                : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
            )}
          >
            <Zap size={12} />
            Templates
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-6">
        {/* ── Template Showcase ── */}
        {showTemplates && filteredTemplates.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Workflow Templates</h2>
                <p className="text-xs text-gray-400 mt-0.5">Pre-built automation recipes using popular integrations</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {filteredTemplates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm hover:border-blue-200 transition cursor-pointer group"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                      <Zap size={13} className="text-white" />
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">
                      {tpl.category}
                    </span>
                  </div>
                  <h3 className="font-semibold text-sm text-gray-900 group-hover:text-blue-600 transition">
                    {tpl.name}
                  </h3>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-2">{tpl.description}</p>
                  <div className="flex items-center gap-1.5 mt-3">
                    {tpl.integrations.slice(0, 3).map((intId) => {
                      const integration = INTEGRATIONS.find((i) => i.id === intId);
                      return (
                        <span
                          key={intId}
                          className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs"
                        >
                          {integration?.name ?? intId}
                        </span>
                      );
                    })}
                    <span className="text-xs text-blue-500 font-medium ml-auto group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                      Use <ArrowRight size={10} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Category Filter ── */}
        <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1">
          <Filter size={14} className="text-gray-400 shrink-0" />
          <button
            onClick={() => setSelectedCategory("All")}
            className={clsx(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap",
              selectedCategory === "All"
                ? "bg-gray-900 text-white"
                : "bg-white border border-gray-200 text-gray-500 hover:border-gray-300"
            )}
          >
            All ({categoryCounts["All"]})
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap",
                selectedCategory === cat
                  ? "bg-gray-900 text-white"
                  : "bg-white border border-gray-200 text-gray-500 hover:border-gray-300"
              )}
            >
              {cat} ({categoryCounts[cat] ?? 0})
            </button>
          ))}
        </div>

        {/* ── Integration Grid / List ── */}
        {viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filtered.map((integration) => (
              <div
                key={integration.id}
                onClick={() => setDetailId(integration.id)}
                className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm hover:border-gray-300 transition cursor-pointer group"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-sm font-bold text-gray-500">
                      {integration.name.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-1">
                        <span className="font-semibold text-sm text-gray-900">{integration.name}</span>
                        {integration.official && <CheckCircle size={11} className="text-blue-500" />}
                        {integration.premium && <Crown size={11} className="text-amber-500" />}
                      </div>
                      <span className="text-xs text-gray-400">{integration.category}</span>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{integration.description}</p>
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
                  <div className="flex gap-1">
                    {integration.actions.slice(0, 2).map((a) => (
                      <span key={a} className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs font-mono">
                        {a}
                      </span>
                    ))}
                    {integration.actions.length > 2 && (
                      <span className="px-1.5 py-0.5 bg-gray-100 text-gray-400 rounded text-xs">
                        +{integration.actions.length - 2}
                      </span>
                    )}
                  </div>
                  {integration.connected ? (
                    <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                      Connected
                    </span>
                  ) : integration.premium ? (
                    <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 text-xs font-medium flex items-center gap-0.5">
                      <Lock size={9} /> Premium
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {filtered.map((integration) => (
              <div
                key={integration.id}
                onClick={() => setDetailId(integration.id)}
                className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition cursor-pointer"
              >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-sm font-bold text-gray-500 shrink-0">
                  {integration.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-sm text-gray-900">{integration.name}</span>
                    {integration.official && <CheckCircle size={11} className="text-blue-500" />}
                    {integration.premium && <Crown size={11} className="text-amber-500" />}
                    <span className="text-xs text-gray-400 ml-2">{integration.category}</span>
                  </div>
                  <p className="text-xs text-gray-500 truncate">{integration.description}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {integration.connected ? (
                    <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                      Connected
                    </span>
                  ) : integration.premium ? (
                    <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 text-xs font-medium flex items-center gap-0.5">
                      <Lock size={9} /> Premium
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-400 text-xs">
                      Available
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <Search size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No integrations match your search</p>
            <button
              onClick={() => { setSearch(""); setSelectedCategory("All"); }}
              className="mt-2 text-xs text-blue-500 hover:text-blue-600"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* ── Results count ── */}
        {filtered.length > 0 && (
          <div className="text-center mt-6 text-xs text-gray-400">
            Showing {filtered.length} of {INTEGRATIONS.length} integrations
          </div>
        )}
      </div>

      {/* ── Detail Drawer ── */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20" onClick={() => setDetailId(null)} />
          <div className="relative w-full max-w-md bg-white shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-lg font-bold text-gray-500">
                  {detail.name.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h2 className="font-bold text-gray-900">{detail.name}</h2>
                    {detail.official && <CheckCircle size={13} className="text-blue-500" />}
                    {detail.premium && <Crown size={13} className="text-amber-500" />}
                  </div>
                  <span className="text-xs text-gray-400">{detail.category}</span>
                </div>
              </div>
              <button
                onClick={() => setDetailId(null)}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-5">
              <p className="text-sm text-gray-600 leading-relaxed">{detail.description}</p>

              {detail.premium && !detail.connected && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
                  <Crown size={14} className="text-amber-500 shrink-0" />
                  <p className="text-xs text-amber-700">
                    This is a premium integration. Upgrade your plan to connect.
                  </p>
                </div>
              )}

              {/* Status */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-20">Status</span>
                {detail.connected ? (
                  <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                    Connected
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">
                    Not connected
                  </span>
                )}
              </div>

              {/* Available actions */}
              <div>
                <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-2">
                  Available Actions
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {detail.actions.map((action) => (
                    <span
                      key={action}
                      className="px-2 py-1 bg-gray-100 text-gray-600 rounded-lg text-xs font-mono"
                    >
                      {action}
                    </span>
                  ))}
                </div>
              </div>

              {/* Related templates */}
              {TEMPLATES.filter((t) => t.integrations.includes(detail.id)).length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-2">
                    Related Templates
                  </h3>
                  <div className="space-y-2">
                    {TEMPLATES.filter((t) => t.integrations.includes(detail.id)).map((tpl) => (
                      <div key={tpl.id} className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                        <div className="flex items-center gap-1.5">
                          <Zap size={11} className="text-blue-500" />
                          <span className="text-sm font-medium text-blue-900">{tpl.name}</span>
                        </div>
                        <p className="text-xs text-blue-600 mt-1">{tpl.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Auth setup placeholder */}
              <div>
                <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-2">
                  Authentication
                </h3>
                <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                  <p className="text-xs text-gray-500">
                    {detail.connected
                      ? "This integration is authenticated and ready to use in your workflows."
                      : detail.premium
                        ? "Upgrade to Premium to configure authentication for this integration."
                        : "Click Connect below to set up API key or OAuth authentication."}
                  </p>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => toggleConnect(detail.id)}
                  disabled={detail.premium && !detail.connected}
                  className={clsx(
                    "flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium transition",
                    detail.connected
                      ? "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200"
                      : detail.premium
                        ? "bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200"
                        : "bg-blue-600 text-white hover:bg-blue-700"
                  )}
                >
                  {detail.connected ? "Disconnect" : detail.premium ? "Upgrade Required" : "Connect"}
                </button>
                <button className="px-3 py-2.5 rounded-lg border border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300 transition">
                  <ExternalLink size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
