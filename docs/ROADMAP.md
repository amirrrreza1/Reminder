# Roadmap

The roadmap implements a narrow, reliable MVP before expanding features. Requirement IDs refer to [PRODUCT_SPEC.md](PRODUCT_SPEC.md).

## Phase 0 — Specification baseline

Status: complete.

- Product scope, field validation, recurrence rules, settings, and acceptance scenarios.
- Architecture, database model, API contract, design system, deployment, and testing plan.
- Open-source contribution, conduct, security, environment, changelog, and license files.

Exit: contributors can create implementation issues without inventing core behavior.

## Phase 1 — Repository and container foundation

Status: complete.

- pnpm workspace with `apps/web`, `apps/worker`, and shared packages.
- Strict TypeScript, lint, format, test, and dependency-boundary configuration.
- Next.js shell, local Geist fonts, design tokens, and accessible component primitives.
- Multi-stage non-root Dockerfile.
- Compose database, migration, web, worker, and health-check skeleton.
- CI for static checks, unit tests, clean build, secret scan, and image scan.

Exit:

- One image builds reproducibly.
- Clean Compose stack reaches health with placeholder web/worker behavior.
- No secret enters client bundle or image history.

## Phase 2 — Domain and persistence

- Calendar adapter and independent trusted fixtures.
- Gregorian/Jalali recurrence, month-end, leap, timezone, and notification-time logic (`REC-*`).
- Money parsing/formatting and type presets.
- Drizzle schema and initial reviewed SQL migration.
- Reminder/settings repositories, transactions, optimistic concurrency.
- REST resources and error envelope.
- Integration tests against pinned PostgreSQL.

Exit:

- All unit/integration calendar and data acceptance scenarios pass.
- API can create/read/update/delete reminders and update settings without UI.
- Migration and integrity commands pass from a clean database.

## Phase 3 — Dashboard and modal UX

- Header, summary, toolbar, responsive reminder-card grid (`DASH-*`).
- Add/edit reminder modal with schedule preview, dirty-close protection, pause/resume, and delete (`REM-*`).
- Settings modal with four preferences and provider readiness (`SET-*`, excluding live provider test until Phase 4).
- Empty, loading, background-error, offline, and stale-edit conflict states.
- Keyboard, screen-reader, reduced-motion, 200% zoom, mobile, and RTL smoke coverage.
- Deterministic visual regression suite.

Exit:

- All core journeys work against the real API.
- Design QA checklist passes at required viewports.
- No critical/serious accessibility issue remains.

## Phase 4 — Notification worker

- Scheduler advisory lock and bounded reminder pass.
- Unique delivery insertion, cancellation, occurrence advancement, and one-time completion.
- Queue claims with leases and `FOR UPDATE SKIP LOCKED`.
- SMTP adapter and escaped plain/HTML email.
- Telegram Bot API adapter and escaped content.
- Retry, jitter, rate-limit, expiry, graceful shutdown, and heartbeat.
- Asynchronous provider-test API and Settings interaction.
- Multi-worker, crash-window, restart, and redaction tests (`NOT-*`).

Exit:

- Fake-provider CI proves queue and retry correctness.
- Real protected SMTP and Telegram smoke tests pass.
- At-least-once semantics and rare duplicate window match documentation.

## Phase 5 — Operations and release hardening

- Complete Compose dependency/health/restart/log configuration.
- Backup service, checksum metadata, restore/integrity tooling.
- Timezone/send-time dry-run and apply maintenance command.
- Security headers, origin policy, body limits, and reverse-proxy examples.
- SBOM, dependency/license/image scans, release provenance where available.
- Clean-host deployment, restart, backup/restore, upgrade, and rollback drills.
- Final README and environment review.

Exit:

- [Product definition of done](PRODUCT_SPEC.md#11-definition-of-done-for-010) passes.
- A new self-hoster can deploy from documentation without maintainer assistance.

## `0.1.0` — MVP release

Release contents:

- Single-user reminder dashboard.
- Gregorian and Jalali recurrence.
- Optional IRR/USD amounts.
- One lead-time value and email/Telegram channels.
- Four settings.
- Docker Compose deployment, health, backup/restore, and upgrade notes.

The release notes must clearly repeat that the app has no built-in authentication and must not be exposed unauthenticated to the public internet.

## Candidate follow-ups

These are ideas, not commitments. Each requires a proposal updating product, data, API, privacy, UX, and migration implications.

### `0.2.x` candidates

- Persian translation and first-class RTL experience.
- Optional in-app login for single-user internet deployments.
- Multiple notification lead times.
- Import/export in a documented portable format.
- Delivery-history diagnostics inside Settings.
- Optional Toman presentation while keeping an unambiguous stored currency model.

### Later candidates

- Multiple recipients or household members.
- Additional providers such as generic webhook or ntfy.
- Calendar feed/export.
- Advanced recurrence rules and exclusions.
- Native secret-file support and external PostgreSQL deployment profile.
- Prometheus metrics without personal content.

## Explicitly deferred

- Teams, roles, public signup, social/sharing features.
- Payment processing, budgeting, invoices, exchange rates.
- Full calendar/task-management UI.
- SMS and native mobile push.
- Attachments and rich-text descriptions.

## Issue slicing guidance

- Each issue references requirement/test IDs and touches one vertical behavior where practical.
- Calendar/queue changes include tests in the same pull request.
- Database changes include migration, rollback/compatibility note, and restored-fixture test.
- UI issues include keyboard, responsive, loading/error, and visual-regression acceptance.
- Provider issues include redaction and failure classification.
- Scope additions update specification before or with implementation; undocumented behavior is not accepted by accident.
