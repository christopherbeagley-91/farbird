-- Box matrix, 11 Nov 2026:
-- Huski is a New Zealand brand, so it breaks the from-abroad rule: demoted to Option and flagged; BrüMate (USA) replaces it.
-- Sibling and Partner get for-her and for-him picks. Partner hero moves away from Jellycat (too child-centric for an adult partner).
-- Costs are estimates at about half of NZ retail until quotes arrive.

update public.hq_box_items set pick = 'Option',
  notes = 'NZ brand: breaks the from-abroad rule. Keep only as a fallback. ' || coalesce(notes, '')
where supplier = 'Huski';

update public.hq_box_items set pick = 'Option',
  notes = 'Too child-centric for an adult partner. Better suited to the Kids box. ' || coalesce(notes, '')
where box = 'Partner' and supplier = 'Jellycat';

update public.hq_box_items set item = 'For her: ' || item where box = 'Sibling' and slot = 'Small' and supplier = 'Squishmallows';
update public.hq_box_items set item = 'For her: ' || item where box = 'Partner' and slot = 'Small' and supplier = 'L''Occitane';

insert into public.hq_box_items (box, slot, pick, supplier, item, origin, rrp_nzd, est_cost_nzd, notes) values
  -- Dad hero
  ('Dad','Hero','Pick','Research: BrüMate NZ stockist','BrüMate Hopsulator Slim can cooler','USA',45,22.5,'Retail is an estimate. The US equivalent of the Huski cooler; on Amazon US for the prototype.'),
  -- Sibling hero: her and him
  ('Sibling','Hero','Pick','Research: BrüMate NZ stockist','For her: BrüMate Uncork''d wine tumbler','USA',50,25,'Retail is an estimate. Replaces the Huski tumbler. Over the hero target.'),
  ('Sibling','Hero','Pick','Research: NZ games distributor','For him: Exploding Kittens card game','USA',35,17.5,'Retail is an estimate. Long-running viral party game, around NZ$30–35.'),
  ('Sibling','Hero','Option','Research: NZ games distributor','For him: UNO Show ''Em No Mercy','USA',25,12.5,'Retail is an estimate. The viral, brutal UNO.'),
  ('Sibling','Hero','Option','Research: Loop NZ stockist','For him: Loop Quiet earplugs','Belgium',40,20,'Retail is an estimate. Trending with gym-goers and gig-goers.'),
  -- Sibling small: him
  ('Sibling','Small','Pick','Research: NZ stockist','For him: Dr. Squatch bar soap','USA',16,8,'Retail is an estimate. Big with men on TikTok and YouTube.'),
  -- Partner hero: her and him
  ('Partner','Hero','Pick','Research: Mecca or Sol de Janeiro trade','For her: Sol de Janeiro perfume mist, travel size (Cheirosa 62)','Brazil / USA',35,17.5,'Retail is an estimate. Called TikTok''s scent of the year. The 90ml is about NZ$55 at Mecca, over budget.'),
  ('Partner','Hero','Pick','Research: Bellroy NZ stockist','For him: Bellroy card sleeve','Australia',59,29.5,'Retail is an estimate. Well over the hero target, so look for a trade price or a cheaper style.'),
  ('Partner','Hero','Option','Research: Kitsch NZ stockist','For her: Kitsch satin pillowcase','USA',45,22.5,'Retail is an estimate. Viral and cheap to post.'),
  -- Partner small: him
  ('Partner','Small','Pick','L''Occitane','For him: L''Occitane Cade shave or aftershave balm, travel size','France',25,12.5,'Retail is an estimate. Same supplier as the her pick: L''Occitane''s men''s line.');
