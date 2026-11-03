# Phase 8 — Payments

**Status:** Complete
**Provider:** Paystack, using the NGN transaction and refund APIs. No credentials are committed; local runtime configuration is optional until the operator supplies a test/live secret.
**Next phase:** Phase 9 — Commissions and Payouts

## Goal
Initiate and verify customer payments for pending orders, securely process provider webhooks idempotently, and let admins create auditable full or partial refunds.

## Scope
1. Add `Payment`, `PaymentAttempt`, `PaymentWebhookEvent`, and `Refund` through Prisma Migrate.
2. Initialize Paystack hosted checkout with server-derived order amount, currency, customer email, and a server-generated reference. Retry requests use `Idempotency-Key`.
3. Verify transactions server-to-server before marking an order paid. Verify the provider reference, transaction status, exact amount, and currency.
4. Capture the Paystack raw request body, verify the `x-paystack-signature` HMAC-SHA512 with the secret key, deduplicate event keys, and record only a payload hash (no raw provider payload).
5. Apply payment success once, advancing the order to `paid` and sub-orders to `confirmed`. Failed/expired attempts do not change stock allocation; customers may cancel after an attempt expires.
6. Allow admins to create idempotent partial/full refunds and expose refund state. Provider refund events update the refund record.
7. If a late payment arrives after an order was cancelled, record a refund requiring admin attention; never reopen an order whose stock has been restored.
8. Document Paystack setup, endpoints, security, test strategy, and limitations. Use built-in Node `fetch`; no SDK dependency is needed.

## API surface
- `POST /api/v1/orders/:id/payment` — customer, CSRF, idempotency header; initializes or returns the active payment attempt.
- `POST /api/v1/payments/verify` — customer, CSRF; verifies an owned reference.
- `POST /api/v1/payments/webhooks/paystack` — public provider callback; HMAC signature required.
- `GET /api/v1/orders/:id/payment` — customer-owned payment state.
- `POST /api/v1/admin/payments/:id/refunds` — admin + CSRF + idempotency header.
- `GET /api/v1/admin/payments/:id/refunds` — admin refund history.

## Security and lifecycle rules
- `PAYSTACK_SECRET_KEY` is an operator-supplied env value. If absent, payment routes return `503 SERVICE_UNAVAILABLE`; no fake key or provider response is used.
- Never trust callback query parameters or webhook data as proof of payment. Always call Paystack verification and match reference, status, amount, and currency.
- HMAC signature is checked against the exact raw request bytes with constant-time comparison before parsing/processing.
- Webhook requests are idempotent. Duplicate valid events return `200` without repeating state transitions.
- Customer payment/order reads are owner-scoped; refund creation/history is admin-only.
- Refund cumulative amount cannot exceed the captured payment. A refund request is idempotent per payment/key.
- Keys, authorization headers, raw webhook bodies, and provider customer data are not logged or persisted.

## Out of scope
Commissions, vendor payouts, alternative providers, payment method tokenization, card data handling, chargebacks/disputes, background polling/queue infrastructure, deployment, and live credentials.

## Acceptance criteria
- Payment initialization uses only the pending order's database total and customer email.
- Same idempotency key returns the same attempt; different key cannot create concurrent active attempts for one order.
- Verified success atomically marks payment/order/sub-orders once; forged, repeated, mismatched, and invalid-signature webhooks cannot create paid orders.
- Expired-attempt cancellation and late success do not double-allocate stock or reopen a cancelled order.
- Admin refunds enforce remaining balance and record provider status idempotently.
- Unit, HTTP, and database integration tests use provider mocks and never require real credentials or network calls.
- Typecheck, lint, tests, and build pass; docs and progress checklist are current.

## Progress checklist
- [x] Provider selected from official Paystack API documentation for the NGN application
- [x] Prisma schema/migration
- [x] Paystack adapter, transaction init/verify, and webhook signature/idempotency
- [x] Refund APIs and state machine
- [x] Unit and database integration tests
- [x] API/security/database/domain docs updated
- [x] Typecheck, lint, test, and build pass
- [x] Final report delivered
