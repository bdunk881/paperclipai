# Supabase passwordless auth (magic link + email OTP)

AutoFlow completes email sign-in on the **Fly API** so magic links work on any device. The dashboard still uses Supabase PKCE for Google/GitHub OAuth and password signup confirmation.

## Flow summary

1. User requests sign-in on `/login?mode=magic-link` → `signInWithOtp` with `emailRedirectTo` pointing at `/api/auth/email/callback`.
2. Supabase emails a **link** (`token_hash`) and a **6-digit code** (`{{ .Token }}` in the Magic Link template).
3. **Link (any device):** user opens `GET /api/auth/email/callback?token_hash=...&type=email` → API `verifyOtp` → httpOnly session cookie → redirect to dashboard.
4. **OTP (any device):** user enters code on login → `POST /api/auth/verify-otp` → same session cookie.
5. Dashboard calls `GET /api/auth/session` with `credentials: include` for Bearer tokens on `/api/*`.

## Supabase Dashboard checklist

### Redirect URLs (Auth → URL configuration)

| Environment | Add to allowlist |
|-------------|------------------|
| Local | `http://localhost:3000/api/auth/email/callback`, `http://localhost:5173/api/auth/email/callback` |
| Dev API | `https://dev-api.helloautoflow.com/api/auth/email/callback` |
| Staging API | `https://staging-api.helloautoflow.com/api/auth/email/callback` |
| Production API | `https://api.helloautoflow.com/api/auth/email/callback` |

Also keep SPA URLs for OAuth PKCE: `{dashboard}/auth/callback`, `{dashboard}/reset-password`.

### Magic Link email template

```html
<h2>Sign in to AutoFlow</h2>
<p><a href="{{ .ConfirmationURL }}">Sign in with magic link</a></p>
<p>Or enter this code on the sign-in page: <strong>{{ .Token }}</strong></p>
```

`{{ .ConfirmationURL }}` honors `emailRedirectTo` from the client (API callback URL).

### API secrets (Infisical / Fly only)

- `SUPABASE_URL` — same project as dashboard
- `SUPABASE_SERVICE_ROLE_KEY` — server-only
- `AUTH_COOKIE_DOMAIN=.helloautoflow.com` (staging/production)
- `DASHBOARD_PUBLIC_URL` — where to redirect after link click
- `API_PUBLIC_URL` — public API origin for callbacks

## Local development

- Run dashboard on port **5173** with Vite proxying `/api` → `localhost:3000`.
- Prefer `emailRedirectTo` of `http://localhost:5173/api/auth/email/callback` so the session cookie is set on the dashboard origin.
- Set `AUTH_RETURN_TOKENS_IN_BODY=true` on the API for OTP verification without cross-port cookies.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Redirect / invalid link | Add exact API callback URL to Supabase redirect allowlist |
| OTP always fails | Ensure template includes `{{ .Token }}`; check email rate limits |
| Signed in in browser, API 401 | `SUPABASE_URL` on API must match dashboard project |
| Cookie missing on staging | Set `AUTH_COOKIE_DOMAIN=.helloautoflow.com` and CORS `ALLOWED_ORIGINS` for dashboard host |

## Smoke checklist

- [ ] Request sign-in email from magic-link tab
- [ ] Open link on a **different** browser → lands signed in on dashboard
- [ ] Enter OTP code on login → signed in without clicking link
- [ ] Google OAuth still works via `/auth/callback?code=`
