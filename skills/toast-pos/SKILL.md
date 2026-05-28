---
name: toast-pos
description: Use this skill when an AutoFlow agent needs to read or write data in Toast — pull orders / checks / payments / menu items from a restaurant Toast account, push sales into QuickBooks, react to order events, sync customer loyalty data, or read labor data for shift reporting. Covers Toast's restaurant-specific data model (Restaurant / Check / Item / Selection / Payment / Server / Shift), partner-style auth, the workflow shape AutoFlow customers reach for (close of business → QBO journal, menu update → catalog sync, loyalty sign-up → Mailchimp).
---

# Toast — restaurant POS

Toast is the dominant point-of-sale platform for AutoFlow's restaurant SMB segment (independent restaurants, small chains, food trucks, fast-casual). Like Square, it owns the in-restaurant payments + hardware, but its data model is restaurant-specific (Check ≠ Order; Selection ≠ Line Item; Menu Group hierarchy; Server attribution; Comp/Void distinction).

Use Toast *instead of* Square POS when the customer is specifically a restaurant — Toast's reporting, menu modeling, and reconciliation are calibrated for F&B operations in ways Square's general POS isn't.

## When to reach for this skill

- **End-of-day reconciliation** → roll the day's checks + payments into a QBO journal entry covering food sales, beverage sales, comps, tips, refunds, processing fees.
- **Menu sync** → push the latest Toast menu items to a customer's online ordering or marketing site.
- **Loyalty sign-up** → when a Toast guest joins loyalty, sync to Mailchimp/Klaviyo for nurture.
- **Comp / void anomaly detection** → daily check for unusual void or comp rates by server (early fraud indicator).
- **Labor reporting** → pull shift data per restaurant for the labor-cost dashboard.
- **Online ordering ingestion** → Toast online orders → kitchen routine, customer SMS via Twilio.

## Authentication

Toast uses a **partner-style OAuth** flow specifically designed for SaaS integrations:

1. Customer goes through Toast's partner authorization UI in the Toast Admin app.
2. Toast issues a `clientId` + `clientSecret` per integration, scoped to **specific restaurants** the customer authorized.
3. AutoFlow exchanges these for an access token via `/authentication/v1/authentication/login`.

```
Authorization: Bearer <toast-access-token>
Toast-Restaurant-External-ID: <restaurant-guid>
```

The `Toast-Restaurant-External-ID` header is **required on most calls** — it scopes the request to a specific restaurant location. A customer with multiple restaurants under one ownership has one auth grant but many restaurant GUIDs; AutoFlow's connection record must enumerate them at install and let the customer pick.

Tokens are short-lived (~30 minutes); re-mint before expiry using the saved clientId + clientSecret. There's no refresh-token flow per se — every token exchange uses the credentials.

Base URL: `https://ws-api.toasttab.com/`

Sandbox: `https://ws-sandbox-api.toasttab.com/` for testing. Production data is real money — confirm env before any write.

## Core API surface

| Resource | Endpoint | What it's for |
|---|---|---|
| Restaurant Config | `/restaurants/v1/restaurants` | The restaurant's own settings, services, locations |
| Menus | `/menus/v2/menus` | Full menu tree (groups → items → modifiers) |
| Orders | `/orders/v2/orders` | All orders (dine-in, takeout, delivery, online) — paginated, time-ranged |
| Single Order | `/orders/v2/orders/{guid}` | Full order with all checks + selections |
| Checks | embedded in order | One order can have multiple checks (split tables) |
| Selections | embedded in check | Toast's term for line items |
| Payments | `/orders/v2/payments` | Card + cash + comp / voucher payments per check |
| Restaurant Reports | `/labor/v1/timeEntries`, `/labor/v1/shifts` | Labor data per restaurant |
| Loyalty | `/loyalty/v1/cards` | Loyalty card + member data |
| Guests | `/crm/v1/guests` | Customer records from Toast CRM |

## Common AutoFlow workflows

### 1. End-of-day reconciliation → QBO journal entry

```
Cron routine at 4am the next day (after the previous day's business
day closes — restaurant business days don't end at midnight) →
  1. GET /orders/v2/ordersBulk?startDate={prev_business_day}&endDate={prev_business_day_end}
     (paginate; busy restaurants have hundreds of orders)
  2. Walk orders[].checks[] for each:
       gross_sales = sum of selection.price across all selections
       comps       = sum of selection.appliedDiscounts.amount where type=comp
       voids       = sum of selection.price where voided=true
       net_sales   = gross_sales − comps − voids
       tips        = sum of payment.tipAmount across all payments
       refunds     = sum of payment.refundAmount where exists
       cc_fees     = (estimate; Toast statement settlement has actuals)
  3. POST QBO /journalentry:
       Debit Bank "Toast Clearing" (net_deposit)
       Debit Processing Fees expense (cc_fees)
       Debit Comps expense (comps)
       Credit Food Sales (food_net_sales)
       Credit Beverage Sales (bev_net_sales)
       Credit Tips Payable (tips)
       PrivateNote: "Toast EOD for {restaurant_name} {business_date}"
```

