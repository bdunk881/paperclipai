---
name: honeybook
description: Use this skill when an AutoFlow agent needs to read or write data in HoneyBook — the all-in-one client-flow + business-management platform for creative + service SMBs (photographers, wedding planners, event planners, designers, consultants, coaches, marketing freelancers, doulas, makeup artists). Pull clients / projects / contracts / invoices / sessions, react to inquiry and milestone events, push billing to QuickBooks, automate client-flow stages, manage contracts via DocuSign-like integrated signing, and run follow-up routines. Covers HoneyBook's REST API + OAuth, the Project / Client / Workflow / Smart File (contract/invoice/proposal) / Session model, creative-business-specific considerations (rights/licensing language, deposit + payment schedule discipline), and the workflow shape AutoFlow customers reach for (inquiry → booked, project lifecycle, milestone-driven client-flow automation).
---

# HoneyBook — all-in-one creative + service SMB client management

HoneyBook is the dominant client-flow + business-management platform for AutoFlow's creative + service SMBs — wedding + event photographers, videographers, planners, designers, doulas, makeup artists, hair stylists for events, calligraphers, florists, consultants, coaches, marketing freelancers, copywriters. Used by ~250,000+ creative + service professionals.

Use HoneyBook when the customer is a **solo or small-team creative / service professional** running inquiry → proposal → contract → payment → delivery as a complete flow. Distinct from Calendly (just scheduling), HubSpot (CRM-centric), or DocuSign (just signing) — HoneyBook bundles all of these for the creative SMB shape.

## When to reach for this skill

- **New inquiry → response routine** — speed-to-lead is the single biggest factor in inquiry-to-booked conversion for creative SMBs.
- **Proposal sent → follow-up cadence** — the gap between sent and signed has predictable drop-off; structured follow-up materially lifts conversion.
- **Contract signed → onboarding** — welcome flow, payment schedule setup, questionnaire collection, scheduling.
- **Payment schedule management** — most creative work has deposit + milestone + final structure; track + remind.
- **Project milestone reminders** — sessions, consults, deliverables; nudge both ways.
- **Final delivery → post-delivery routine** — gallery delivery, review request, referral ask, testimonial collection.
- **Year-end clean-up** — tax-form prep, 1099 contractor management for second-shooters/assistants.

## Authentication

HoneyBook offers OAuth 2.0 for partner integrations:

```
Authorization: Bearer <honeybook-access-token>
```

Standard authorization-code flow. Access tokens last ~1 hour; refresh tokens rotate on use.

