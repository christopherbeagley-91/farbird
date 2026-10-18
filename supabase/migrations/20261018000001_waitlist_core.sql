-- Farbird: waitlist + team access. Applied to project fmrabsrgdwqhyxcjnfgt on 2026-10-18.
create extension if not exists citext;

-- Team allow-list for HQ access
create table public.team_members (
  email citext primary key,
  name text not null,
  role text,
  created_at timestamptz not null default now()
);
alter table public.team_members enable row level security;

create or replace function public.is_team()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where email = (auth.jwt() ->> 'email')::citext
  );
$$;
revoke all on function public.is_team() from public;
revoke execute on function public.is_team() from anon;
grant execute on function public.is_team() to authenticated;

create policy "team reads team" on public.team_members
  for select to authenticated using (public.is_team());

-- Waitlist
create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  first_name text,
  country text,
  referral_code text not null unique,
  referred_by text,
  source text,
  utm_source text,
  utm_campaign text,
  created_at timestamptz not null default now()
);
create table public.waitlist_people (
  id uuid primary key default gen_random_uuid(),
  waitlist_id uuid not null references public.waitlist(id) on delete cascade,
  first_name text not null,
  relationship text not null,
  box text,
  birthday_day int check (birthday_day between 1 and 31),
  birthday_month int check (birthday_month between 1 and 12),
  nz_city text,
  created_at timestamptz not null default now()
);
create index on public.waitlist_people (waitlist_id);
create index on public.waitlist (referred_by);

alter table public.waitlist enable row level security;
alter table public.waitlist_people enable row level security;
-- No anon policies: the public only writes through join_waitlist().
create policy "team reads waitlist" on public.waitlist
  for select to authenticated using (public.is_team());
create policy "team reads waitlist people" on public.waitlist_people
  for select to authenticated using (public.is_team());

-- Public entry point: validates, dedupes on email, credits referrer, returns position.
create or replace function public.join_waitlist(
  p_email text,
  p_first_name text,
  p_country text,
  p_people jsonb,
  p_ref text default null,
  p_source text default null,
  p_utm_source text default null,
  p_utm_campaign text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_code text;
  v_person jsonb;
  v_position int;
  v_refs int;
begin
  if p_email is null or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(p_email) > 254 then
    raise exception 'invalid email';
  end if;
  if p_people is null or jsonb_typeof(p_people) <> 'array' or jsonb_array_length(p_people) > 10 then
    raise exception 'invalid people';
  end if;

  select id, referral_code into v_id, v_code from waitlist where email = p_email::citext;

  if v_id is null then
    loop
      v_code := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 7));
      exit when not exists (select 1 from waitlist where referral_code = v_code);
    end loop;
    insert into waitlist (email, first_name, country, referral_code, referred_by, source, utm_source, utm_campaign)
    values (
      p_email, left(p_first_name, 80), left(p_country, 40), v_code,
      case when p_ref is not null and exists (select 1 from waitlist where referral_code = lower(p_ref)) then lower(p_ref) end,
      left(p_source, 80), left(p_utm_source, 80), left(p_utm_campaign, 80)
    )
    returning id into v_id;
  end if;

  for v_person in select * from jsonb_array_elements(p_people) loop
    if coalesce(trim(v_person ->> 'first_name'), '') <> '' then
      insert into waitlist_people (waitlist_id, first_name, relationship, box, birthday_day, birthday_month, nz_city)
      values (
        v_id,
        left(trim(v_person ->> 'first_name'), 80),
        left(coalesce(v_person ->> 'relationship', 'Other'), 40),
        left(v_person ->> 'box', 40),
        nullif(v_person ->> 'birthday_day', '')::int,
        nullif(v_person ->> 'birthday_month', '')::int,
        left(v_person ->> 'nz_city', 80)
      );
    end if;
  end loop;

  select count(*) into v_position from waitlist
   where created_at <= (select created_at from waitlist where id = v_id);
  select count(*) into v_refs from waitlist where referred_by = v_code;

  return jsonb_build_object('referral_code', v_code, 'position', v_position, 'referrals', v_refs);
end;
$$;
revoke all on function public.join_waitlist(text, text, text, jsonb, text, text, text, text) from public;
grant execute on function public.join_waitlist(text, text, text, jsonb, text, text, text, text) to anon, authenticated;

-- Public social-proof count only
create or replace function public.waitlist_count()
returns int language sql stable security definer set search_path = public
as $$ select count(*)::int from waitlist; $$;
revoke all on function public.waitlist_count() from public;
grant execute on function public.waitlist_count() to anon, authenticated;

-- First team member (real email set directly in the live project):
-- insert into public.team_members (email, name, role) values ('you@example.com', 'Chris', 'GTM & Commercial');
