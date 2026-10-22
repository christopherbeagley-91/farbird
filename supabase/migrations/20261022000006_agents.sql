-- Farbird agents: every run is logged, and the marketing agent's posts live in a queue.

create table if not exists public.agent_runs (
  id bigint generated always as identity primary key,
  agent text not null check (agent in ('finance', 'marketing', 'ops')),
  trigger text not null default 'chat' check (trigger in ('chat', 'report', 'schedule', 'manual')),
  prompt text,
  reply text,
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  tools_used jsonb not null default '[]'::jsonb,
  asked_by text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists agent_runs_agent_created on public.agent_runs (agent, created_at desc);

create table if not exists public.content_queue (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('instagram', 'tiktok', 'facebook')),
  post_at timestamptz,
  caption text not null,
  visual_brief text,
  media_url text,
  status text not null default 'Draft' check (status in ('Draft', 'Approved', 'Scheduled', 'Posted', 'Failed', 'Rejected')),
  audit jsonb,
  external_id text,
  last_error text,
  created_by text not null default 'marketing agent',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_runs enable row level security;
alter table public.content_queue enable row level security;
create policy "team all" on public.agent_runs for all to authenticated
  using (public.is_team()) with check (public.is_team());
create policy "team all" on public.content_queue for all to authenticated
  using (public.is_team()) with check (public.is_team());
create trigger touch before update on public.content_queue
  for each row execute function public.touch_updated_at();