### 2. Comp / void anomaly detection

```
Cron routine daily at 11am →
  1. GET orders for the previous business day
  2. Aggregate comps + voids per server (createdEmployeeId)
  3. Compute server's voids_ratio = (voids / gross_sales)
  4. If any server's voids_ratio > 5% AND total voids > $100:
       POST Slack alert to #managers:
       "{server.name}: $XXX voids on $YYY sales ({Z}%) yesterday — review"
  5. Tag the server in the AutoFlow workspace's HR table for follow-up.
```

### 3. Loyalty sign-up → Mailchimp / Klaviyo

```
Toast webhook (or daily poll on /loyalty/v1/cards?modifiedSince=...) →
Routine fires →
  1. For each new loyalty member with email:
       POST /lists/{loyalty-list-id}/members upsert (Mailchimp pattern)
       Tag with "toast-loyalty", "restaurant-{restaurant_guid}"
  2. Optional: enroll in the "Welcome to our loyalty program" journey.
```

### 4. Menu sync to customer marketing site

```
On webhook or daily cron →
  1. GET /menus/v2/menus for the full menu tree
  2. Transform to the customer's site CMS shape (Sanity, Contentful, etc.)
  3. PUT to the site CMS; the site rebuilds itself
  4. Slack confirmation to #ops with the diff (added/removed/changed items).
```

### 5. Online order → kitchen + customer SMS

```
Toast webhook orders.create (where order.diningOption.behavior=takeout) →
Routine fires →
  1. POST Twilio SMS to order.guest.phone:
       "Your order is in. Pickup at {readyTime} at {restaurant.address}.
        Reply CANCEL to cancel within 5 minutes."
  2. Optional: print to the kitchen printer via a separate routine
     (Toast handles native printing, but AutoFlow agents can also chain
     extra notifications to a backup printer or expo display).
```

## Idempotency

Toast's API is generally read-heavy for AutoFlow workflows — most writes happen inside the restaurant's POS, not from outside. For the writes AutoFlow does perform (CRM upserts on the loyalty side, menu pushes back), use Toast's natural unique keys (`guid`, `externalId`) and check-then-write.

## Business day vs calendar day

Restaurants don't close at midnight. Toast's business day for a given restaurant is configurable (typically ends 3-5am). All time-ranged queries should use the restaurant's `businessDate` rather than calendar dates.

```
GET /orders/v2/ordersBulk?businessDate=20260527
```

Cron routines reading "yesterday's data" should query `businessDate` for the previous business day, not "calendar yesterday."

## Webhooks

Toast supports webhooks via the `/eventnotifications/v1/eventnotifications` config. Configure subscriptions per restaurant:

```
POST /eventnotifications/v1/eventnotifications
body:
  callbackUrl: "https://autoflow.example/webhooks/toast/{workspace_id}/{restaurant_guid}"
  events: ["orders.create", "orders.modified", "loyalty.cardEnrolled"]
```

Signature verification: `Toast-Signature` is an HMAC of body with a per-subscription secret returned at create time. Verify before processing.

Webhook reliability is moderate; AutoFlow routines should also support a daily backfill cron from `/orders/v2/ordersBulk?businessDate=...` to catch missed events.

## Rate limits

- **5 requests/sec** per access token per restaurant.
- 429 returns standard `Retry-After`.
- Bulk endpoints exist for orders + menus; use them for daily reconciliation rather than iterating single GETs.

## What this skill does NOT cover

- **Toast Online Ordering** customization — its own product layer; AutoFlow customers usually configure it in Toast's UI.
- **Toast Marketing** (Toast's native email product) — overlaps with Mailchimp / Klaviyo; pick one.
- **Toast Payroll** — separate add-on; if the customer uses it, route payroll JE the same as Gusto.
- **Toast Capital** (lending) — financial product, not on AutoFlow's path.
- **Kitchen Display System** — Toast handles it natively; AutoFlow only chains extras.

## References

- API: https://doc.toasttab.com/openapi/
- Authentication: https://doc.toasttab.com/doc/devguide/apiAuthenticationLogin.html
- Orders API: https://doc.toasttab.com/openapi/orders/
- Webhooks: https://doc.toasttab.com/openapi/eventnotifications/
- Business dates: https://doc.toasttab.com/doc/devguide/businessDateLogic.html
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce-style flow + secrets-store; enumerate authorized restaurants at install; 30-minute token TTL)
