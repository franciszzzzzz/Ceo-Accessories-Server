# Payments API (Phase 8)

All routes use the `/api/v1` prefix and the standard success/error envelopes. Payment amounts are integers in NGN kobo. The provider is Paystack; configure `PAYSTACK_SECRET_KEY` before using payment routes. Without it, provider operations return `503 SERVICE_UNAVAILABLE`.

## Initialize checkout

`POST /api/v1/orders/:id/payment` — authenticated customer, CSRF, `Idempotency-Key`.

The server takes the amount, currency, and customer email from the order and account. The response contains a hosted checkout URL and server-generated reference:

```json
{
  "success": true,
  "data": {
    "payment": {
      "reference": "marketplace_…",
      "status": "pending",
      "authorizationUrl": "https://checkout.paystack.com/…",
      "expiresAt": "2026-11-03T12:00:00.000Z"
    }
  }
}
```

Repeating the same key returns the same attempt. Another key is rejected while a non-expired attempt is active. Attempts expire after 30 minutes. Orders that are no longer awaiting payment cannot start an attempt.

## Verify a payment

`POST /api/v1/payments/verify` — authenticated customer, CSRF.

```json
{ "reference": "marketplace_…" }
```

The API verifies the reference with Paystack and matches the captured status, amount, and currency before changing order state. A reference owned by another customer is not found. Success returns the owner's payment state.

## Read payment state

`GET /api/v1/orders/:id/payment` — authenticated owner of the order. Returns payment status and attempt references, statuses, checkout URLs, and expiry times. It does not return provider secrets or raw provider responses.

## Paystack webhook

`POST /api/v1/payments/webhooks/paystack` — public provider callback with `x-paystack-signature`.

The signature is checked against the exact request bytes using HMAC-SHA512 before event processing. Charge events trigger server-side transaction verification. Valid duplicate event IDs are acknowledged without repeating state changes. The database retains the event type, reference, payload hash, and processing status, not the payload. Invalid signatures return `401`.

## Admin refunds

`POST /api/v1/admin/payments/:id/refunds` — admin, CSRF, `Idempotency-Key`.

```json
{ "amount": 1500, "reason": "Customer requested a partial refund." }
```

`amount` is optional (omitted means the remaining refundable balance) and is expressed in kobo. The API rejects amounts over the captured balance. The response contains the refund ID, amount, status, reason, and timestamps.

`GET /api/v1/admin/payments/:id/refunds` — admin refund history for a payment. Paystack refund webhooks update refund status.

If a provider request fails after the request may have reached Paystack, the refund is marked `needs_attention`; the same idempotency key will not submit a second provider refund automatically. An operator must reconcile that state in the Paystack dashboard before taking another action. A payment arriving after its order was cancelled is similarly recorded for admin attention and never reopens the order.

## Errors

Routes may return `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 CONFLICT`, `422 UNPROCESSABLE`, `429 RATE_LIMITED`, or `503 SERVICE_UNAVAILABLE`, using the standard error envelope.
