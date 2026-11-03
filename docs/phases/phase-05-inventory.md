# Phase 5 — Inventory

**Status:** Complete
**Next phase:** Phase 6 — Cart

## Goal
Track sellable stock per product variant, prevent concurrent reservations from overselling stock, and give vendors an actionable low-stock view.

## Scope
1. Add `InventoryItem` (one per variant) and `StockReservation` (customer-owned temporary holds) with Prisma Migrate.
2. Automatically create a zero-stock inventory record when a catalog variant is created; backfill existing variants at migration time.
3. Let vendors read and update stock and low-stock thresholds for variants in their active store. Stock cannot be lowered below currently reserved units.
4. Let signed-in customers create, list, and release their own reservations. Holds expire after 15 minutes; expired holds do not reduce availability. Reservation writes use serializable transactions and bounded retry for serialization conflicts.
5. Let admins inspect paginated low-stock inventory across stores.
6. Document and test validation, access control, concurrency/availability rules, endpoints, and database invariants.

## API surface
- `GET /api/v1/vendor/inventory?page=1&limit=20&lowStockOnly=false`
- `PATCH /api/v1/vendor/inventory/:variantId` with `quantityOnHand` and/or `lowStockThreshold`
- `GET /api/v1/inventory/reservations/me`
- `POST /api/v1/inventory/reservations` with `variantId` and `quantity`
- `DELETE /api/v1/inventory/reservations/:id`
- `GET /api/v1/admin/inventory/low-stock?page=1&limit=20`

All writes require the appropriate role, CSRF validation, and rate limiting. Vendors can only access inventory belonging to their active store. Reservation ownership is always derived from the authenticated user. Public APIs do not reveal exact stock counts.

## Data and lifecycle rules
- `quantityOnHand` and `lowStockThreshold` are nonnegative integers; initial threshold is 5 and is vendor-configurable.
- `StockReservation.quantity` is a positive integer. A reservation is active until explicitly released or until `expiresAt` has passed. Expired records are transitioned to `expired` during reservation maintenance; their stock stops counting immediately at expiry.
- Available quantity is computed as on-hand stock minus the sum of active, unexpired reservations. No separately maintained reserved counter can drift from reservation rows.
- Reservation creation checks an active product variant in an active store. Archived variants and hidden products cannot receive new reservations.
- Vendor stock updates cannot reduce on-hand stock below currently active reservations.
- Checkout conversion/commit, cart integration, scheduled cleanup, low-stock notifications, and inventory ledgers remain later-phase work.

## Out of scope
Cart and checkout, order conversion, payment, shipping, stock adjustment audit ledger, scheduled job infrastructure, notifications, public stock disclosure, frontend changes, deployment, and external integrations.

## Acceptance criteria
- Every existing and newly created variant has exactly one inventory item.
- Concurrent reservation attempts cannot reserve more than available stock.
- A customer's reservation cannot be viewed or released by another customer.
- Vendor inventory reads and writes are scoped to the authenticated owner's active store.
- Reserved stock is reflected in availability and low-stock calculations; expired/released reservations do not count.
- Admin low-stock listing is paginated and includes store/product/variant context without exposing customer data.
- Unit, HTTP, and database integration tests cover limits, transitions, scope, validation, and error behavior.
- Typecheck, lint, tests, and build pass; API, database, domain, security, testing, and progress docs are current.

## Progress checklist
- [x] Scope and schema approved by user direction to complete the phase using best judgment
- [x] Prisma migration created and applied to local/test databases
- [x] Inventory and reservation APIs implemented
- [x] Catalog variant creation initializes inventory
- [x] Concurrency-safe reservation and release rules implemented
- [x] Unit and database integration tests
- [x] API/security/database/domain docs updated
- [x] Typecheck, lint, test, and build pass
- [x] Final report delivered
