# Changelog

All notable changes will be documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases will follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) after `1.0.0`.

## [Unreleased]

### Added

- Phase 4 notification delivery: PostgreSQL advisory-lock scheduling, lease-based `SKIP LOCKED` claims, missed-delivery expiry, retry backoff, and graceful worker shutdown.
- SMTP and Telegram provider adapters with escaped content, safe failure classification, and asynchronous provider-test API/UI flow.
- Phase 2 domain and persistence: Gregorian/Jalali calendar and recurrence logic, exact money parsing, reviewed PostgreSQL schema, and singleton settings seeding.
- Reminder and settings JSON APIs with validation, provider availability gates, optimistic concurrency, and cursor-paginated list responses.
- PostgreSQL integration coverage for clean migrations and reminder CRUD/stale-write behavior.
- Phase 1 repository and container foundation: pnpm workspace, shared packages, Next.js shell, worker placeholder, multi-stage Dockerfile, Compose stack, and CI.
- Validated environment configuration with a secret-free client projection.
- Foundation SQL migration and migration CLI.
- Design tokens and accessible UI primitives (button, dialog, switch, tooltip).
- Liveness and readiness health endpoints; worker heartbeat health check.
- Initial product, architecture, data, API, design, deployment, testing, and roadmap specifications.
- Open-source contribution, conduct, security, license, environment, and ignore files.

Add comparison links here after the repository URL and first release tag exist.
