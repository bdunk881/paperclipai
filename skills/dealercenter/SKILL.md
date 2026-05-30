---
name: dealercenter
description: Use this skill when an AutoFlow agent needs to read or write data in DealerCenter — the dealer management system (DMS) for independent used-car dealerships, BHPH (buy here pay here) lots, small franchise dealers, and adjacent automotive resale operators. Pull inventory / leads / deals / customers / loans / payments, react to lead and deal events, push revenue to QuickBooks, manage compliance + state-DMV titling routines, run BHPH payment + collection routines, automate inventory listing across web channels. Covers DealerCenter's API + auth, the Inventory / Customer / Deal / Loan / Payment / Trade / Title model, automotive retail compliance (FTC Used Car Rule, Buyers Guide, state DMV titling, OFAC/red-flags, regulation Z + AAN for credit, BHPH-specific rules), and the workflow shape AutoFlow customers reach for (lead → deal → financing → titling → delivery, BHPH payment collection, inventory listing automation).
---

# DealerCenter — independent used-car dealership management

DealerCenter is the leading dealer management system (DMS) for AutoFlow's independent automotive-retail SMBs — independent used-car lots, BHPH (Buy Here Pay Here) dealers, small franchise dealers, RV dealers, motorcycle dealers, powersports dealers, boat dealers. Used by ~28,000+ dealerships. Competes with FrazerDMS, CarsForSale.com DMS, and other independent-dealer DMS tools.

Use DealerCenter when the customer is an **independent or small franchise dealer running pre-owned inventory + financing**. For new-car franchise dealers → CDK / Reynolds & Reynolds (enterprise franchise DMS). For independent auto repair shops (service only) → Shopmonkey.

## When to reach for this skill

