# Testing Strategy

## Tools
Vitest (runner and assertions), Supertest (HTTP tests against the exported app).

## Layout
```
tests/
  unit/          pure logic: services, utils, error mapping
  integration/   HTTP tests through app.ts with Supertest
  helpers/       factories, mocks, test setup
```
Module tests may sit beside the module (`*.test.ts`) once modules exist.

## Principles
- Test behaviour, not implementation details.
- Tests are written with the code, in the same change.
- `app.ts` is importable without opening a port.
- Unit and HTTP boundary tests use mocks where possible. Database-backed integration tests require local PostgreSQL and Redis.

## Levels
| Level | What | Dependencies |
|-------|------|--------------|
| Unit | Services, validators, error classes | None, repositories mocked |
| Integration (HTTP) | Routes, middleware, response envelopes | Usually Prisma and Redis mocked |
| Database integration (from Phase 2) | Repositories and transactions | Real PostgreSQL test database |
| End-to-end flows (later phases) | Checkout, payment webhook, payout | Test DB, provider sandbox/mocks |

## Phase 1 required tests
- `/health` returns 200 and the success envelope.
- `/ready` returns 200 when DB and Redis are up, 503 when either is down.
- Unknown route returns the 404 envelope.
- Thrown `AppError` returns its code and status.
- Zod validation failure returns `VALIDATION_ERROR` with details.
- Unexpected error returns generic 500 with no stack or internal message in production mode.
- Env validation fails with a clear error on missing required variables.

## Database tests (Phase 2 on)
- Separate test database, URL from `DATABASE_URL_TEST`.
- Migrations applied before the run; data cleaned between tests.
- Never point tests at a shared or production database.
- `vitest.config.ts` selects `DATABASE_URL_TEST` from the ignored local `.env` when available. The test database must be created and migrated explicitly; tests never migrate, reset, or truncate it.
- Phase 3 integration coverage verifies concurrent application uniqueness, review transitions, role/store creation, owner scoping, slug locks, store activation, and active-only public reads.
- Phase 4 integration coverage verifies category cycle prevention, vendor ownership, draft publication requirements, per-store SKU uniqueness, integer price serialization, and active-only catalog browse/detail.
- Phase 5 integration coverage verifies inventory initialization, vendor store scoping, reservation ownership, available-stock calculations, low-stock filters, stock edit boundaries, and concurrent reservations without overselling.
- Phase 6 integration coverage verifies persistent customer scope, multi-store subtotals, database price authority, changed-price reporting, current reservation-aware availability, invalid stock handling, and cart item removal/clear.
- Phase 7 integration coverage verifies price/cart confirmation, multi-store order splitting, concurrent idempotent retry, reservation conversion, stock allocation/restock on cancellation, customer/vendor scoping, and address privacy.
- Phase 8 provider unit tests cover Paystack request mapping and HMAC signature checks; payment integration coverage uses provider mocks to verify idempotent initialization, server verification, duplicate webhook delivery, refund limits, and admin/customer access boundaries.
- Phase 9 integration coverage verifies commission rule overlap and precedence, item-level rounding, idempotent payment ledger posting, refund reversals, payout idempotency, balance reservations, manual completion, and vendor/admin access boundaries.

## Money and payments
Test rounding, commission calculation, split orders, refunds, and idempotent webhook replays explicitly.

## Quality gates
- `npm run typecheck`, `npm run lint`, `npm test` must pass before a phase is complete.
- Coverage is tracked; target 80% on services, no hard gate in Phase 1.
- CI runs the three commands plus `npm audit` on every pull request.

## Reporting
Agents paste real command output. A test is "passing" only if it was run.
