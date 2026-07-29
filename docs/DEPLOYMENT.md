# Deployment and operations

Docker Compose is the supported baseline for development and self-hosted production. The target is one application image plus PostgreSQL; Redis and external schedulers are not required.

> The Compose services, Dockerfile, and health endpoints are implemented for Phase 1. Backup/restore, timezone maintenance, and full production hardening land in later phases. Commands below describe the supported contract as it is implemented.

## 1. Prerequisites

- A supported Docker Engine/Desktop release with the Compose v2 plugin.
- At least 1 CPU, 1 GiB available memory, and 2 GiB free disk for a small personal instance.
- Persistent disk for the PostgreSQL named volume.
- Optional SMTP account and/or Telegram bot credentials.
- For public-network access, an authenticated TLS reverse proxy or private-network solution.

Pin production image versions/digests during implementation. Do not deploy floating `latest` tags.

## 2. Compose contract

The completed `compose.yaml` must define:

| Service   | Image/command                           | Dependency           | Published port     |
| --------- | --------------------------------------- | -------------------- | ------------------ |
| `db`      | Pinned PostgreSQL                       | none                 | none               |
| `migrate` | Reminder image, `migrate` command       | healthy `db`         | none               |
| `web`     | Reminder image, `web` command           | successful `migrate` | `${APP_PORT}:3000` |
| `worker`  | Reminder image, `worker` command        | successful `migrate` | none               |
| `backup`  | PostgreSQL client, opt-in `ops` profile | healthy `db`         | none               |

Required behavior:

- Database uses a named volume such as `reminder_db_data`.
- `db` has a `pg_isready` health check.
- `migrate` is a one-shot job and exits non-zero on migration failure.
- `web` readiness checks `/api/health/ready`; liveness checks `/api/health/live`.
- `worker` health checks its database heartbeat.
- `web` and `worker` use `init: true` or an init process and handle `SIGTERM` gracefully.
- Long-running services restart `unless-stopped`.
- All services share only an internal network; only `web` publishes a host port.
- Runtime containers run as a non-root UID/GID and use a read-only root filesystem where compatible.
- Service logs use bounded rotation in local deployments.

## 3. First deployment

Once an implementation release exists:

```bash
git clone <repository-url> reminder
cd reminder
cp .env.example .env
# Edit .env and replace every placeholder.
docker compose config
docker compose up --build -d
docker compose ps
```

Open `http://localhost:${APP_PORT}` only after `db`, `web`, and `worker` report healthy and `migrate` has exited successfully.

`docker compose config` renders secrets in terminal output on some Compose versions. Run it only in a private terminal and never paste the rendered output into issues or logs.

## 4. Environment variables

The environment is parsed and validated at process startup. Required core values fail the service safely. Incomplete optional provider groups make that provider unavailable without taking down the core app.

### Application and scheduler

| Variable                             | Required        | Example                        | Rule                                   |
| ------------------------------------ | --------------- | ------------------------------ | -------------------------------------- |
| `NODE_ENV`                           | Yes             | `production`                   | `development`, `test`, or `production` |
| `APP_PORT`                           | Yes for Compose | `3000`                         | Host port 1–65535                      |
| `APP_BASE_URL`                       | Yes             | `https://reminder.example.com` | Absolute URL, no credentials           |
| `APP_TIMEZONE`                       | Yes             | `Asia/Tehran`                  | Valid IANA timezone                    |
| `LOG_LEVEL`                          | No              | `info`                         | `debug`, `info`, `warn`, `error`       |
| `NOTIFICATION_SEND_TIME`             | Yes             | `09:00`                        | `HH:mm`, local to `APP_TIMEZONE`       |
| `NOTIFICATION_POLL_INTERVAL_SECONDS` | Yes             | `60`                           | Recommended 15–300                     |
| `NOTIFICATION_MISSED_GRACE_HOURS`    | Yes             | `72`                           | Non-negative bounded integer           |
| `NOTIFICATION_MAX_ATTEMPTS`          | Yes             | `5`                            | Recommended 1–10                       |

Changing timezone or notification send time changes materialized notification instants and may affect which local occurrence is considered current. Follow the maintenance procedure in section 12; do not just restart with the new values.

### Database

| Variable            | Required               | Notes                                                                         |
| ------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| `POSTGRES_DB`       | Yes in bundled Compose | Database name                                                                 |
| `POSTGRES_USER`     | Yes in bundled Compose | Dedicated non-superuser application role after initialization where practical |
| `POSTGRES_PASSWORD` | Yes in bundled Compose | Long random secret                                                            |
| `DATABASE_URL`      | Yes                    | Application connection string using the internal `db` hostname                |

For an external managed PostgreSQL instance, disable the bundled `db` service through a documented override and use TLS parameters required by the provider. Do not put database URLs in Docker images.

### SMTP

Email is available only when all required values validate.

