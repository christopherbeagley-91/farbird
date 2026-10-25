-- Editable breakeven inputs for HQ → Financials (price, box costs, packing labour, card fees).
-- Fixed costs stay as Budget lines in hq_finance.

create table if not exists public.hq_assumptions (
  key text primary key,
  grp text not null,
  label text not null,
  value numeric not null,
  unit text not null default 'NZ$',
  sort int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hq_assumptions enable row level security;
create policy "team all" on public.hq_assumptions for all to authenticated
  using (public.is_team()) with check (public.is_team());
create trigger touch before update on public.hq_assumptions
  for each row execute function public.touch_updated_at();

insert into public.hq_assumptions (key, grp, label, value, unit, sort, notes) values
  ('avg_price',          'Price',     'Average price per box, delivered', 89,   'NZ$',    1,  'Christmas hero box'),
  ('discount_per_box',   'Price',     'Average offer discount per box',   5,    'NZ$',    2,  'Blended across the Sixer, NZ$10 off and full-price boxes'),
  ('boxes_per_customer', 'Price',     'Boxes per customer',               1.6,  'boxes',  3,  'One address per order, so one box per order'),
  ('product_cost',       'Box costs', 'Gifts and treats',                 35,   'NZ$',    10, 'Estimate until supplier quotes are in'),
  ('base_kit',           'Box costs', 'Sleeve, box, tissue, card, filler, carton', 8, 'NZ$', 11, 'Lynn''s print quotes replace this'),
  ('courier',            'Box costs', 'Courier per parcel',               11,   'NZ$',    12, 'Mum''s rate card replaces this'),
  ('pack_wage',          'Packing',   'Packer hourly wage',               20,   'NZ$/hr', 20, '16 or 17 in first six months; adult minimum is NZ$23.95'),
  ('pack_holiday_pct',   'Packing',   'Holiday pay',                      8,    '%',      21, 'Paid on top for casual work'),
  ('pack_kiwisaver_pct', 'Packing',   'KiwiSaver employer contribution',  3.5,  '%',      22, 'If they are a member'),
  ('pack_minutes',       'Packing',   'Minutes per box',                  10,   'min',    23, 'Make, pack and label'),
  ('fee_pct',            'Card fees', 'Shopify Payments, international card', 3.3, '%',   30, 'Most buyers pay with an overseas card'),
  ('fee_fixed',          'Card fees', 'Per-order card fee',               0.30, 'NZ$',    31, null)
on conflict (key) do nothing;
