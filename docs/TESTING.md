# Testing and quality strategy

Reminder’s risk is concentrated in recurrence math, timezones, durable delivery, provider redaction, and modal accessibility. The test strategy gives those paths more depth than ordinary card rendering.

## 1. Test layers

| Layer                 | Tools                                           | Primary responsibility                                              |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| Static                | TypeScript strict mode, ESLint, Prettier        | Type, import-boundary, and consistency failures                     |
| Unit                  | Vitest                                          | Calendar, recurrence, money, validation, eligibility, retry math    |
| Component             | Vitest + React Testing Library + axe            | Cards, forms, modals, keyboard behavior, accessible state           |
| Database integration  | Vitest + real pinned PostgreSQL service         | Migrations, constraints, transactions, claims, leases, concurrency  |
| Provider contract     | Local SMTP/HTTP fakes                           | Payload escaping, timeouts, classification, redaction, retry policy |
| End-to-end            | Playwright                                      | Dashboard and modal flows against full web/worker/database stack    |
| Visual                | Playwright screenshots                          | Responsive layout and design-token regressions                      |
| Operational           | Compose scripts                                 | Clean start, health, restart, backup, restore, upgrade              |
| Security/supply chain | Secret, dependency, license, and image scanners | Known vulnerabilities and accidental disclosure                     |

Tests run in UTC at the operating-system level unless a case explicitly varies host timezone. Application timezone is always explicit.

## 2. Unit test obligations

### Calendar conversion

- Trusted Gregorian ↔ Jalali fixture pairs across several decades.
- First/last day of every month.
- Gregorian leap years, including century rules.
- Jalali leap-year boundaries as defined by the chosen adapter.
- Invalid month/day/year values.
- Exact supported-range boundaries and values immediately outside `1900-01-01` through `2400-12-31` Gregorian equivalent.
- Round-trip property for every supported valid test date.
- Persian/Arabic digit normalization without accepting ambiguous free-form dates.

Do not generate expected values using the same library/code being tested. Fixtures must come from an independently reviewed source or specification.

### Recurrence

Test every frequency at interval 1 and representative custom intervals. Critical sequences include:

| Anchor                 | Frequency      | Expected property                                           |
| ---------------------- | -------------- | ----------------------------------------------------------- |
| Gregorian Jan 31       | Monthly        | Feb last day; Mar 31                                        |
| Gregorian Jan 30       | Monthly        | Feb clamp; Mar 30                                           |
| Gregorian Feb 29       | Yearly         | Non-leap last day; later leap returns 29                    |
| Jalali Esfand 30       | Yearly         | Non-leap Esfand 29; later leap returns 30                   |
| Jalali month end       | Monthly        | Preserve explicit last-day intent                           |
| Historical birthday    | Yearly         | First computed occurrence is future                         |
| Today before send time | Yearly/monthly | Current occurrence remains eligible                         |
| Today after send time  | Recurring      | Immediate catch-up delivery before occurrence policy cutoff |
| One-time past          | Once           | Validation error                                            |
| Interval 99            | All repeating  | Terminates and produces ordered result                      |

Property tests assert:

- next occurrence date is strictly later than the previous materialized occurrence date;
- output is a valid date in the recurrence calendar;
- anchor components never mutate due to clamping;
- iteration is bounded;
- equivalent runs are deterministic.

### Notification eligibility

- Lead days 0, 1, and 365.
- Creation before/after local send time.
- Each combination of environment availability, global setting, reminder setting, and active state.
- Offline recovery just inside and outside grace boundary.
- Schedule edit and pause cancellation.
- Provider independence.
- Retry delay, jitter bounds, `Retry-After`, max attempts, and expiry.

### Money

- IRR zero-decimal and USD two-decimal parsing/formatting.
- Very large safe API strings.
- Group separators and localized digits at UI boundary.
- Negative, fractional IRR, overprecision USD, unsafe integer, exponent, and symbol rejection.
- Default-currency change does not transform stored amounts.

## 3. Database integration tests

Run against the same PostgreSQL major version family as production, never an in-memory substitute.

### Schema and migrations

- Empty database migrates to current schema.
- Migration command is repeatable/no-op when current.
- All checks, foreign keys, partial indexes, and unique constraints exist.
- Invalid amount/currency, custom type, completed state, and schedule combinations fail at DB layer.
- Previous release fixture database migrates without data loss.

### Queue correctness

- Two scheduler processes produce one unique delivery row.
- Multiple workers claim disjoint batches with `SKIP LOCKED`.
- A processing lease cannot be claimed before expiry.
- An expired lease becomes retryable.
- Provider network latency holds no database transaction open.
- Schedule edit cancels stale rows and creates new rows atomically.
- Pausing during pending/retry prevents future claim.
- Global channel disable cancels only that channel.
- Reminder deletion cascades its deliveries.
- Terminal rows are not claimed.

### Optimistic concurrency

- Two readers receive the same `updatedAt`.
- First mutation succeeds and changes `updatedAt`.
- Second mutation receives `409` and changes no row/delivery.
- Timestamp precision round-trips exactly through JSON and PostgreSQL.

## 4. Provider contract tests

### SMTP fake

Capture outgoing mail and assert:

- intended single recipient and configured sender;
- subject and plain-text body;
- small escaped HTML alternative;
- Unicode title/date handling;
- no script/HTML injection from description;
- authentication, TLS, transient server, recipient, timeout, and connection errors classify correctly;
- logs and error results omit credentials, destination, and body.

### Telegram HTTP fake

Assert:

