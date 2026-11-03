# Cart API

All routes are under `/api/v1`, use the standard success/error envelopes, and require an authenticated customer session. Browser writes require the CSRF cookie/header pair and are rate-limited. The API never accepts a client-provided price, user ID, store ID, or cart ID.

## Routes

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /api/v1/cart` | Customer | Read the caller's persistent multi-vendor cart |
| `PUT /api/v1/cart/items` | Customer + CSRF | Add or replace a variant quantity (idempotent target quantity) |
| `PATCH /api/v1/cart/items/:id` | Customer + CSRF | Set a cart item's target quantity |
| `DELETE /api/v1/cart/items/:id` | Customer + CSRF | Remove an owned cart item |
| `DELETE /api/v1/cart` | Customer + CSRF | Clear all items in the caller's cart |

Add/replace request:

```json
{ "variantId": "<variant UUID>", "quantity": 2 }
```

Update request:

```json
{ "quantity": 3 }
```

Quantities must be integers from 1 to 1000. `PUT` uses the requested quantity as the target; retrying the same request does not increment it. Repeating an existing variant updates that row and refreshes its quoted price.

## Response

Cart reads and successful writes return `{ "success": true, "data": { "cart": { ... } } }`. The cart includes `items`, `itemCount`, an overall current-price `total`, and `storeSubtotals`. Each item includes the variant/product/store, `quantity`, `quotedPrice`, `currentPrice`, `lineTotal`, `priceChanged`, `availableQuantity`, and `isAvailable`.

`quotedPrice` is captured when the item is last added or explicitly updated. Cart reads calculate totals from current database prices, and set `priceChanged` when the current price differs. A quantity update refreshes the quote. Existing items remain visible when a listing is archived or stock becomes insufficient; `isAvailable` is false and checkout must not proceed until resolved. Cart quantities do not reserve stock. A customer's active inventory holds reduce the quantity available to that customer and other customers.

## Errors

- Invalid shapes or unknown fields: `400 VALIDATION_ERROR`.
- Missing/invalid session: `401 UNAUTHENTICATED`; missing customer role or CSRF: `403 FORBIDDEN`.
- Insufficient available stock or inactive/missing sellable variant on add/update: `409 CONFLICT`. Insufficient-stock details include `availableQuantity`.
- Missing or another customer's cart item: `404 NOT_FOUND`.

Example cart response:

```json
{
  "success": true,
  "data": {
    "cart": {
      "itemCount": 2,
      "total": { "amount": 350000, "currency": "NGN" },
      "storeSubtotals": [
        { "store": { "id": "...", "name": "Coastal Goods", "slug": "coastal-goods" }, "subtotal": { "amount": 350000, "currency": "NGN" } }
      ],
      "items": [
        {
          "id": "...",
          "quantity": 2,
          "quotedPrice": { "amount": 175000, "currency": "NGN" },
          "currentPrice": { "amount": 175000, "currency": "NGN" },
          "lineTotal": { "amount": 350000, "currency": "NGN" },
          "priceChanged": false,
          "availableQuantity": 8,
          "isAvailable": true,
          "variant": { "id": "...", "sku": "COASTAL-TEE-M", "product": { "id": "...", "name": "Coastal Tee", "slug": "coastal-tee" }, "store": { "id": "...", "name": "Coastal Goods", "slug": "coastal-goods" } }
        }
      ]
    }
  }
}
```
