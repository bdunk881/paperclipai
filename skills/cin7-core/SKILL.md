---
name: cin7-core
description: Use this skill when an AutoFlow agent needs to read or write inventory + order data in Cin7 Core (formerly DEAR Systems) — the inventory + warehouse + manufacturing platform for small-to-mid product businesses managing stock beyond what Shopify/POS provides. Pull products / stock-levels / sales orders / purchase orders / production orders, react to inventory events, sync to QuickBooks, fire reorder routines, manage multi-warehouse + multi-channel inventory. Covers Cin7 Core's REST API + API-key auth, the Product / Stock / SalesOrder / PurchaseOrder / ProductionOrder / Warehouse / Supplier model, and the workflow shape AutoFlow customers reach for (low-stock reorder, multi-channel inventory sync, landed-cost accounting, manufacturing BOM tracking).
---

# Cin7 Core (DEAR) — inventory + warehouse + light manufacturing

Cin7 Core (previously branded as DEAR Systems before the 2023 merger) is the leading inventory + warehouse + light-manufacturing platform for AutoFlow's product-business SMBs that have outgrown Shopify's basic inventory or a spreadsheet. Used by ecommerce brands, wholesalers, multi-channel sellers, light manufacturers, food + beverage producers, kit-assemblers, third-party logistics (3PL) clients.

Use Cin7 Core when the customer:
- Manages **inventory across multiple warehouses or channels** (Shopify + Amazon + wholesale + retail).
- Tracks **landed cost** (purchase price + freight + duties + handling).
- Runs **manufacturing or kit assembly** (Bills of Materials / BOMs).
- Needs **wholesale order management** beyond Shopify B2B.

For online-store-only operators with simple inventory → Shopify is enough. For high-volume warehouse operations → ShipStation handles ship-level needs; Cin7 sits upstream as the inventory source-of-truth.

## When to reach for this skill

- **Low-stock reorder** — daily sweep, auto-draft purchase orders for SKUs below min-stock per supplier.
- **Multi-channel inventory sync** — when a sale happens in any channel (Shopify, Amazon, eBay, wholesale), decrement the source-of-truth inventory and re-allocate to other channels.
- **Receiving** — when a PO arrives, increment stock + recalculate landed cost.
- **Manufacturing order** — assemble a kit or produce a finished good from BOM components; consume components, increment finished-good stock.
- **Wholesale sales order** → fulfillment → invoice → QBO.
- **Inventory valuation** — month-end report of total stock value at landed cost for QBO journal entry.
- **Cycle count** — periodic count routine to detect shrinkage early.

## Authentication

Cin7 Core uses **API key + Account ID** authentication:

```
api-auth-accountid: <account-id>
api-auth-applicationkey: <api-key>
Content-Type: application/json
```

Both values come from the customer's Cin7 Core account settings. AutoFlow's connection record holds them in the secrets store.

Base URL: `https://inventory.dearsystems.com/ExternalApi/v2/` (note: legacy DEAR domain; Cin7 Core API endpoints continue to use it as of 2026 — check current docs for migration to a unified Cin7 domain)

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Product | A SKU (finished good, raw material, kit) | The unit of inventory |
| Stock | On-hand quantity per Product per Location | Source of truth |
| Location (Warehouse) | A physical or virtual stocking site | Multi-warehouse customers |
| Supplier | A vendor | For purchase orders |
| Customer | A wholesale buyer | For sales orders |
| Sale | A sales order (wholesale or DTC) | Becomes invoice + fulfillment |
| Purchase | A purchase order to a supplier | Becomes goods receipt |
| Stock Adjustment | Manual increment/decrement | Cycle counts, write-offs |
| Stock Transfer | Move between Locations | Inter-warehouse moves |
| Production Order | Assemble a kit from BOM components | Manufacturing |
| BOM (Bill of Materials) | Recipe for a finished good | Component list + quantities |
| Price Tier | Wholesale tier pricing | "Distributor", "Reseller", "Retail" |
| Sale Channel | Sales source attribution | "Shopify", "Amazon", "Direct" |

## Common AutoFlow workflows

### 1. Low-stock reorder

```
Cron routine daily →
  1. GET /product/availability — products with available_stock below min_level
  2. Group by preferred_supplier (each product has a default supplier)
  3. For each supplier, draft a purchase order:
       POST /purchase with:
         supplier, location (destination warehouse),
         line[]: { product, quantity = reorder_qty, unit_cost = last_purchase_price }
       status = "Draft" (NEVER auto-authorize PO — purchasing decision needs human)
  4. Slack alert to purchasing manager with the draft PO link
  5. Manager reviews + authorizes in Cin7 UI.
```

### 2. Multi-channel inventory sync

```
Webhook on sale.created (any channel) → Routine fires →
  1. The sale already decrements Cin7 stock natively
  2. For other channels (Shopify, Amazon, etc.), check whether the
     channel's local inventory is currently in sync; if not, push the
     corrected level
  3. Cin7's native channel-integrations usually handle this; AutoFlow's
     role is exception handling (alert on sync failures, attempt re-push)
  4. For channels not natively connected, AutoFlow bridges (e.g. via the
     channel's API) — Shopify PUT inventoryLevel, Amazon Inventory submit
```

