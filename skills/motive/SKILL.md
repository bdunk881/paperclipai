---
name: motive
description: Use this skill when an AutoFlow agent needs to read or write data in Motive (formerly KeepTruckin) — the fleet management + ELD (Electronic Logging Device) + dispatch platform for trucking SMBs, owner-operators, regional carriers, and field-service fleets. Pull drivers / vehicles / loads / HOS (hours of service) / inspections / fuel data, react to ELD + safety events, push driver pay to QuickBooks / payroll, manage compliance routines (DOT, IFTA, DVIR, HOS), automate load-status updates to brokers/shippers. Covers Motive's REST API + OAuth, the Driver / Vehicle / Load / HOS Log / Inspection / Asset model, trucking-specific regulatory compliance (DOT HOS limits, IFTA fuel reporting, DVIR pre/post-trip inspections, ELD mandate), and the workflow shape AutoFlow customers reach for (HOS compliance monitoring, load tracking, fuel cost reconciliation, driver pay reconciliation, DOT-audit-ready records).
---

# Motive (KeepTruckin) — fleet management + ELD + dispatch

Motive (rebranded from KeepTruckin in 2022) is the dominant fleet-management + ELD platform for AutoFlow's trucking + fleet SMBs — owner-operators, regional carriers (5-100 trucks), small fleets, field-service fleets (HVAC/plumbing trucks), agricultural/heavy-equipment fleets, food distribution fleets, construction fleets. Used by 100,000+ businesses managing ~1M+ vehicles.

Use Motive when the customer operates **commercial vehicles subject to DOT regulation** (typically over 10,000 lbs GVWR or carrying paid freight). For non-commercial vehicle tracking → consumer GPS apps. For dealership service → CDK. For independent auto repair shop → Shopmonkey.

## When to reach for this skill

- **HOS compliance** — Hours of Service: drivers can drive max 11 hours per 14-hour duty window, then 10-hour rest. AutoFlow monitors + alerts on approaching limits.
- **Load tracking + customer ETAs** — push real-time location to brokers/shippers; SMS customers when trucks are 30 min out.
- **DVIR (Daily Vehicle Inspection Report)** — DOT-required pre-trip + post-trip inspections; track completion + defect routing to repair queue.
- **Fuel reconciliation + IFTA** — Interstate Fuel Tax Agreement requires per-state fuel + mileage tracking for tax reporting.
- **Driver pay** — mileage-based, hourly, or per-load pay reconciliation; push to payroll.
- **Maintenance scheduling** — preventive maintenance by mileage/engine-hour; alert before due.
- **Safety event response** — hard brake, harsh turn, speeding events → coaching routine.
- **DOT audit prep** — pull last 6 months of records for audit per FMCSA rules.

## Authentication

Motive uses **OAuth 2.0** for partner integrations:

```
Authorization: Bearer <motive-access-token>
```

Standard authorization-code flow. Access tokens last ~1 hour; refresh tokens rotate on use.

Base URL: `https://api.gomotive.com/v2/`

Multi-company operators (operator + lease-on owner-operators) typically run separate Motive accounts; AutoFlow connection records pin per-company.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Company | The fleet operator | Top-level scope; has DOT number |
| Driver | A licensed CDL operator | Has unique HOS clock + log |
| Vehicle | A commercial truck/trailer | Tagged with VIN, plate, GVWR |
| Asset | Non-truck equipment (trailers, generators) | Tracked but no driver assignment |
| ELD Log | An HOS daily log (FMCSA-format) | Driving / On-Duty / Off-Duty / Sleeper Berth statuses |
| HOS Status | Current driver duty state | Live during shift |
| Load | A dispatched shipment | From pickup to delivery |
| DVIR | A daily vehicle inspection report | Pre-trip and post-trip |
| Defect | A reported equipment defect | Triggered by DVIR |
| Fuel Purchase | A fuel transaction | From card or manual entry |
| Inspection (DOT) | A roadside inspection event | Critical compliance record |
| Safety Event | A telemetry event (hard brake, harsh turn, speeding) | Coaching source |
| Route | A planned + tracked vehicle path | Source for ETA + mileage |
| Geofence | A defined location boundary | Used for arrival/departure events |

