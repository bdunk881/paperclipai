---
name: trainerize
description: Use this skill when an AutoFlow agent needs to read or write data in Trainerize — the online + hybrid personal training platform for independent personal trainers, online fitness coaches, online nutrition coaches, small studio personal-training operations, and adjacent fitness-coaching SMBs. Pull clients / programs / workouts / check-ins / payments, react to client engagement and program-completion events, push billing to QuickBooks, automate progress-check + accountability cadences, manage program design + delivery, and handle subscription billing. Covers Trainerize's API + auth, the Client / Program / Workout / Schedule / Check-In / Habit / Message / Subscription model, online-coaching-specific considerations (scope of practice for non-RDs giving nutrition guidance, liability waivers, asynchronous communication discipline), and the workflow shape AutoFlow customers reach for (new client onboarding, weekly check-ins, program-completion cycles, subscription retention).
---

# Trainerize — online + hybrid personal training management

Trainerize (an ABC Fitness Solutions product) is the leading platform for AutoFlow's online + hybrid personal-training SMBs — independent personal trainers running online-only or hybrid in-person/online coaching, small studio PT operations with online-delivery capability, online fitness coaches (powerlifting, bodybuilding prep, running, mobility, postpartum, etc.), online nutrition coaches (within scope of practice), small wellness/coaching collectives. Used by 200K+ trainers globally.

Use Trainerize when the customer is an **online or hybrid personal trainer or fitness coach** delivering programs through an app. For studio-only group classes → Mindbody / Glofox. For one-on-one in-person scheduling → Calendly / Acuity. For nutrition-anchored clinical work → Practice Better.

## When to reach for this skill

- **New client onboarding** — intake form, goals + history collection, program design kickoff, app onboarding.
- **Weekly check-in cadence** — clients report progress (weight, measurements, photos, energy, adherence); trainer responds with adjustments + accountability.
- **Program completion → reassessment** — 8/12-week programs typically; end-of-program review + next-program design.
- **Subscription billing** — most coaches use monthly subscription model; renewals + churn handling.
- **Habit + adherence tracking** — daily logging compliance (meals, water, sleep, mobility); nudges on gaps.
- **Workout completion** — celebrate completed workouts; check-in on missed.
- **Async messaging** — clients message trainer with form questions, mindset issues; trainer responds within agreed window.
- **Group challenge / cohort routines** — many trainers run 30-day challenges or cohort programs.

## Authentication

Trainerize / ABC Fitness offers API access through partner program:

```
Authorization: Bearer <trainerize-access-token>
```

OAuth-style per partner agreement. AutoFlow stores per-trainer credentials.

Base URL: `https://api.trainerize.com/v1/` (verify with current docs at integration time; ABC Fitness has been consolidating endpoints)

Multi-trainer business setups: one Trainerize account per business; AutoFlow connections pin per-account. Multi-coach studios: each coach may have separate client visibility within one account (role-based).

## Regulatory framing

Online fitness coaching has its own scope-of-practice constraints:

- **Personal trainers vs registered dietitians** — most personal trainers are NOT licensed/credentialed to provide individualized nutrition plans for medical conditions; certifying bodies (NASM, ACE, NSCA) typically prohibit it. AutoFlow routines must not auto-generate or route detailed nutrition recommendations for medical conditions without confirming the coach's RD/CNS credentials.
- **Liability waivers** — every client should sign before starting workouts; surface waiver status.
- **Medical clearance** — for clients with pre-existing conditions, age above thresholds, etc., medical clearance from a physician is often recommended; trainer + AutoFlow surfaces, doesn't replace medical advice.
- **Telehealth / health coaching law variance** — some states regulate health coaching; varies by claim/scope.
- **Pregnancy + special populations** — typically require specialized certification; trainer scope discipline.

## Core entity model

| Entity | What it is | Notes |
|---|---|---|
| Trainer (Coach) | The fitness/wellness professional | Top-level (or per-coach within studio) |
| Client | The person being coached | Has goals + history + program assignments |
| Program | A multi-week training program template | Can be assigned to many clients |
| Workout | An individual workout (warmup, sets, cooldown) | Building block of programs |
| Schedule | A client's assigned workouts on calendar | Time-bound delivery |
| Exercise | A movement (squat, deadlift, push-up) | With video, instructions, alternatives |
| Check-In | Periodic client progress report | Weekly typical; weight, photos, measurements |
| Habit Tracker | Daily habit log (water, steps, sleep, etc.) | Adherence signal |
| Message | Async messaging thread | Client-trainer communication |
| Subscription | Recurring billing record | Monthly or longer terms |
| Payment | Money received | Stripe under the hood typically |
| Group Challenge | Multi-client cohort program | Engagement + community |
| Meal Plan | Nutrition plan (within scope) | Trainer-authored typically |
| Progress Photo | Periodic body photos | Sensitive; private |

## Common AutoFlow workflows

### 1. New client onboarding → program kickoff

```
Webhook on client.created (often via Stripe subscription) → Routine fires →
  1. Send welcome email + app-install instructions
  2. Schedule intake form completion:
       Goals (specific, measurable: weight loss, strength gain, etc.)
       Training history + current activity
       Health questionnaire (PAR-Q+ or similar — pre-activity screening)
       Equipment available (home gym? commercial? minimal?)
       Schedule availability (when can train + how often)
       Liability waiver signature
  3. SMS reminder if not completed in 48h
  4. On completion: notify trainer for program design
  5. Schedule trainer's program-design task (typically 24-72h turnaround
     per trainer's promise to client)
  6. Track time-to-first-workout-assigned (a key client-satisfaction
     metric).
```

