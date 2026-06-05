# Composio documentation index (sitemap)

Source: `https://docs.composio.dev/llms.txt` (read 2026-06-05). **Clean markdown of any page = append `.md`** (e.g. `https://docs.composio.dev/docs/authentication.md`). Entire docs in one file: `https://docs.composio.dev/llms-full.txt`. Repo: `https://github.com/ComposioHQ/composio` (MIT). Dashboard: `https://dashboard.composio.dev`. Backend/API base: `https://backend.composio.dev/api/v3.1`.

✅ = read line-by-line this session (captured in SKILL.md).

## Getting Started
- /docs ✅ · /docs/quickstart ✅ (note: the TS quickstart uses `@composio/claude-agent-sdk`)

## How it works / Sessions
- /docs/how-composio-works ✅ · /docs/configuring-sessions · /docs/tools-and-toolkits · /docs/sessions-vs-direct-execution · /docs/workbench

## Providers
- /docs/providers ✅ · /docs/providers/anthropic ✅ · /openai · /vercel · /google · /langchain · /autogen · /crewai · /llamaindex · /mastra
- /docs/providers/custom-providers · /custom-providers/typescript · /custom-providers/python

## Toolkits & Tools
- /docs/toolkits/fetching-tools-and-toolkits · /toolkits/enable-and-disable-toolkits · /toolkits/custom-tools-and-toolkits
- /docs/tools-direct/fetching-tools ✅ · /tools-direct/authenticating-tools · /tools-direct/executing-tools ✅ · /tools-direct/custom-tools ✅ · /tools-direct/toolkit-versioning
- /docs/tools-direct/modify-tool-behavior/schema-modifiers · /before-execution-modifiers ✅ · /after-execution-modifiers
- /docs/native-tools-vs-mcp ✅ · /docs/proxy-execute · /docs/cli

## User Authentication
- /docs/authentication ✅
- /docs/authenticating-users/in-chat-authentication ✅ · /manually-authenticating ✅ · /shared-connections
- /docs/custom-app-vs-managed-app ✅ · /docs/white-labeling-authentication ✅
- /docs/importing-existing-connections ✅ · /docs/managing-multiple-connected-accounts ✅ · /docs/subscribing-to-connection-expiry-events ✅

## Auth Configuration
- /docs/auth-configuration/custom-auth-configs ✅ · /white-labeling ✅ · /programmatic-auth-configs ✅ · /custom-auth-params · /connected-accounts ✅ · /migrating-initiate-to-link

## Triggers & Webhooks
- /docs/triggers ✅ · /docs/setting-up-triggers/creating-triggers ✅ · /subscribing-to-events ✅ · /managing-triggers · /docs/webhook-verification ✅

## Projects / Org / Observability
- /docs/projects ✅ · /docs/observability · /observability/logs · /observability/usage · /docs/signing-up-as-an-agent · /docs/common-faq · /docs/glossary ✅ · /docs/debugging-info

## Migration (legacy → v3 / sessions / tool-router)
- /docs/migration-guide · /migration-guide/direct-to-sessions · /tool-router-beta · /toolkit-versioning · /new-sdk

## Troubleshooting
- /docs/troubleshooting/{api,authentication,cli,dashboard,mcp,sdks,tools,triggers}

## API Reference (v3) — exact REST request/response schemas (fetch when wiring backend calls)
- /reference/v3/api-reference/{auth-configs, connected-accounts, toolkits, tools, triggers, mcp, files, migration, organization, projects, tool-router, webhook-endpoints, webhook-subscriptions}
- /reference/v3/{authentication, errors, rate-limits}
- Meta tools: /reference/meta-tools/{search_tools, get_tool_schemas, manage_connections, multi_execute_tool, remote_bash_tool, remote_workbench}

## SDK Reference
- TypeScript: /reference/sdk-reference/typescript/{composio, auth-configs, connected-accounts, tools, toolkits, triggers, mcp, tool-router-session, remote-file}
- Python: /reference/sdk-reference/python/{composio, auth-configs, connected-accounts, tools, toolkits, triggers, mcp, tool-router-session}

## Cookbooks (worked examples)
- /cookbooks/app-connections-dashboard ✅ (our Integrations page) · /background-agent · /chat-app · /fast-api · /hono · /gmail-labeler · /pr-review-agent · /slack-summariser · /supabase-sql-agent · /support-agent · /tool-generator · /workplace-search · /templates

## Hosted MCP
- "Rube" = ComposioHQ's hosted MCP server (500+ apps; Cursor/Claude Desktop). See repo README.
