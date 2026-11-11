-- Box matrix: everything should feel like it came from abroad (no NZ-made items).
-- Rewrites the gap notes and adds overseas options for every gap. Food must come through an MPI-registered NZ importer.
-- Costs are estimates at about half of NZ retail until quotes arrive.

update public.hq_box_items set notes = case box
  when 'Mum' then 'Shelf-stable, from abroad, through an MPI-registered NZ importer. Options listed below.'
  when 'Dad' then 'Shelf-stable, from abroad, through an MPI-registered NZ importer. Hot honey is the trend.'
  when 'Sibling' then 'Shelf-stable, from abroad, through an MPI-registered NZ importer. Dubai-style pistachio chocolate is the year''s viral treat.'
  when 'Partner' then 'Shelf-stable, from abroad, through an MPI-registered NZ importer. Options listed below.'
  when 'Kids' then 'Shelf-stable, from abroad, through an MPI-registered NZ importer. Swedish pick-and-mix is the TikTok trend.'
end
where pick = 'Gap' and slot = 'Perishable';

update public.hq_box_items set notes = 'Nothing on the shortlist fits. Patterned socks from an overseas brand deliver on the "better than socks" joke.'
where pick = 'Gap' and box = 'Dad' and slot = 'Small';
update public.hq_box_items set notes = 'Nothing on the shortlist fits. A collectable blind-box figure is the trend.'
where pick = 'Gap' and box = 'Kids' and slot = 'Small';

insert into public.hq_box_items (box, slot, pick, supplier, item, origin, rrp_nzd, est_cost_nzd, notes) values
  -- Mum treats
  ('Mum','Perishable','Option','Research: NZ importer','Bonne Maman mini jams or Christmas biscuits','France',16,8,'Retail is an estimate. Stocked in NZ, so an importer or wholesaler should carry it.'),
  ('Mum','Perishable','Option','Research: NZ importer','Lindt Excellence or a Lindt Christmas bar','Switzerland',10,5,'Retail is an estimate. Safe, recognisable, under budget.'),
  ('Mum','Perishable','Option','Research: NZ importer','Walkers shortbread, Christmas tin','Scotland',14,7,'Retail is an estimate. Classic Christmas, travels well.'),
  -- Dad small + treats
  ('Dad','Small','Option','Research: Happy Socks or Stance stockist','Patterned socks (Happy Socks, Sweden or Stance, USA)','Sweden / USA',30,15,'Retail is an estimate. Over the NZ$8.75 target, so look for a trade deal or a single pair in a gift tin.'),
  ('Dad','Perishable','Option','Research: NZ importer','Mike''s Hot Honey (or similar US hot honey)','USA',25,12.5,'Retail is an estimate. On trend but over target. A smaller jar or sachets would fit.'),
  ('Dad','Perishable','Option','Research: NZ importer','Walkers shortbread fingers','Scotland',8,4,'Retail is an estimate. Cheap, travels well.'),
  ('Dad','Perishable','Option','Research: NZ importer','Lotus Biscoff biscuits or spread','Belgium',10,5,'Retail is an estimate.'),
  -- Sibling treats
  ('Sibling','Perishable','Option','Research: NZ importer','Dubai-style pistachio (kunafa) chocolate bar','UAE / Europe',18,9,'Retail is an estimate. The viral chocolate. Lindt and others now make one, so check NZ importers for stock.'),
  ('Sibling','Perishable','Option','Research: NZ importer','Japanese KitKat flavours (matcha, strawberry)','Japan',12,6,'Retail is an estimate. Asian grocery importers carry them.'),
  -- Partner treats
  ('Partner','Perishable','Option','Research: NZ importer','Godiva truffles, small box','Belgium',20,10,'Retail is an estimate. Over target, but it feels like a gift.'),
  ('Partner','Perishable','Option','Research: NZ importer','Dubai-style pistachio chocolate bar','UAE / Europe',18,9,'Retail is an estimate. On trend.'),
  ('Partner','Perishable','Option','Research: NZ importer','Venchi chocolate bar','Italy',14,7,'Retail is an estimate.'),
  -- Kids small + treats
  ('Kids','Small','Option','Research: NZ stockist','Sonny Angel or Pop Mart mini blind box','Japan / China',22,11,'Retail is an estimate. Collectable and on trend. A little over target.'),
  ('Kids','Perishable','Option','Research: NZ importer','Swedish pick-and-mix bag (e.g. Bubs)','Sweden',12,6,'Retail is an estimate. The TikTok lolly trend. Must be pre-packed, not loose.'),
  ('Kids','Perishable','Option','Research: NZ importer','Nerds Gummy Clusters','USA',8,4,'Retail is an estimate. American candy is a draw for kids.'),
  ('Kids','Perishable','Option','Research: NZ importer','Hi-Chew chewy sweets','Japan',5,2.5,'Retail is an estimate. Cheap filler.');
