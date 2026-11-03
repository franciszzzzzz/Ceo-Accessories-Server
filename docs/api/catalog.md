# Catalog API

All endpoints use `/api/v1`, standard envelopes, and Zod validation. Unsafe cookie-authenticated requests require the CSRF cookie/header pair. Prices use integer minor units in `{ "amount": 175000, "currency": "NGN" }` form.

## Categories

- `GET /api/v1/categories` — public active category tree. Archived ancestors are omitted; active descendants appear at the nearest visible level.
- `GET /api/v1/categories/:slug` — public active category detail.
- `GET /api/v1/admin/categories?includeArchived=true` — admin category tree; archived categories are excluded by default.
- `POST /api/v1/admin/categories` — admin create. Body: `{ "name": "Kitchen", "slug": "kitchen", "parentId": null, "sortOrder": 0 }`; `description` is optional.
- `PATCH /api/v1/admin/categories/:id` — admin update name, slug, description, parent, or sort order. Parent cycles are rejected.
- `POST /api/v1/admin/categories/:id/archive` — admin archive; categories are not hard-deleted.

Category writes require the admin role and CSRF. Duplicate slugs return `409 CONFLICT`; invalid hierarchy changes return `422 UNPROCESSABLE`.

## Vendor products

Every vendor route requires the vendor role, CSRF for writes, and an active owned store.

- `GET /api/v1/vendor/products?page=1&limit=20` — paginated products for the vendor's store.
- `POST /api/v1/vendor/products` — create a draft. Body: `{ "name": "Linen Shirt", "description": "Cotton shirt.", "categoryIds": ["<category UUID>"] }`. `categoryIds` defaults to an empty list. Slug is generated from the name and suffixed if needed.
- `GET /api/v1/vendor/products/:id` — own product and variants.
- `PATCH /api/v1/vendor/products/:id` — update name, description, or category assignments.
- `POST /api/v1/vendor/products/:id/publish` — publish a draft with at least one active category and one active variant.
- `POST /api/v1/vendor/products/:id/archive` — archive the product without deleting it.
- `POST /api/v1/vendor/products/:productId/variants` — add a variant. Body: `{ "sku": "linen-shirt-blue-m", "options": { "color": "Blue", "size": "M" }, "priceAmount": 175000, "currency": "NGN" }`. SKU is normalized to uppercase and unique within the store.
- `PATCH /api/v1/vendor/products/:productId/variants/:variantId` — update SKU, option values, or integer price.
- `POST /api/v1/vendor/products/:productId/variants/:variantId/archive` — archive a variant. The last active variant of a published product cannot be archived until the product is archived.

Create returns `201`; invalid requests return `400 VALIDATION_ERROR`; duplicate SKU returns `409 CONFLICT`; incomplete publication returns `422 UNPROCESSABLE`. A vendor cannot read or modify another store's product.

## Public catalog

- `GET /api/v1/products?page=1&limit=20&q=linen&category=kitchen&sort=newest` — paginated browse/search. `q` searches product name and description. `sort` accepts `newest`, `name_asc`, or `name_desc`.
- `GET /api/v1/stores/:storeSlug/products/:productSlug` — public product detail.

Public results include only active products with at least one active variant in active stores. Product detail and browse include active categories and active variants. Unknown, draft, archived, or inactive-store products return `404 NOT_FOUND` on detail.

## Media

`ProductMedia` stores object metadata for a future storage adapter. Upload and media mutation endpoints are not available in this phase; no local file or unapproved object storage is used.
