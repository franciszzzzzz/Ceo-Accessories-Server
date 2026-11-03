# Architecture

## Overview
Two independent repositories communicate over a versioned REST API.

```
 Browser ──> marketplace-web (Next.js) ──HTTPS──> marketplace-server (Express) ──> PostgreSQL
                                                         │
                                                         └──> Redis (cache, rate limit, queues)
```

Each repo has its own Git history, dependencies, environment variables, and deployment.

## Style: modular monolith
One deployable Node.js service, organized into business modules with clear boundaries. No microservices.

## Layers (per module)
```
route  ->  controller  ->  service  ->  repository  ->  Prisma
```
- **Route**: maps URL and middleware to a controller. No logic.
- **Controller**: parses validated input, calls a service, shapes the HTTP response.
- **Service**: business rules and orchestration. Framework-agnostic.
- **Repository**: the only code that uses the Prisma client.
- Modules call each other through services, never through another module's repository.

Phase 1 health code follows the same route -> controller -> service -> repository boundary. Its repository only probes PostgreSQL and Redis; it does not define marketplace data or models.

## Directory structure
```
src/
  config/        env.ts, database.ts, redis.ts, sentry.ts, logger.ts
  middleware/    error, not-found, request-logger, (later: auth, rate-limit)
  modules/       one folder per business module (health first, others per phase)
  routes/        index.ts mounts module routers under /api/v1
  shared/
    errors/      AppError and subclasses
    http/        response/error envelope helpers
    middleware/  validate.ts (Zod request validation)
    types/
    utils/
  app.ts         builds the Express app (no listen)
  server.ts      starts the server, handles graceful shutdown
```
Module folder shape (from Phase 2 on):
```
modules/<name>/
  <name>.routes.ts
  <name>.controller.ts
  <name>.service.ts
  <name>.repository.ts
  <name>.schemas.ts     Zod schemas
  <name>.types.ts
  <name>.test.ts
```

## Cross-cutting concerns
- **Config**: validated once at boot with Zod. App refuses to start on invalid env.
- **Logging**: Pino, JSON in production, request ID on every log line, secrets redacted.
- **Errors**: throw `AppError` subclasses; one central error middleware formats responses.
- **Validation**: Zod schemas validate body, query, params at the edge.
- **Monitoring**: Sentry with scrubbed events.
- **Background jobs**: Redis-backed queue (BullMQ planned). Phase 1 only prepares the foundation; no marketplace jobs.

## Lifecycle
- `app.ts` exports the Express app so tests can import it without opening a port.
- `server.ts` connects dependencies, starts listening, and on SIGTERM/SIGINT stops accepting requests, then closes HTTP, Redis, and Prisma in order.

## Key decisions
| Decision | Choice | Reason |
|----------|--------|--------|
| Architecture | Modular monolith | Simple to run, easy to split later if needed |
| ORM / migrations | Prisma + Prisma Migrate | One schema source of truth |
| Validation | Zod | Same library for env and requests |
| Money | Integer minor units | No floating-point errors |
| API style | REST, `/api/v1` | Simple for a separate frontend to consume |
| IDs | CUID2 or UUID strings | Non-guessable, safe to expose |
