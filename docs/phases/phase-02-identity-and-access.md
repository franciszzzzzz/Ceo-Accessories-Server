# Phase 2 — Identity and Access

**Status:** Complete
**Next phase (do not start without approval):** Phase 3 — Vendor Onboarding and Stores

## Goal
Add secure customer identity, browser authentication, role checks, password reset token handling, and Redis-backed rate limiting. This phase adds only identity and access models and endpoints.

## Authentication decision
- Browser authentication uses short-lived signed access tokens and rotating refresh tokens in `HttpOnly` cookies.
- Access and refresh cookies use `Secure` in production, `SameSite=Lax`, deliberate path scopes, and exact allowlisted CORS origins with credentials enabled.
- Unsafe cookie-authenticated requests require a CSRF token in a request header, matched against a separate CSRF cookie.
- Refresh tokens are opaque random values; only their hashes are stored in PostgreSQL. Refresh rotates the stored hash and revokes a reused token family.
- Access tokens are signed with an environment secret and expire after 15 minutes. Refresh sessions expire after 30 days and can be revoked.
- The default role at registration is `customer`. `vendor` and `admin` assignments are represented in the schema but are not self-assignable and are not managed through public endpoints in this phase.

## In scope
1. `User`, `Role`, `UserRole`, `RefreshSession`, and `PasswordResetToken` Prisma models, plus Prisma Migrate migration.
2. Registration, login, refresh, logout, current-user, password-reset request, and password-reset completion endpoints.
3. Argon2id password hashing and credential verification.
4. Short-lived access token validation and role authorization middleware.
5. Refresh token rotation, hashed storage, revocation, and reuse detection.
6. Cookie security, CSRF protection, credentialed CORS configuration, and authentication-specific rate limits backed by Redis.
7. Generic password-reset request responses that do not disclose account existence.
8. An injectable password-reset delivery port; no email provider or credentials are added. Persist reset tokens hashed. If no delivery adapter is configured, requests remain accepted but cannot complete until a later phase provides delivery; this limitation must be explicit in API and deployment docs.
9. Unit, HTTP integration, and database integration tests using a dedicated `DATABASE_URL_TEST`.
10. API docs, security docs, schema docs, `.env.example`, and progress checklist updates.

## Out of scope
Vendor applications or stores, product/catalog models, authorization policies tied to stores, password-reset email provider integration, social login, MFA, payments, frontend code, deployment, and destructive database operations.

## Acceptance criteria
- [x] A customer can register and log in without revealing whether a submitted email exists.
- [x] Passwords are hashed with Argon2id; plaintext passwords never persist or appear in logs.
- [x] Refresh rotates tokens, persists only hashes, revokes on logout, and detects refresh reuse.
- [x] Protected routes reject missing, expired, malformed, or revoked sessions with the standard `UNAUTHENTICATED` envelope.
- [x] Unsafe cookie-authenticated requests require a valid CSRF token.
- [x] Public users cannot assign themselves vendor or admin roles.
- [x] Auth endpoints have Redis-backed rate limits and return `RATE_LIMITED` consistently.
- [x] Password reset tokens are hashed, single-use, expire, and responses do not disclose account existence.
- [x] Prisma migration applies to dedicated local and test databases without reset or destructive operations.
- [x] `npm run typecheck`, `npm run lint`, and `npm test` pass with real output captured.
- [x] `.env.example` and all relevant docs are current.

## Progress checklist
Only tick items that were actually run or verified.

- [x] Phase scope recorded and approved
- [x] Authentication and CSRF configuration
- [x] Prisma schema
- [x] Prisma migration generated with Prisma Migrate
- [x] Prisma migration applied to dedicated local and test databases
- [x] Password hashing and user repository
- [x] Registration and login
- [x] Refresh rotation, logout, and session revocation
- [x] Authentication and role middleware
- [x] Redis-backed rate limiting
- [x] Password reset token handling
- [x] Unit and HTTP tests passing
- [x] Database integration tests passing against `DATABASE_URL_TEST`
- [x] API and security docs updated
- [x] Typecheck, lint, and current full test suite pass
- [x] Final report delivered

## Notes and decisions
- Password reset email delivery is intentionally represented by a port only because no provider or credentials are authorized. The flow is not operational until a delivery adapter is supplied in a later approved phase.
- No database reset, truncate, or drop operation is permitted.
- Local Docker development uses `redis:7-bookworm` because the `redis:7-alpine` image failed with an exec format error on the available Docker engine.