| Variable        | Required for email | Notes                                                           |
| --------------- | ------------------ | --------------------------------------------------------------- |
| `SMTP_HOST`     | Yes                | SMTP server hostname                                            |
| `SMTP_PORT`     | Yes                | Commonly 465 or 587; use provider guidance                      |
| `SMTP_SECURE`   | Yes                | `true` for implicit TLS, otherwise `false` with STARTTLS policy |
| `SMTP_USER`     | Provider dependent | Authentication username                                         |
| `SMTP_PASSWORD` | Provider dependent | App password/token preferred                                    |
| `EMAIL_FROM`    | Yes                | Valid sender/mailbox form                                       |
| `EMAIL_TO`      | Yes                | Single MVP destination address                                  |

Production SMTP must require encrypted transport and enforce certificate validation. The implementation must not silently fall back to clear text.

### Telegram

| Variable             | Required for Telegram | Notes                                     |
| -------------------- | --------------------- | ----------------------------------------- |
| `TELEGRAM_BOT_TOKEN` | Yes                   | Secret issued by BotFather                |
| `TELEGRAM_CHAT_ID`   | Yes                   | Destination user/group/channel identifier |

Create the bot through Telegram’s official [BotFather flow](https://core.telegram.org/bots/tutorial). A user must contact the bot first before it can send a private message. Treat the bot token like a password; never place it in screenshots, URLs shared with others, issues, or browser history.

### Initial defaults

| Variable                   | Values                | Behavior                                    |
| -------------------------- | --------------------- | ------------------------------------------- |
| `DEFAULT_CALENDAR_SYSTEM`  | `gregorian`, `jalali` | Seeds a new settings row                    |
| `DEFAULT_CURRENCY`         | `IRR`, `USD`          | Seeds a new settings row                    |
| `DEFAULT_EMAIL_ENABLED`    | boolean               | Can seed true only if SMTP is available     |
| `DEFAULT_TELEGRAM_ENABLED` | boolean               | Can seed true only if Telegram is available |

These values are used only when the settings table is empty. Restarting never overwrites UI settings.

## 5. Secrets management

Minimum local practice:

- `.env` is ignored by Git and readable only by the operating user.
- Generate separate random database and provider credentials.
- Never use the example password.
- Do not pass secrets as Docker build arguments.
- Do not attach `.env`, Compose config output, database dumps, or full logs to public issues.

Stronger production practice:

- Use Docker secrets or bind-mounted read-only secret files when implementation adds `_FILE` variable support.
- Restrict daemon/socket access; membership in the Docker group is effectively privileged.
- Rotate bot/SMTP/database credentials after suspected exposure.
- Rebuild/restart services after rotation and send one explicit provider test.

## 6. Safe exposure

The MVP has no built-in login. Choose one supported access model:

### Local-only

Bind the published port to loopback in a Compose override:

```yaml
services:
  web:
    ports:
      - "127.0.0.1:${APP_PORT:-3000}:3000"
```

Access through the host, an SSH tunnel, or another private path.

### Private network

Expose the service only inside a trusted VPN/overlay network and retain host firewall rules.

### Authenticated TLS reverse proxy

Place a maintained reverse proxy in front of `web` with:

- HTTPS and automatic certificate renewal;
- authentication before forwarding requests;
- request/body/time limits;
- mutation and provider-test rate limits;
- preserved `Host` and standard forwarded headers from trusted proxy addresses only;
- access logs that do not include query/body secrets.

The Next.js self-hosting documentation recommends a reverse proxy rather than direct internet exposure. `APP_BASE_URL` must match the public HTTPS origin so origin checks work.

## 7. Provider verification

### Email

1. Fill every SMTP variable and restart web/worker.
2. Open Settings; confirm Email says configured.
3. Enable email globally and save.
4. Select Send test, review the confirmation, and send.
5. Confirm receipt and inspect safe worker logs by delivery UUID if it fails.

### Telegram

1. Create a bot with BotFather and store the token privately.
2. From the destination user/group, contact or add the bot as required.
3. Determine the destination chat ID through an official Telegram Bot API workflow in a private terminal.
4. Set both Telegram variables and restart web/worker.
5. Enable Telegram in Settings and send a test.

Never build an admin endpoint that returns the configured destination or token.

## 8. Health and diagnostics

Operator checks:

```bash
docker compose ps
docker compose logs --since=15m web worker
curl --fail http://localhost:${APP_PORT}/api/health/live
curl --fail http://localhost:${APP_PORT}/api/health/ready
```

Expected healthy state:

- `db` healthy;
- `migrate` exited `0`;
- `web` healthy/ready;
- `worker` healthy with recent heartbeat;
- no repeating config/migration error events.

Debug logs may include more timing and internal IDs but must not disable redaction. Do not globally log provider request/response bodies.

## 9. Backup

The release Compose file should provide an opt-in `backup` service that:

- runs `pg_dump --format=custom` against the internal database;
- writes a timestamped file to a host bind mount such as `./backups`;
- creates a checksum and a small metadata file containing app/schema version, not secrets;
- refuses to overwrite an existing file;
- exits non-zero on any partial failure.

Target operator command:

```bash
docker compose --profile ops run --rm backup
```

Backup policy for a personal instance:

- before every upgrade;
- at least weekly, with retention appropriate to the user’s needs;
- copy at least one backup off the Docker host;
- protect backups like the data they contain;
- run a restore drill after initial setup and periodically thereafter.

A backup that has never been restored is not verified.

## 10. Restore

Restore is destructive to the selected target database. The implementation’s restore command must require an explicit backup path and confirmation flag, display the resolved target database, and refuse to operate while web/worker are running.

High-level procedure:

1. Stop `web` and `worker`, leaving `db` running.
2. Make a final safety backup if the current database is readable.
3. Validate the selected dump checksum and metadata.
4. Restore into a newly created empty database, not over live tables.
5. Run migrations from the release being deployed.
6. Run integrity checks.
7. Point the services to the restored database and start them.
8. Confirm settings, reminders, worker heartbeat, and one provider test.

Document OS-specific commands with the implemented backup service. Do not ask users to pipe a binary custom-format dump through a shell that may alter bytes.

## 11. Upgrade and rollback

### Upgrade

1. Read release notes and migration/compatibility warnings.
2. Create and verify a backup.
3. Pull the signed/tagged release or build the reviewed commit.
4. Run `docker compose build --pull` where source builds are used.
5. Run the migration job and require success.
6. Start/recreate web and worker.
7. Check readiness, worker heartbeat, dashboard, and a provider test.
8. Keep the pre-upgrade backup until the new release has operated successfully.

### Rollback

Application rollback is safe only when the old binary supports the new schema. Each release must state one of:

- binary rollback supported without database restore;
- binary rollback supported after a named down migration;
- rollback requires restoring the pre-upgrade database backup.

Never assume an older image can read a migrated database.

## 12. Timezone or send-time migration

Because notification timestamps are materialized, changing `APP_TIMEZONE` or `NOTIFICATION_SEND_TIME` requires a controlled recomputation:

1. Back up the database.
2. Stop `worker` so no deliveries are claimed or occurrences advanced.
3. Change the environment value.
4. Run the application maintenance command in dry-run mode. It reports reminder count, old/new values, and how many pending deliveries change.
5. Review the output, then run with explicit apply confirmation.
6. The command recomputes future occurrence/notification timestamps and cancels/recreates affected pending deliveries transactionally.
7. Start worker and verify its heartbeat.
8. Check several reminders in both calendar systems.

The command never changes semantic anchor calendar components.

## 13. Resource and connection guidance

Small instance defaults:

- web database pool: maximum 5 connections;
- worker pool: maximum 5 connections;
- delivery concurrency: 2 per provider initially;
- scheduler/claim batch: 100 rows;
- graceful shutdown: 30 seconds;
- provider connect/request timeout: 10–20 seconds;
- PostgreSQL container memory tuned only after measurement.

Ensure the sum of pools across replicas stays below PostgreSQL connection capacity. Increasing worker concurrency can trigger provider rate limits and does not help a low-volume personal instance.

## 14. Troubleshooting

### Settings says provider is not configured

- Confirm every required variable in the provider group is present in the running container, not only the host shell.
- Check startup logs for a redacted configuration category.
- Restart web and worker after environment changes.
- Do not print the full environment to diagnose.

### Web is live but not ready

- Check database health and migration-job exit status.
- Verify `DATABASE_URL` uses the Compose service hostname inside containers.
- Inspect safe `db.*` and `migration.*` log events.

### Worker is unhealthy

- Check database readiness, migration version, and worker heartbeat events.
- Look for an invalid timezone/send-time configuration.
- Check for a stuck lease pattern; use the supported diagnostic command rather than editing queue rows manually.

### Messages are delayed

- Compare occurrence, lead days, `APP_TIMEZONE`, and `NOTIFICATION_SEND_TIME`.
- Inspect the delivery’s safe status/attempt category by UUID in logs.
- Check provider rate limits and host clock synchronization.
- Confirm the instance was not offline beyond the missed-delivery grace window.

### A duplicate message appears

The queue suppresses duplicate rows, but an external provider can accept a send just before a worker crash prevents receipt persistence. Correlate the delivery UUID and worker restart window. This rare at-least-once edge is documented in [Architecture](ARCHITECTURE.md#delivery-guarantee).

## 15. Production readiness checklist

- [ ] Every placeholder secret replaced with a strong unique value.
- [ ] App is private or protected by authenticated HTTPS proxy.
- [ ] Only the intended web port is published.
- [ ] Database volume is on durable storage.
- [ ] Compose services and base images are pinned.
- [ ] Containers run non-root and have bounded logs.
- [ ] Health checks and restart behavior are verified.
- [ ] Email/Telegram provider tests succeed for enabled channels.
- [ ] Backup completes, checksum verifies, and restore drill succeeds.
- [ ] Host clock/timezone expectations are checked.
- [ ] Upgrade/rollback notes are retained with the deployed release.
- [ ] `.env`, backups, logs, and Compose render output are excluded from public sharing.
