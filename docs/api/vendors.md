# Vendor Applications and Stores API

All routes are under `/api/v1` and use the standard success/error envelopes. Browser requests include cookies and the `X-CSRF-Token` header on unsafe methods. Contact phone values use international E.164 format. Application bodies are strict; callers cannot set status, reviewer, owner, or role fields.

## Vendor applications

### `POST /api/v1/vendor-applications`

Auth: customer role plus CSRF. Creates a pending application (`201`). Only one pending application per account is allowed; a rejected applicant can apply again, and history is retained.

```json
{
  "businessName": "Coastal Goods",
  "storeName": "Coastal Goods Shop",
  "businessDescription": "Home and lifestyle goods.",
  "contactPhone": "+2348012345678"
}
```

`businessDescription` is optional. Response data contains the created application. Duplicate pending applications return `409 CONFLICT`; invalid fields return `400 VALIDATION_ERROR`.

### `GET /api/v1/vendor-applications/me`

Auth: customer role. Returns only the caller's application history, including any rejection reason.

## Admin review

### `GET /api/v1/admin/vendor-applications?page=1&limit=20&status=pending`

Auth: admin role. `status` is optional (`pending`, `approved`, `rejected`). Results use `data.applications` and standard pagination `meta`.

### `GET /api/v1/admin/vendor-applications/:id`

Auth: admin role. Returns one application with applicant and reviewer identity.

### `POST /api/v1/admin/vendor-applications/:id/approve`

Auth: admin role plus CSRF. Approves a pending application, adds the vendor role, and creates a pending store in one transaction. The store slug is generated from the proposed name; a short unique suffix is used if needed. Repeated review returns `409 CONFLICT`.

### `POST /api/v1/admin/vendor-applications/:id/reject`

Auth: admin role plus CSRF. Requires `{ "reason": "Please provide clearer business activity details." }`; reason length is 10–500 characters and is visible to the applicant. Rejected applications can be resubmitted as a new history record.

### `GET /api/v1/admin/stores?page=1&limit=20`

Auth: admin role. Returns pending stores with pagination metadata.

### `POST /api/v1/admin/stores/:id/activate`

Auth: admin role plus CSRF. Activates a pending store after profile review. Only active stores are publicly visible.

## Store profile

### `GET /api/v1/stores/me`

Auth: vendor role. Returns the authenticated vendor's own store.

### `PATCH /api/v1/stores/me`

Auth: vendor role plus CSRF. At least one permitted field is required:

```json
{ "name": "Coastal Goods Outlet", "slug": "coastal-goods-outlet", "description": "Home goods." }
```

Owners may change the slug only while the store is pending. Active or suspended store slugs are locked. Slug collisions return `409 CONFLICT`.

### `GET /api/v1/stores/:slug`

Public. Returns only active stores; pending, suspended, and unknown slugs return `404 NOT_FOUND`. Public responses omit contact phone and owner IDs. The slug `me` is reserved for the authenticated profile route.

## Admin bootstrap

There is no public admin assignment API. An operator first registers the account, then runs `npm run admin:grant -- <existing-user-email>` from a trusted shell. The command grants the role only to an existing account and does not handle passwords.
