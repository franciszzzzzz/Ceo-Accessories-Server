# Phase 3 — Vendor Onboarding and Stores

**Status:** Complete
**Next phase (do not start without approval):** Phase 4 — Catalog

## Goal
Allow a customer to apply to become a vendor, an administrator to review applications, and an approved vendor to complete a store profile. Public reads expose active stores only.

## Approved decisions
- Application fields are business name, proposed store name, optional short description, and a contact phone in E.164 format. Do not collect registration numbers, identity documents, financial information, or a business address in this phase.
- A user may have one pending application at a time. Rejected users may submit a new application; prior applications and review decisions remain for audit.
- Approval assigns the vendor role and creates a pending store in one transaction. An administrator separately activates the store after profile review.
- Store owners can update name and description; contact phone can be updated. Slugs can be changed while pending, then are immutable once active. Slugs are generated from the proposed name and receive a short unique suffix on collision.
- Rejection requires an actionable reason (10–500 characters), visible to the applicant.
- The first administrator is provisioned by an explicit operator-run CLI command that grants the admin role to an existing user by email. No public admin assignment endpoint or external credentials are added.

## In scope
1. `VendorApplication` and `Store` Prisma models only, plus Prisma Migrate migration.
2. Customer application submission and own application history/status.
3. Admin application listing, inspection, approval, rejection, and pending-store activation.
4. Vendor-owned store profile read/update with ownership checks in service logic.
5. Public active-store lookup by slug.
6. Operator CLI to grant an admin role to an existing account.
7. Zod validation, standard envelopes, rate limiting for review/bootstrap-sensitive actions, API and security documentation, and unit/HTTP/database integration tests.

## API surface
- `POST /api/v1/vendor-applications` — customer submits an application.
- `GET /api/v1/vendor-applications/me` — customer sees their application history and rejection reasons.
- `GET /api/v1/admin/vendor-applications` — admin lists applications with status and pagination filters.
- `GET /api/v1/admin/vendor-applications/:id` — admin inspects an application.
- `POST /api/v1/admin/vendor-applications/:id/approve` — admin approves; creates vendor role and pending store transactionally.
- `POST /api/v1/admin/vendor-applications/:id/reject` — admin rejects with a required reason.
- `GET /api/v1/admin/stores` — admin lists pending stores.
- `POST /api/v1/admin/stores/:id/activate` — admin activates a pending store.
- `GET /api/v1/stores/me` — vendor reads their own store.
- `PATCH /api/v1/stores/me` — vendor updates permitted profile fields.
- `GET /api/v1/stores/:slug` — public reads an active store.

## Data and security rules
- Public users cannot set application status, reviewer fields, roles, store status, or owner IDs.
- A unique nullable `openUserId` database key serializes the one-pending-application rule while preserving rejected/approved history.
- An application is reviewable only while pending. Review transitions are atomic and cannot be repeated.
- Store owner IDs are unique. Store updates always select by authenticated owner ID, never by a caller-supplied owner ID.
- Only active stores are returned publicly. Only pending stores can be activated; suspended status management is reserved for a later admin-hardening phase.
- Admin CLI accepts an existing email, verifies the user exists, and uses the repository layer. It never accepts or prints a password.

## Out of scope
Products, categories, media upload/storage, vendor payouts, store search, messaging/email delivery, identity-document verification, frontend code, deployment, and any models beyond the two listed.

## Acceptance criteria
- Customers can submit applications and see only their own history.
- Duplicate pending applications are prevented under concurrent submissions; rejected applications remain available and a new submission is allowed.
- Only admins can review applications and activate stores.
- Approval assigns the vendor role and creates a pending store atomically; repeated review cannot duplicate role/store records.
- Rejection requires a reason, and applicants can see it.
- Vendors can update only their own store and cannot edit its slug after activation.
- Public lookup returns active stores only.
- Admin bootstrap works only for an existing user and does not expose a public privilege-grant route.
- Prisma migration applies to local and dedicated test databases without reset or destructive operations.
- Unit, HTTP, and database integration tests, typecheck, lint, and build pass.
- Relevant docs and progress checklist are current.

## Progress checklist
- [x] Scope and policy decisions recorded
- [x] Prisma schema reviewed and approved
- [x] Prisma migration created and applied to local/test databases
- [x] Repository and service logic
- [x] Application and admin review routes
- [x] Store profile and public read routes
- [x] Admin bootstrap CLI
- [x] Unit, HTTP, and database tests
- [x] API/security/database documentation
- [x] Typecheck, lint, test, and build pass
- [x] Final report delivered

## Notes
- No external integrations or new credentials are introduced.
- Show the finalized Prisma schema before creating a migration.
