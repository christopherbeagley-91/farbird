-- Sleeve colour per person on the waitlist (Lauren, 14 Nov 2026: let senders
-- pick the sleeve colour; we print each named sleeve to order).
-- Stored in its own table so waitlist_people stays unchanged. join_waitlist()
-- is replaced to save the colour; the public still writes only through it.

create table if not exists public.waitlist_sleeves (
  person_id uuid primary key references public.waitlist_people(id) on delete cascade,
  colour text not null check (colour in ('pohutukawa', 'bush', 'kowhai', 'musk', 'jandal')),
  created_at timestamptz not null default now()
);

alter table public.waitlist_sleeves enable row level security;
-- No anon policies: the public only writes through join_waitlist().
create policy "team reads waitlist sleeves" on public.waitlist_sleeves
  for select to authenticated using (public.is_team());

create or replace function public.join_waitlist(
  p_email text, p_first_name text, p_country text, p_people jsonb,
  p_ref text default null, p_source text default null,
  p_utm_source text default null, p_utm_campaign text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_code text;
  v_person jsonb;
  v_person_id uuid;
  v_colour text;
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
      )
      returning id into v_person_id;

      v_colour := lower(trim(coalesce(v_person ->> 'sleeve', '')));
      if v_colour in ('pohutukawa', 'bush', 'kowhai', 'musk', 'jandal') then
        insert into waitlist_sleeves (person_id, colour) values (v_person_id, v_colour);
      end if;
    end if;
  end loop;

  select count(*) into v_position from waitlist
   where created_at <= (select created_at from waitlist where id = v_id);
  select count(*) into v_refs from waitlist where referred_by = v_code;

  return jsonb_build_object('referral_code', v_code, 'position', v_position, 'referrals', v_refs);
end;
$function$;
