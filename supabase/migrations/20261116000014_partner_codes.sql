-- Partner codes on the waitlist (16 Nov 2026): track which community a signup
-- came from (FLATWHITE, KEA, ...) and which offer they were promised.
-- join_waitlist() is unchanged; the page calls apply_partner_code() right after
-- a successful signup, identified by the signup's own referral code.

create table if not exists public.partner_codes (
  code text primary key check (code ~ '^[A-Z0-9]{2,20}$'),
  partner text not null,
  offer text not null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.partner_codes enable row level security;
create policy "team all" on public.partner_codes
  for all to authenticated using (public.is_team()) with check (public.is_team());
create trigger partner_codes_touch before update on public.partner_codes
  for each row execute function public.touch_updated_at();

create table if not exists public.waitlist_partner_codes (
  waitlist_id uuid primary key references public.waitlist(id) on delete cascade,
  code text not null references public.partner_codes(code),
  created_at timestamptz not null default now()
);

alter table public.waitlist_partner_codes enable row level security;
-- No anon policies: the public writes only through apply_partner_code().
create policy "team reads waitlist partner codes" on public.waitlist_partner_codes
  for select to authenticated using (public.is_team());

insert into public.partner_codes (code, partner, offer, notes) values
  ('FLATWHITE', 'Flat White NYC', 'NZ$10 off a first box', 'Flat White meetup community, New York'),
  ('KEA', 'Kea New Zealand', 'NZ$10 off a first box', 'Kea global Kiwi network')
on conflict (code) do nothing;

-- Attach a partner code to a signup. Returns the code's partner and offer when
-- the code is active, {"valid": false} otherwise. A signup keeps its first code.
create or replace function public.apply_partner_code(p_referral_code text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_waitlist uuid;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_row partner_codes;
begin
  select * into v_row from partner_codes where code = v_code and active;
  if v_row.code is null then
    return jsonb_build_object('valid', false);
  end if;

  select id into v_waitlist from waitlist where referral_code = lower(trim(p_referral_code));
  if v_waitlist is null then
    return jsonb_build_object('valid', false);
  end if;

  insert into waitlist_partner_codes (waitlist_id, code)
  values (v_waitlist, v_row.code)
  on conflict (waitlist_id) do nothing;

  return jsonb_build_object('valid', true, 'code', v_row.code, 'partner', v_row.partner, 'offer', v_row.offer);
end;
$function$;

revoke all on function public.apply_partner_code(text, text) from public;
grant execute on function public.apply_partner_code(text, text) to anon, authenticated;