- correct Bot API method and destination request;
- escaped message text and disabled link preview;
- response message identifier stored when safe;
- 400 recipient/config, 401 auth, 429 retry-after, 5xx, timeout, malformed JSON, and connection reset classification;
- token is absent from captured application logs/error output.

### Ambiguous acceptance

Simulate provider acceptance followed by connection/process failure before receipt persistence. The delivery remains retryable and the test documents that a duplicate external message is possible even though no second queue row exists.

## 5. Component tests

### Reminder card

- Complete, no-description, no-amount, paused, completed, overdue, today, due-soon states.
- Exact date and relative countdown both present.
- Currency separated and screen-reader label expanded.
- Explicit edit accessible name.
- Three-line description clamping does not remove accessible content.

### Reminder modal

- Create defaults and type-preset behavior.
- Type change does not overwrite dirty fields.
- Calendar date validation and next-occurrence preview.
- Amount reveal/clear and currency rules.
- Provider unavailable/disabled/configured states.
- Client error summary and field associations.
- Dirty close confirmation.
- Edit save, pause/resume, stale conflict, and delete confirmation.
- Focus trap, Escape policy, initial focus, and focus restoration.

### Settings modal

- Exactly four editable preferences.
- Provider readiness is read-only and secret-free.
- Cannot enable unavailable provider.
- Provider test requires confirmation and announces async result.
- Display calendar change reformats but does not mutate reminder semantic data.

## 6. End-to-end journeys

At minimum:

1. Clean database → empty state → create Gregorian subscription → card appears.
2. Create Jalali yearly birthday → switch display calendar → occurrence remains equivalent.
3. Create IRR debt → change default to USD → existing amount stays IRR; new amount defaults USD.
4. Edit schedule and verify stale pending delivery cancellation in DB/API.
5. Pause/resume and verify worker behavior.
6. Email success + Telegram failure, then retry Telegram to success.
7. Provider unavailable state and safe configuration guidance.
8. Stale edit conflict from two browser contexts.
9. Filter/search/sort URL persistence and focus behavior.
10. Delete reminder with confirmation and cascade verification.
11. Worker restart with expired lease recovery.
12. Offline beyond grace creates `expired`, not a late-message burst.

Use fake providers in normal CI. A protected manual/staging workflow may test real SMTP and Telegram credentials; it must never run for untrusted pull requests.

## 7. Accessibility tests

Automated axe checks are necessary but not sufficient. Manual release checks cover:

- keyboard-only create/edit/settings/delete/provider test;
- visible focus in every component state;
- modal focus containment and restoration;
- screen-reader labels, descriptions, errors, live announcements, and exact countdown dates;
- 200% zoom and reflow;
- reduced motion;
- Windows high-contrast/forced-colors smoke;
- touch target size on mobile;
- RTL smoke with long Persian-like strings and isolated numeric/currency content.

No critical or serious automated accessibility violation may be waived without a linked issue, rationale, and owner.

## 8. Visual regression set

Capture deterministic screenshots with fixed time, timezone, locale, fonts, data, and animation disabled:

- desktop dashboard: populated, empty, loading, background error;
- mobile dashboard at 360 px;
- reminder modal create and edit, desktop and mobile;
- validation errors;
- settings configured/unconfigured providers;
- paused, completed, overdue, today, and mixed-currency cards;
- 200% zoom layout;
- RTL smoke.

Review intentional baseline changes for borders, hard shadows, clipped overflow, focus rings, date hierarchy, and sticky modal footer.

## 9. Operational tests

### Compose clean start

- Start from no images/volume.
- Database becomes healthy before migration.
- Migration completes before web/worker readiness.
- Only app port is published.
- Restart host/daemon and verify recovery.

### Backup and restore

- Create known reminders and delivery states.
- Run backup service; verify checksum.
- Restore into a new empty database.
- Apply migrations and run integrity command.
- Compare semantic reminder/settings data and terminal delivery counts.

### Upgrade

- Restore previous-release fixture.
- Deploy candidate migration/image.
- Verify app/worker and representative calendar data.
- Exercise documented rollback category.

### Time migration

- Dry-run timezone/send-time recomputation.
- Apply and verify future timestamps/pending rows.
- Confirm anchors remain unchanged.

## 10. Security and supply-chain checks

- Secret scan repository history and built artifacts.
- Dependency vulnerability and license scan from lockfile.
- Container image vulnerability scan and software bill of materials.
- Confirm no development dependencies in runtime image.
- Inspect image history for environment/build secret leakage.
- Test CSP/security headers and cross-origin mutation rejection.
- Fuzz user-controlled text at HTML/email/Telegram boundaries.
- Confirm log fixtures contain no database URL, SMTP credential/address, bot token/chat ID, or message body.
- Ensure CI workflows for forks cannot access protected provider secrets.

## 11. Coverage and release gates

Coverage is a signal, not the goal:

- Domain calendar/recurrence/eligibility/money modules: 95% line and branch minimum.
- Provider adapters and database queue services: 90% line and 85% branch minimum.
- Repository overall: 80% line and 75% branch minimum.

A release candidate is blocked by:

- any failing type/lint/unit/component/integration/E2E test;
- any unreviewed visual difference;
- any critical/serious accessibility failure;
- any unaccepted critical/high vulnerability;
- any secret/license policy failure;
- failed clean Compose start;
- failed backup/restore drill;
- product requirement without test or documented manual evidence.

## 12. Test data policy

- Use synthetic names, descriptions, addresses, chat IDs, and amounts.
- Never copy production database rows into fixtures.
- Provider integration credentials exist only in protected CI/staging secrets.
- Test failures redact environment and provider payloads.
- Screenshots and traces are treated as potentially sensitive artifacts and retained briefly.
