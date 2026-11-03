# Phase 9 — Commissions and Payouts

**Status:** In progress
**Next phase:** Phase 10 — Shipping

## Goal
Calculate the platform commission when an order is paid, preserve an append-only vendor ledger, expose vendor earnings, and let admins manage payout records safely.

## Scope
1. Add effective-dated commission rules scoped globally, to a store, or to a category. Rules cannot be backdated, overlapping periods at the same scope are rejected, and admins can set a future end time. More specific rules take precedence.
2. On verified order payment, create idempotent sale and commission ledger entries for each sub-order using the order item snapshots and applicable rule. Money stays in integer NGN minor units.
3. Expose vendor-owned ledger history and available balance. Customers and other vendors cannot access it.
4. Let vendors request payouts up to their available balance with idempotency. Admins can approve or reject requests and record a completed manual transfer only with an external transfer reference.
5. Persist every payout state transition and ledger impact. A successful manual payout creates one immutable ledger debit. No external transfer integration or credentials are added.
6. Document endpoints, rule precedence, rounding, ledger invariants, operational handling, and tests.

## API surface
- `GET /api/v1/admin/commission-rules`
- `POST /api/v1/admin/commission-rules`
- `GET /api/v1/vendor/earnings`
- `GET /api/v1/vendor/ledger`
- `POST /api/v1/vendor/payouts` — idempotent request
- `GET /api/v1/vendor/payouts`
- `GET /api/v1/admin/payouts`
- `POST /api/v1/admin/payouts/:id/approve`
- `POST /api/v1/admin/payouts/:id/reject`
- `POST /api/v1/admin/payouts/:id/mark-paid` — manual transfer reference required

## Security and accounting rules
- Commission and payout endpoints require role authorization and CSRF on writes.
- Rules are immutable once created except for ending their effective period; they cannot overlap at the same scope.
- Basis-point commissions are rounded down to the nearest minor unit per order item. Net vendor earnings equal gross item total minus commission.
- Ledger entries are append-only with a unique source key to prevent duplicate credits/debits.
- Payout requests reserve balance: pending or approved requests count against available funds. Rejected payouts release that reservation; paid payouts are additionally debited in the ledger.
- Manual payout completion records a supplied external reference. The service does not move money or claim that a transfer occurred independently of an admin confirmation.
- Payout writes use serializable transactions and bounded retries to prevent concurrent overspending.

## Out of scope
Automated bank transfers, vendor bank-account collection, multiple currencies, tax withholding, chargeback allocation, scheduled payout batches, and a transfer provider.

## Acceptance criteria
- Payment success creates exactly one set of commission/sale ledger entries per sub-order.
- Rule precedence and rounding produce deterministic results in NGN minor units.
- Vendors see only their own balance, ledger, and payouts.
- Concurrent payout requests cannot reserve more than the available balance.
- Only admins can approve/reject/mark paid; marking paid requires a reference and creates one ledger debit.
- Typecheck, lint, tests, build, migration status, docs, and progress checklist are current.

## Progress checklist
- [x] Prisma schema/migration
- [x] Commission rule APIs and precedence
- [x] Payment-to-ledger accounting
- [x] Vendor earnings and ledger APIs
- [x] Payout request and admin lifecycle
- [x] Unit and database integration tests
- [x] API/security/database/domain docs updated
- [ ] Typecheck, lint, test, and build pass
- [ ] Final report delivered
