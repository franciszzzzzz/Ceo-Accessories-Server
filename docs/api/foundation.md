# Foundation API

All endpoints are unauthenticated and mounted under `/api/v1` in Phase 1. Responses are JSON. Every response includes `X-Request-Id`; clients may supply a valid ID containing 1–128 letters, digits, dots, underscores, colons, or hyphens.

## `GET /api/v1/health`

Liveness check. It does not contact PostgreSQL or Redis.

Success (`200`):

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "uptime": 12.34,
    "timestamp": "2026-10-30T12:00:00.000Z"
  }
}
```

## `GET /api/v1/ready`

Readiness check. It pings PostgreSQL and Redis.

Success (`200`):

```json
{
  "success": true,
  "data": {
    "status": "ready",
    "checks": { "database": "up", "redis": "up" }
  }
}
```

Failure (`503`, if either dependency is unavailable):

```json
{
  "success": false,
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "One or more required services are unavailable.",
    "details": {
      "status": "not_ready",
      "checks": { "database": "down", "redis": "up" }
    },
    "requestId": "b3c1..."
  }
}
```

## Common errors

Unknown paths return `404` with code `NOT_FOUND`. Invalid request shapes return `400` with code `VALIDATION_ERROR` and field details. Unexpected failures return `500` with code `INTERNAL_ERROR`; production responses contain no internal error messages or stack traces. See [`api-conventions.md`](../api-conventions.md) for the full envelope contract.
