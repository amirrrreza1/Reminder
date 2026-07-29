# Product specification

| Field        | Value                                                      |
| ------------ | ---------------------------------------------------------- |
| Product      | Reminder                                                   |
| Release      | MVP / `0.1.0` target                                       |
| Status       | Approved implementation baseline                           |
| Audience     | Maintainers, designers, contributors, QA, and self-hosters |
| Last updated | 2026-07-29                                                 |

## 1. Product vision

Reminder makes recurring obligations visible and dependable without becoming a calendar, finance system, or productivity suite. A self-hoster should be able to open one screen, understand what is coming, and trust that configured email and Telegram notifications will be attempted on time.

### Principles

1. **Small surface, complete behavior.** One dashboard and two modals are enough for the MVP.
2. **Trust over cleverness.** Dates, recurrence rules, and notification status must be explicit.
3. **Calendar-safe.** Gregorian and Solar Hijri recurrence must preserve their own calendar meaning.
4. **Self-hosting first.** Local data, portable PostgreSQL backups, provider-neutral SMTP, and no telemetry.
5. **No silent transformations.** Currency changes do not convert amounts; calendar changes do not move anniversaries.
6. **Accessible personality.** A bold visual system must still support keyboard, screen-reader, reduced-motion, and high-contrast use.

## 2. MVP assumptions

- One deployed instance serves one person or one trusted household.
- There are no application accounts, roles, workspaces, or tenancy boundaries in the MVP.
- Production access is protected by a private network or an authenticated TLS reverse proxy.
- English is the initial interface language. Layout and components must be RTL-safe so Persian localization can follow without redesign.
- `APP_TIMEZONE` is deployment configuration, not a UI setting. The default example is `Asia/Tehran`.
- Provider secrets and destination addresses/chat IDs live in environment variables. The UI never reads or reveals them.
- The product has no analytics or telemetry unless a future maintainer proposes an explicit, opt-in change.

## 3. Goals and non-goals

### Goals

- CRUD for recurring reminders with a fast modal workflow.
- Accurate next-occurrence calculation for Gregorian and Jalali calendars.
- Optional amounts in IRR or USD.
- Configurable lead time in whole days.
- Durable, retryable email and Telegram delivery.
- Responsive, accessible cards with a warm neo-brutalist visual language.
- A documented Docker Compose deployment and safe upgrade path.

### Non-goals for MVP

- Multi-user authentication, sharing, teams, permissions, or public signup.
- Full calendar views, drag-and-drop scheduling, task lists, or note management.
- SMS, mobile push, browser push, webhooks, or chat commands.
- Attachments, contacts, tags, custom fields, or recurring checklists.
- Exchange rates, currency conversion, payments, invoices, or financial accounting.
- Multiple notification offsets per reminder.
- Complex RFC 5545 rules such as “third business day” or arbitrary exclusion dates.
- Native mobile applications.
- A notification-history page. Delivery history exists in the database and logs for operations.

## 4. Information architecture

```text
/
├── Header: product mark, Settings, Add reminder
├── Summary: total active, due soon, monthly amount snapshot
├── Toolbar: search, type filter, state filter, sort
├── Reminder card grid
├── Reminder modal: create/edit/delete
└── Settings modal: four preferences + provider readiness/test actions
```

The URL remains `/` while either modal is open. Modal state may be represented in the query string (`?modal=reminder&id=...` or `?modal=settings`) so refresh and back-button behavior remain predictable, but these are not separate pages.

## 5. Core user stories

- As a self-hoster, I can see which reminder happens next and how many days remain.
- As a user, I can create a birthday reminder that repeats on the correct Jalali or Gregorian date every year.
- As a user, I can record a monthly subscription amount and see its currency unambiguously.
- As a user, I can request a message several days before an occurrence through one or both configured channels.
- As a user, I can pause a reminder without deleting its history.
- As a user, I can change the display calendar without changing when an existing reminder actually recurs.
- As an operator, I can determine from health checks and logs whether the scheduler and providers are working.
- As a contributor, I can understand the expected behavior without reverse-engineering implementation details.

## 6. Functional requirements

Requirement IDs are stable references for issues, pull requests, tests, and release notes.

