## ALT-2408 landing runtime contract

`landing/` no longer owns server routes. For Cloudflare Pages compatibility, all live mutations moved behind the main backend.

### Public endpoints

- `POST /api/public/landing/checkout`
- `POST /api/public/landing/subscribe`
- `POST /api/public/landing/beta-signup`
- `POST /api/public/landing/waitlist-signup`
- Stripe webhook target: `POST /api/webhooks/stripe`

### Required env vars

Landing build:

- `NEXT_PUBLIC_API_URL=https://api.helloautoflow.com`

Backend runtime:

- `ALLOWED_ORIGINS=https://app.helloautoflow.com,https://helloautoflow.com`
- `LANDING_BASE_URL=https://helloautoflow.com`
- `STRIPE_SECRET_KEY`
- `STRIPE_FLOW_PRICE_ID`
- `STRIPE_AUTOMATE_PRICE_ID`
- `STRIPE_SCALE_PRICE_ID`
- `STRIPE_WEBHOOK_SECRET`
- `ZAPIER_WEBHOOK_URL`
- `ZAPIER_BETA_SIGNUP_WEBHOOK_URL`
- `ZAPIER_WAITLIST_SIGNUP_WEBHOOK_URL` optional; when unset the waitlist endpoint logs and returns success
- `PAPERCLIP_API_URL`
- `PAPERCLIP_WEBHOOK_API_KEY`
- `PAPERCLIP_COMPANY_ID`
- `PAPERCLIP_CSM_AGENT_ID` optional
- `PAPERCLIP_ONBOARDING_GOAL_ID` optional

### Verification commands

Checkout:

```bash
curl -i "$API_BASE_URL/api/public/landing/checkout" \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://helloautoflow.com' \
  --data '{"tier":"flow","email":"ada@example.com","firstName":"Ada","companyName":"AutoFlow"}'
```

Waitlist:

```bash
curl -i "$API_BASE_URL/api/public/landing/waitlist-signup" \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://helloautoflow.com' \
  --data '{"email":"ops@example.com"}'
```

Beta signup:

```bash
curl -i "$API_BASE_URL/api/public/landing/beta-signup" \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://helloautoflow.com' \
  --data '{"name":"Ada","email":"ada@example.com","company":"AutoFlow","currentTools":"Zapier","useCase":"Lead routing"}'
```

Stripe webhook wiring:

```bash
stripe listen --forward-to "$API_BASE_URL/api/webhooks/stripe"
```

### Cutover note

After this change, `landing/app/api/*` must stay empty. Any new landing mutation belongs either on the main backend or on a separately managed Cloudflare-compatible service, not inside the Pages app.
