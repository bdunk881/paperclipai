---
name: twilio
description: Use this skill when an AutoFlow agent needs to send or receive SMS, WhatsApp, or voice messages via Twilio — outbound notifications (order shipped, payment failed, appointment reminder), inbound message handling (customer reply → CRM update), verification (OTP for two-factor), or programmable voice (callbacks, IVR). Covers the Account SID + Auth Token model, the Messaging / Voice / Verify / Conversations API surfaces, and the workflow shape AutoFlow customers reach for (Shopify shipment → SMS update, missed call → Slack alert, Calendly booking → SMS confirmation).
---

# Twilio — SMS, voice, WhatsApp, verification

Twilio is the dominant programmable-communications platform for AutoFlow's SMB segment. It handles every customer touch that goes over a phone number: order updates, appointment reminders, two-factor codes, missed-call callbacks, and (for customers with WhatsApp Business approval) WhatsApp messaging.

## When to reach for this skill

- **Outbound notification** — order shipped (Shopify/ShipStation), payment failed (Stripe), appointment reminder (Calendly), refund processed (Zendesk).
- **Inbound reply** — customer texts back → CRM activity log + auto-reply or human handoff.
- **OTP / 2FA verification** — sign-up flow needs to confirm phone ownership.
- **Programmable voice** — missed-call callback routine, IVR for support routing, recorded message blasts.
- **WhatsApp Business** — same surface for international or chat-preferred customer segments.

## Authentication

Twilio uses **Account SID + Auth Token** as Basic Auth credentials:

```
Authorization: Basic base64(<account-sid>:<auth-token>)
```

`Account SID` starts with `AC` and is non-sensitive (visible in the dashboard URL). `Auth Token` is the secret — rotate via Console if it leaks.

For multi-tenant SaaS apps, Twilio's **Subaccounts** model lets you create per-customer subaccounts under your main account. Each gets its own SID + token, scoped to its own phone numbers + usage. AutoFlow's `ticketSync` schema (`src/ticketSync/`) handles the `api_key` auth method.

API Keys (`SK*` prefix) are a longer-lived alternative for service-to-service auth where you want to revoke a specific integration without rotating the master auth token.

Base URL: `https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/`

Other product subdomains: `verify.twilio.com`, `conversations.twilio.com`, `studio.twilio.com`, etc. Each Twilio sub-product has its own base — check the docs per call.

## Core API surface

### Messaging (SMS, MMS, WhatsApp)

| Resource | Endpoint | What it's for |
|---|---|---|
| Message | `/Messages` | Send an outbound message; list inbound + outbound history |
| Phone Number | `/IncomingPhoneNumbers` | Provision a number to send/receive from |
| Messaging Service | `/Services/{sid}` (messaging.twilio.com) | Pool of numbers with smart routing (long codes, short codes, alphanumeric senders) |
| Media | `/Messages/{sid}/Media/{media_sid}` | Inbound MMS attachments |

### Voice

| Resource | Endpoint | What it's for |
|---|---|---|
| Call | `/Calls` | Initiate an outbound call; list call history |
| Recording | `/Recordings/{sid}` | Captured audio from a call |
| Conference | `/Conferences/{sid}` | Multi-party call setup |

### Verify (OTP)

| Resource | Endpoint | What it's for |
|---|---|---|
| Verification | `/Services/{sid}/Verifications` (verify.twilio.com) | Send an OTP via SMS/voice/email |
| Verification Check | `/Services/{sid}/VerificationCheck` | Validate a user-entered code |

### Conversations (multi-channel threads)

| Resource | Endpoint | What it's for |
|---|---|---|
| Conversation | `/Conversations/{sid}` (conversations.twilio.com) | Threaded SMS/WhatsApp/web-chat |
| Participant | `/Conversations/{sid}/Participants` | Add a customer or agent |
| Message | `/Conversations/{sid}/Messages` | Append to the thread |

## Common AutoFlow workflows

### 1. Shopify order shipped → SMS update

```
ShipStation webhook tracking.created (or Shopify orders/fulfilled) → Routine fires →
  1. GET Shopify order for customer.phone (or HubSpot contact's phone)
  2. POST /Messages
       To: customer.phone (E.164 format: +14155552671)
       From: workspace's verified number (or MessagingServiceSid)
       Body: "Hi {first_name}, your order {order_number} shipped! Track: {short_url}"
  3. Log to HubSpot timeline as an SMS activity.
```

### 2. Stripe payment failed → SMS + email cascade