### 6.1 Dashboard

- **DASH-001:** `/` lists reminder cards ordered by `nextOccurrenceDate` ascending by default.
- **DASH-002:** Each card shows title, type, formatted next date, countdown, recurrence label, optional amount, channel badges, and active/paused state.
- **DASH-003:** Descriptions are clamped to three lines; the full value is available to assistive technology and in edit mode.
- **DASH-004:** A card is fully keyboard reachable. Its edit control has an explicit accessible name such as “Edit Internet subscription.”
- **DASH-005:** The toolbar searches title and description locally/server-side without a page navigation.
- **DASH-006:** Filters cover type and state (`active`, `paused`, `all`). Sorting covers next occurrence, title, and amount.
- **DASH-007:** Filters are represented in the URL query string and survive refresh.
- **DASH-008:** Summary values include active reminder count and count due within seven days. Amount summary is shown separately by currency; currencies are never added together.
- **DASH-009:** The empty state explains the value of the app and offers one primary “Add reminder” action.
- **DASH-010:** Loading uses stable skeleton cards; errors keep existing content when possible and offer retry.
- **DASH-011:** A reminder due today says “Today”; a past-due one-time reminder says “Overdue”; future dates use an exact date plus relative countdown.

### 6.2 Reminder lifecycle

- **REM-001:** Add opens an empty modal with defaults from settings and type preset.
- **REM-002:** Edit opens the same modal populated from the selected reminder.
- **REM-003:** Save performs the same Zod validation on client and server; server validation is authoritative.
- **REM-004:** Successful save closes the modal, updates the card list, and announces success through an accessible live region.
- **REM-005:** Closing a dirty modal asks for confirmation before discarding edits.
- **REM-006:** A reminder can be paused/resumed. Paused reminders keep their schedule but do not create deliveries.
- **REM-007:** Delete is available only in edit mode, uses a destructive confirmation, and permanently deletes the reminder and its delivery history through database cascade.
- **REM-008:** A reminder is assigned an immutable UUID by the server.
- **REM-009:** Concurrent edits use `updatedAt` as an optimistic concurrency token. A stale update returns `409 CONFLICT` and does not overwrite newer data.
- **REM-010:** On save, the server computes and persists the first valid `nextOccurrenceDate` and `nextNotificationAt` strictly from validated schedule data.

### 6.3 Reminder fields

| Field           | Required           | Rules                                                                                                       |
| --------------- | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| Title           | Yes                | Trimmed; 1–120 Unicode characters                                                                           |
| Description     | No                 | Trimmed; maximum 2,000 Unicode characters; plain text only                                                  |
| Type            | Yes                | One predefined type or `CUSTOM`                                                                             |
| First/next date | Yes                | Valid in the selected input calendar; Gregorian equivalent must fall from `1900-01-01` through `2400-12-31` |
| Recurrence      | Yes                | `ONCE`, `DAILY`, `WEEKLY`, `MONTHLY`, or `YEARLY` with interval 1–99                                        |
| Amount          | No                 | Non-negative; maximum minor-unit value `9,999,999,999,999`; no free-form symbols                            |
| Currency        | When amount exists | `IRR` or `USD`; defaults from settings                                                                      |
| Remind before   | Yes                | Whole number from 0 through 365 days; default 1                                                             |
| Email           | Yes                | Boolean; defaults to global email setting only when provider is available                                   |
| Telegram        | Yes                | Boolean; defaults to global Telegram setting only when provider is available                                |
| Active          | Yes                | Boolean; default `true`                                                                                     |

The calendar used to enter the schedule and the recurrence anchor are persisted even though the modal normally defaults to the global display calendar.

### 6.4 Reminder types and presets

Types are presentation metadata, not separate database tables in the MVP. A type proposes defaults but does not restrict editing.

