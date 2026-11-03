# Marketplace Server

Backend API for a multi-vendor ecommerce marketplace. This is an independently managed repository; the frontend lives in `marketplace-web` and communicates through `/api/v1`.

**Stack:** Node.js 22.12+ or 24 LTS, Express 5, TypeScript strict, PostgreSQL, Prisma 7 + Prisma Migrate, Redis, Zod, Pino, Sentry, Vitest.

## Local setup

Requirements: Node.js 22.12+ or 24 LTS, npm, and Docker Desktop with its engine running.

In PowerShell, from the repository root:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set local-only values for `POSTGRES_USER`, `POSTGRES_PASSWORD`, and both database URLs. Keep the database name `marketplace` consistent in `DATABASE_URL` and `POSTGRES_DB`; `DATABASE_URL_TEST` must target a separate `marketplace_test` database. Generate unique random values for `ACCESS_TOKEN_SECRET` and `CSRF_SECRET` (32 or more characters each). These are local development credentials only.

Start local PostgreSQL and Redis, create the dedicated test database, apply migrations, then install dependencies and start the API:

```powershell
docker compose up -d postgres redis
docker compose exec -T postgres sh -lc 'createdb -U "$POSTGRES_USER" marketplace_test'
npx prisma migrate deploy
npm install
npm run dev
```

Apply the same migration to `DATABASE_URL_TEST` before running tests. In PowerShell, set `$env:DATABASE_URL` to the value of `DATABASE_URL_TEST` from `.env`, run `npx prisma migrate deploy`, then clear `$env:DATABASE_URL`. `npm test` reads `DATABASE_URL_TEST` from `.env` and never runs migrations or resets databases.

The API listens on `http://localhost:4000`. Liveness is at `GET /api/v1/health`; readiness is at `GET /api/v1/ready`.

Prisma Migrate is the only schema migration system. Never run `migrate reset` on a shared or production database.

To stop the local containers while preserving their named volumes:

```powershell
docker compose stop postgres redis
```

## Commands

```bash
npm run dev          # development server with reload
npm run build        # generate Prisma Client and compile to dist/
npm start            # run dist/server.js
npm run typecheck    # strict TypeScript check
npm run lint         # ESLint
npm test             # Vitest suite
npx prisma generate  # regenerate the Prisma Client
```

For a clean production dependency install, use `npm ci`, then `npm run build` and `npm start`. The deployment process runs `npx prisma migrate deploy` after a phase introduces migrations.

## API documentation

Foundation endpoints and response examples are in [`docs/api/foundation.md`](docs/api/foundation.md). Identity endpoints are in [`docs/api/auth.md`](docs/api/auth.md). Vendor onboarding and store endpoints are in [`docs/api/vendors.md`](docs/api/vendors.md). Catalog endpoints are in [`docs/api/catalog.md`](docs/api/catalog.md). Inventory endpoints are in [`docs/api/inventory.md`](docs/api/inventory.md). Cart endpoints are in [`docs/api/cart.md`](docs/api/cart.md). Checkout/order endpoints are in [`docs/api/orders.md`](docs/api/orders.md). Payment/refund endpoints are in [`docs/api/payments.md`](docs/api/payments.md). Commission, earnings, ledger, and payout endpoints are in [`docs/api/commissions.md`](docs/api/commissions.md). General API conventions live in [`docs/api-conventions.md`](docs/api-conventions.md).

## Project docs

See [`AGENTS.md`](AGENTS.md), [`GOALS.md`](GOALS.md), [`PLANS.md`](PLANS.md), and [`docs/`](docs/) for the architecture, security, database, testing, deployment, and phase scope.
