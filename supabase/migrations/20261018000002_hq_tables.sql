-- Farbird HQ: project manager / CRM tables. Team-only via public.is_team().
create table public.hq_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  workstream text not null default 'General',
  phase text,
  owner text,
  status text not null default 'To do' check (status in ('To do','In progress','Blocked','Done')),
  start_date date,
  due_date date,
  notes text,
  clickup_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hq_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  location text,
  contact text,
  products text,
  unit_cost_nzd numeric(10,2),
  moq int,
  lead_time_days int,
  status text not null default 'Prospect' check (status in ('Prospect','Contacted','Quoted','Sampling','Approved','Rejected')),
  owner text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hq_boxes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text check (kind in ('Relationship','Persona','Drop')),
  tier text,
  price_nzd numeric(10,2),
  cogs_nzd numeric(10,2),
  items text,
  status text not null default 'Concept' check (status in ('Concept','Sourcing','Sampled','Live','Retired')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hq_finance (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('Budget','Actual cost','Revenue')),
  category text not null,
  item text not null,
  amount_nzd numeric(12,2) not null default 0,
  entry_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hq_channels (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  type text,
  owner text,
  status text not null default 'Planned' check (status in ('Planned','Live','Paused','Done')),
  target text,
  result text,
  cost_nzd numeric(10,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hq_plan (
  key text primary key,
  title text not null,
  body text not null default '',
  sort int not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

do $$
declare t text;
begin
  foreach t in array array['hq_tasks','hq_suppliers','hq_boxes','hq_finance','hq_channels','hq_plan'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "team all" on public.%I for all to authenticated using (public.is_team()) with check (public.is_team())', t);
    execute format('create trigger touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- Seed data (tasks, boxes, budget, channels, plan sections) was loaded on 2026-10-18 directly
-- and is edited live in HQ; it is not replayed from here.
