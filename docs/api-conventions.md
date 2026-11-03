# API Conventions

Source of truth for the contract between `marketplace-server` and `marketplace-web`. The frontend repo keeps a copy; this repo is authoritative.

## Base
- Base path: `/api/v1`. Breaking changes require `/api/v2`.
- JSON only. `Content-Type: application/json`.
- Resource names are plural, lowercase, kebab-case: `/api/v1/vendor-applications`.
- Fields in JSON are `camelCase`.
- IDs are opaque strings. Dates are ISO 8601 UTC strings. Money is `{ "amount": 150000, "currency": "NGN" }` in minor units.

## Success response
```json
{
  "success": true,
  "data": { },
  "meta": { }
}
```
`meta` is optional (pagination, etc.).

## Error response
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": [{ "field": "email", "message": "Invalid email" }],
    "requestId": "b3c1..."
  }
}
```
- `code`: stable, machine-readable, `UPPER_SNAKE_CASE`. Frontends branch on this.
- `message`: human-readable, safe to show.
- `details`: optional, mainly for validation.
- `requestId`: always present; also returned in the `X-Request-Id` header.

## Error codes (initial set)
| Code | HTTP | Meaning |
|------|------|---------|
| `VALIDATION_ERROR` | 400 | Body, query, or params invalid |
| `UNAUTHENTICATED` | 401 | Missing or invalid credentials |
| `FORBIDDEN` | 403 | Authenticated but not allowed |
| `NOT_FOUND` | 404 | Resource or route not found |
| `CONFLICT` | 409 | State conflict (duplicate, version) |
| `UNPROCESSABLE` | 422 | Valid shape, business rule failed |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected failure |
| `SERVICE_UNAVAILABLE` | 503 | Dependency down (readiness) |

New codes are added here before use.

## Status codes
`200` read/update, `201` created (with `Location` where useful), `204` no content, then the error codes above.

## Pagination
Query: `?page=1&limit=20` (limit max 100). Response:
```json
{ "success": true, "data": [ ], "meta": { "page": 1, "limit": 20, "total": 134, "totalPages": 7 } }
```
Cursor pagination may be added for large feeds; document it here first.

## Filtering and sorting
`?sort=-createdAt` (prefix `-` for descending), `?status=active`. Allowed fields are whitelisted per endpoint.

## Headers
- `X-Request-Id`: accepted from client if valid, otherwise generated; always returned.
- `Idempotency-Key`: required on order checkout and payment-creating endpoints. Checkout binds the key to the user and request hash; same-request retries return the same order.

## Health endpoints (Phase 1)
| Endpoint | Purpose | Success | Failure |
|----------|---------|---------|---------|
| `GET /api/v1/health` | Liveness. No dependency checks. | `200 { success: true, data: { status: "ok", uptime, timestamp } }` | n/a |
| `GET /api/v1/ready` | Readiness. Checks PostgreSQL and Redis. | `200 { data: { status: "ready", checks: { database: "up", redis: "up" } } }` | `503` with `SERVICE_UNAVAILABLE` and per-check status |

## Authentication (Phase 2)
Browser authentication uses `HttpOnly` access and refresh cookies. Access tokens expire after 15 minutes; refresh tokens rotate and expire after 30 days. The separate readable `csrf_token` cookie must be echoed in `X-CSRF-Token` on unsafe requests. CORS credentials are enabled only for exact origins in `CORS_ALLOWED_ORIGINS`. Protected endpoints return `UNAUTHENTICATED` for missing, invalid, expired, or revoked sessions. Registration and password reset requests return generic accepted responses.

## Authorization (Phase 3)
Vendor application routes require the customer role; review and store activation routes require the admin role; `/stores/me` routes require the vendor role. Public `GET /stores/:slug` returns active stores only. Unsafe cookie-authenticated routes also require CSRF validation.

## Catalog (Phase 4)
Category management requires the admin role. Product and variant management requires the vendor role and scopes every query to that vendor's active store. Public product browse and detail endpoints return only active products with an active variant from active stores. Prices are returned as `{ "amount": <integer minor units>, "currency": "NGN" }`. Media upload is unavailable until an object-storage adapter is authorized.

## Inventory (Phase 5)
Vendor inventory routes require the vendor role and an active owned store. Reservation routes require the customer role and derive ownership from the session. Admin low-stock reporting requires the admin role. Unsafe writes require CSRF. Public catalog endpoints do not expose exact stock quantities. Available stock subtracts active, unexpired reservations; reservation creation and stock edits use serializable transactions.

## Cart (Phase 6)
Cart routes require the customer role. Cart and cart-item ownership are derived from the authenticated user. Writes accept target quantities only; prices are read from the database. Cart reads report quoted/current prices and calculate totals using current prices. Cart items do not reserve inventory; available stock is revalidated on writes and checkout will validate again.

## Checkout and Orders (Phase 7)
Checkout requires a customer session, CSRF, and an `Idempotency-Key`. The API verifies cart quantities and quotes against current catalog/inventory data, then creates one parent order and one sub-order per store atomically. Customer order routes are owner-scoped. Vendor order routes expose only their store's sub-orders and omit shipping addresses before payment confirmation.

## Payments (Phase 8)
Payment initialization and admin refund creation require an `Idempotency-Key`. Amounts are NGN minor units. Payment success is based on server-to-server Paystack verification of the stored reference, status, amount, and currency. Webhooks require an HMAC-SHA512 signature over the exact raw request body; webhook events are deduplicated. See [`docs/api/payments.md`](api/payments.md) for request and response details.

## Commissions and Payouts (Phase 9)
Commission rules are admin-managed and effective-dated. A payment creates vendor-sale and commission ledger entries; provider-confirmed refunds create reversals. Vendor balances and payout requests are scoped to the owned store. Payouts are manually transferred and recorded by an admin with an external reference; the API does not initiate transfers. See [`docs/api/commissions.md`](api/commissions.md).

## Versioning and deprecation
Additive changes (new optional fields, new endpoints) are allowed in v1. Removals or meaning changes need a new version. Deprecations are documented here with a date.

## Documentation for the frontend
Each phase adds its endpoints to `docs/api/<module>.md` with method, path, auth, request, response, errors, and an example.
