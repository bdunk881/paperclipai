---
name: touchbistro
description: Use this skill when an AutoFlow agent needs to read or write data in TouchBistro — the iPad-based restaurant POS for cafes, bars, food trucks, quick-service, full-service independents, and smaller multi-unit operators below Toast's typical sweet spot. Pull orders / checks / payments / menu / staff data, react to closeout events, push daily sales to QuickBooks, manage online ordering integration, sync loyalty signals to Mailchimp/Klaviyo. Covers TouchBistro's reporting + POS API surfaces, the Venue / Order / Check / MenuItem / Staff model, and the workflow shape AutoFlow customers reach for (end-of-day reconciliation, menu price update, loyalty signal capture, online order routing).
---

# TouchBistro — iPad-based restaurant POS

TouchBistro is the leading iPad-native point-of-sale platform for AutoFlow's smaller-restaurant SMBs — cafes, bars, food trucks, neighborhood full-service restaurants, quick-service venues, breweries with food, small chains (2-10 locations). It's positioned below Toast in restaurant size + revenue and competes with Square for Restaurants and Clover at the smaller end.

Use TouchBistro when the customer is a **smaller restaurant** (under ~$2M annual revenue, simpler menu structure, often single-location) and chose it for the iPad-native simplicity. For larger / multi-location restaurants with complex menu engineering + reporting → Toast. For non-restaurant retail → Square POS.

## When to reach for this skill

- **End-of-day closeout** → roll the day's sales into a QBO journal entry (food, bev, alcohol, comps, tips, tax).
- **Menu update** → sync menu/price changes to the customer's online ordering provider (DoorDash, ChowNow, ToastTakeout, etc.) and marketing site.
- **Online order routing** → react to inbound online orders, ensure kitchen acknowledgment, ETA SMS to customer.
- **Loyalty signal** → push transactions to Mailchimp/Klaviyo for repeat-customer segmentation.
- **Anomaly detection** → unusual void/comp/discount rate by server (early fraud signal).
- **Tip-out reporting** → daily tip pool calculation by shift for staff payouts.
- **Inventory-aware menu** → 86 items when ingredients run low, optionally syncing to online ordering.

## Authentication

TouchBistro's developer API is **partner-program-mediated** (formal partner agreement required to access the broader API set). Two access paths:

- **TouchBistro Partner API (REST)** — once a partner agreement is in place, AutoFlow gets per-venue API credentials (client ID + secret) and exchanges via OAuth client-credentials:

  ```
  Authorization: Bearer <touchbistro-access-token>
  ```

- **TouchBistro Reporting API / data export** — for customers not yet on partner-API access, AutoFlow can ingest TouchBistro's scheduled daily/weekly CSV exports as a fallback.

AutoFlow's connection record captures `(venue_id, access_method, credentials)` per connection.

Base URL: `https://api.touchbistro.com/` (partner program; confirm path per latest docs at integration time)

## Venues + multi-location

A TouchBistro "venue" is a single restaurant location. Multi-location operators have one venue record per location. AutoFlow connections pin per-venue; brand-level reporting joins across them.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Venue | A restaurant location | Top-level scope |
| Order (Check) | A guest's order session | TouchBistro uses "check" interchangeably with order |
| Selection (Line Item) | A menu item ordered | Per check |
| Modifier | Options on a selection | "Extra cheese", "No onions" |
| Payment | A card/cash/digital transaction | One check can have multiple payments (split) |
| Menu Group / Menu Item | The pricebook structure | Categories → items → modifiers |
| Staff Member (User) | Employee record (server, kitchen, manager) | Used for tip-out + voids attribution |
| Shift | A staff member's clock-in window | Source for labor cost + tip-out |
| Customer | Recurring guest record (loyalty, gift card) | Light CRM layer |
| Comp / Void / Discount | Adjustments to a check | Compliance-tracked |
| Gift Card | Stored-value card | Inventory-tracked |

## Common AutoFlow workflows

### 1. End-of-day closeout → QBO journal entry

```
Cron routine at 4am next day (business day closes overnight for late-
service venues — restaurants don't honor calendar midnight) →
  1. GET orders for the prior business day (use venue's
     business-date if exposed; otherwise venue-local close time
     to close+24h window)
  2. Aggregate:
       food_sales (selections in food categories)
       bev_sales  (non-alcoholic)
       alcohol_sales (separate for many jurisdictions' tax reporting)
       comps + voids + discounts
       tips (separate by card vs cash)
       tax_collected
       net = sum(payments) - tips
  3. POST QBO /journalentry:
       Debit Bank "TouchBistro Clearing" (net deposit)
       Debit Comps expense (comps + voids + discounts)
       Credit Food Sales
       Credit Bev Sales
       Credit Alcohol Sales (split for jurisdictions with separate
                              alcohol-tax line)
       Credit Sales Tax Payable (tax_collected)
       Credit Tips Payable (tips)
       PrivateNote: "TouchBistro EOD for {venue} {business_date}"
```

