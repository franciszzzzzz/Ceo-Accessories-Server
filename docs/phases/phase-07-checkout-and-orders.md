# Phase 7 — Checkout and Orders

**Status:** Complete
**Next phase:** Phase 8 — Payments

## Goal
Turn a customer's confirmed multi-vendor cart into one immutable parent order and one sub-order per store, atomically allocating stock and preserving purchase snapshots.

## Scope
1. Add `Order`, `SubOrder`, and `OrderItem` with Prisma Migrate. Extend the Phase 5 reservation lifecycle with a `converted` terminal state for holds consumed by checkout.
2. Checkout requires the client's cart lines and quoted prices to match the server cart and current variant prices. Changed prices require the customer to refresh/reconfirm the cart first.
3. Create one order and one sub-order per store, with item name, slug, SKU, options, quantity, and integer price snapshots.
4. Allocate stock atomically under serializable isolation; convert the caller's holds for purchased variants and prevent oversell against other active holds.
5. Require an `Idempotency-Key` for checkout. Store a request hash so same-key retries return the original order and mismatched reuse conflicts.
6. Provide customer order list/detail and cancellation of pending-payment orders. Provide vendor-owned sub-order list/detail without exposing shipping address before payment is confirmed.
7. Persist a validated shipping address snapshot on the order. Payment processing and payment confirmation remain Phase 8.

## API surface
- `POST /api/v1/orders/checkout` — customer, CSRF; requires `Idempotency-Key`, shipping address, and confirmed cart item/price list.
- `GET /api/v1/orders/me?page=1&limit=20` — customer order history.
- `GET /api/v1/orders/:id` — customer-owned order detail.
- `POST /api/v1/orders/:id/cancel` — customer cancels a pending-payment order and stock is restored atomically.
- `GET /api/v1/vendor/orders?page=1&limit=20` — vendor's sub-orders only.
- `GET /api/v1/vendor/orders/:id` — one owned sub-order.

## Data and lifecycle rules
- A new order starts `pending_payment`; each child sub-order starts `pending`. Payment confirmation in Phase 8 advances them.
- Stock quantity is decremented atomically when the pending-payment order is created. Cancellation while pending payment restores stock. Later payment failure/cancellation flows must not double-restock.
- Available-to-customer stock includes that customer's active reservations but excludes every other customer's reservations. Checkout converts the customer's holds on purchased variants.
- A cart is cleared only after successful order creation. Same idempotency key and same normalized request returns the prior order; same key with another request returns `409 CONFLICT`.
- Vendors see only their own sub-orders. Shipping address is withheld from vendor responses until a payment-confirmed phase explicitly authorizes its release.
- Money remains integer minor units. Order/sub-order totals use BigInt in PostgreSQL to safely sum multiple line items; API amounts remain safe JSON integers.

## Out of scope
Payment provider, payment records/webhooks, refunds, commissions, payouts, vendor fulfillment transitions, shipping provider/rates, customer address book, frontend, deployment, and external integrations.

## Acceptance criteria
- Checkout is atomic across all stores: either parent order, sub-orders, items, inventory allocation, reservation conversion, and cart clear all succeed, or none do.
- Concurrent checkouts cannot oversell and cannot create duplicate orders when retried with the same idempotency key.
- Price/quantity/cart mismatches and inactive/unavailable variants fail with stable API errors and no partial writes.
- Order snapshots do not change when catalog listings later change.
- Cancellation only works for the authenticated customer's pending-payment order and restores allocated stock once.
- Customer and vendor order access is scoped by ownership; vendors never see another store's sub-orders or pre-payment address data.
- Unit, HTTP, and database integration tests cover checkout, retries, multi-store splitting, price validation, concurrency, cancellation/restock, and ownership.
- Typecheck, lint, tests, and build pass; API, database, domain, security, testing, and progress docs are current.

## Progress checklist
- [x] Scope approved by user's ongoing direction to continue phases
- [x] Prisma schema reviewed and migration created/applied to local/test databases
- [x] Atomic checkout, order snapshots, idempotency and cancellation implemented
- [x] Customer and vendor order APIs implemented
- [x] Unit and database integration tests
- [x] API/security/database/domain docs updated
- [x] Typecheck, lint, test, and build pass
- [x] Final report delivered