| Type               | Suggested icon | Default recurrence | Amount default         |
| ------------------ | -------------- | ------------------ | ---------------------- |
| Birthday           | Cake           | Yearly             | Hidden until requested |
| Subscription       | Repeat/card    | Monthly            | Visible                |
| Debt / installment | Receipt        | Monthly            | Visible                |
| Rent               | Home           | Monthly            | Visible                |
| Bill / utility     | Bolt           | Monthly            | Visible                |
| Insurance          | Shield         | Yearly             | Visible                |
| Membership         | Badge          | Yearly             | Visible                |
| Maintenance        | Wrench         | Every 3 months     | Optional               |
| Medication refill  | Pill           | Monthly            | Optional               |
| Tax / license      | File-check     | Yearly             | Optional               |
| Custom             | Bell           | Monthly            | Optional               |

Changing a type updates defaults only for untouched fields during creation. It never overwrites user-entered values and never mutates an existing reminder during editing.

### 6.5 Recurrence behavior

- **REC-001:** `ONCE` has one occurrence and becomes `completed` after its occurrence is processed.
- **REC-002:** Daily and weekly recurrence add calendar days/weeks in `APP_TIMEZONE`.
- **REC-003:** Monthly and yearly recurrence use the reminder’s persisted recurrence calendar, not the current display setting.
- **REC-004:** A date on the last day of a month remains on the last valid day when the target month is shorter. Gregorian February 29 and Jalali Esfand 30 follow the same “last valid day” rule in non-leap years.
- **REC-005:** Intervals are positive integers from 1–99. Example: frequency `MONTHLY`, interval `3` means every three months.
- **REC-006:** The recurrence anchor never changes after creation unless the user edits the date or recurrence.
- **REC-007:** Calculating the next occurrence is a pure, shared domain function with exhaustive calendar-edge tests.
- **REC-008:** The system materializes `nextOccurrenceDate` as a canonical Gregorian database `DATE` and `nextNotificationAt` as a UTC instant for efficient queries, while retaining the original local calendar components needed to calculate later occurrences.
- **REC-009:** When an instance was offline, it processes an unsent notification only if its notification time is within `NOTIFICATION_MISSED_GRACE_HOURS`. Older missed deliveries are marked `expired`, not sent in a burst.
- **REC-010:** Changing `APP_TIMEZONE` is an operator migration, not a routine restart. The worker recomputes future UTC timestamps from the unchanged local schedule before sending resumes.
- **REC-011:** A date-only occurrence remains “Today” for the entire local calendar day and advances/completes on the first scheduler pass after that local date ends.

### 6.6 Settings

- **SET-001:** Settings open in a modal from the dashboard header.
- **SET-002:** Calendar system is exactly `Gregorian` or `Solar Hijri (Jalali)`.
- **SET-003:** Currency is exactly `Iranian rial (IRR)` or `US dollar (USD)`.
- **SET-004:** Email enabled is a global boolean.
- **SET-005:** Telegram enabled is a global boolean.
- **SET-006:** A channel toggle is disabled and labeled “Not configured by the server” when required environment variables are missing or invalid.
- **SET-007:** The modal shows provider readiness but never host credentials, usernames, tokens, chat IDs, or recipient addresses.
- **SET-008:** Each configured channel offers a “Send test” action. It asks for confirmation because it creates an external message.
- **SET-009:** A settings update changes future presentation/defaults and channel gating. It does not rewrite reminder currency, recurrence calendar, or per-reminder channel choices.
- **SET-010:** A fresh database is seeded from `DEFAULT_*` environment variables exactly once.

### 6.7 Notification eligibility and delivery

A delivery is eligible only when all applicable gates are true:

| Gate                                 | Email    | Telegram |
| ------------------------------------ | -------- | -------- |
| Required environment values validate | Required | Required |
| Global setting enabled               | Required | Required |
| Reminder channel flag enabled        | Required | Required |
| Reminder active                      | Required | Required |
| Occurrence in send/catch-up window   | Required | Required |

