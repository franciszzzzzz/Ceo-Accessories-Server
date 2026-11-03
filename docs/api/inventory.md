# Inventory API

All endpoints use `/api/v1`, the standard response envelopes, and strict Zod validation. Browser writes require the CSRF cookie/header pair. Inventory counts are not exposed by public catalog endpoints.

## Vendor inventory

- `GET /api/v1/vendor/inventory?page=1&limit=20&lowStockOnly=false` — vendor role; requires an active owned store. Returns `data.inventory` and pagination metadata. Each entry contains `quantityOnHand`, `reservedQuantity`, `availableQuantity`, `lowStockThreshold`, `isLowStock`, and product/variant/store context. `lowStockOnly=true` filters by available stock.
- `PATCH /api/v1/vendor/inventory/:variantId` — vendor role, CSRF; updates one or both fields: `{ "quantityOnHand": 40, "lowStockThreshold": 8 }`. Values are nonnegative integers. On-hand stock cannot be set below current active reservations. Returns the updated inventory item.

Unknown inventory or variants return `404 NOT_FOUND`; attempting to reduce stock below reserved quantity returns `409 CONFLICT`; invalid values return `400 VALIDATION_ERROR`.

## Customer reservations

- `GET /api/v1/inventory/reservations/me` — customer role; returns the caller's active, unexpired reservations.
- `POST /api/v1/inventory/reservations` — customer role, CSRF; body `{ "variantId": "<UUID>", "quantity": 2 }`. Creates a 15-minute hold and returns `{ "reservation": { ... }, "availableQuantity": 3 }` with `201`.
- `DELETE /api/v1/inventory/reservations/:id` — customer role, CSRF; releases the caller's active hold and returns `{ "reservation": { ... } }`.

Only variants in active products and active stores can be reserved. The caller's identity is taken from the authenticated session; clients cannot supply a customer ID. Insufficient stock returns `409 CONFLICT` with `details.availableQuantity`. Unknown or another user's reservation returns `404 NOT_FOUND`; an expired or already released reservation returns `409 CONFLICT`. Expired holds do not reduce available stock even before their status is updated.

## Admin low-stock view

- `GET /api/v1/admin/inventory/low-stock?page=1&limit=20` — admin role; returns active variants in active stores where `availableQuantity <= lowStockThreshold`, with store/product/variant context and pagination metadata. Customer information is never included.

## Inventory rules

Each product variant has one inventory record, initialized at zero. The default low-stock threshold is five units. Available stock is `quantityOnHand - active unexpired reservation quantities`. Reservation creation and stock edits use serializable transactions with bounded retry for serialization conflicts to prevent overselling. Holds are valid for 15 minutes. Checkout conversion is deferred to Phase 7.
