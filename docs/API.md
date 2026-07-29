# HTTP API contract

The browser uses a private JSON API under `/api/v1`. The contract is documented so UI, worker, tests, and future clients share predictable validation and error behavior; it is not an unauthenticated public internet API.

## 1. Conventions

- Base path: `/api/v1`
- Media type: `application/json; charset=utf-8`
- Field names: `camelCase`
- Resource IDs: lowercase UUID strings
- Instants: ISO 8601 UTC strings ending in `Z`
- Calendar dates: numeric `{ year, month, day }` plus explicit calendar
- Money: integer minor units transported as decimal strings
- Unknown request fields: rejected with `VALIDATION_ERROR`
- Empty optional text: trimmed and normalized to `null`
- Mutation responses: the canonical resource after transaction commit
- Trace header: server returns `X-Request-Id`; safe error bodies include the same ID

All mutation routes enforce same-origin/CSRF policy, JSON content type, and a small request-body limit. The reverse proxy should rate-limit provider-test and mutation endpoints.

## 2. Resource shapes

### Reminder

```json
{
  "id": "83e41b5d-77df-449d-89b1-09ba665fef8f",
  "title": "Domain renewal",
  "description": "Renew the primary project domain",
  "type": "subscription",
  "customTypeLabel": null,
  "state": "active",
  "schedule": {
    "calendar": "gregorian",
    "anchorDate": { "year": 2026, "month": 11, "day": 15 },
    "anchorWasLastDay": false,
    "frequency": "yearly",
    "interval": 1,
    "nextOccurrenceDate": "2026-11-15",
    "nextNotificationAt": "2026-11-08T05:30:00.000Z"
  },
  "amount": {
    "currency": "USD",
    "minor": "1299"
  },
  "remindBeforeDays": 7,
  "channels": {
    "email": true,
    "telegram": true
  },
  "createdAt": "2026-07-29T09:10:22.000Z",
  "updatedAt": "2026-07-29T09:10:22.000Z"
}
```

`nextOccurrenceDate` is a server-derived canonical Gregorian `YYYY-MM-DD` value, not an event time. `nextNotificationAt` is a UTC instant. Neither is accepted as a writable request field.

### Settings

```json
{
  "calendarSystem": "jalali",
  "defaultCurrency": "IRR",
  "emailEnabled": false,
  "telegramEnabled": true,
  "providers": {
    "email": {
      "available": false,
      "status": "not_configured"
    },
    "telegram": {
      "available": true,
      "status": "configured"
    }
  },
  "updatedAt": "2026-07-29T09:00:00.000Z"
}
```

Provider readiness is an allowlisted status. No address, username, host, token, chat ID, or secret is exposed.

## 3. Reminder endpoints

### `GET /api/v1/reminders`

Returns a cursor-paginated list plus dashboard summary.

Query parameters:

| Parameter   | Values                                        | Default          |
| ----------- | --------------------------------------------- | ---------------- |
| `q`         | 1–120 character search string                 | omitted          |
| `type`      | one reminder type or comma-separated types    | all              |
| `state`     | `active`, `paused`, `completed`, `all`        | `active`         |
| `sort`      | `nextOccurrence`, `title`, `amount`           | `nextOccurrence` |
| `direction` | `asc`, `desc`                                 | depends on sort  |
| `limit`     | integer 1–100                                 | 50               |
| `cursor`    | opaque URL-safe cursor from previous response | omitted          |

Success: `200 OK`

```json
{
  "items": [],
  "page": {
    "nextCursor": null,
    "hasMore": false
  },
  "summary": {
    "activeCount": 0,
    "dueWithinSevenDaysCount": 0,
    "amountsByCurrency": {
      "IRR": "0",
      "USD": "0"
    }
  }
}
```

The summary represents all active reminders and is intentionally unaffected by list search/filter controls. Amount currencies remain separate.

### `POST /api/v1/reminders`

Creates one reminder.

```json
{
  "title": "Mother's birthday",
  "description": null,
  "type": "birthday",
  "customTypeLabel": null,
  "state": "active",
  "schedule": {
    "calendar": "jalali",
    "anchorDate": { "year": 1405, "month": 8, "day": 12 },
    "frequency": "yearly",
    "interval": 1
  },
  "amount": null,
  "remindBeforeDays": 3,
  "channels": {
    "email": false,
    "telegram": true
  }
}
```

