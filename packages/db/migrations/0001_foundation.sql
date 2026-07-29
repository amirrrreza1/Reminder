-- Phase 1 foundation migration.
-- Domain tables arrive in Phase 2; this establishes the migration ledger and worker heartbeat.

create table if not exists worker_heartbeats (
  worker_id text primary key,
  updated_at timestamptz not null default now()
);