Base URL: `https://api.honeybook.com/v2/` (verify with current docs at integration time — HoneyBook's API is partner-program-mediated for production access)

Multi-team accounts (small studios with associates): treat each team member as a sub-account; AutoFlow connections pin per-team.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Workspace | The user's business account | Top-level scope |
| Client | The booked or prospective customer | One per couple/family/business |
| Project | A booked job (wedding, family session, brand-design engagement) | Central organizing unit |
| Inquiry | A prospective project (pre-booked) | Source of conversion pipeline |
| Smart File | A combined contract+invoice+proposal (HoneyBook's signature primitive) | Replaces separate contract + invoice + proposal |
| Workflow | Automated sequence template (auto-email, task creation, etc.) | Powers client-flow automation |
| Session | A scheduled client meeting (consult, shoot, etc.) | Calendar primitive |
| Invoice | Stand-alone billing record | Often embedded in Smart File |
| Payment Schedule | Milestone-based payment plan | Deposit → midpoint → final |
| Questionnaire | Client intake form | Pre-event details, branding info, etc. |
| Brochure | Pricing + package menu | For inquiry response |
| Contract | Signed agreement | Part of Smart File or standalone |
| Lead Source | Where the inquiry came from | Marketing attribution |

## Common AutoFlow workflows

### 1. New inquiry → speed-to-lead response

```
Webhook on inquiry.created → Routine fires →
  1. Within 5 minutes of receipt:
       Auto-acknowledge SMS + email:
         "Thanks for reaching out about your {event_type}! I'm so
          excited to learn more. I'll be in touch within {24 hours}
          with a personal note + our pricing brochure."
  2. Within 24 hours:
       Surface to creative for personal response (do NOT auto-send
       canned proposal — high-touch matters for creative work)
       Provide the inquiry context + brochure suggestion + similar-
       past-project references
  3. Track inquiry-to-response time as a KPI (industry benchmark:
     response within 1 hour ~3x conversion vs >24 hours).
```

### 2. Proposal sent → structured follow-up

```
Webhook on smart_file.sent (where contains proposal) → Routine fires →
  1. Cron 3 days later: friendly check-in if not viewed
       Email + SMS: "Just making sure my proposal didn't get lost in
                     your inbox. Any questions about the {event} details?"
  2. Cron 7 days later: if viewed but not signed:
       Personal SMS — surface to creative for tailored note
  3. Cron 14 days later: gentle "final follow-up" + offer to call
  4. Track conversion: % proposals → contracts (industry benchmark
     varies wildly by niche; wedding photography ~30-50%).
```

### 3. Contract signed → onboarding routine

```
Webhook on smart_file.signed → Routine fires →
  1. Send welcome packet via email:
       What to expect timeline
       Payment schedule details
       Questionnaire link (for event details, color preferences, etc.)
       Schedule for any consults/calls
  2. Process deposit payment (autopay if enrolled)
  3. Schedule key milestones on creative's calendar:
       Consult/strategy call
       Day-before reminder
       Event/session day
       Delivery date
  4. Slack/SMS the creative: "🎉 Booked! {client_name} for {event}
                              on {date}. Onboarding kicked off."
```

### 4. Payment schedule management

```
Cron routine daily →
  1. For each active project with upcoming payment milestone:
       At 14d before: reminder email + SMS to client
       At 7d before: SMS + link to portal
       At 1d before: final reminder
       At due date: process autopay if on file
       If decline / not received: dunning routine
  2. On all payments cleared: project moves to fulfillment-ready stage.
  3. Track AR aging by project + creative.
```

### 5. Pre-event reminder cadence

```
Cron routine daily →
  1. For each upcoming Session/event (typical for photographers,
     planners):
       At 30d out: confirmation + final-details questionnaire
       At 14d out: timeline + day-of contacts confirmation
       At 7d out: weather check + final logistics
       At 2d out: "looking forward, see you soon" + creative's phone
       At 1d out: morning-of texts
  2. Day-of: creative-facing "today's schedule" summary
  3. Post-event same-day: thank-you note from creative.
```

### 6. Post-delivery → review + referral

```
Webhook on project.delivered (gallery delivered, final asset sent) →
Routine fires →
  1. Send delivery confirmation + how-to-use guide:
       "Here's everything from your event! How to download, share,
        print, etc."
  2. Cron 3 days later: review request
       SMS: "Loved working with you! Mind leaving a quick review?
              Google: {link}  Wedding directory: {link}"
  3. Cron 14 days later: referral ask
       Email: "Know anyone else getting married this year? We have
              a referral thank-you when they book."
  4. Cron 30 days later: anniversary-ready content reminder
       (for wedding photographers — "your first dance picture would
        make a great anniversary post")
  5. Track review rate + referral conversion (a referred client is
     worth significantly more LTV than a cold inquiry).
```

### 7. Year-end 1099 contractor management

```
Cron routine January 5 →
  1. Pull contractor payment records from the year for:
       Second photographers / shooters
       Assistants
       Stylists, editors, etc.
  2. Identify contractors with total payments >$600 (IRS 1099-NEC
     threshold)
  3. Generate 1099 forms via QBO or specialty tool
  4. Surface to creative for review before filing
  5. File electronically via IRS FIRE or service provider.
```

## Creative-business considerations

- **Rights + licensing language** in contracts — copyright + usage rights are common dispute points. HoneyBook's contract templates include this; AutoFlow shouldn't modify standard language without creative + legal review.
- **Deposit non-refundability** — most creative contracts make the deposit non-refundable (covers held date). Customer disputes can be sensitive; surface to creative.
- **Model releases** for usage rights (sharing the work) — separate from main contract.
- **Sales tax on services** — varies by state for creative services (CA, TX exempt; some states tax photography). Don't auto-charge tax without confirming state.
- **Reschedules (pandemic-era pattern)** — creative weddings are often rescheduled; AutoFlow should accommodate rescheduling routines without losing deposit-tracking discipline.
- **Independent contractor classification** — many creatives are sole proprietors / LLCs; tax discipline matters.

## Idempotency

HoneyBook's API supports idempotency on Smart File + payment writes. For routine-driven writes, use deterministic keys.

For client + project upserts, dedupe by email + project name before creating.

## Webhooks

HoneyBook publishes webhooks for major events:
- `inquiry.created`, `inquiry.converted`
- `smart_file.sent`, `smart_file.viewed`, `smart_file.signed`
- `project.created`, `project.status_changed`
- `payment.completed`, `payment.failed`
- `session.scheduled`, `session.completed`

Signature verification: HMAC with per-subscription secret. Verify before processing.

## Rate limits

HoneyBook publishes per-account rate limits in their partner portal. Typically conservative for solo/small-team accounts; 429 with `Retry-After`. Heavy reports off-peak.

## What this skill does NOT cover

- **Gallery delivery platforms** (Pixieset, ShootProof, CloudSpot) — separate tools photographers use for client galleries; HoneyBook tracks delivery completion.
- **Studio management at scale** (Studio Ninja, Iris Works) — alternative platforms with similar shape.
- **Email marketing** beyond basic client-flow — route through Mailchimp/Klaviyo.
- **Booking calendar embed customization** — HoneyBook provides; AutoFlow doesn't drive.
- **Tax preparation** beyond 1099 forms — accountant work.

## References

- API: https://www.honeybook.com/developers (partner program access)
- IRS Pub 1779 (independent contractor): https://www.irs.gov/forms-pubs/about-form-1099-nec
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce + secrets-store; speed-to-lead routine is highest-leverage configuration; creative-personalization gates on auto-responses)
