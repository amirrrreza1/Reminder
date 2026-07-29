# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.18.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/notifications/package.json packages/notifications/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
ENV NEXT_OUTPUT=standalone
RUN pnpm -r --filter=./packages/* build \
  && pnpm --filter @reminder/worker build \
  && pnpm --filter @reminder/db build \
  && pnpm --filter @reminder/web build \
  && pnpm --filter @reminder/worker --prod deploy /deploy/worker \
  && pnpm --filter @reminder/db --prod deploy /deploy/db

FROM node:${NODE_VERSION}-bookworm-slim AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client tini \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 reminder \
  && useradd --system --uid 1001 --gid reminder --home /app --shell /usr/sbin/nologin reminder

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /deploy/worker ./runtime/worker
COPY --from=builder /deploy/db ./runtime/db
COPY scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
COPY scripts/worker-healthcheck.sh /app/worker-healthcheck.sh

RUN chmod +x /app/docker-entrypoint.sh /app/worker-healthcheck.sh \
  && chown -R reminder:reminder /app

USER reminder
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["web"]
