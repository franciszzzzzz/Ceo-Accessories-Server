# Checkout and Orders API

All endpoints use `/api/v1`, JSON, standard envelopes, and authenticated cookie sessions. Unsafe browser requests require the CSRF cookie/header pair. Checkout requires an `Idempotency-Key` header.

## Checkout

### `POST /api/v1/orders/checkout`

Auth: customer role + CSRF + `Idempotency-Key` (16–128 letters, digits, `.`, `_`, `:`, or `-`). The customer submits the cart lines and their last quoted prices along with the delivery address:

```json
{
  "shippingAddress": {
    "recipientName": "Ada Buyer",
    "phone": "+2348012345678",
    "addressLine1": "12 Market Street",
    "city": "Lagos",
    "state": "Lagos",
    "countryCode": "NG"
  },
  "items": [
    { "variantId": "<variant UUID>", "quantity": 2, "quotedPriceAmount": 175000 }
  ]
}
```

The items and prices must match the server cart and current catalog price. Client amounts are confirmations only; the API recalculates everything from PostgreSQL. If the cart or a price changed, checkout returns `409 CONFLICT` without creating an order; refresh the cart and confirm the updated values. The address is a Nigeria delivery snapshot; no address book or shipping provider is configured.

On success, returns `201` with an order in `pending_payment`, per-store sub-orders, and immutable item snapshots. Stock is allocated atomically and the cart is cleared only after all order rows and inventory updates succeed. Same key and same request returns the existing order; reusing a key for different input returns `409 CONFLICT`.

## Customer orders

- `GET /api/v1/orders/me?page=1&limit=20` — customer order history with pagination.
- `GET /api/v1/orders/:id` — one order belonging to the caller; includes the delivery address and purchase snapshots.
- `POST /api/v1/orders/:id/cancel` — CSRF-protected cancellation while status is `pending_payment`. Stock is restored in the same transaction. Other statuses return `409 CONFLICT`.

Another customer's order is indistinguishable from a missing order and returns `404 NOT_FOUND`.

## Vendor orders

- `GET /api/v1/vendor/orders?page=1&limit=20` — sub-orders for stores owned by the authenticated vendor.
- `GET /api/v1/vendor/orders/:id` — one sub-order owned by the vendor.

Vendor responses include the order status and item/store snapshots, but never include customer identity or shipping address. Vendors cannot see another store's sub-order. Fulfilment transitions are deferred to the shipping phase.

## Status and money

Order status starts at `pending_payment`; each sub-order starts at `pending`. Payment confirmation advances these in Phase 8. Cancellation is currently permitted only while pending payment. All prices are NGN integer minor units. PostgreSQL stores order totals as `BIGINT`; API amounts are JSON integers and are checked to fit JavaScript's safe integer range.

Other errors: `400 VALIDATION_ERROR` for malformed input or missing/invalid idempotency key; `401 UNAUTHENTICATED`; `403 FORBIDDEN`; `409 CONFLICT` for price, stock, cart, state, or idempotency conflicts; `422 UNPROCESSABLE` for an empty cart.
