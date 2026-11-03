# Identity and Access API

All routes use the `/api/v1` base path and standard success/error envelopes. Browser endpoints use cookies; set `credentials: "include"` in the browser client. Configure exact frontend origins in `CORS_ALLOWED_ORIGINS`.

Before unsafe requests, call `GET /api/v1/auth/csrf`, then send the returned `csrfToken` as `X-CSRF-Token`. The response also sets a readable `csrf_token` cookie. Access and refresh cookies are HttpOnly.

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /api/v1/auth/csrf` | Public | Issue CSRF token and cookie |
| `POST /api/v1/auth/register` | CSRF | Register customer; returns generic `202` accepted |
| `POST /api/v1/auth/login` | CSRF | Authenticate and set access, refresh, and CSRF cookies |
| `POST /api/v1/auth/refresh` | Refresh cookie + CSRF | Rotate refresh token and renew cookies |
| `POST /api/v1/auth/logout` | CSRF | Revoke refresh family and clear cookies; returns `204` |
| `GET /api/v1/auth/me` | Access cookie | Return current user and roles |
| `POST /api/v1/auth/password-reset-requests` | CSRF | Request reset; generic `202` accepted response |
| `POST /api/v1/auth/password-resets` | CSRF | Complete reset with token and new password |

Register body: `{ "email": "person@example.com", "password": "at-least-12-characters" }`. Login body uses the same fields. Reset request body: `{ "email": "person@example.com" }`. Reset completion body: `{ "token": "delivered-reset-token", "password": "at-least-12-characters" }`.

Successful login, refresh, and current-user responses contain `{ "success": true, "data": { "user": { "id": "...", "email": "...", "roles": ["customer"] } } }`. Invalid credentials or sessions return `UNAUTHENTICATED`; CSRF failures return `FORBIDDEN`; validation failures return `VALIDATION_ERROR`; exceeded Redis rate limits return `RATE_LIMITED`.

Passwords must be 12–128 characters. Unknown request fields are rejected. Registration only grants `customer`; public callers cannot request elevated roles. Password reset delivery is not configured in this phase: requests are accepted and hashed tokens are persisted, but users cannot receive the token until a delivery adapter is implemented.
