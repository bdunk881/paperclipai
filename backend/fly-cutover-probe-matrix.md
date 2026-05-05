# FastAPI Fly Cutover Probe Matrix

Use this matrix after a Fly deploy when the FastAPI service is expected to front
production ingress paths that previously terminated on the legacy backend.

## Required environment

- `AUTH_NATIVE_AUTH_PROXY_BASE_URL` or `AZURE_CIAM_AUTHORITY`
- `AUTH_NATIVE_AUTH_PROXY_ALLOWED_ORIGINS` including the dashboard host used for
  the probe
- `FASTAPI_EDGE_RELAY_BASE_URL` pointing at the legacy backend that still owns
  OAuth callback and webhook business logic during cutover

## Probe set

1. `GET /health`
   - Expected: `200`
   - Purpose: verifies the Fly edge is live
2. `POST /api/auth/native/oauth2/v2.0/initiate`
   - Expected: `200` or upstream validation `400`
   - Failure threshold: `5xx`, `403`, or `404`
   - Purpose: proves CIAM initiate traffic reaches the upstream authority
3. `GET /api/integrations/slack/oauth/callback?error=access_denied&error_description=fly_cutover_probe`
   - Expected: `200`, `302`, `307`, `400`, or `401`
   - Failure threshold: local relay `503` or `404`
   - Purpose: proves provider callback paths remain live on the Fly host
4. `POST /api/webhooks/stripe`
   - Body: unsigned `{}` JSON payload
   - Expected: `400`, `401`, or relayed legacy `503`
   - Failure threshold: local relay `503` or `404`
   - Purpose: proves webhook deliveries still traverse the Fly host to the
     legacy handler

`infra/scripts/fly_fastapi_smoke.sh` executes this matrix and records the
request/status evidence bundle.
