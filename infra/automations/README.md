# Power Automate Templates

## Apollo Reply → Attio Contact Routing

**File:** `apollo-reply-to-attio-contact.json`

Monitors the Apollo reply mailbox for new emails and automatically upserts contacts into Attio, tagging them with `source = May5Launch` and setting the pipeline stage to `Prospect`.

### Flow steps

1. **Trigger** — Office 365 "When a new email arrives" on the Apollo reply mailbox folder
2. **Parse sender** — Extracts sender email, subject, and reply body
3. **Upsert contact** — `PUT /v2/objects/people/records?matching_attribute=email_addresses` to Attio (creates or updates by email)
4. **Set pipeline stage** — `PUT /v2/lists/{pipeline}/entries` to place the contact at the `Prospect` stage

### Import instructions

1. Go to [Power Automate](https://make.powerautomate.com) → **My flows** → **Import** → **Import Package (Legacy)** or **Import a flow**.
2. Upload `apollo-reply-to-attio-contact.json`.
3. Configure connections when prompted:
   - **Office 365** — select or create a connection for the Apollo reply mailbox account.
4. Set flow parameters:
   - `attio_api_token` — your Attio API bearer token (Settings → Developers → API in Attio).
   - `apollo_mailbox_folder` — mailbox folder name (default: `Inbox`). Change if Apollo replies land in a subfolder.
   - `attio_pipeline_slug` — your Attio pipeline/list slug (default: `sales_pipeline`). Find yours via `GET https://api.attio.com/v2/lists`.
5. Turn on the flow.

### Prerequisites

- M365 E5 subscription (Power Automate included)
- Attio API token with scopes: `record_permission:read-write`, `list_entry:read-write`, `object_configuration:read`, `list_configuration:read`
- A `source` attribute (text or select) configured on the People object in Attio
- A pipeline list with a `stage` status attribute that includes a `Prospect` option

### Customization notes

- To route to a specific Attio workspace, update the API base URL if using a non-default region.
- The `source` tag value (`May5Launch`) is hardcoded in the upsert body — change it in the JSON if running a different campaign.
- Polling interval is set to 3 minutes. Adjust the trigger's `recurrence.interval` to change frequency.
