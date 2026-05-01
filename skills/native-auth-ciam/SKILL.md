---
name: native-auth-ciam
description: >
  Microsoft Entra External ID Native Authentication reference for the CTO org.
  Covers the Native Auth API (sign-up, sign-in, SSPR), WebView SSO, social
  identity provider integration, and the React SPA SDK. Use when building,
  debugging, or reviewing any CIAM native authentication flow for Above the Wild /
  AutoFlow.
---

# Native Authentication (CIAM) — Engineering Reference

This skill captures comprehensive knowledge of Microsoft Entra External ID's **Native Authentication** capability. It is the canonical training document for all CTO org engineers working on Above the Wild / AutoFlow authentication.

Source articles (Microsoft Learn + DevBlogs):
1. [Native Authentication API Reference](https://learn.microsoft.com/en-us/entra/identity-platform/reference-native-authentication-api?tabs=emailOtp)
2. [WebView SSO How-To](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-native-authentication-webview-sso)
3. [Native Auth SSO GA Announcement](https://devblogs.microsoft.com/identity/native-auth-sso-ga/)
4. [Native Auth Social IDPs & WebView GA Announcement](https://devblogs.microsoft.com/identity/native-auth-social-idps-web-view-ga/)
5. [React SPA Social Sign-In Tutorial](https://learn.microsoft.com/en-us/entra/identity-platform/tutorial-native-authentication-single-page-app-react-social-sign-in)

---

## 1. What Is Native Authentication?

Native Authentication lets you host the **entire sign-in/sign-up UI inside your own app** instead of redirecting to a browser or system web view. Microsoft Entra External ID provides a REST API (and SDKs) that your client calls directly.

**Key benefits:**
- Full control over look and feel of auth screens
- No browser redirect — truly native UX
- Supports email+password AND email+OTP authentication methods
- Supports MFA (email OTP, SMS as second factor)
- Supports self-service password reset (SSPR)
- Supports social identity provider sign-in via browser-delegated flow

**Applies to:** External tenants only (customer-facing apps via Microsoft Entra External ID).

---

## 2. Native Auth API — Core Concepts

### 2.1 Continuation Token

Every API call in a flow returns a **continuation token**. This token:
- Uniquely identifies the current flow
- Maintains state across endpoints
- Must be included in every subsequent request in the same flow
- Is valid only for a limited time
- Can only be used for the next request in the flow

### 2.2 Challenge Types

The `challenge_type` parameter advertises which authentication methods the client supports. Predefined values represent different auth methods:

| Auth Method | Challenge Types |
|---|---|
| Email + Password | `oob`, `password`, `redirect` |
| Email OTP | `oob`, `redirect` |
| SSPR | `oob`, `redirect` |

If the server selects a challenge type the app doesn't support, it returns a `redirect` response telling the app to fall back to browser-based auth.

### 2.3 Capabilities Parameter

Use `capabilities=registration_required mfa_required` in sign-in requests to tell the server your app can handle inline registration and MFA flows.

---

## 3. Sign-Up Flow

### Endpoints

| Endpoint | Purpose |
|---|---|
| `/signup/v1.0/start` | Begin sign-up; pass client_id, username, challenge_type |
| `/signup/v1.0/challenge` | Server selects auth method; issues challenge (e.g. OTP to email) |
| `/signup/v1.0/continue` | Submit OTP/password/attributes; continue or get new challenge |
| `/oauth/v2.0/token` | Exchange final continuation token for ID + access tokens |

### Flow Steps

1. **Start** — `POST /signup/v1.0/start` with `client_id`, `username`, `challenge_type`, optional `password` and `attributes`
2. **Challenge** — `POST /signup/v1.0/challenge` with continuation token; server picks OTP or password challenge
3. **Continue** — `POST /signup/v1.0/continue` with OTP code or password or required attributes
4. **Token** — `POST /oauth/v2.0/token` with final continuation token → receive `id_token`, `access_token`, `refresh_token`

### User Attributes

Attributes can be submitted to `/signup/v1.0/start` or `/signup/v1.0/continue`. Required attributes are defined in the user flow configured in Entra admin center.

**Built-in attributes** (use display name as key):
- `city`, `country`, `displayName`, `givenName`, `jobTitle`, `postalCode`, `state`, `streetAddress`, `surname`

**Custom attributes** (use `extension_{appId}_{attributeName}` format):
- Strip hyphens from app ID
- Example: `extension_2588de9627ee4e20a05e534e25a3d500_loyaltyNumber`

Attribute values are typed:
- `String` → `"value"`
- `Int` → `123`
- `Boolean` → `true/false`
- `StringCollection` → `["val1", "val2"]`

---

## 4. Sign-In Flow

### Endpoints

| Endpoint | Purpose |
|---|---|
| `/oauth/v2.0/initiate` | Start sign-in with username |
| `/oauth/v2.0/challenge` | Server selects challenge (OTP / password / MFA) |
| `/oauth/v2.0/token` | Submit credentials; receive tokens or MFA required signal |
| `/oauth/v2.0/introspect` | List user's registered strong auth methods (for MFA) |

### Flow Steps (Email + Password)

1. **Initiate** — `POST /oauth/v2.0/initiate` with `client_id`, `username`, `challenge_type`
2. **Challenge** — `POST /oauth/v2.0/challenge` with continuation token
3. **Token** — `POST /oauth/v2.0/token` with continuation token + `grant_type=continuation_token` + password

### MFA Flow

If MFA is enforced by tenant policy, the `/oauth/v2.0/token` response indicates MFA is required:
- If user **has** a registered strong auth method → complete MFA challenge
- If user **has no** registered strong auth method → register one inline, then complete MFA

**Introspect endpoint** (`/oauth/v2.0/introspect`): returns list of user's registered MFA methods so the app can present the right UX.

### Username + Password Sign-In

Users who sign up with email+password can also sign in with a **username** (alias) if enabled:
1. Enable username in sign-in identifier policy
2. Create or update users with username via admin center or Graph API
3. Users can then sign in with either email or username

---

## 5. Self-Service Password Reset (SSPR)

Available for users whose primary auth method is email+password.

### Endpoints

| Endpoint | Purpose |
|---|---|
| `/resetpassword/v1.0/start` | Begin SSPR; validate username |
| `/resetpassword/v1.0/challenge` | Issue OTP to verify identity |
| `/resetpassword/v1.0/continue` | Submit OTP code |
| `/resetpassword/v1.0/submit` | Submit new password |
| `/resetpassword/v1.0/poll_completion` | Poll until password reset completes |
| `/oauth/v2.0/token` | Auto sign-in after successful reset |

### Flow Steps

1. **Start** — `POST /resetpassword/v1.0/start` with username
2. **Challenge** — `POST /resetpassword/v1.0/challenge` → OTP sent to email
3. **Continue** — `POST /resetpassword/v1.0/continue` with OTP
4. **Submit** — `POST /resetpassword/v1.0/submit` with new password
5. **Poll** — `POST /resetpassword/v1.0/poll_completion` until status = succeeded
6. **Token** — `POST /oauth/v2.0/token` for automatic sign-in

---

## 6. Strong Authentication Method Registration

For MFA, users may need to register a strong auth method inline during sign-in.

### Endpoints

| Endpoint | Purpose |
|---|---|
| `/oauth/v2.0/introspect` | Get list of available strong auth methods |
| `/signup/v1.0/challenge` (reused) | Issue challenge for selected method |
| `/signup/v1.0/continue` (reused) | Submit verification code |

### Steps

1. Call `/introspect` to get available methods (e.g., `emailOtp`, `sms`)
2. Call `/challenge` with the selected method
3. Call `/continue` with the verification code
4. Receive tokens upon successful verification

---

## 7. WebView SSO — Native App to Embedded Web Views

### Problem

After a user signs in natively, embedded web views (WKWebView on iOS, WebView on Android) are **isolated from browser session state** — no automatic cookie SSO.

### Solution: Token-Based SSO

1. User signs in via native SDK/API
2. App retrieves valid access token from SDK cache or via silent refresh
3. App loads web view with custom request: `Authorization: Bearer <access_token>`
4. Web resource validates token, issues session cookie for subsequent navigation

### Implementation Options

**Option A: Bearer Token via HTTP Header (RECOMMENDED)**
- Stateless, isolates token to specific request
- Avoids web-based attack vectors (XSS, CSRF)
- Construct URL → create custom request → add `Authorization: Bearer <token>` header → load in web view

**Option B: Cookie Injection (FALLBACK ONLY — DISCOURAGED)**
- Use only when target web resource cannot handle headers
- Risks: XSS, CSRF, session fixation
- If used: server-issued session cookies, `HttpOnly`, `Secure`, `SameSite` attributes, strict CSRF protection

### Backend Token Validation

1. Validate token signature and claims (`aud` must match API identifier, `iss` must match authority)
2. For ASP.NET Core: use `Microsoft.Identity.Web` (MISE)
3. Issue session cookie (`Set-Cookie` with `HttpOnly`, `Secure`, `SameSite`) for subsequent web view navigation

### Key Requirements

- **Shared client identity**: Mobile app and web app must share the same client ID (application ID)
- **Scope alignment**: Request access token with exact scopes the web resource requires
- **HTTPS only**: Never send tokens over HTTP

---

## 8. Social Identity Provider Integration

### Architecture

Social sign-in uses a **browser-delegated (web-view) authentication flow**:

1. App presents native UI for initial interaction
2. Authentication switches to browser-delegated web view for OAuth with social provider
3. Post-social steps (MFA, attribute collection) continue in same web view
4. Tokens issued by Entra External ID after social provider success

### Supported Providers (GA)

| Provider | domainHint Value |
|---|---|
| Google | `"Google"` |
| Facebook | `"Facebook"` |
| Apple | `"Apple"` |
| Custom OIDC (e.g. LinkedIn) | Issuer URI (e.g. `"www.linkedin.com"`) |

**Not supported:** Microsoft Entra accounts and Microsoft accounts (MSA).

### Configuration

1. Configure social provider in Entra External ID tenant
2. Add provider to user flow
3. Register redirect URI in app registration

### React SPA Implementation

Uses `@azure/msal-browser` SDK with `loginPopup`:

```typescript
const popUpRequest: PopupRequest = {
    authority: customAuthConfig.auth.authority,
    scopes: [],
    redirectUri: customAuthConfig.auth.redirectUri || "",
    prompt: "login",
    domainHint: "Google",  // or "Facebook", "Apple", "www.linkedin.com"
};

await authClient.loginPopup(popUpRequest);
const accountResult = authClient.getCurrentAccount();
```

**Key parameters:**
- `authority`: External tenant authority URL
- `redirectUri`: Must match app registration in Entra admin center
- `prompt`: `"login"` forces credential entry
- `domainHint`: Selects which social provider to use

### Mobile Implementation

For Android/iOS, use the Native Auth SDK's social sign-in flow. The SDK handles the browser-delegated web view automatically.

---

## 9. Prerequisites Checklist

Before implementing any native auth flow:

- [ ] External tenant created in Microsoft Entra
- [ ] App registered with Application (client) ID and Directory (tenant) ID recorded
- [ ] Admin consent granted
- [ ] Public client and native authentication flows enabled
- [ ] User flow created with required user attributes configured
- [ ] App registration associated with user flow
- [ ] For SSPR: self-service password reset enabled for customer users
- [ ] For social IDPs: providers configured and added to user flow
- [ ] For WebView SSO: web resource served over HTTPS, shared client identity

---

## 10. Error Handling & Troubleshooting

### Common API Errors

| Error | Cause | Fix |
|---|---|---|
| `redirect` challenge type returned | App's requested auth method not supported by server | Fall back to browser-based auth flow |
| Invalid continuation token | Token expired or reused | Restart the flow from the beginning |
| Attribute validation error | Required attribute missing or wrong format | Check user flow config; submit all required attributes |
| Password policy violation | Password doesn't meet tenant policy | Enforce password requirements client-side |

### Social IDP Troubleshooting

| Issue | Solution |
|---|---|
| Popup blocked | Allow popups from app domain in browser settings |
| domainHint not recognized | Verify exact string matches provider config |
| Auth fails after popup opens | Check: redirectUri matches registration, client ID correct, provider configured in user flow |
| User account not created after sign-up | Ensure provider enabled in both sign-up and sign-in user flows |
| CORS errors | Ensure CORS proxy is running (`npm run cors`) |

### WebView SSO Troubleshooting

| Issue | Solution |
|---|---|
| Token rejected by web resource | Verify `aud` claim matches web API ID, check scope alignment |
| Session not persisted after initial load | Backend must issue `Set-Cookie` after validating bearer token |
| Token sent over HTTP | Always use HTTPS — never send tokens over plain HTTP |

---

## 11. API Base URL Pattern

All native auth endpoints use the tenant-specific CIAM login URL:

```
https://{tenant_subdomain}.ciamlogin.com/{tenant_subdomain}.onmicrosoft.com/
```

Example for tenant `contoso`:
```
https://contoso.ciamlogin.com/contoso.onmicrosoft.com/oauth2/v2.0/initiate
https://contoso.ciamlogin.com/contoso.onmicrosoft.com/signup/v1.0/start
https://contoso.ciamlogin.com/contoso.onmicrosoft.com/resetpassword/v1.0/start
```

**Important:** Native auth API endpoints do NOT support CORS. For browser-based SPAs, use the JavaScript SDK which handles this via a CORS proxy.

---

## 12. Security Best Practices

1. **Never store tokens in localStorage** — use secure, httpOnly cookies or in-memory storage
2. **Always validate tokens server-side** — check signature, issuer, audience, expiry
3. **Use HTTPS everywhere** — especially for token transmission
4. **Prefer bearer token headers over cookies** for WebView SSO
5. **Implement proper error handling** — never expose raw API errors to end users
6. **Use the SDK when possible** — raw HTTP API is supported but SDK handles edge cases
7. **Request minimum scopes** — only request what the resource actually needs
8. **Enable MFA** — use Conditional Access policies to require MFA for sensitive operations
9. **Monitor with audit logs** — track sign-in attempts, failures, and SSPR usage

---

## 13. SDK References

| Platform | SDK | Docs |
|---|---|---|
| Android (Kotlin) | MSAL Android + Native Auth | [Android quickstart](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-native-authentication-android-sign-in) |
| iOS/macOS (Swift) | MSAL iOS + Native Auth | [iOS quickstart](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-native-authentication-ios-sign-in) |
| React SPA | `@azure/msal-browser` | [React tutorial](https://learn.microsoft.com/en-us/entra/identity-platform/tutorial-native-authentication-single-page-app-react-social-sign-in) |
| Raw HTTP | Native Auth REST API | [API reference](https://learn.microsoft.com/en-us/entra/identity-platform/reference-native-authentication-api) |

---

## 14. Roadmap (Announced)

- Cross-app SSO (beyond single app to web view)
- Multi-device sessions
- Advanced security scenarios (policies, conditional access, passkeys)
- Fully native post-social UX for MFA and Conditional Access (replacing current web-view for post-social steps)