## Common AutoFlow workflows

### 1. HOS compliance monitoring + driver alerts

```
Continuous routine during operating hours →
  1. Check each driver's HOS status:
       Drive time used (max 11 hours per shift)
       Duty window used (max 14 hours from on-duty start)
       70-hour 8-day rolling clock
  2. At 1 hour remaining on any clock:
       SMS the driver: "Approaching HOS limit: {clock_type} 1hr remaining.
                        Plan stop-time."
       Notify dispatch to plan logistics around the upcoming stop
  3. At 30 minutes remaining:
       Final SMS + dispatch alert
  4. Violations (driving past limit) are DOT-reportable; the ELD records
     them automatically. AutoFlow's role is prevention.
  5. HOS violations are the #1 compliance citation for trucking; an
     HOS violation can cost $1000s + put the driver out of service.
```

### 2. Load tracking + customer ETA

```
Webhook on load.dispatched OR cron during transit →
  1. Pull current vehicle location from Motive every 5-15 min
  2. Compute ETA via Motive's routing or external Google Maps API
  3. At 30 min from delivery geofence:
       SMS the customer/receiver: "Driver {driver.first} arriving in
                                    ~30 minutes at {destination}."
  4. On arrival (geofence trigger):
       SMS customer: "Driver has arrived."
       SMS broker (if loaded for broker): "Arrived at {location}."
  5. On departure post-delivery:
       Update load status + notify next stop or back-to-yard.
```

### 3. DVIR compliance routine

```
Daily routine at start-of-shift +1 hour →
  1. Verify each on-duty driver has completed pre-trip DVIR
  2. For drivers with missing DVIR:
       SMS reminder + flag to dispatch (DOT requires DVIR before driving)
  3. For any DVIR with reported defects:
       Critical defect (brakes, tires, lights) → vehicle out of service
                                                  + repair routed immediately
       Non-critical → repair scheduled at next maintenance window
  4. Track defect-to-repair time + defect-recurrence by vehicle
     (fleet health metric).
  5. DVIR records must be retained 3 months per FMCSA rules; AutoFlow
     archives them with the workspace audit trail.
```

### 4. IFTA fuel + mileage reporting

```
Cron routine monthly (or quarterly per IFTA cycle) →
  1. Pull all fuel purchases for the period grouped by state
  2. Pull mileage by state (Motive's per-state mileage tracking)
  3. Compute per-state tax owed/refunded per IFTA rates
  4. Generate the IFTA quarterly report for filing
  5. Surface to operator's CPA for review before submission
  6. POST QBO entries for:
       Fuel expense (by state)
       Tax payable per state
  7. IFTA misreporting can result in audits + back-tax assessments;
     accuracy matters.
```

### 5. Driver pay reconciliation

```
Cron routine end-of-pay-period →
  1. For each driver, pull HOS logs + completed loads:
       Mileage-paid drivers: sum of paid miles × per-mile rate
       Per-hour drivers: on-duty hours × rate
       Per-load drivers: completed loads × per-load rate
       Bonuses (safety, retention, fuel-economy)
       Deductions (DOT physical, drug test, etc.)
  2. Generate pay statement
  3. Push to QuickBooks Payroll / Gusto / ADP
  4. Email driver their statement for transparency
  5. Track driver-pay accuracy (disputes are retention-killing).
```

### 6. Preventive maintenance scheduling

```
Cron routine daily →
  1. For each vehicle, compare current mileage + engine hours against
     PM schedule:
       Oil change every X miles
       DOT annual inspection (1 year)
       Brake inspection per fleet policy
       Tire rotation/replacement per wear pattern
  2. At 500 miles before due: schedule the service in fleet calendar
                              + notify dispatch to plan vehicle off-route time
  3. At due: vehicle marked for service; route to fleet shop or vendor
  4. Past-due: critical alert; running past-due maintenance compounds
     risk + can void warranty.
```