- **Inventory acquisition** — when a vehicle is purchased at auction or traded in, intake routine (vehicle history check, recall lookup, photos, listing).
- **Lead → deal pipeline** — lead lands (website, CarGurus, Autotrader, walk-in) → salesperson assignment → test drive → deal structure.
- **Financing application** — submit credit application to lenders, track approvals, structure deal.
- **Titling + DMV** — state-specific titling paperwork; the regulatory hot zone of dealership operations.
- **BHPH payment collection** — for buy-here-pay-here lots, ongoing weekly/biweekly payment management.
- **Compliance: FTC Buyers Guide + warranty disclosure** — required on every used-car sale.
- **Inventory listing automation** — push inventory to multiple channels (CarGurus, Autotrader, Cars.com, Facebook Marketplace, dealer's own site).
- **Reconditioning + lot management** — track vehicles in detail (in recon, ready-to-sell, sold-not-delivered).

## Authentication

DealerCenter offers API access through partner-program integration:

```
Authorization: Bearer <dealercenter-access-token>
```

OAuth or API key per partner agreement. AutoFlow stores per-dealer credentials.

Base URL: `https://api.dealercenter.com/` (verify with current docs at integration time)

Multi-rooftop operators (chains): one DealerCenter account per rooftop typically; AutoFlow connections pin per-rooftop.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Dealer (Rooftop) | A dealership location | Top-level scope |
| Vehicle | A unit in inventory | VIN-keyed; YMM + odometer + condition |
| VIN Decode | Year/Make/Model/Engine info pulled from VIN | Foundation for everything |
| Customer (Buyer) | A purchase customer | Full PII for credit + titling |
| Co-Buyer | Joint applicant | Often spouse |
| Lead | A prospective customer not yet in a deal | Pre-purchase pipeline |
| Test Drive | Logged test-drive record | Sales activity |
| Deal | A structured offer or completed sale | Cash, finance, lease |
| Trade-In | Vehicle traded in toward purchase | Becomes new inventory |
| Loan | The financing agreement | Lender, term, APR, payment |
| Lender | Bank, credit union, or BHPH self-finance | Loan source |
| Payment | Money received (BHPH) | Loan amortization |
| Title | The vehicle title document | State-specific |
| Lien | Lender's security interest in vehicle | Recorded on title |
| Recall | Open manufacturer recall on a vehicle | Disclosure required |

## Common AutoFlow workflows

### 1. Inventory acquisition → intake

```
Triggered by vehicle purchase at auction or trade-in arrival →
Routine fires →
  1. VIN decode (year/make/model/options) — use NHTSA VIN API
  2. Run vehicle history check (Carfax, AutoCheck — paid per pull)
  3. Check NHTSA recalls — open recalls MUST be disclosed under FTC
     Used Car Rule (newer requirement)
  4. Capture photos — typical 25+ photos for online listing
  5. Reconditioning task list (clean, mechanical inspection, photos,
     pricing recommendation)
  6. Listing draft — pull comp pricing from market data
  7. Surface to inventory manager for review + go-live
  8. On approved go-live: push to all enabled listing channels.
```

### 2. Lead → assignment → contact cadence

```
Webhook on lead.created (CarGurus, Autotrader, website, walk-in entry) →
Routine fires →
  1. Match lead's vehicle interest against current inventory
  2. Assign to salesperson per rotation + availability rules
  3. Immediate SMS to salesperson: "New lead: {first_name} on
     {vehicle}. Contact info: {phone/email}"
  4. Salesperson is expected to respond within 5-15 min (industry
     benchmark: <5 min response = much higher close rate)
  5. Auto-send a courteous lead-confirmation SMS to customer:
       "Thanks for your interest in the {YMM} at {dealer.name}.
        {salesperson.first} will reach out within 15 minutes.
        Reply STOP to opt out."
  6. Track time-to-first-contact + lead-to-deal conversion.
```

### 3. Deal structure + financing application

```
Triggered by deal entry in DealerCenter → Routine fires →
  1. Capture deal structure: price, trade allowance, down payment,
     financing requested
  2. For financed deals: submit credit application to lenders
       Most independent dealers use DealerTrack or RouteOne to fan
       out applications to multiple lenders
       Track responses (approved with stipulations, declined, counter)
  3. Lender approval received: structure deal per lender requirements
  4. Surface to F&I (finance + insurance) staff for product offerings
     (extended warranty, GAP, etc.)
  5. NEVER auto-finalize deal terms — F&I review is mandatory
     compliance + sales conversation.
```

### 4. Titling + DMV (state-specific regulatory hot zone)

```
After deal completion → Routine fires →
  1. Identify the customer's state (buyer's residence determines
     titling jurisdiction in most cases)
  2. Generate state-specific paperwork:
       Title application
       Power of attorney (for dealer to process)
       Odometer disclosure (federal requirement under TIMA)
       Sales tax form
       Bill of sale
       Buyers Guide (FTC Used Car Rule — must be displayed in
                     window + provided to buyer)
       Open recall disclosure
       Warranty disclosure
       Truth in Lending disclosures (Reg Z, for financed)
  3. Track titling progress to DMV:
       Dealer submits paperwork to state DMV
       Receive title (some states issue immediately, some weeks-months)
       Lien recording (if financed)
       Title transfer to customer
  4. Late titling = state fines for the dealer; track deadlines per
     state (typically 30 days from sale).
  5. Title-jacketing fraud (failure to record liens, double-titling)
     is a serious felony; AutoFlow routines surface deadlines but
     human title clerks verify accuracy.
```

### 5. BHPH payment + collection routines

```
For Buy Here Pay Here dealers (where the dealer also finances):
  1. Weekly/biweekly payment cadence per loan terms
  2. Auto-debit from customer's bank account or card if enrolled
  3. Decline / missed payment → escalation ladder:
       Day 1: friendly SMS reminder + portal link
       Day 5: harder SMS + late fee per loan terms
       Day 10: phone call to customer (route to collections staff)
       Day 15+: state-law-specific repo notice required
       Day 30+: repo eligibility per state law
  4. NEVER auto-trigger repo — repossession is a legal action with
     significant due-process requirements (varies by state); always
     route to collections manager + per-state attorney review
  5. SCRA verification — active-duty military gets special protections
     under Servicemembers Civil Relief Act; verify before any repo
     escalation
  6. Track payment success rate + repo rate by underwriting cohort.
```

### 6. Compliance: Buyers Guide + OFAC/red-flags

```
On every sale → Routine fires →
  1. Generate the FTC Buyers Guide for the vehicle (As-Is vs Warranty,
     systems covered, dealer contact, complaint resolution)
     Must be in the window during display + provided in sale paperwork
  2. OFAC screening — federal law requires checking customer name
     against OFAC SDN (Specially Designated Nationals) list
     Surface match alerts to manager — never auto-clear
  3. Red Flags Rule (FACT Act) — identity verification for credit
     transactions; check for ID inconsistencies, flagged addresses,
     etc.
  4. Compliance audit trail archived per dealer's record-retention
     policy (typically 5 years).
```

### 7. Inventory listing automation

```
Cron routine throughout day →
  1. For each vehicle status-changed to "available":
       Sync to all enabled listing channels
       Standardize photo gallery, description, pricing
       Apply per-channel pricing strategy if different
  2. For status-changed to "sold":
       Pull listings from all channels immediately
       Prevent embarrassing "sold" listings still showing
  3. Track listing performance: views, leads per channel, cost per
     lead, lead-to-deal close rate.
```

## Automotive-retail compliance — the regulated stack

- **FTC Used Car Rule + Buyers Guide** — federally required disclosure on every used-vehicle sale (As-Is vs Warranty, defects, complaint resolution).
- **TIMA odometer disclosure** — Truth in Mileage Act federal requirement on title transfer.
- **Truth in Lending (Reg Z)** — APR + finance charges + total-of-payments disclosures.
- **Adverse Action Notice (AAN)** — if credit application is declined, customer must receive AAN with specific reasons + credit-reporting bureau info.
- **OFAC + Red Flags Rule** — customer identity verification + sanctions screening for credit transactions.
- **State titling laws** — varies wildly; deadlines (typically 30 days), required forms, taxes.
- **BHPH-specific** — many states have caps on interest rates (or none); repo procedure due-process requirements vary; some states require notarized power of attorney.
- **CARS Rule (FTC, 2024)** — banned "junk fees" + required price-display rules; review for compliance per current effective date.
- **SCRA** — active-duty military protections from defaults, repos, foreclosures.

## Idempotency

DealerCenter's API has variable idempotency support. For routine-driven writes (titling tasks, listing updates), dedupe via natural keys (VIN + status + timestamp).

For customer + deal upserts, dedupe by SSN or driver's license + DOB before creating.

## Webhooks

DealerCenter publishes webhooks for major events (varies by partner agreement):
- `lead.created`
- `vehicle.added`, `vehicle.sold`
- `deal.created`, `deal.completed`
- `payment.received`, `payment.failed`
- `title.received`, `title.transferred`

Signature verification: HMAC with per-subscription secret. Verify before processing.

## Rate limits

DealerCenter publishes per-account rate limits in partner portal. Typically conservative for periodic syncs; 429 with `Retry-After`.

## What this skill does NOT cover

- **Floor plan financing** (NextGear, Ally) — wholesale lending to dealers; separate financial product.
- **Auction bidding software** (Manheim, ADESA, IAA) — separate platforms used to acquire inventory; DealerCenter receives the result.
- **Vehicle history report ordering at scale** — Carfax/AutoCheck API for batch use; per-call cost matters.
- **Marketing CRM beyond DealerCenter** — many dealers layer DealerSocket or VinSolutions; consume their data via separate skills.
- **Repair order management** — for dealerships running service shops alongside sales, that's CDK-DMS or specialty tools.

## References

- API: https://www.dealercenter.com/ (partner agreement required)
- FTC Used Car Rule + Buyers Guide: https://www.ftc.gov/business-guidance/resources/dealers-guide-used-car-rule
- FTC CARS Rule (2024): https://www.ftc.gov/legal-library/browse/rules/combating-auto-retail-scams-rule
- TIMA odometer: https://www.fhwa.dot.gov/motor_carrier_safety/tima/
- NHTSA recalls: https://www.nhtsa.gov/recalls
- SCRA: https://scra.dmdc.osd.mil/scra/
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce or api_key + secrets-store; per-rooftop credentials; state-titling-deadline tracking; SCRA + OFAC gate on credit + repo routines)
