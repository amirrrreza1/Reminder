# Local development

Two ways to run the app. Pick one — they both want port 3100/1234 and the same
database, so don't run them at the same time.

## Hot-reload mode (day-to-day work)

Postgres runs in Docker; the web app and worker run on the host so every save is
picked up without a rebuild.

```bash
pnpm install        # first time only
pnpm dev:up
```

`pnpm dev:up` does four things in order:

1. `docker compose -f compose.yaml -f compose.dev.yaml up -d db` — starts Postgres
   and publishes it on `localhost:5432`.
2. Builds the workspace packages once, so `dist/` exists before anything imports it.
3. Runs pending migrations against the dev database.
4. `pnpm dev:all` — starts every watcher in parallel.

What `dev:all` watches:

| Process | Command | Reloads on |
| --- | --- | --- |
| Web | `next dev` (port 3100) | `apps/web/**`, `packages/ui/**` — Fast Refresh, no restart |
| Worker | `tsx watch` | `apps/worker/**` — process restarts |
| `@reminder/config`, `db`, `domain`, `notifications` | `tsc --watch` | their `src/**` — recompiles `dist/`, which then triggers the web/worker reload |

`@reminder/ui` is exported straight from source (`exports["."].import` → `./src/index.ts`),
so component and CSS edits there hit the browser immediately with no compile step.
The other packages are consumed from `dist/`, which is why they need the `tsc --watch`
processes above.

Stop everything with `Ctrl+C`, then `pnpm dev:db:stop` if you also want Postgres down.

### Environment

- Web reads `apps/web/.env` (Next.js loads it automatically).
- Worker and migrations load the root `.env` themselves, via `src/load-root-env.ts`
  (imported first in each entrypoint). `tsx` does not read `.env` on its own, and
  `--env-file` flags proved unreliable through the pnpm/tsx wrapper chain, so the
  loader resolves the path from the module's own location instead of `process.cwd()`.
  It's a no-op when `DATABASE_URL` is already set or no `.env` exists, so the Docker
  image is unaffected.
- Both must point `DATABASE_URL` at `localhost:5432`, not `db:5432` — the `db`
  hostname only resolves inside the compose network.
- `APP_BASE_URL` must match the dev port (`http://localhost:3100`) in both `.env`
  files. The port itself comes from the `--port` flag in `apps/web/package.json`,
  not from `APP_PORT` — `APP_PORT` only feeds the compose stack's published port.
- `AUTH_PASSWORD` is the dashboard login. It must be present in both `.env` files —
  the web app needs it to check the password, and the worker shares the same
  config schema. Minimum 8 characters, and a handful of obvious placeholders
  (`changeme`, `password`, the value from `.env.example`) are rejected outright.
  Changing it invalidates every existing session cookie.

### Ports

| Port | What |
| --- | --- |
| 3100 | `next dev` — moved off 3000, which another project uses |
| 5432 | Postgres (dev overlay only) |
| 1234 | production compose stack (`APP_PORT`) |

Set `POSTGRES_PORT` in `.env` if 5432 is already taken on your machine, and update
`DATABASE_URL` to match.

## Production-parity mode (verifying a release)

The full stack in Docker, built images, no hot reload:

```bash
docker compose up -d --build
```

Served on `http://localhost:1234`. Every source change needs
`docker compose up -d --build web worker` to take effect. Note that `.env` for this
mode needs `DATABASE_URL=postgresql://reminder:...@db:5432/reminder` (container
hostname) and `NODE_ENV=production`.

## Troubleshooting

**Every page redirects to `/login` and the password does not work** — the web app
and your browser disagree about `AUTH_PASSWORD`. Check `apps/web/.env`, then restart
`next dev`: the value is read per request, but a stale dev server started before the
variable existed will have failed config validation instead.

**`/login` returns a 503 mentioning `AUTH_PASSWORD`** — the variable is unset in the
web app's environment. Middleware serves nothing rather than defaulting to open
access, which is why this is a hard failure rather than a warning.

**The `@visual` snapshots fail after an auth change** — the dashboard actions row now
carries a Log out button. Re-record with
`pnpm test:visual --update-snapshots`.

**Worker exits with `Invalid configuration: DATABASE_URL: ...`** — the root `.env`
is missing, or a key is absent from it. `load-root-env.ts` resolves the repo root
from its own module URL (`../../../.env`), which holds for both `src/` and `dist/`.

**Web compiles but the page still shows old styles** — a stale `.next`. Run
`pnpm --filter @reminder/web clean` and start again.

**`tsc --watch` output floods the terminal** — the watchers use
`--preserveWatchOutput` so they don't clear the screen; that's intentional, it keeps
the web and worker logs from being wiped.

**Port 5432 already in use** — you likely have a native Postgres service running.
Either stop it or set `POSTGRES_PORT=5433` in `.env` and update `DATABASE_URL`.