### 2. Menu update → online-ordering sync

```
Webhook on menu.updated (or daily cron diff) → Routine fires →
  1. GET current menu via Reporting API
  2. Compare against last-synced version stored in workspace state
  3. For each changed item (added, modified, price-changed, 86'd):
       Translate to online-ordering provider's API
       (DoorDash, ChowNow, ToastTakeout, custom site CMS)
       PUT/PATCH the change at each connected provider
  4. Slack confirmation to #ops with the diff summary.
```

### 3. Online order routing + customer SMS

```
Webhook on order.created (where order_source = "online") → Routine fires →
  1. Verify routed to kitchen printer (TouchBistro handles natively,
     but check the order has a kitchen-ack timestamp; if not after
     5 min, alert the manager)
  2. POST Twilio SMS to customer:
       "Your order is in. Pickup at {ready_time} at {venue.address}.
        Reply CANCEL within 5 minutes to cancel."
  3. At ready_time -5min: SMS update — "Your order is ready in 5 min!"
  4. At ready_time +15min if uncollected (track via order_completed
     timestamp): manager Slack alert for re-warming or rebroadcast.
```

### 4. Loyalty signal → Mailchimp/Klaviyo

```
Cron routine daily →
  1. GET completed orders with customer.email present
  2. For each, POST a behavioral event to the customer's email-marketing
     platform:
       Mailchimp/Klaviyo: "Placed Order" event with order total, items,
                          visit timestamp
  3. The email platform's segmentation handles repeat-customer flows
     (welcome new, win back lapsed, VIP outreach).
```

### 5. Void/comp anomaly detection

```
Cron routine daily at 11am →
  1. GET prior business day's voids + comps + discounts grouped by
     staff member
  2. Compute each staff's voids_ratio = (voids + comps) / gross sales
  3. If any staff > 5% voids/comps ratio AND > $100 total: 
       Slack alert to manager: "{staff.name}: $XXX voids/comps on
       $YYY sales ({Z}%) yesterday — review"
  4. Tag in workspace HR table for follow-up.
  Note: this is a SIGNAL not a verdict; reviews are manager decisions.
```

### 6. Tip-out calculation

```
Cron routine at shift-end (or daily) →
  1. GET tips collected by server (cash + card-tip)
  2. Apply the venue's tip-out rules (e.g. "bartender 10% of bev sales,
     bussers 5% of food sales, kitchen 3% pool of all tips")
  3. Compute net tip-out per staff member
  4. Format for the operator's payroll system (Gusto, ADP) — manual
     entry or API write where supported
  5. Email/Slack the manager the tip-out summary for approval.
```

### 7. Inventory-aware 86

```
On low-stock signal (inventory minimum reached, manual mark by kitchen) →
  1. Mark the affected MenuItem as `86_d = true` in TouchBistro
  2. Propagate to online-ordering channels (DoorDash, ChowNow, etc.)
  3. Notify FOH (Front-of-house) via the venue's Slack #floor channel:
       "86: Salmon special. Pull from specials board."
  4. When restocked, automatically un-86 across all surfaces.
```

## Idempotency

TouchBistro's API does not consistently expose idempotency keys. For routine-driven writes (menu updates, customer record creates), dedupe via natural keys before writing:
- Customer: phone or email
- Menu items: SKU or item name within a venue
- Stored side-store of operations performed (with timestamps) avoids redo on retry

## Webhooks

TouchBistro webhook support varies by partner-program tier. For events not pushed, AutoFlow falls back to polling the Reporting API:
- Orders + payments: poll every 15 min during service hours
- Menu + staff: poll daily

When available, common topics:
- `order.created`, `order.completed`, `order.voided`
- `payment.received`
- `menu.updated`
- `shift.ended`

Signature verification: HMAC-SHA256 with per-subscription secret. Verify before processing.

## Rate limits

TouchBistro's API is sized for periodic reporting + targeted writes, not high-frequency polling. Respect documented per-venue limits; back off on 429.

## What this skill does NOT cover

- **TouchBistro Online Ordering** (their integrated online-ordering product) — handled inside TouchBistro UI; AutoFlow consumes the resulting orders via the standard Order entity.
- **Reservations** (their reservation product) — separate product surface; if a customer uses it, author its own skill.
- **Loyalty (TouchBistro Loyalty)** — their native loyalty add-on; if a customer enables it, use it instead of routing to Mailchimp/Klaviyo for the loyalty flow.
- **Marketing campaigns** — handled via Mailchimp/Klaviyo; TouchBistro provides the transaction signal.

## References

- API (partner access): https://www.touchbistro.com/partners/
- Reporting API: https://www.touchbistro.com/help/touchbistro-reporting/
- AutoFlow integration shape: `src/ticketSync/` (api_key or oauth2_pkce per partner agreement; per-venue credentials; CSV export fallback for non-partner customers)