Success: `201 Created`, `Location: /api/v1/reminders/{id}`, body is the canonical Reminder.

Validation highlights:

- The anchor date must exist in the specified calendar and convert within the supported Gregorian range `1900-01-01` through `2400-12-31`.
- `customTypeLabel` is required only for type `custom`.
- Amount and currency must be both present or both absent.
- Selecting an unavailable provider is rejected with a field error; a provider that is configured but globally disabled may remain selected as a saved preference but will not send.
- A one-time anchor that is already past is rejected. A recurring anchor may be historical; the server calculates the first future occurrence.

### `GET /api/v1/reminders/{id}`

Success: `200 OK` with the canonical Reminder. Unknown ID: `404 NOT_FOUND`.

### `PATCH /api/v1/reminders/{id}`

Partially updates a reminder. `expectedUpdatedAt` is required. Nested `schedule`, `amount`, and `channels` values are atomic: when present, send the complete nested object.

```json
{
  "expectedUpdatedAt": "2026-07-29T09:10:22.000Z",
  "remindBeforeDays": 14,
  "channels": {
    "email": true,
    "telegram": true
  }
}
```

Success: `200 OK` with updated Reminder.

If the stored `updatedAt` differs, return `409 CONFLICT` with code `STALE_WRITE` and the current resource in `error.meta.current`. The server does not merge stale changes.

Updating schedule, lead time, state, or channels transactionally cancels now-stale pending deliveries and creates any newly eligible deliveries.

### `DELETE /api/v1/reminders/{id}`

Requires the concurrency token in JSON:

```json
{
  "expectedUpdatedAt": "2026-07-29T09:10:22.000Z"
}
```

Success: `204 No Content`. Stale token: `409 STALE_WRITE`. Unknown ID: `404 NOT_FOUND`.

## 4. Settings endpoints

### `GET /api/v1/settings`

Success: `200 OK` with Settings.

### `PATCH /api/v1/settings`

All four settings and `expectedUpdatedAt` are required so the singleton is replaced consistently.

```json
{
  "calendarSystem": "gregorian",
  "defaultCurrency": "USD",
  "emailEnabled": true,
  "telegramEnabled": true,
  "expectedUpdatedAt": "2026-07-29T09:00:00.000Z"
}
```

Success: `200 OK` with canonical Settings.

Rules:

- A channel cannot be enabled globally when its provider configuration is unavailable.
- Disabling a channel cancels its eligible pending/retry deliveries in the same transaction.
- Calendar and currency changes do not update existing reminder anchors or currency values.
- A stale update returns `409 STALE_WRITE`.

## 5. Provider test endpoints

Provider tests are queued so the HTTP request does not hold an external network connection and uses the same delivery path as real reminders.

### `POST /api/v1/provider-tests/email`

### `POST /api/v1/provider-tests/telegram`

Request:

```json
{ "confirmed": true }
```

If configured, returns `202 Accepted`:

```json
{
  "id": "7bb8f997-3e8b-46a2-b2e4-2894a991d514",
  "channel": "telegram",
  "status": "pending",
  "statusUrl": "/api/v1/provider-tests/7bb8f997-3e8b-46a2-b2e4-2894a991d514"
}
```

If not configured, return `409 PROVIDER_UNAVAILABLE`. If `confirmed` is not true, return `400 CONFIRMATION_REQUIRED`.

### `GET /api/v1/provider-tests/{id}`

Returns only provider-test rows and only safe fields:

```json
{
  "id": "7bb8f997-3e8b-46a2-b2e4-2894a991d514",
  "channel": "telegram",
  "status": "sent",
  "attemptCount": 1,
  "createdAt": "2026-07-29T09:20:00.000Z",
  "sentAt": "2026-07-29T09:20:01.000Z",
  "error": null
}
```

Terminal failure returns a categorized, redacted error such as:

```json
{
  "category": "authentication",
  "code": "PROVIDER_AUTH_FAILED",
  "message": "Telegram rejected the configured bot credentials. Check the server environment."
}
```