- **NOT-001:** Notification time is the occurrence’s local date minus `remindBeforeDays`, at `NOTIFICATION_SEND_TIME` in `APP_TIMEZONE`.
- **NOT-002:** `remindBeforeDays = 0` means the occurrence day, not immediately after creation.
- **NOT-003:** If a reminder is created after its calculated notification time but before the occurrence, enqueue the delivery immediately.
- **NOT-004:** One delivery row is created per reminder, occurrence, channel, and lead time under a database unique constraint.
- **NOT-005:** Email and Telegram are independent. One provider failing never prevents the other provider’s delivery.
- **NOT-006:** Transient failures retry with exponential backoff and jitter up to `NOTIFICATION_MAX_ATTEMPTS`.
- **NOT-007:** Permanent validation/authentication failures do not retry indefinitely and are logged without secrets.
- **NOT-008:** Messages include title, exact localized occurrence date, relative timing, type, optional description, and optional formatted amount. They never contain raw HTML from user input.
- **NOT-009:** Email uses a plain-text body plus a small escaped HTML body. Telegram uses escaped HTML or plain text with link previews disabled.
- **NOT-010:** Scheduler and worker operations are safe with more than one worker process through transactions, unique constraints, and `FOR UPDATE SKIP LOCKED` claims.
- **NOT-011:** Pausing before a queued delivery is sent changes pending deliveries to `cancelled`. Resuming recalculates future eligibility.
- **NOT-012:** Editing schedule, lead time, or channel fields cancels pending deliveries for the old occurrence and creates new eligible rows transactionally.

### 6.8 Provider test behavior

- A test message is sent only after an explicit confirmation.
- Test delivery is not tied to a reminder and is stored with `kind = provider_test`.
- A successful test returns provider timestamp/message identifier when available.
- Failure returns a safe, actionable category such as configuration, authentication, recipient, rate-limit, or network error.
- API responses and UI never echo secrets or complete provider payloads.

## 7. Key interaction flows

### Create a reminder

1. Select **Add reminder**.
2. Enter a title and choose a type.
3. Enter the first/next date in the currently selected display calendar.
4. Confirm or adjust the recurrence suggested by the type.
5. Optionally enter an amount; choose lead days and available channels.
6. Save. The server validates, computes the next occurrence, and returns the canonical resource.
7. The modal closes, focus returns to Add reminder, and the new card appears in sorted position.

### Edit schedule

1. Open a card’s edit action.
2. Change date, recurrence, or lead time.
3. Save with the original `updatedAt` token.
4. The server cancels stale pending deliveries and calculates the new schedule in one transaction.
5. The card and countdown refresh.

### Change display calendar

1. Open Settings and select the other calendar system.
2. Save.
3. Visible dates are converted for presentation.
4. Each reminder continues to recur according to its original recurrence calendar.

### Disable a provider globally

1. Turn off the provider in Settings.
2. Pending unsent deliveries for that provider become `cancelled_global`.
3. Per-reminder channel preferences remain stored.
4. Re-enabling the provider creates only still-eligible future/catch-up deliveries.

## 8. Content and formatting rules

- Use sentence case for labels and buttons.
- Use “Solar Hijri (Jalali)” on first mention and “Jalali” where space is limited.
- Use ISO currency codes next to ambiguous amounts: `1,250,000 IRR`, `$12.50 USD` where appropriate.
- Never label IRR as “IRL”; `IRR` is the ISO 4217 code for Iranian rial.
- Dates include month names in long display contexts and digits in compact fields.
- Relative dates never replace exact dates; cards show both.
- Destructive actions use “Delete reminder,” not a vague “Confirm.”
- Provider errors explain the next operator action without exposing configuration values.

## 9. Non-functional requirements

### Reliability

- **NFR-REL-001:** Each eligible occurrence has one durable delivery row per channel and lead time; normal concurrent processing does not duplicate sends, and the documented ambiguous provider-acceptance window is handled as at-least-once.
- **NFR-REL-002:** A container restart does not lose pending or retrying deliveries.
- **NFR-REL-003:** Health checks distinguish process liveness from database/provider readiness.
- **NFR-REL-004:** Graceful shutdown stops claiming jobs, finishes the current send within a bounded timeout, then exits.

### Performance

- **NFR-PERF-001:** With 10,000 reminders, a default dashboard request returns the first page within 500 ms at p95 on a modest self-hosted machine, excluding network latency.
- **NFR-PERF-002:** Dashboard JavaScript remains below a 250 KiB compressed initial target; modal code may load on demand.
- **NFR-PERF-003:** Scheduler queries use indexed materialized occurrence dates/notification instants and bounded batches.

### Accessibility

