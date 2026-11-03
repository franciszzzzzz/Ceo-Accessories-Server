# GOALS.md

## Product
A multi-vendor marketplace where independent vendors run their own stores and sell through one shared storefront. Customers browse, add items from several vendors to one cart, and pay once. The platform splits the order per vendor, takes a commission, and pays vendors out.

## Primary users
- **Customer**: browses, buys, tracks orders, leaves reviews.
- **Vendor**: applies, manages a store, products, stock, fulfils orders, sees earnings.
- **Admin**: approves vendors, moderates, manages categories, commissions, payouts, disputes.

## Backend goals
1. A secure, well-documented REST API a separate frontend can consume without guessing.
2. A clean modular monolith that is easy to extend one module at a time.
3. Correct money handling: integer minor units, auditable records, idempotent payments.
4. Multi-vendor order splitting with traceable commissions and payouts.
5. Observable in production: structured logs, error monitoring, health and readiness checks.
6. Independently deployable from the frontend.

## Non-goals (for the MVP)
- Microservices
- Native mobile apps
- Multi-currency conversion (single currency at launch)
- Advanced recommendations or search ranking
- Real-time chat between customers and vendors
- Marketplace-run logistics fleet

## MVP success criteria
- A customer can register, browse, fill a multi-vendor cart, pay, and see split orders.
- A vendor can onboard, list products, manage stock, and fulfil orders.
- An admin can approve vendors and run payouts.
- All critical flows have automated tests.
- The API is documented well enough for the frontend repo to integrate from the docs alone.
