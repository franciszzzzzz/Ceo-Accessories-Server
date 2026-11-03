# PLANS.md — Roadmap

One phase at a time. Each phase has a file in `docs/phases/`. The agent stops at the end of a phase and waits for approval.

| # | Phase | Summary | Status |
|---|-------|---------|--------|
| 1 | Backend Foundation | Express/TS app, config, Prisma, Redis, health/ready, errors, logging, Sentry, tests | Complete |
| 2 | Identity and Access | Registration, login, sessions/tokens, roles (customer, vendor, admin), password reset, rate limiting | Complete |
| 3 | Vendor Onboarding and Stores | Vendor applications, admin approval, store profiles | Complete |
| 4 | Catalog | Categories, products, variants, media metadata, public browse and search; uploads deferred pending storage approval | Complete |
| 5 | Inventory | Stock per variant, reservations, low-stock rules | Complete |
| 6 | Cart | Persistent multi-vendor cart, price validation | Complete |
| 7 | Checkout and Orders | Order and per-vendor sub-order creation, status lifecycle | Complete |
| 8 | Payments | Paystack transaction integration, webhooks, idempotency, refunds | Complete |
| 9 | Commissions and Payouts | Commission rules, vendor ledger, payout runs | In progress |
| 10 | Shipping | Shipping methods and rates, fulfilment, tracking | Planned |
| 11 | Reviews, Notifications, Admin Tools | Reviews, email notifications, admin dashboards data | Planned |
| 12 | Hardening and Launch | Load testing, security review, backups, runbooks | Planned |

## Rules for phases
- Do not start a phase without written approval.
- Each phase file defines scope, deliverables, acceptance criteria, and out-of-scope items.
- Each phase ends with an updated progress checklist in its phase file.
- Frontend phases follow the matching backend phase, never ahead of it.