### 3. PO receiving → inventory + landed cost

```
Webhook on purchase.received (warehouse marked goods received) →
Routine fires →
  1. Stock increments natively
  2. Compute landed cost = unit_cost + freight_allocated + duties_allocated
     + handling_allocated
     (allocations per the customer's landed-cost policy — typically
     freight allocated by weight or value, duties by tariff classification)
  3. PATCH the receiving record with landed_cost values
  4. POST QBO entries:
       Debit Inventory (at landed cost)
       Credit Accounts Payable (at supplier invoice cost)
       Credit Freight Clearing (allocated freight, cleared when freight
                                  invoice is paid)
```

### 4. Manufacturing order — BOM consumption

```
Production order initiated (manual trigger in Cin7) → Routine fires →
  1. Verify component stock availability against BOM requirements
  2. If insufficient: Slack alert to production manager + flag PO needs
  3. On production complete: stock auto-decrements components,
     auto-increments finished good (Cin7 native)
  4. POST QBO entries for the WIP / cost-of-production movement:
       Debit Finished Goods (at standard cost or BOM rollup cost)
       Credit Raw Materials Inventory (component costs)
       Credit Labor / Overhead (if tracked)
  5. Update production scorecard (cycle time, yield, scrap rate).
```

### 5. Wholesale sales order → fulfillment → invoice

```
Wholesale customer places order (via portal, EDI, manual entry) →
  1. POST /sale with customer, line items, requested ship date
  2. Stock allocates against the order
  3. Pick-pack-ship in the warehouse (Cin7 + WMS integration)
  4. On fulfillment completion: ship + invoice
  5. POST QBO /invoice for the wholesale invoice; tagged by price tier
     + sale channel for revenue reporting
  6. SendGrid email the customer the invoice + tracking number.
```

### 6. Inventory valuation → QBO month-end

```
Cron routine on the last day of each month →
  1. GET /reports/stock-on-hand at month-end snapshot
  2. Aggregate by Location + Product type (raw material / WIP /
     finished good)
  3. Compute total inventory value at landed cost
  4. POST QBO /journalentry adjustment to reconcile QBO's Inventory
     account balance to Cin7's source-of-truth value
       Debit/Credit Inventory account (delta)
       Debit/Credit Inventory Adjustment expense
  5. Email/Slack the controller the month-end snapshot.
```

### 7. Cycle count → shrinkage alert

```
Scheduled routine (e.g. monthly per warehouse zone) →
  1. Surface a list of products to count to warehouse staff (UI task list)
  2. Compare counted quantities to Cin7's expected quantities
  3. For variances > tolerance:
       POST stock adjustment in Cin7 to reconcile to counted
       Tag the adjustment with "shrinkage", "damage", or "found"
       depending on direction + likely cause
  4. Aggregate monthly shrinkage % per warehouse for the loss-prevention
     dashboard.
```

## Idempotency

Cin7 Core does not consistently expose an idempotency-key header. For routine-driven writes:
- Sales orders: dedupe by external_id (set to AutoFlow's correlation ID — e.g. Shopify order ID)
- Purchase orders: dedupe by reference + supplier within a window
- Stock adjustments: dedupe by note + timestamp + location

## Webhooks

Cin7 Core supports webhooks for major events:
- `Sale.Order.Created`, `Sale.Order.Updated`
- `Purchase.Order.Created`, `Purchase.Order.Received`
- `Product.Created`, `Product.Updated`
- `StockAdjustment.Created`

Signature verification: webhook payloads carry a token in the URL or header (configured at subscription time). Verify before processing.

For events not pushed, fall back to incremental polling with `?LastModifiedSince=...`.

## Rate limits

- **60 requests/minute** per account (default).
- 429 returns standard `Retry-After`.
- Heavy reports (stock-on-hand snapshots, sales history) should run off-peak.

## What this skill does NOT cover

- **Cin7 Omni** (the enterprise SKU separate from Cin7 Core) — different platform, different API; author its own skill when a customer is on it.
- **Cin7 Connections** (their EDI service) — handled inside Cin7 Core's UI; AutoFlow consumes the resulting orders.
- **WMS-specific functionality** (mobile pick-pack apps, RF scanning) — Cin7 has a basic native WMS; serious operations layer on specialized WMS (Snapfulfil, Manhattan, etc.).
- **Demand forecasting** — third-party tools (Inventory Planner, Cogsy); Cin7's native forecasting is limited.

## References

- API: https://dearinventory.docs.apiary.io/
- Cin7 Core docs: https://help.cin7core.com/
- Webhooks: https://dearinventory.docs.apiary.io/#reference/webhook
- AutoFlow integration shape: `src/ticketSync/` (api_key + secrets-store; account-id + application-key pair; landed-cost policy captured at install)
