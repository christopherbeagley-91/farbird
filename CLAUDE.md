# Farbird

Personalised, PR-style NZ gift boxes for Kiwis living overseas, sent to family back home, with reminders so nobody misses a date. Name locked as Farbird (NZ company name reserved Oct 2026; IPONZ trademark not yet filed). Handles: Instagram @farbird.nz, TikTok @farbirdnz. EXPAT is the future platform / member-club sub-brand.

## Status (Oct 2026)
Christmas 2026 test. Waitlist from 31 Oct, pre-sale 16 Nov (500 signups by 15 Nov), last order date Sat 12 Dec, go/kill 16 Jan 2027.

## Team
- Chris: GTM, commercial, P&L, tech
- Mum: NZ operations, suppliers (NZ + China), courier bookings; NZ director (proposed)
- Packer (student hire, Dec): packs and ships every box (see the Farbird packing guide)
- Lauren: brand, creative, influencers, UGC, events
- Lynn: print and packaging
- Emily (Lauren's friend): design and logo

## Repo layout
- `index.html` — public waitlist page (static, deployed to GitHub Pages by `.github/workflows/pages.yml`). Writes only through the `join_waitlist` RPC.
- `hq/index.html` — Farbird HQ, the team-only project manager / CRM (tasks, timeline, waitlist, boxes, suppliers, financials, marketing, plan). Magic-link sign-in; access gated by `public.team_members`.
- `supabase/migrations/` — schema as applied to the live project.
- `supabase/functions/` — Edge Functions. `_shared/` holds auth, secrets, logging, retry, webhook and dispatch helpers; `integrations-status` (HQ status/Sync now/self-test) and `integrations-cron` (pg_cron every 5 min).
- Agents: `supabase/functions/_shared/agents.ts` (role prompts, tools, Claude tool loop, brand audit, Metricool), `agent` (HQ panels: status, chat, report, run, settings, scheduled) and `agents-sync` (hourly, called by the dispatcher as integration key `agents`). Runs log to `agent_runs`; marketing posts live in `content_queue`. Panels: Finance on Financials, Marketing on Marketing, Operations on Waitlist.
- `docs/hq-build-prompt.md` — the HQ roadmap: core views, integrations framework (edge functions, secrets, sync log, external refs), connectors (ClickUp, Stripe, Resend, PostHog, Google Workspace, courier, UGC, Twilio, Canva) and CRM/loyalty. Follow it for any HQ or integration work.

## Stack
- Supabase project `farbird` (ref `fmrabsrgdwqhyxcjnfgt`, region ap-southeast-2 Sydney). Publishable key is in the HTML on purpose; it is safe because RLS blocks all direct table access for `anon`.
- supabase-js 2.45.4, marked 12.0.2, DOMPurify 3.1.6 from jsdelivr. No build step.
- ClickUp: folder "Farbird — Christmas 2026" in Team Space (lists 1-7 by workstream). Each `hq_tasks.clickup_url` links to its ClickUp task.

## Rules
- Integrations: third-party keys only in Supabase Edge Function secrets, never in HTML. Connectors are `<key>-sync` / `<key>-webhook` functions built on `_shared/`, deployed with verify_jwt = false (they call `authorize()`). Map records via `external_refs`, log via `logSync`, store webhooks via `recordWebhook` before processing.
- Agents never move money, refund, delete or email customers; they read HQ data and draft. Marketing autopilot only schedules organic posts that pass the brand audit. Paid ads stay human-approved.
- Never add an `anon` select policy on `waitlist` or `waitlist_people`. Public writes go through `join_waitlist()` only.
- Tool list lives in `supabase/functions/_shared/registry.ts`; edit there, not in the `integrations` table. `kind: "manual"` tools have no sync function.
- Migrations are additive only (the Supabase MCP blocks ALTER/DELETE): new tables or functions, not column changes.
- New HQ tables: enable RLS and add the `"team all"` policy using `public.is_team()`, plus the `touch` trigger.
- Add a teammate: `insert into public.team_members (email, name, role) values (...)`.
- Keep the waitlist page a single self-contained HTML file. Mobile-first; test at 390px.
- Brand (editorial direction, 26 Oct 2026: the box as a coffee-table book, Assouline travel-series cues; full book in the Farbird design system): ivory #F6F1E7, linen #ECE4D4, ink #1B1A17, ink-soft #5A544B, gilt #B08D57 (foil, decorative/large only), gilt-deep #7A5F35; box linens lacquer #8E1B24 (Mum), bush #2F4A35 (Dad), ochre #C9962E (Sibling, ink text), fig #5E2233 (Partner), harbour #1E3A5F (Kids); paua #134A50 second colour; blush #EBCFCB tissue. Fonts: Bodoni Moda (display, names in spaced capitals), EB Garamond (text), Instrument Sans (UI, buttons, overlines). Square corners. The waitlist page still uses the old Kiwiana tokens until it is redesigned after the Canva mock-ups.
- Voice: dry Kiwi humour, warm, never cheesy. Sentence case. No te reo Māori in the brand mark.
- Money in NZD. Dates in NZ terms (NZ Mother's Day 2nd Sun May, Father's Day 1st Sun Sep).
- No alcohol in boxes (needs NZ off-licence). Food is pre-packaged only. Treats may be international (decided Oct 2026), bought from NZ importers who are MPI-registered food importers; buying food direct from overseas means registering Farbird with MPI first.
