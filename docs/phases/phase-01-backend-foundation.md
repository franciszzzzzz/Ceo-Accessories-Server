# Phase 1 — Backend Foundation

**Status:** Complete
**Next phase (do not start without approval):** Phase 2 — Identity and Access

## Goal
A running, tested, documented Express and TypeScript backend with config, PostgreSQL (Prisma), Redis, health and readiness endpoints, centralized errors, logging, Sentry, and graceful shutdown. No marketplace features.

## In scope
1. Express and TypeScript (strict) app, `app.ts` separated from `server.ts`.
2. Directory structure per `docs/architecture.md`.
3. Zod-validated environment config.
4. Prisma set up (datasource and generator only) and a shared client.
5. Redis client with connection and failure handling.
6. `/api/v1/health` and `/api/v1/ready`.
7. Central error handler, 404 handler, response and error envelopes.
8. Zod request validation middleware.
9. Helmet, CORS from env, body limits.
10. Pino request logging with redaction and request IDs.
11. Sentry with scrubbing.
12. Graceful shutdown for HTTP, Redis, Prisma.
13. Queue foundation placeholder (no jobs).
14. Vitest setup and required tests.
15. `.env.example`, README setup instructions, API docs for the foundation endpoints.

## Out of scope
Authentication, users, vendors, stores, products, inventory, carts, checkout, orders, payments, commissions, payouts, shipping, any database models, frontend code, deployment.

## Acceptance criteria
- [ ] `npm run dev` starts the server; `GET /api/v1/health` returns 200.
- [ ] `/api/v1/ready` returns 200 with DB and Redis up and 503 when either is down.
- [ ] App fails fast with a clear message on invalid env.
- [ ] Unknown routes return the 404 envelope; errors follow `docs/api-conventions.md`.
- [ ] No stack traces or secrets in production error responses or logs.
- [ ] SIGTERM closes HTTP, Redis, and Prisma cleanly.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass (real output captured).
- [ ] `.env.example` lists every variable.
- [ ] Docs reflect the two-repository architecture.

## Progress checklist
Update as work lands. Only tick items that were actually run or verified.

- [x] Plan presented and approved
- [x] Project scaffolding and tooling
- [x] Config and env validation
- [x] Prisma and PostgreSQL
- [x] Redis
- [x] Health and readiness
- [x] Error handling and envelopes
- [x] Validation middleware
- [x] Security middleware
- [x] Logging and Sentry
- [x] Graceful shutdown
- [x] Tests passing
- [x] Docs updated
- [x] Final report delivered

## Notes and decisions
_Record any approved deviations from the docs here._

Phase 1 decisions and verification notes:
- Prisma 7.10.1 is used with `prisma.config.ts`; it imports the validated configuration from `src/config/env.ts`, keeping application environment reads centralized there.
- Docker Compose defines local PostgreSQL and Redis services bound to localhost. The Compose file was validated and Docker Desktop was available, but containers were not started because no local `.env` values were provided; no credentials were invented.
- Tests mock dependency checks by default as required by `docs/testing-strategy.md`. Production runtime checks verified liveness `200` and readiness `503` with each dependency down.
