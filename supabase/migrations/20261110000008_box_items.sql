-- Box contents matrix for HQ → Boxes: every persona box has three slots (hero, smaller item, perishable).
-- Each row is one candidate item. pick = 'Pick' (current choice), 'Option' (shortlisted) or 'Gap' (nothing yet: research lead).
-- est_cost_nzd starts at about half of NZ retail (typical trade price) until supplier quotes replace it.

create table if not exists public.hq_box_items (
  id uuid primary key default gen_random_uuid(),
  box text not null check (box in ('Mum','Dad','Sibling','Partner','Kids')),
  slot text not null check (slot in ('Hero','Small','Perishable')),
  pick text not null default 'Option' check (pick in ('Pick','Option','Gap')),
  supplier text,
  item text not null,
  origin text,
  rrp_nzd numeric(10,2),
  est_cost_nzd numeric(10,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hq_box_items enable row level security;
create policy "team all" on public.hq_box_items for all to authenticated
  using (public.is_team()) with check (public.is_team());
create trigger touch before update on public.hq_box_items
  for each row execute function public.touch_updated_at();

insert into public.hq_box_items (box, slot, pick, supplier, item, origin, rrp_nzd, est_cost_nzd, notes) values
  -- Mum (Sandra)
  ('Mum','Hero','Pick','Domestic Agencies','Costa Nova stoneware mug (e.g. Stacked Organic, 360ml)','Portugal',42,21,'Retail about NZ$38–42. Ask Domestic Agencies for trade price and Christmas stock. Pack well: ceramic.'),
  ('Mum','Hero','Option','Sid Dickens','Sid Dickens memory block','Canada',129,65,'Retail price is an estimate. Far over the hero budget: only works in a premium box. Confirm the NZ distributor.'),
  ('Mum','Small','Pick','L''Occitane','L''Occitane Shea Butter Hand Cream 30ml','France',22,11,'NZ$22 at Ballantynes. L''Occitane may not sell trade to a small business: ask about corporate gifting pricing.'),
  ('Mum','Perishable','Gap',null,'Research: treat for Mum',null,null,null,'None of the shortlisted suppliers sell food. Options: one of Mum''s NZ chocolatiers (Remarkable, Seriously Good, House of Chocolate, Devonport) as the taste of home, or an international treat from an MPI-registered importer.'),
  -- Dad (Graham)
  ('Dad','Hero','Pick','Huski','Huski Beer Cooler 2.0','Australia',45,22.5,'NZ$45 at Pepper & Me. Limited-edition colours sell well.'),
  ('Dad','Hero','Option','Domestic Agencies','Peugeot salt or pepper mill','France',120,60,'Retail price is an estimate. Far over budget.'),
  ('Dad','Small','Gap',null,'Research: smaller item for Dad',null,null,null,'Nothing on the shortlist fits. Earlier idea: merino socks. Kilner or Typhoon from Domestic Agencies are a stretch for Dad.'),
  ('Dad','Perishable','Gap',null,'Research: treat for Dad',null,null,null,'Earlier idea: chilli hot honey (trending). Needs a food supplier.'),
  -- Sibling (Kate, or a brother)
  ('Sibling','Hero','Pick','Huski','Huski Wine Tumbler 2.0 (sister) or Short Tumbler 2.0 (brother)','Australia',45,22.5,'Retail price is an estimate, same range as the Beer Cooler. One supplier covers both versions.'),
  ('Sibling','Small','Pick','Squishmallows','Squishmallows 5in clip-on','USA',12,6,'Retail price is an estimate. Gen Z collectable. Need the NZ distributor and a trade account.'),
  ('Sibling','Perishable','Gap',null,'Research: treat for a sibling',null,null,null,'Earlier idea: a limited-edition chocolate block ("you can''t get this"). Needs a food supplier.'),
  -- Partner (Aroha)
  ('Partner','Hero','Pick','Jellycat','Jellycat Amuseables (e.g. croissant or coffee cup)','UK',40,20,'Retail price is an estimate. Adult Jellycat collecting is the trend. Need the NZ distributor and a trade account.'),
  ('Partner','Hero','Option','Jellycat','Jellycat Bashful Bunny, small','UK',49,24.5,'NZ$49 at Ballantynes. Classic, but over the hero budget.'),
  ('Partner','Small','Pick','L''Occitane','L''Occitane hand cream 30ml (Cherry Blossom or Rose)','France',22,11,'Same price as the Shea. Different scent from Mum''s box.'),
  ('Partner','Perishable','Gap',null,'Research: treat for a partner',null,null,null,'NZ-made chocolate is the taste of home. Needs a food supplier.'),
  -- Kids (Nico)
  ('Kids','Hero','Pick','Squishmallows','Squishmallows 12in','USA',25,12.5,'Retail price is an estimate. Leaves room in the budget.'),
  ('Kids','Hero','Option','Jellycat','Jellycat Bashful Bunny, small','UK',49,24.5,'NZ$49 at Ballantynes. The premium option.'),
  ('Kids','Small','Gap',null,'Research: smaller item for kids',null,null,null,'Nothing on the shortlist fits. Look for a trending activity or collectable (sticker book, mini blind box).'),
  ('Kids','Perishable','Gap',null,'Research: treat for kids',null,null,null,'Lollies. NZ lollies are the taste of home; international candy needs an MPI-registered importer.');
