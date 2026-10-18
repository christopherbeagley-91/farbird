# Farbird

Personalised, PR-style NZ gift boxes for Kiwis living overseas, sent to family back home, with reminders so nobody misses a date. "Farbird" is the working name (trademark checks pending). EXPAT is the future platform / member-club sub-brand.

## Status (Oct 2026)
Christmas 2026 test. Waitlist from 19 Oct, pre-sale 9 Nov, last order date Sat 12 Dec, go/kill 16 Jan 2027.

## Team
- Chris: GTM, commercial, P&L, tech
- Mum: NZ operations, suppliers (NZ + China), courier, packing
- Lauren: brand, creative, influencers, UGC, events
- Lynn: print and packaging

## Repo layout
- `index.html` — public waitlist page (static, deployed to GitHub Pages by `.github/workflows/pages.yml`). Writes only through the `join_waitlist` RPC.
- `hq/index.html` — Farbird HQ, the team-only project manager / CRM (tasks, timeline, waitlist, boxes, suppliers, financials, marketing, plan). Magic-link sign-in; access gated by `public.team_members`.
- `supabase/migrations/` — schema as applied to the live project.
- `supabase/functions/` — Edge Functions. `_shared/` holds auth, secrets, logging, retry, webhook and dispatch helpers; `integrations-status` (HQ status/Sync now/self-test) and `integrations-cron` (pg_cron every 5 min).
- `docs/hq-build-prompt.md` — the HQ roadmap: core views, integrations framework (edge functions, secrets, sync log, external refs), connectors (ClickUp, Stripe, Resend, PostHog, Google Workspace, courier, UGC, Twilio, Canva) and CRM/loyalty. Follow it for any HQ or integration work.

## Stack
- Supabase project `farbird` (ref `fmrabsrgdwqhyxcjnfgt`, region ap-southeast-2 Sydney). Publishable key is in the HTML on purpose; it is safe because RLS blocks all direct table access for `anon`.
- supabase-js 2.45.4, marked 12.0.2, DOMPurify 3.1.6 from jsdelivr. No build step.
- ClickUp: folder "Farbird — Christmas 2026" in Team Space (lists 1-7 by workstream). Each `hq_tasks.clickup_url` links to its ClickUp task.

## Rules
- Integrations: third-party keys only in Supabase Edge Function secrets, never in HTML. Connectors are `<key>-sync` / `<key>-webhook` functions built on `_shared/`, deployed with verify_jwt = false (they call `authorize()`). Map records via `external_refs`, log via `logSync`, store webhooks via `recordWebhook` before processing.
- Never add an `anon` select policy on `waitlist` or `waitlist_people`. Public writes go through `join_waitlist()` only.
- New HQ tables: enable RLS and add the `"team all"` policy using `public.is_team()`, plus the `touch` trigger.
- Add a teammate: `insert into public.team_members (email, name, role) values (...)`.
- Keep the waitlist page a single self-contained HTML file. Mobile-first; test at 390px.
- Brand tokens: sky #E4EEF2, ink #17222E, crimson #B3182B, flax #3D5A33, kowhai #F1C232. Fonts: Bricolage Grotesque (display), Instrument Sans (body).
- Voice: dry Kiwi humour, warm, never cheesy. Sentence case. No te reo Māori in the brand mark.
- Money in NZD. Dates in NZ terms (NZ Mother's Day 2nd Sun May, Father's Day 1st Sun Sep).
- No alcohol in boxes (needs NZ off-licence). Pre-packaged NZ-made food only.
