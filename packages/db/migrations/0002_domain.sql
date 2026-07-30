-- Phase 2 domain and persistence schema. Enum additions are forward-only.

create extension if not exists pgcrypto;

do $$ begin create type calendar_system as enum ('gregorian', 'jalali'); exception when duplicate_object then null; end $$;
do $$ begin create type currency as enum ('IRR', 'USD'); exception when duplicate_object then null; end $$;
do $$ begin create type reminder_type as enum ('birthday', 'subscription', 'debt', 'rent', 'bill', 'insurance', 'membership', 'maintenance', 'medication_refill', 'tax_license', 'custom'); exception when duplicate_object then null; end $$;
do $$ begin create type reminder_state as enum ('active', 'paused', 'completed'); exception when duplicate_object then null; end $$;
do $$ begin create type recurrence_frequency as enum ('once', 'daily', 'weekly', 'monthly', 'yearly'); exception when duplicate_object then null; end $$;
do $$ begin create type notification_channel as enum ('email', 'telegram'); exception when duplicate_object then null; end $$;
do $$ begin create type delivery_kind as enum ('occurrence', 'provider_test'); exception when duplicate_object then null; end $$;
do $$ begin create type delivery_status as enum ('pending', 'processing', 'retry', 'sent', 'failed', 'expired', 'cancelled', 'cancelled_global'); exception when duplicate_object then null; end $$;

create table if not exists settings (
  id smallint primary key default 1 check (id = 1),
  calendar_system calendar_system not null,
  default_currency currency not null,
  email_enabled boolean not null,
  telegram_enabled boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  title varchar(120) not null check (length(btrim(title)) between 1 and 120),
  description text check (description is null or length(description) <= 2000),
  type reminder_type not null,
  custom_type_label varchar(40),
  state reminder_state not null default 'active',
  recurrence_calendar calendar_system not null,
  anchor_year smallint not null,
  anchor_month smallint not null check (anchor_month between 1 and 12),
  anchor_day smallint not null check (anchor_day between 1 and 31),
  anchor_was_last_day boolean not null,
  frequency recurrence_frequency not null,
  recurrence_interval smallint not null check (recurrence_interval between 1 and 99),
  next_occurrence_date date,
  next_notification_at timestamptz,
  remind_before_days smallint not null check (remind_before_days between 0 and 365),
  amount_minor bigint check (amount_minor between 0 and 9999999999999),
  currency currency,
  email_enabled boolean not null default false,
  telegram_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminders_amount_currency_check check ((amount_minor is null) = (currency is null)),
  constraint reminders_custom_label_check check ((type = 'custom' and custom_type_label is not null and length(btrim(custom_type_label)) between 1 and 40) or (type <> 'custom' and custom_type_label is null)),
  constraint reminders_completed_schedule_check check ((state = 'completed' and frequency = 'once' and next_occurrence_date is null and next_notification_at is null) or (state <> 'completed' and next_occurrence_date is not null and next_notification_at is not null))
);

create index if not exists reminders_dashboard_order on reminders (state, next_occurrence_date, id);
create index if not exists reminders_scheduler_due on reminders (next_notification_at, id) where state = 'active';
create index if not exists reminders_occurrence_due on reminders (next_occurrence_date, id) where state = 'active';
create index if not exists reminders_type_filter on reminders (type, state, next_occurrence_date);

create table if not exists notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid references reminders(id) on delete cascade,
  kind delivery_kind not null,
  channel notification_channel not null,
  occurrence_date date,
  remind_before_days smallint check (remind_before_days between 0 and 365),
  scheduled_for timestamptz not null,
  status delivery_status not null default 'pending',
  attempt_count smallint not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  lease_owner varchar(100),
  lease_expires_at timestamptz,
  provider_message_id varchar(255),
  last_error_code varchar(80),
  last_error_detail varchar(500),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_occurrence_fields_check check ((kind = 'occurrence' and reminder_id is not null and occurrence_date is not null and remind_before_days is not null) or (kind = 'provider_test' and reminder_id is null and occurrence_date is null and remind_before_days is null)),
  constraint delivery_claim_state_check check ((status in ('pending', 'retry') and next_attempt_at is not null and lease_owner is null and lease_expires_at is null) or (status = 'processing' and lease_owner is not null and lease_expires_at is not null) or (status in ('sent', 'failed', 'expired', 'cancelled', 'cancelled_global') and lease_owner is null and lease_expires_at is null))
);

create unique index if not exists notification_deliveries_occurrence_unique on notification_deliveries (reminder_id, occurrence_date, channel, remind_before_days) where kind = 'occurrence';
create index if not exists notification_deliveries_claim on notification_deliveries (next_attempt_at, created_at, id) where status in ('pending', 'retry');
create index if not exists notification_deliveries_lease_recovery on notification_deliveries (lease_expires_at, id) where status = 'processing';
create index if not exists notification_deliveries_reminder_history on notification_deliveries (reminder_id, created_at desc);

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  -- API concurrency tokens are canonical ISO timestamps with millisecond precision.
  -- Always advance at least one visible millisecond so rapid writes cannot share a token.
  new.updated_at = greatest(date_trunc('milliseconds', clock_timestamp()), date_trunc('milliseconds', old.updated_at) + interval '1 millisecond');
  return new;
end;
$$;

drop trigger if exists settings_set_updated_at on settings;
create trigger settings_set_updated_at before update on settings for each row execute function set_updated_at();
drop trigger if exists reminders_set_updated_at on reminders;
create trigger reminders_set_updated_at before update on reminders for each row execute function set_updated_at();
drop trigger if exists notification_deliveries_set_updated_at on notification_deliveries;
create trigger notification_deliveries_set_updated_at before update on notification_deliveries for each row execute function set_updated_at();

alter table worker_heartbeats add column if not exists role varchar(30);
alter table worker_heartbeats add column if not exists started_at timestamptz;
alter table worker_heartbeats add column if not exists last_seen_at timestamptz;
alter table worker_heartbeats add column if not exists build_version varchar(80);
update worker_heartbeats set role = coalesce(role, 'scheduler_delivery'), started_at = coalesce(started_at, updated_at), last_seen_at = coalesce(last_seen_at, updated_at);
alter table worker_heartbeats alter column role set not null;
alter table worker_heartbeats alter column started_at set not null;
alter table worker_heartbeats alter column last_seen_at set not null;