The UI polls with capped exponential delay and stops on a terminal state or after a bounded timeout.

## 6. Health endpoints

Health endpoints are intentionally outside versioned product resources.

### `GET /api/health/live`

Does not query dependencies.

```json
{ "status": "ok" }
```

Success: `200 OK` while the process can handle requests.

### `GET /api/health/ready`

Checks parsed configuration, database reachability, and expected migration version.

```json
{
  "status": "ready",
  "checks": {
    "database": "ok",
    "migrations": "ok"
  }
}
```

Ready: `200 OK`. Not ready: `503 Service Unavailable`. The payload never includes versions that disclose avoidable attack detail, hostnames, or connection strings.

## 7. Error envelope

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid fields.",
    "requestId": "req_01J4...",
    "fields": {
      "schedule.anchorDate.day": ["Day 30 is not valid for this month and year."],
      "remindBeforeDays": ["Must be between 0 and 365."]
    },
    "meta": null
  }
}
```

`message` is safe for display. `fields` uses request paths. Internal stack traces and provider bodies never leave the server.

### Stable error codes

| HTTP | Code                     | Meaning                                                  |
| ---- | ------------------------ | -------------------------------------------------------- |
| 400  | `INVALID_JSON`           | Malformed JSON                                           |
| 400  | `VALIDATION_ERROR`       | Schema or domain validation failure                      |
| 400  | `CONFIRMATION_REQUIRED`  | Side-effect confirmation missing                         |
| 403  | `ORIGIN_NOT_ALLOWED`     | Origin/CSRF validation failed                            |
| 404  | `NOT_FOUND`              | Resource does not exist                                  |
| 409  | `STALE_WRITE`            | Optimistic concurrency token is old                      |
| 409  | `PROVIDER_UNAVAILABLE`   | Channel environment is incomplete/invalid                |
| 413  | `PAYLOAD_TOO_LARGE`      | Body limit exceeded                                      |
| 415  | `UNSUPPORTED_MEDIA_TYPE` | JSON required                                            |
| 422  | `SCHEDULE_UNCOMPUTABLE`  | Valid shape but no valid next occurrence can be produced |
| 429  | `RATE_LIMITED`           | Proxy/application test limit reached                     |
| 500  | `INTERNAL_ERROR`         | Unexpected safe failure                                  |
| 503  | `SERVICE_UNAVAILABLE`    | Required dependency unavailable                          |

## 8. Validation contract

Shared Zod schemas define syntax. Domain functions define calendar and recurrence semantics. Database constraints are the final integrity layer.

| Input               | Contract                                                                 |
| ------------------- | ------------------------------------------------------------------------ |
| Title               | Unicode string after trim; 1–120 characters                              |
| Description         | Unicode string after trim; null or ≤2,000 characters                     |
| Custom label        | null unless type custom; then 1–40 characters                            |
| Calendar date       | Integers; valid in explicit calendar                                     |
| Recurrence interval | Integer 1–99                                                             |
| Lead days           | Integer 0–365                                                            |
| Amount minor        | Digit-only string; range enforced; no sign/decimal separator             |
| Search              | Trimmed string ≤120; no wildcard semantics exposed                       |
| Cursor              | Authenticated/opaque server encoding; invalid cursors return field error |
| Expected timestamp  | Exact canonical UTC timestamp returned by API                            |

## 9. Caching and freshness

- Reminder and settings responses use `Cache-Control: private, no-store` for the MVP.
- Health endpoints may use `no-store`.
- Browser mutations refresh the affected list/settings data after commit.
- Do not depend on cross-instance Next.js cache invalidation for correctness.
- Provider test polling may use a short client-side interval but remains `no-store` at HTTP level.

## 10. API test obligations

- Contract tests cover every success/error status and reject unknown fields.
- Every request example in this document becomes a validated fixture.
- Fuzz/property tests cover calendar components, amount strings, cursors, and Unicode length boundaries.
- Security tests cover cross-origin mutations, content type, oversized bodies, HTML/script text, and secret redaction.
- Concurrency tests prove stale writes cannot win.
- Provider-test endpoints prove no provider configuration value appears in any response.
