# AGENTS.md — Marketplace Server

Instructions for any coding agent working in this repository. Read this first, every session.

## What this repo is
The **backend API** of a multi-vendor ecommerce marketplace. It is one of two independent repositories:

- `marketplace-server` (this repo): Node.js, Express, TypeScript, PostgreSQL, Prisma, Redis
- `marketplace-web` (separate repo): Next.js, React, TypeScript, Tailwind CSS

They talk only through the versioned REST API under `/api/v1`. Never create a `frontend/` folder, a monorepo, or workspace config here.

## Read before coding
In order: `GOALS.md`, `PLANS.md`, `README.md`, then everything in `docs/`, then the current phase file in `docs/phases/`.

## Commands (available after Phase 1)
- `npm run dev` start with reload
- `npm run build` compile TypeScript
- `npm start` run compiled build
- `npm run typecheck` `tsc --noEmit`
- `npm run lint` ESLint
- `npm test` Vitest
- `npx prisma migrate dev` create/apply migrations locally
- `npx prisma migrate deploy` apply migrations in production

## Hard rules
1. Strict TypeScript. No `any` without a comment explaining why.
2. Prisma Migrate is the only migration system. No raw SQL schema changes outside Prisma migrations.
3. Only the data-access layer touches Prisma. Controllers never import the Prisma client.
4. No business logic in route handlers or controllers. Logic lives in services.
5. Only `src/config/env.ts` reads `process.env`. Everything else imports the validated config.
6. Never hardcode or log secrets, tokens, passwords, or full request bodies.
7. All routes live under `/api/v1` and follow `docs/api-conventions.md`.
8. Money is stored as integer minor units (kobo). Never floats.
9. No new dependency without stating why it is needed.
10. No destructive database operations (drop, truncate, reset) without explicit approval.
11. Do not deploy anything. Do not invent credentials or external integrations.
12. Do not build features outside the current phase. Do not create speculative models.

## Workflow
1. **Plan first.** Inspect the repo, then present a plan (files, dependencies, risks, assumptions). Wait for approval.
2. **Implement in small, reviewable steps.** Write tests alongside code.
3. **Verify for real.** Run typecheck, lint, and tests. Paste actual output. Never claim something passed unless you ran it.
4. **Report.** List files changed, commands to run, env vars added, remaining work.
5. **Stop at the phase boundary** and wait for approval before the next phase.

## Definition of done (every phase)
- Code matches the docs, or the docs are updated in the same change.
- `typecheck`, `lint`, and `test` pass with real output shown.
- `.env.example` is current.
- The phase progress file is updated.
- No secrets in code, logs, or commits.

## When docs and request conflict
Say so and ask. Do not silently change the approved architecture.
