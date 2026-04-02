# UptimeRobot Monitoring — AutoFlow

Free-tier UptimeRobot monitors for production and staging. Set these up once the
Hetzner VPS and Coolify deployment are live.

## Monitors to create

Log in to [UptimeRobot](https://uptimerobot.com) and create the following:

| Monitor name | Type | URL | Interval | Alert when |
|---|---|---|---|---|
| AutoFlow — production health | HTTPS | `https://helloautoflow.com/health` | 5 min | Down |
| AutoFlow — staging health | HTTPS | `https://staging.helloautoflow.com/health` | 5 min | Down |
| AutoFlow — production frontend | HTTPS | `https://helloautoflow.com` | 5 min | Down or status ≠ 200 |
| AutoFlow — API (prod) | HTTPS | `https://helloautoflow.com/api/health` | 5 min | Down |

## Alert contacts

Add an alert contact before creating monitors:

1. **Email:** `ops@helloautoflow.com` — receives all down/up notifications.
2. **Slack (optional):** connect via UptimeRobot integrations → Slack webhook.

## Setup steps

1. Create a free account at https://uptimerobot.com (up to 50 monitors, 5-min checks).
2. Go to **My Settings → Alert Contacts** → add `ops@helloautoflow.com`.
3. For each row in the table above, click **Add New Monitor**:
   - Monitor type: **HTTPS**
   - Friendly name: as shown
   - URL: as shown
   - Monitoring interval: 5 minutes
   - Alert contacts: select the email contact created above
4. Share the status page: **My Pages → Create Status Page** — include all 4 monitors.
   Suggested URL slug: `status-autoflow`.

## Health endpoint spec

Both backend and frontend must expose `/health` returning HTTP 200:

```
GET /health
→ 200 OK
{"status":"ok","timestamp":"..."}
```

The backend FastAPI app already has this endpoint. The frontend nginx config
serves `/health` as a static `200 OK` text response (see `docker/frontend/nginx.conf`).

## Escalation

UptimeRobot sends email on first failure. For PagerDuty integration (if needed
later), add a PagerDuty alert contact via UptimeRobot integrations → PagerDuty.