### 7. Safety event coaching

```
Webhook on safety_event.created → Routine fires →
  1. Categorize: hard brake, harsh acceleration, harsh turn,
     speeding, distracted driving (camera-detected), fatigue indicators
  2. Log to driver's safety scorecard
  3. For repeated/severe events:
       Surface to safety manager for coaching session
       Schedule 1-on-1 training session
       Track post-coaching event reduction
  4. For acute risk (severe speeding, multiple events in one trip):
       Immediate phone call to driver from dispatch/safety
  5. Track fleet safety score trend; CSA scores (FMCSA's safety
     scoring system) impact insurance + audit risk.
```

## Trucking-specific compliance — the regulatory weight

DOT/FMCSA regulations govern every aspect of commercial vehicle operation. AutoFlow routines must respect:

- **HOS (Hours of Service)** — Property carriers: 11hr drive max, 14hr duty window, 10hr off-duty rest, 70hr/8day rolling cycle. Passenger carriers different. ELD mandate (since 2017): electronic logging required for most commercial drivers; manual logs prohibited.
- **DVIR** — Pre-trip + post-trip inspections required; defects must be repaired before next use for critical items.
- **IFTA (International Fuel Tax Agreement)** — Quarterly fuel + mileage reporting by state for vehicles >26,000 lbs operating across state lines.
- **CDL (Commercial Driver's License)** — Drivers must have valid CDL with appropriate endorsements (HazMat, Tanker, Passenger). Track expirations.
- **DOT medical certificates** — Drivers must have current medical certificate; expirations DOT-recordable.
- **Drug + alcohol testing** — Pre-employment, random, post-accident, return-to-duty, reasonable-suspicion. Programs heavily regulated.
- **Roadside inspections** — DOT officers can inspect at any time; clean inspection history improves insurance + reduces audit risk.
- **CSA scores** — FMCSA's Compliance, Safety, Accountability scoring system; affects insurance + audit selection.
- **SCRA + ADA** — apply to trucking employment too.

## Idempotency

Motive's API supports idempotency on some POST endpoints. For routine-driven writes (dispatch decisions, status updates), dedupe via natural keys.

## Webhooks

Motive publishes webhooks for major events:
- `driver.hos_violation`
- `vehicle.location_update`
- `load.status_changed`
- `dvir.completed`, `dvir.defect_reported`
- `safety_event.created`
- `fuel_purchase.created`

Signature verification: HMAC with per-subscription secret. Verify before processing.

## Rate limits

Motive publishes per-company rate limits. Typically conservative for periodic syncs; 429 with `Retry-After`. Real-time location polling at 5-15 min intervals fits within limits for most fleets.

## What this skill does NOT cover

- **Dispatch optimization software** (McLeod, TMW) — separate transportation management systems with deeper load-board + dispatch UIs; Motive integrates with these.
- **Load board integration** (DAT, Truckstop) — Motive consumes posted loads; AutoFlow can read but typically doesn't write load board postings.
- **Carrier insurance management** — separate platforms (Reliance Partners).
- **Authority + carrier setup** (DOT number, MC authority) — one-time admin; not AutoFlow's flow.
- **Warehouse + dock scheduling** — separate tools at receiver locations.

## References

- API: https://developer.gomotive.com/
- FMCSA HOS rules: https://www.fmcsa.dot.gov/regulations/hours-service
- IFTA: https://www.iftach.org/
- DVIR requirements: https://www.fmcsa.dot.gov/regulations/title49/section/396.11
- AutoFlow integration shape: `src/ticketSync/` (oauth2_pkce + secrets-store; per-company credentials; HOS compliance alerts as highest-priority routines; DOT-audit-ready archival)
