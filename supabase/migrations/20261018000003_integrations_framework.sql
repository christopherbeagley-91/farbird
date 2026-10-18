-- Phase 2: integrations framework.
-- Every third-party tool connects through Edge Functions using secrets held in Supabase.
-- The browser never sees a third-party key.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- One row per connected tool. Non-secret settings only in config.
create table public.integrations (
  key text primary key,
  name text not null,
  category text not null,
  description text,
  phase text not null default 'Later',
  status text not null default 'not_connected'
    check (status in ('not_connected', 'connected', 'error', 'paused')),
  enabled boolean not null default false,
  required_secrets text[] not null default '{}',
  config jsonb not null default '{}'::jsonb,
  sync_every_minutes int not null default 15 check (sync_every_minutes >= 5),
  sort int not null default 100,
  last_sync_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

-- Every sync and webhook outcome, newest first.
create table public.sync_log (
  id bigint generated always as identity primary key,
  integration_key text not null references public.integrations(key) on delete cascade,
  direction text not null check (direction in ('in', 'out', 'internal')),
  entity text,
  entity_id text,
  external_id text,
  status text not null check (status in ('ok', 'error', 'skipped')),
  message text,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index sync_log_recent on public.sync_log (integration_key, created_at desc);

-- The single map from a Farbird row to its copy in another tool.
create table public.external_refs (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  entity_id text not null,
  integration_key text not null references public.integrations(key) on delete cascade,
  external_id text not null,
  external_url text,
  synced_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (entity, entity_id, integration_key)
);
create index external_refs_lookup on public.external_refs (integration_key, external_id);

-- Inbound webhooks, stored before processing. Unique key makes retries idempotent.
create table public.webhook_events (
  id bigint generated always as identity primary key,
  integration_key text not null references public.integrations(key) on delete cascade,
  event_type text,
  external_id text not null,
  payload jsonb,
  processed boolean not null default false,
  error text,
  received_at timestamptz not null default now(),
  unique (integration_key, external_id)
);

-- Access: team reads everything; team can edit integration settings and refs.
-- sync_log and webhook_events are written only by Edge Functions (service role).
alter table public.integrations enable row level security;
alter table public.sync_log enable row level security;
alter table public.external_refs enable row level security;
alter table public.webhook_events enable row level security;

create policy "team all" on public.integrations for all to authenticated using (public.is_team()) with check (public.is_team());
create policy "team all" on public.external_refs for all to authenticated using (public.is_team()) with check (public.is_team());
create policy "team reads" on public.sync_log for select to authenticated using (public.is_team());
create policy "team reads" on public.webhook_events for select to authenticated using (public.is_team());

create trigger touch before update on public.integrations for each row execute function public.touch_updated_at();
create trigger touch before update on public.external_refs for each row execute function public.touch_updated_at();

-- Providers on the roadmap (docs/hq-build-prompt.md, Phase 3).
insert into public.integrations (key, name, category, description, phase, required_secrets, sync_every_minutes, sort, config) values
('clickup', 'ClickUp', 'Project management', 'Two-way task sync with the Farbird — Christmas 2026 folder.', 'Now',
  array['CLICKUP_API_TOKEN', 'CLICKUP_WEBHOOK_SECRET'], 15, 1,
  '{"workspace_id": "9017657384", "folder_id": "901711976388", "lists": {"Finance & Legal": "901717881420", "Brand": "901717881421", "Product & Suppliers": "901717881422", "Print & Packaging": "901717881423", "Waitlist & Tech": "901717881424", "Marketing": "901717881425", "Partnerships": "901717881425", "Ops": "901717881426"}}'::jsonb),
('stripe', 'Stripe', 'Payments', 'Pre-sale checkout in NZD; orders and revenue into HQ.', 'Before pre-sale',
  array['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'], 60, 2, '{}'::jsonb),
('resend', 'Resend', 'Email', 'Waitlist confirmation, early access, orders, dispatch and occasion reminders.', 'Before pre-sale',
  array['RESEND_API_KEY'], 60, 3, '{}'::jsonb),
('posthog', 'PostHog', 'Analytics', 'Waitlist funnel events, shown on the HQ overview.', 'Before pre-sale',
  array['POSTHOG_PERSONAL_API_KEY'], 60, 4, '{}'::jsonb),
('google', 'Google Workspace', 'Calendar and files', 'Shared Farbird calendar for milestones; Drive links for quotes and creative.', 'After Christmas',
  array['GOOGLE_SERVICE_ACCOUNT_JSON'], 60, 5, '{}'::jsonb),
('courier', 'NZ courier', 'Fulfilment', 'Shipments and tracking once a courier account exists. CSV until then.', 'After Christmas',
  array['COURIER_API_KEY'], 60, 6, '{}'::jsonb),
('ugc', 'Social and UGC', 'Marketing', 'Unboxing posts logged in HQ; repost rewards. Manual first.', 'After Christmas',
  array[]::text[], 1440, 7, '{}'::jsonb),
('twilio', 'Twilio', 'SMS', 'Occasion reminders by text.', 'Later',
  array['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'], 60, 8, '{}'::jsonb),
('canva', 'Canva', 'Design', 'Links to sleeve, card and social designs. No sync needed yet.', 'Later',
  array[]::text[], 1440, 9, '{}'::jsonb);

-- Move existing ClickUp links into the shared map. hq_tasks.clickup_url stays as a cached link.
insert into public.external_refs (entity, entity_id, integration_key, external_id, external_url, synced_at)
select 'hq_tasks', id::text, 'clickup', regexp_replace(clickup_url, '^.*/t/', ''), clickup_url, now()
from public.hq_tasks where clickup_url is not null
on conflict do nothing;

-- Scheduler secret: lives in Vault, checked by Edge Functions through a service-role-only function.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'integrations_cron_secret', 'Shared secret for pg_cron -> Edge Function calls');

create or replace function public.integrations_check_internal_secret(p_secret text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'integrations_cron_secret' and decrypted_secret = p_secret
  );
$$;
revoke all on function public.integrations_check_internal_secret(text) from public, anon, authenticated;
grant execute on function public.integrations_check_internal_secret(text) to service_role;

-- Every 5 minutes the dispatcher decides which enabled integrations are due.
select cron.schedule(
  'integrations-dispatch',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://fmrabsrgdwqhyxcjnfgt.supabase.co/functions/v1/integrations-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-farbird-internal', (select decrypted_secret from vault.decrypted_secrets where name = 'integrations_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $job$
);

-- Keep the log lean.
select cron.schedule(
  'sync-log-cleanup',
  '17 3 * * *',
  $job$ delete from public.sync_log where created_at < now() - interval '90 days'; $job$
);

-- Internal row for scheduler runs and self-tests (hidden from the HQ cards).
insert into public.integrations (key, name, category, description, phase, status, enabled, sort, sync_every_minutes)
values ('system', 'Farbird system', 'System', 'Scheduler runs and self-tests. Not a third-party tool.', 'Now', 'connected', false, 0, 1440);
