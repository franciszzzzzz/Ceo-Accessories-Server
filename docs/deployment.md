# Deployment

The backend deploys independently of the frontend. Agents never deploy; this document is for humans and for configuring the app correctly.

## Environments
| Env | Purpose | Data |
|-----|---------|------|
| local | Development | Local PostgreSQL and Redis |
| staging | Pre-release checks | Separate DB, test payment keys |
| production | Live | Production DB, live keys |

## Runtime
- Node.js 22.12+ or 24 LTS (set in `package.json` `engines` and CI; Prisma 7 requires these supported lines).
- Build: `npm ci && npm run build`. Start: `npm start` (compiled `dist/server.js`).
- Run as a non-root user under a process manager (systemd or PM2) or in a container.

## Typical topology
```
Internet -> nginx (TLS, reverse proxy) -> Node app :4000 -> PostgreSQL / Redis (private network)
```
- Terminate TLS at the proxy. Set `TRUST_PROXY` accordingly so client IPs and secure cookies work.
- Database and Redis are not exposed publicly. Firewall allows only 80/443 (and SSH from trusted IPs).

## Environment variables
Runtime variables are defined and validated in `src/config/env.ts`; `DATABASE_URL_TEST` is read by Vitest configuration. All are listed with placeholders in `.env.example`.

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `development`, `test`, `production` |
| `PORT` | HTTP port |
| `DATABASE_URL` | PostgreSQL connection string |
| `DATABASE_URL_TEST` | Dedicated PostgreSQL database URL used by database integration tests; never point it at shared or production data |
| `REDIS_URL` | Redis connection string |
| `ACCESS_TOKEN_SECRET` | Signing secret for short-lived access tokens (at least 32 characters; unique per environment) |
| `CSRF_SECRET` | HMAC secret for CSRF tokens (at least 32 characters; unique per environment) |
| `CORS_ALLOWED_ORIGINS` | Comma-separated frontend origins |
| `LOG_LEVEL` | Pino level |
| `SENTRY_DSN` | Optional, enables Sentry |
| `SENTRY_ENVIRONMENT` | Label for Sentry events |
| `TRUST_PROXY` | Express trust proxy setting |
| `BODY_LIMIT` | JSON body size limit |
| `PAYSTACK_SECRET_KEY` | Optional Paystack secret key for payment initialization, verification, refunds, and webhook signature verification. Leave blank until the operator configures a provider test/live key. |
| `POSTGRES_DB` | Local Docker Compose database name |
| `POSTGRES_USER` | Local Docker Compose database user |
| `POSTGRES_PASSWORD` | Local Docker Compose database password |

The `POSTGRES_*` variables are used only by the local Docker Compose service. Set the same database name, user, and password in `DATABASE_URL`. The example file uses placeholders; supply local values before starting containers.

For local development, run `docker compose up -d postgres redis` from the repository root. The Compose services bind only to `127.0.0.1` and persist data in named volumes. Do not use `docker compose down -v` unless you explicitly intend to remove those database and Redis volumes.

The operator-only admin bootstrap command is `npm run admin:grant -- <existing-user-email>`. Register the account first, then run this command from a trusted operator shell. It grants only the `admin` role and does not create or reset credentials.

More variables are added per phase and documented here when added.

## Release steps
1. CI passes (typecheck, lint, test, audit).
2. Build artifact or image.
3. Back up the database.
4. `npx prisma migrate deploy`.
5. Restart the app (zero-downtime reload if possible).
6. Check `/api/v1/health` and `/api/v1/ready`.
7. Watch logs and Sentry.

## Rollback
Redeploy the previous build. Migrations are written to be backward compatible (expand and contract) so the previous build still works with the new schema.

## Graceful shutdown
SIGTERM stops new connections, finishes in-flight requests, closes Redis and Prisma, then exits. The process manager's stop timeout must exceed the app's shutdown timeout.

## Monitoring
- Liveness probe: `/api/v1/health`. Readiness probe: `/api/v1/ready`.
- Sentry for errors, structured logs shipped to a log store.
- Uptime check on the public health URL.

## CORS with the frontend
Set `CORS_ALLOWED_ORIGINS` to the exact deployed frontend origin(s) per environment. No wildcards.