```
Stripe webhook invoice.payment_failed → Routine fires →
  1. Look up the customer's preferred contact channel (custom HubSpot field)
  2. If "sms":
       POST /Messages with a polite "your payment didn't go through" message
       + a link to update payment method
  3. If "email":
       Trigger the existing Mailchimp dunning sequence
  4. Both channels: PATCH HubSpot deal stage to "payment-recovery".
```

### 3. Calendly booking → SMS confirmation + day-before reminder

```
Calendly webhook invitee.created → Routine fires →
  1. POST /Messages immediately: "You're booked for {date} at {time}. Reply CANCEL to cancel."
  2. Schedule a cron 24h before the event_start_time:
       POST /Messages "Reminder: meeting tomorrow at {time}. Reply with questions."
  3. Listen for inbound CANCEL replies (webhook) → trigger Calendly cancel
     + CRM update.
```

### 4. Two-factor OTP for sensitive routine

```
User initiates a sensitive action in the AutoFlow dashboard
(e.g. "transfer funds", "delete workspace") → Routine fires →
  1. POST verify.twilio.com /Services/{verify_sid}/Verifications
       To: user.phone, Channel: "sms"
  2. User enters the 6-digit code in the dashboard
  3. POST verify.twilio.com /Services/{verify_sid}/VerificationCheck
       To: user.phone, Code: "123456"
       → status: "approved" (proceed) or "pending" (retry).
```

### 5. Inbound reply → CRM activity log + routing

```
Twilio webhook on the messaging service URL → Routine fires →
  1. Verify the X-Twilio-Signature header
  2. Lookup contact by From phone in HubSpot
  3. POST HubSpot timeline event with the SMS body
  4. If body contains support-class keywords ("refund", "broken"):
       Open a Zendesk ticket with the SMS as the initial message
       Assign to the Billing or Technical group based on keywords
  5. Optionally: POST /Messages with an auto-acknowledgment.
```

## Idempotency

`Idempotency-Key` is not exposed in the public API. For routines that must not double-send (e.g. payment-failed SMS), check-before-send:

```
GET /Messages?To={phone}&DateSentAfter={now - 5min}
→ if any message body matches the intended send, skip.
```

Or, encode a unique correlation ID in a custom message URL/short-link so re-sends are detectable post-hoc.

## E.164 phone numbers

**Always send phone numbers in E.164 format** (`+14155552671`, not `(415) 555-2671`). Twilio rejects non-E.164. Use `libphonenumber` or Twilio's `/PhoneNumbers/{number}` lookup API to normalize before storing.

## Webhooks

Configured per-phone-number or per-messaging-service in the Twilio Console (or via API):

```
PUT /IncomingPhoneNumbers/{sid}
body:
  SmsUrl: https://autoflow.example/webhooks/twilio/{workspace_id}/sms-inbound
  VoiceUrl: https://autoflow.example/webhooks/twilio/{workspace_id}/voice-inbound
  StatusCallback: https://autoflow.example/webhooks/twilio/{workspace_id}/status
```

Signature verification: `X-Twilio-Signature` is an HMAC-SHA1 of (URL + sorted-form-params) using your auth token. **Verify before processing** — the official Twilio SDKs have built-in helpers.

Webhook payloads are **form-encoded**, not JSON. Twilio is the exception in our integration stack.

## Rate limits

- **Concurrent send limit** per messaging service (~100 msg/sec for short codes, ~1 msg/sec for unregistered long codes; 10K8/sec for toll-free verified).
- 429 returns standard `Retry-After`.
- For bulk sends (>1,000 recipients), use the Messaging Service queue with `validity_period` set conservatively.

## What this skill does NOT cover

- **TwiML markup** — Twilio's verb-based XML for voice flows. Useful for IVR but more involved than this skill; author its own file when an AutoFlow customer needs voice IVR.
- **Twilio Flex** (contact-center product) — separate API and pricing tier.
- **SendGrid email** — Twilio-owned but separate product; use the existing Mailchimp skill for marketing email and SendGrid skill (TBD) for transactional.
- **Number compliance / 10DLC registration** — done in the Twilio Console; the customer's ops team handles it.

## References

- API: https://www.twilio.com/docs/usage/api
- Messaging: https://www.twilio.com/docs/sms
- Verify: https://www.twilio.com/docs/verify/api
- Conversations: https://www.twilio.com/docs/conversations
- Signature validation: https://www.twilio.com/docs/usage/webhooks/webhooks-security
- AutoFlow integration shape: `src/ticketSync/` (api_key + secrets-store; SubaccountSid per workspace for multi-tenant)
