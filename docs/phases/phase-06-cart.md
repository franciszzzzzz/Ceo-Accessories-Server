# Phase 6 — Cart

**Status:** Complete
**Next phase:** Phase 7 — Checkout and Orders

## Goal
Provide each customer with a persistent multi-vendor cart and validate current listing, price, and available inventory whenever cart items are changed or read.

## Scope
1. Add `Cart` and `CartItem` only through Prisma Migrate. A user has at most one cart; cart items reference sellable variants and store the last quoted integer price.
2. Add customer-owned read, add/replace quantity, update quantity, remove item, and clear cart operations.
3. Validate that products, variants, and stores remain active and that requested quantities do not exceed current available stock (on-hand minus active unexpired reservations). Cart items do not reserve inventory.
4. On reads, calculate totals from current prices and report quoted/current price differences for customer confirmation. Group subtotals by store.
5. Document API, ownership, validation, and price/availability behavior; add unit, HTTP, and database-backed tests.

## API surface
- `GET /api/v1/cart`
- `PUT /api/v1/cart/items` with `variantId` and target `quantity` (idempotent upsert)
- `PATCH /api/v1/cart/items/:id` with target `quantity`
- `DELETE /api/v1/cart/items/:id`
- `DELETE /api/v1/cart`

All routes require the customer role. Unsafe writes require CSRF and rate limiting. Cart item ownership is derived through the authenticated user and cannot be supplied by the caller.

## Data and lifecycle rules
- One `Cart` per user; one `CartItem` per variant in a cart.
- Quantity is a positive integer and must not exceed stock available at the time of write. Since carts do not reserve stock, availability is checked again on every cart read/write and will be checked again during checkout in Phase 7.
- Only active variants in active products and active stores can be added or updated. Existing cart rows remain visible when an item becomes unavailable, with an availability state explaining that it must be removed or restored before checkout.
- `quotedPriceAmount` records the price at the last explicit add/update. Cart reads return current price, quoted price, and `priceChanged`; totals use current price and never trust a client-provided price.
- A cart can contain items from multiple stores. API returns an overall NGN total and store subtotals. No checkout or order records are created in this phase.

## Out of scope
Checkout, order creation, stock reservation creation, payment, coupons/promotions, shipping, wishlists, frontend code, deployment, and external integrations.

## Acceptance criteria
- A customer can retrieve a persistent cart across sessions and combine products from multiple active stores.
- Cart reads and writes are strictly scoped to the authenticated user.
- Add/update validates listing state, price source, and current availability; no client price is accepted.
- Cart summaries identify unavailable items and price changes without hiding existing cart rows.
- Unit, HTTP, and database integration tests cover multi-store totals, ownership, invalid quantities, price changes, unavailable stock, and cart cleanup.
- Typecheck, lint, tests, and build pass; API, database, domain, security, testing, and progress docs are current.

## Progress checklist
- [x] Scope approved by user's ongoing direction to continue phases
- [x] Prisma schema reviewed and migration created/applied to local/test databases
- [x] Cart APIs implemented
- [x] Current price, availability, and multi-store summaries implemented
- [x] Unit and database integration tests
- [x] API/security/database/domain docs updated
- [x] Typecheck, lint, test, and build pass
- [x] Final report delivered
