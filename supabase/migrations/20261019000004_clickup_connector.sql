-- ClickUp connector support (additive only).

-- Integration secrets created by connectors themselves (e.g. ClickUp's webhook signing secret)
-- live in Vault. Only Edge Functions (service role) can read or write them.
create or replace function public.integrations_set_secret(p_name text, p_value text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'integration:' || p_name;
  if v_id is null then
    perform vault.create_secret(p_value, 'integration:' || p_name, 'Created by a Farbird connector');
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end;
$$;

create or replace function public.integrations_get_secret(p_name text)
returns text
language sql stable security definer set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'integration:' || p_name;
$$;

revoke all on function public.integrations_set_secret(text, text) from public, anon, authenticated;
revoke all on function public.integrations_get_secret(text) from public, anon, authenticated;
grant execute on function public.integrations_set_secret(text, text) to service_role;
grant execute on function public.integrations_get_secret(text) to service_role;

-- When the other tool last changed a linked record. Two-way sync compares this with
-- external_refs.synced_at and the Farbird row's updated_at to decide push / pull / conflict.
create table public.external_ref_sync (
  ref_id uuid primary key references public.external_refs(id) on delete cascade,
  external_updated_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.external_ref_sync enable row level security;
create policy "team reads" on public.external_ref_sync for select to authenticated using (public.is_team());

-- Connector settings (required secrets, descriptions, config defaults) are declared in code in
-- supabase/functions/_shared/registry.ts and applied to public.integrations by integrations-status.
