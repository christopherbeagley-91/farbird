-- Supplier website and trade/account links, kept in a companion table
-- (migrations here are additive only, so no new columns on hq_suppliers).
create table if not exists public.hq_supplier_links (
  supplier_id uuid primary key references public.hq_suppliers(id) on delete cascade,
  website text,
  account_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hq_supplier_links enable row level security;
create policy "team all" on public.hq_supplier_links for all to authenticated
  using (public.is_team()) with check (public.is_team());
create trigger touch before update on public.hq_supplier_links
  for each row execute function public.touch_updated_at();