### 2. Weekly check-in cadence

```
Cron routine weekly (typically Mon morning after weekend) →
  1. SMS each active client:
       "Time for your weekly check-in! Log your progress in the app:
        - Weight + measurements
        - Photos (front/side/back)
        - How was the week? Energy, sleep, adherence?
        - Any questions?
        Link: {app_deeplink}"
  2. Cron 48h reminder if not completed
  3. Surface to trainer for response within agreed window
       (typically 24-48h; missing trainer response is the #1 cause
       of subscription churn)
  4. Trainer responds with:
       Adjustments to next week's program
       Accountability + encouragement
       Q&A
  5. Track check-in completion rate (adherence proxy) + trainer
     response time (service quality).
```

### 3. Workout completion celebration + miss-handling

```
Webhook on workout.completed → Routine fires →
  1. Quick celebration SMS:
       "🔥 Workout done! Great job. {workout_name} complete."
       (Or in-app push notification for high-engagement clients)
  2. Daily routine for clients with scheduled-but-not-completed:
       At end-of-day SMS: "Missed today's workout — want to reschedule
                            or push it? No judgment, life happens."
  3. For 3+ consecutive missed workouts:
       Surface to trainer for personal check-in (often a life-event
       indicator; trainer relationship building > automated re-engagement)
```

### 4. Program completion → reassessment

```
Cron routine when assigned program reaches end-date →
  1. SMS client + trainer:
       "{program_name} is complete! Time for your end-of-program
        check-in: full measurements, photos, performance metrics."
  2. Schedule trainer's assessment task
  3. Trainer reviews vs starting baseline; decides next program
  4. New program assigned; routine repeats
  5. End-of-program is a critical retention moment — clients often
     decide whether to continue at this milestone.
```

### 5. Subscription billing + retention

```
Stripe webhook on subscription.payment_failed →
Routine fires →
  1. SMS client: "Your subscription payment didn't process.
                  Update payment: {portal_link} or call us at {phone}."
  2. Retry per Stripe dunning sequence
  3. After 14 days unresolved:
       Surface to trainer for personal conversation (often a financial-
       hardship indicator; trainer can offer pause or downgrade rather
       than losing client entirely)
  4. On subscription canceled:
       Light farewell from trainer (not transactional save-the-sale)
       60d later: comeback offer if appropriate
  5. Track churn cohort patterns by program type, trainer, tenure.
```

### 6. Habit + adherence nudges

```
Cron routine daily →
  1. For each client with active habit goals (steps, water, sleep):
       Check today's logged compliance vs target
       If completed: positive reinforcement note (in-app, low-friction)
       If gaps multiple days running: surface to trainer for context-
       sensitive nudge (NOT automated guilt — health behavior change
       requires trust + relationship)
  2. Habit tracking is a multiplier for primary-goal progress;
     adherence > program-perfection.
```

### 7. Group challenge / cohort routines

```
Triggered when trainer launches a 30/60/90-day group challenge →
  1. Pre-launch: enrollment routine, expectations setting, group access
  2. Launch day: kickoff message + first workout
  3. Throughout: weekly leaderboards (with opt-in privacy),
                  community feature highlights, trainer Q&A
  4. Mid-challenge: progress check + 1-on-1 invite for stragglers
  5. Final week: results celebration + program-2 upsell
  6. Group challenge conversion to ongoing subscription is the
     biggest revenue mechanic for many online coaches.
```

## Idempotency

Trainerize's API supports idempotency on writes. For routine-driven creates, use deterministic keys.

For client upserts, dedupe by email before creating.

## Webhooks

Trainerize publishes webhooks for major events:
- `client.created`, `client.updated`
- `workout.completed`, `workout.skipped`
- `check_in.submitted`
- `subscription.created`, `subscription.canceled`, `subscription.payment_failed`
- `message.received`

Signature verification: HMAC with per-subscription secret. Verify before processing.

## Rate limits

Trainerize publishes per-account rate limits. Typically conservative for solo trainers; 429 with `Retry-After`.

## What this skill does NOT cover

- **Detailed clinical nutrition** — out of scope for non-RD trainers; use Practice Better for RD/clinical work.
- **Heart-rate / wearable integration** (Whoop, Apple Watch) — Trainerize integrates with some; data ingestion may flow there but specific wearable APIs are separate.
- **Live group fitness classes** — Trainerize is async + 1-on-1; Mindbody/Glofox for live.
- **Detailed strength program periodization** — trainer's expertise; Trainerize is the delivery vehicle.
- **Marketing automation beyond client retention** — route through Mailchimp/Klaviyo.

## References

- API: https://www.trainerize.com/api/ (partner program)
- NASM scope of practice: https://www.nasm.org/
- PAR-Q+ pre-activity screening: https://eparmedx.com/
- AutoFlow integration shape: `src/ticketSync/` (api_key or oauth2_pkce + secrets-store; per-trainer/per-business credentials; scope-of-practice + waiver gates)
