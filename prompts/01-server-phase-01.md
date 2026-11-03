# Prompt — Server Phase 1 (paste into your agent)

Act as a senior Node.js backend engineer and software architect.

You are working in the **backend repository** (`marketplace-server`) of a multi-vendor ecommerce marketplace. The frontend is a separate repository. Work only in this repo.

## Read first (in this order)
`AGENTS.md`, `GOALS.md`, `PLANS.md`, `README.md`, everything in `docs/`, then `docs/phases/phase-01-backend-foundation.md`.

These documents are the source of truth. If anything in this prompt conflicts with them, stop and ask.

## Task
Implement **Phase 1 — Backend Foundation** exactly as defined in `docs/phases/phase-01-backend-foundation.md`, following `docs/architecture.md`, `docs/api-conventions.md`, `docs/security.md`, `docs/testing-strategy.md`, and `docs/deployment.md`.

Stack: Node.js, Express, TypeScript strict, PostgreSQL, Prisma + Prisma Migrate (the only migration system), Redis, Zod, Pino, Sentry, Vitest. Use npm.

## Constraints
- No `frontend/` directory, no monorepo, no workspace config, no frontend code.
- No business modules (auth, vendors, products, orders, payments, etc.) and no database models.
- No invented credentials or external integrations. No deployment. No destructive database operations.
- No new dependency without a stated reason.

## Step 1 — Plan only (do not write files yet)
1. Inspect the repo (it may be empty).
2. Confirm the docs already describe two separate repositories. Flag any leftover monorepo assumptions.
3. Present: final directory structure, dependency list (runtime and dev) with reasons, purpose of each important file, assumptions, open questions, technical risks.
4. Check the current stable versions and requirements of Express, Prisma, and Sentry before choosing patterns, and tell me what you found.
5. Stop and wait for my approval.

## Step 2 — Implement (after I approve)
Work in small reviewable steps: scaffolding and tooling, config and env, Prisma, Redis, health and readiness, errors and envelopes, validation, security middleware, logging and Sentry, graceful shutdown, tests, docs. Write tests alongside code.

## Step 3 — Report
1. Every file created or modified
2. Architecture explanation
3. Important config and infrastructure files
4. Exact install commands
5. Exact dev and production start commands
6. All environment variables and their purposes
7. Database setup instructions
8. Redis setup instructions
9. Available endpoints
10. Tests run, with real output
11. Typecheck and lint, with real output
12. Remaining incomplete work
13. Security considerations
14. Updated `docs/phases/phase-01-backend-foundation.md` progress checklist

Do not claim anything was tested unless you ran it.

## Completion boundary
Stop after Phase 1. Do not start Phase 2 — Identity and Access. Wait for my approval.
