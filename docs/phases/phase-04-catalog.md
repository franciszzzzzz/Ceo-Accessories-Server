# Phase 4 — Catalog

**Status:** Complete
**Next phase (do not start without approval):** Phase 5 — Inventory

## Goal
Add category management, vendor product and variant management, and public product browse/search. Keep all catalog ownership scoped to active vendor stores.

## Scope
1. Prisma models: `Category`, `Product`, `ProductVariant`, and `ProductMedia` only.
2. Admin-managed hierarchical categories with unique slugs and safe parent validation.
3. Vendor-owned product create, read, update, archive, variant/SKU, and price operations.
4. Public paginated browse/search for published products from active stores, with category and text filters and documented sorting.
5. Prices stored as integer minor units in NGN; no floating-point values.
6. Product media metadata and a storage adapter boundary only. No upload route, filesystem storage, cloud SDK, external service, or credentials are included. Operational uploads are deferred until a storage provider is explicitly approved.
7. Zod validation, authorization, ownership checks, Prisma Migrate migration, tests, API documentation, and security/database docs.

## API surface
- `GET /api/v1/categories`; `GET /api/v1/categories/:slug`
- `GET /api/v1/admin/categories`; `POST /api/v1/admin/categories`; `PATCH /api/v1/admin/categories/:id`; `POST /api/v1/admin/categories/:id/archive`
- `GET /api/v1/vendor/products`; `POST /api/v1/vendor/products`; `GET /api/v1/vendor/products/:id`; `PATCH /api/v1/vendor/products/:id`
- `POST /api/v1/vendor/products/:id/publish`; `POST /api/v1/vendor/products/:id/archive`
- `POST /api/v1/vendor/products/:productId/variants`; `PATCH /api/v1/vendor/products/:productId/variants/:variantId`; `POST /api/v1/vendor/products/:productId/variants/:variantId/archive`
- `GET /api/v1/products`; `GET /api/v1/stores/:storeSlug/products/:productSlug`

## Data rules
- A product belongs to one store and one or more categories; only active categories can be assigned.
- Product status is `draft`, `active`, or `archived`. Only active products with an active variant from active stores appear publicly. Vendors cannot publish into inactive stores.
- Variants carry SKU, option values (such as size/color), integer `priceAmount`, and `currency` defaulting to `NGN`. SKU uniqueness is per store.
- Category parent relationships cannot contain cycles. A category with children or products cannot be hard-deleted; it is archived.
- Product and variant reads/updates are scoped through the authenticated vendor's store. Caller-supplied store ownership is rejected.
- A published product must have an active category and at least one active variant. Its last active variant cannot be archived until the product itself is archived.
- Inventory quantity and reservations are not modeled here; those belong to Phase 5.
- Product media rows represent metadata for a future approved storage adapter. This phase cannot accept file uploads because the repository has no authorized object-storage integration.

## Out of scope
Inventory, stock/reservation logic, cart/checkout, media upload and storage integration, image processing, recommendations, advanced search ranking, frontend code, deployment, and models not listed above.

## Acceptance criteria
- Admins can manage a hierarchical category tree with slug uniqueness and safe archive behavior.
- Vendors can manage products and variants only in their own active store.
- Variant prices are validated integer minor units; SKUs are unique within a store.
- Public browse/search returns only active products from active stores, with stable pagination and documented filters/sorts.
- Products cannot be published without a valid category and at least one variant.
- Unit, HTTP, and database integration tests, typecheck, lint, and build pass.
- API, domain, database, security, and progress docs are current.
- Media uploads remain explicitly deferred; no local file storage or unapproved provider is introduced.

## Progress checklist
- [x] Scope approved with media uploads deferred
- [x] Prisma schema reviewed and approved
- [x] Prisma migration created and applied to local/test databases
- [x] Category CRUD and hierarchy validation
- [x] Vendor-owned product and variant operations
- [x] Product publication and archive rules
- [x] Public browse, search, and detail
- [x] Unit and database integration tests
- [x] API/security/database documentation
- [x] Typecheck, lint, test, and build pass
- [x] Final report delivered