- **NFR-A11Y-001:** Meet WCAG 2.2 AA for the MVP surface.
- **NFR-A11Y-002:** All functionality works at 200% zoom and with keyboard only.
- **NFR-A11Y-003:** Modals trap focus, restore focus, close with Escape when safe, and expose titles/descriptions.
- **NFR-A11Y-004:** Color is never the only urgency or status signal.
- **NFR-A11Y-005:** Motion respects `prefers-reduced-motion`; transforms are decorative and under 160 ms.
- **NFR-A11Y-006:** Touch targets are at least 44×44 CSS pixels on compact layouts.

### Security and privacy

- **NFR-SEC-001:** Secrets are read only from the runtime environment or mounted secret files in a future enhancement.
- **NFR-SEC-002:** Logs redact database URLs, SMTP credentials, bot tokens, recipients, and message bodies by default.
- **NFR-SEC-003:** API mutations validate content type, body size, origin/CSRF policy, and schemas.
- **NFR-SEC-004:** User text is stored as plain text and escaped at every HTML/Telegram rendering boundary.
- **NFR-SEC-005:** Containers run as a non-root user, use a read-only filesystem where practical, and expose only the app port.
- **NFR-SEC-006:** No third-party telemetry, tracking pixels, or remote fonts are required at runtime.

### Portability

- **NFR-PORT-001:** `docker compose up --build -d` is the supported baseline deployment.
- **NFR-PORT-002:** The same application image supports `web`, `worker`, and `migrate` commands.
- **NFR-PORT-003:** PostgreSQL data uses a named volume and standard `pg_dump`/`pg_restore` workflows.
- **NFR-PORT-004:** The UI works at 360 px width and modern desktop widths without horizontal page scrolling.

## 10. MVP acceptance scenarios

1. **Jalali birthday:** Given a birthday anchored to 30 Esfand in a Jalali leap year, the next non-leap occurrence resolves to the last valid day of Esfand and returns to day 30 in the next valid leap year.
2. **Gregorian leap date:** Given February 29 yearly recurrence, non-leap years use February’s last valid day without changing the stored anchor.
3. **Month end:** Given January 31 monthly recurrence, February uses its last valid day and March returns to day 31.
4. **Channel gates:** Given Telegram configured globally and enabled on a reminder, exactly one Telegram delivery is created; disabling the global setting cancels it before send.
5. **Independent providers:** Given SMTP fails and Telegram succeeds, the Telegram delivery is `sent` while email retries.
6. **Restart safety:** Given a worker stops after claiming a delivery but before final status, the lease expires and another worker retries without creating a second delivery row.
7. **Display change:** Given a reminder created in Jalali mode, switching Settings to Gregorian changes displayed values but not future semantic occurrences or notification instants.
8. **Currency change:** Given an `IRR` reminder, changing the default to `USD` leaves that reminder in `IRR` and uses `USD` only for new amounts.
9. **Stale edit:** Given two edit sessions, the second save with an old `updatedAt` receives `409` and does not overwrite the first.
10. **Provider privacy:** Given any provider failure, API output and logs contain no bot token, SMTP password, full destination, or message body.
11. **Keyboard modal:** Given keyboard-only use, focus enters the modal, follows visual order, cannot escape behind it, and returns to the opener after close.
12. **Compose recovery:** Given PostgreSQL is temporarily unavailable, web readiness and worker readiness fail without crash loops; both recover after the database becomes healthy.

## 11. Definition of done for `0.1.0`

- Every `DASH`, `REM`, `REC`, `SET`, `NOT`, and MVP `NFR` requirement has an automated test or documented manual verification.
- Docker Compose starts a healthy database, completed migration job, web service, and worker from a clean checkout.
- Email and Telegram test messages work against real provider test accounts.
- Backup and restore are exercised against a release candidate.
- Calendar edge cases pass against a trusted set of Gregorian/Jalali conversion fixtures.
- Keyboard, screen-reader smoke, contrast, reduced-motion, mobile, and desktop checks pass.
- Dependency, container, secret, and license scans pass with no unaccepted critical/high issue.
- README, environment template, deployment notes, changelog, and migration notes match the shipped release.
