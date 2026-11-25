-- 24 Nov 2026: everyone pays in NZ$ (no local-currency prices). Box prices NZ$89 adult / NZ$59 kids,
-- delivery charged on top once per order (up to 2 boxes to one address): NZ$10 North Island, NZ$21.99 South Island.
-- New breakeven inputs; the per-market rows (grp 'Markets'), avg_price and si_premium are no longer read by HQ.
insert into public.hq_assumptions (key, grp, label, value, unit, sort, notes) values
  ('price_adult', 'Price', 'Adult box price', 89, 'NZ$', 0, 'All prices in NZ$, wherever the buyer lives (decided 24 Nov 2026)'),
  ('price_kids', 'Price', 'Kids box price', 59, 'NZ$', 1, null),
  ('kids_share', 'Price', 'Kids boxes, share of boxes sold', 20, '%', 2, 'Estimate until pre-sale orders show the real mix'),
  ('delivery_ni', 'Price', 'Delivery charged, North Island, per order', 10, 'NZ$', 5, 'Charged at checkout, once per order of up to 2 boxes to one address'),
  ('delivery_si', 'Price', 'Delivery charged, South Island, per order', 21.99, 'NZ$', 6, 'Charged at checkout, once per order of up to 2 boxes to one address')
on conflict (key) do update set value = excluded.value, notes = excluded.notes;
