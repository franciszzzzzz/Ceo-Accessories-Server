# Commissions and Payouts API (Phase 9)

All endpoints use `/api/v1`, JSON envelopes, and integer NGN minor units.

## Commission rules

- `GET /api/v1/admin/commission-rules?page=1&limit=20` — admin rule history.
- `POST /api/v1/admin/commission-rules` — admin + CSRF.
- `PATCH /api/v1/admin/commission-rules/:id/end` — admin + CSRF; body `{ "effectiveUntil": "2026-12-01T00:00:00.000Z" }`. The end time must be future-dated and after the rule start.

```json
{
  "storeId": "optional-store-uuid",
  "categoryId": "optional-category-uuid",
  "rateBasisPoints": 750,
  "effectiveFrom": "2026-11-03T14:00:00.000Z",
  "effectiveUntil": "optional-end-time"
}
```

`rateBasisPoints` ranges from 0 to 10,000. Omitted scope IDs create a global rule. Rules cannot overlap for the same store/category scope. A rule may be scheduled for a future effective time; backdating is rejected. Rules can be ended once by setting a future end time. At payment time, store-and-category rules take precedence, then store rules, then category rules, then global rules. If a product has multiple matching category rules at the same specificity, the most recently effective rule wins, with rule ID as a stable tie-breaker. No matching rule means 0% commission until an admin configures one. Commission is rounded down per order item to the nearest kobo.

## Vendor earnings and ledger

- `GET /api/v1/vendor/earnings` — vendor balance, amount reserved for payouts, and available amount.
- `GET /api/v1/vendor/ledger?page=1&limit=20` — owner-scoped immutable ledger entries.

Successful payments create a gross vendor sale credit and a negative commission entry per sub-order. Provider-confirmed refunds create a negative vendor sale adjustment and a proportional positive commission reversal. Any remainder in multi-store refund allocation is assigned deterministically so allocations sum to the provider refund amount.

## Payouts

- `POST /api/v1/vendor/payouts` — vendor + CSRF + `Idempotency-Key`.
- `GET /api/v1/vendor/payouts?page=1&limit=20` — the vendor's requests.
- `GET /api/v1/admin/payouts?page=1&limit=20` — admin queue.
- `POST /api/v1/admin/payouts/:id/approve` — admin + CSRF.
- `POST /api/v1/admin/payouts/:id/reject` — admin + CSRF; body `{ "reason": "..." }`.
- `POST /api/v1/admin/payouts/:id/mark-paid` — admin + CSRF; body `{ "externalReference": "bank-transfer-reference" }`.

Request body:

```json
{ "amount": 150000 }
```

Requested and approved payouts reserve available balance. Rejecting a request releases the reservation. Marking an approved payout paid records an immutable ledger debit and requires a unique external reference. This is an operator attestation of a manual transfer; the API does not send funds.

Payout requests are idempotent by store and key; reusing a key with a different request body returns `409 CONFLICT`. Insufficient balance returns `422 UNPROCESSABLE`. Vendor queries are always scoped to the authenticated store owner.
