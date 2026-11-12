-- Box matrix, 11 Nov 2026 (evening):
-- BrüMate has no NZ stockist we can find, so Stanley (USA, sold in NZ via nz.stanley1913.com, Ballantynes, Stirling Sports)
-- becomes the pick for Dad's hero and Kate's for-her hero: one supplier across two boxes.
-- Squishmallows clip-on is replaced in the Sibling box by a Sol de Janeiro mini (same supplier as the Partner hero).

update public.hq_box_items set pick = 'Option',
  notes = 'No NZ stockist found (Nov 2026). Fine as a look-alike for the NYC prototype. ' || coalesce(notes, '')
where supplier like 'Research: BrüMate%';

update public.hq_box_items set pick = 'Option',
  notes = 'Replaced by the Sol de Janeiro mini (11 Nov). ' || coalesce(notes, '')
where box = 'Sibling' and slot = 'Small' and supplier = 'Squishmallows';

insert into public.hq_box_items (box, slot, pick, supplier, item, origin, rrp_nzd, est_cost_nzd, notes) values
  ('Dad','Hero','Pick','Stanley NZ (distributor to confirm)','Stanley Everyday Can Cooler Cup 10oz','USA',55,27.5,'NZ$55 at nz.stanley1913.com; also Ballantynes and Stirling Sports. Over the hero target, so ask for trade pricing. Same supplier as Kate''s tumbler.'),
  ('Sibling','Hero','Pick','Stanley NZ (distributor to confirm)','For her: Stanley Everyday wine tumbler 10oz','USA',50,25,'Retail is an estimate. Same supplier as Dad''s can cooler: one order, two boxes.'),
  ('Sibling','Small','Pick','Research: Sol de Janeiro trade or Mecca','For her: Sol de Janeiro Brazilian Bum Bum Cream mini (25ml)','Brazil / USA',22,11,'Retail is an estimate. Same supplier as the Partner hero (perfume mist): one order, two boxes.'),
  ('Sibling','Small','Option','Research: Kitsch NZ stockist','For her: Kitsch claw clip or satin scrunchies','USA',20,10,'Retail is an estimate. Same supplier as the Partner pillowcase option.');
