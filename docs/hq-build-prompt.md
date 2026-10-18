# Farbird HQ — Claude Code build prompt

Paste into a Claude Code session opened on this repo. Build in the phases listed; each phase ends with a working, deployed HQ.

```text
You're working in the farbird repo (read CLAUDE.md first). Build and extend Farbird HQ at hq/index.html: the team-only project manager, CRM and operations hub for Farbird, running on the existing Supabase project (ref fmrabsrgdwqhyxcjnfgt, Sydney). Design it so new tools can be plugged in later without rewriting the app.

CONSTRAINTS
- Front end: single self-contained HTML file, no build step. CDN only: @supabase/supabase-js@2.45.4, marked@12.0.2, dompurify@3.1.6 (jsdelivr).
- The browser only ever holds the publishable key. Every third-party API key lives in Supabase Edge Function secrets (create_edge_function_secret / supabase secrets set). No third-party API is ever called from the browser.
- Auth: Supabase magic link (signInWithOtp, redirect to the HQ URL). After sign-in call rpc('is_team'); if false, show "not on the team list" and stop.
- Every table: RLS on, "team all" policy using public.is_team(), touch_updated_at trigger. Every schema change ships as a new file in supabase/migrations/.
- Brand: sky #E4EEF2, ink #17222E, crimson #B3182B, flax #3D5A33, kowhai #F1C232. Bricolage Grotesque headings, Instrument Sans body. Light and dark mode. Works at 390px.
- Voice: plain, sentence case, dry Kiwi tone. Money in NZD. NZ dates (Mother's Day 2nd Sun May, Father's Day 1st Sun Sep).

EXISTING TABLES
hq_tasks (has clickup_url), hq_suppliers, hq_boxes, hq_finance, hq_channels, hq_plan (markdown sections), waitlist, waitlist_people, team_members.

PHASE 1 — CORE HQ (views in a left sidebar; remember last view)
1. Overview: KPI tiles (signups vs 500 by 8 Nov, people added, referral signups, days to pre-sale 9 Nov, days to last order 12 Dec, tasks done/overdue, spent vs budget, revenue, orders, gross profit). Panels: due in 7 days + overdue; progress by phase; who they're buying for (stock forecast); signups by country; integration health strip.
2. Tasks: grouped by phase; filters (workstream, owner, status); search; edit dialog; overdue in crimson; ClickUp link and sync state per task.
3. Timeline: Gantt by phase, week ticks, today line, colour by status.
4. Waitlist: signups with the people they're buying for, referrals, UTM source, CSV export.
5. Boxes: price, COGS, gross profit (flag under NZ$20), contents, status, linked suppliers.
6. Suppliers: pipeline Prospect → Contacted → Quoted → Sampling → Approved/Rejected; unit cost, MOQ, lead time, owner.
7. Financials: budget / spent / revenue / net; budget vs spent by category; editable lines.
8. Marketing: channels (type, owner, status, target, result, cost) plus ICP, brand, growth-loop and gamification plan sections.
9. Plan: hq_plan sections as sanitised markdown, inline edit, add section.
Build every list view from ONE config-driven CRUD engine (fields, types, options, filters, grouping, formatting) with one shared table renderer and one add/edit/delete dialog.

PHASE 2 — INTEGRATIONS FRAMEWORK (build before any single connector)
Migrations:
- integrations(key pk, name, category, status 'not_connected'|'connected'|'error'|'paused', config jsonb (non-secret settings only), last_sync_at, last_error, updated_at)
- sync_log(id, integration_key, direction 'in'|'out', entity, entity_id, external_id, status 'ok'|'error', message, payload jsonb, created_at)
- external_refs(id, entity, entity_id, integration_key, external_id, external_url, unique(entity, entity_id, integration_key)): the single place that maps a Farbird row to its copy in another tool. Migrate hq_tasks.clickup_url into it and keep the column as a cached link.
- webhook_events(id, integration_key, event_type, external_id, payload jsonb, processed bool, received_at, unique(integration_key, external_id)) for idempotent inbound webhooks.
Edge Functions (Deno, supabase/functions/):
- One function per provider, named <provider>-sync (outbound + scheduled pull) and <provider>-webhook (inbound; verify the provider's signature; write to webhook_events first, then process; return 200 fast).
- A shared _shared/ module: secret loading, HMAC verification, retry with backoff, writing sync_log, upserting external_refs.
- Schedule pulls with pg_cron + pg_net (every 15 minutes by default, configurable per integration).
HQ "Integrations" view: a card per provider with status, last sync, last error, a "Sync now" button (invokes the edge function as the signed-in user; the function re-checks is_team), and the recent sync_log rows. Never display secret values; link to the Supabase dashboard to set them.

PHASE 3 — CONNECTORS (each one: migration if needed, edge functions, HQ wiring, a row in integrations, a README section listing the secrets it needs)
1. ClickUp (project management, two-way):
   - Out: create/update the matching ClickUp task when an hq_task changes (name, dates, status mapping To do/In progress/Blocked/Done, owner tag, phase tag, description link back to HQ). List chosen by workstream (folder "Farbird — Christmas 2026", lists 1-7).
   - In: ClickUp webhook (taskStatusUpdated, taskDueDateUpdated, taskUpdated, taskCreated) updates hq_tasks. Last-write-wins on updated_at; log conflicts to sync_log.
   - Secrets: CLICKUP_API_TOKEN, CLICKUP_WEBHOOK_SECRET. Config: workspace_id, folder_id, list map.
2. Stripe (payments, pre-sale):
   - New tables: customers (buyer), recipients (person in NZ, linked to customer), occasions (recipient, type, date, recurring), orders (customer, status, total_nzd, stripe ids, referral code, bundle flag), order_items (order, box, recipient, personalised name, card message, print status, courier, tracking).
   - Checkout via an edge function creating Stripe Checkout Sessions in NZD. Webhook (checkout.session.completed, charge.refunded) writes orders, writes Revenue lines to hq_finance, and converts matching waitlist rows to customers.
   - HQ: Orders view (filter by status/box/region, print queue for Lynn, pack queue for Mum, CSV for the courier).
   - Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
3. Email (Resend for transactional, plus a marketing list):
   - Waitlist confirmation with referral link, pre-sale early-access email, order confirmation, dispatch with tracking, occasion reminders at T-14 / T-7.
   - Templates stored in an email_templates table and editable in HQ; sends logged to sync_log.
   - Secrets: RESEND_API_KEY. Sender domain verified on the final brand domain.
4. Analytics (PostHog): page and funnel events on the waitlist (view, person_added, signup, share_clicked, referral_landed). HQ Overview reads funnel numbers via an edge function. Secrets: POSTHOG_PROJECT_API_KEY (public, client-side ok), POSTHOG_PERSONAL_API_KEY (server only).
5. Google Workspace: Calendar (push milestones, the last order date and each team member's due tasks to a shared "Farbird" calendar); Drive (store supplier quotes, invoices and creative; attach Drive links to suppliers, boxes and orders via external_refs). Service account or OAuth; secrets GOOGLE_SERVICE_ACCOUNT_JSON.
6. Courier (NZ Post / NZ Couriers API when an account exists): create shipments from order_items, store tracking, pull delivery status, and flag anything at risk of missing its date. Until then, CSV export/import in the Orders view.
7. Social and UGC (manual first): a ugc table (platform, url, creator, order link, reward issued) with an HQ form; the repost reward credits the customer. Instagram/TikTok APIs later behind the same integration pattern.
8. SMS reminders (Twilio, later): occasion reminders by text. Secrets TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM.
9. Design assets (Canva): store Canva design links for box sleeves, cards and social posts against boxes and channels via external_refs. No API sync needed yet.

PHASE 4 — CRM AND LOYALTY
- Customer profile page: recipients, occasions calendar, orders, referrals made, UGC posted, loyalty tier (3 purchases Good Bugger, 5 Legend, 10 EXPAT Club) and rewards issued.
- Occasions engine: a nightly pg_cron job finds occasions in the next 14 days, queues reminder emails/SMS, and shows an "Upcoming occasions" panel in HQ.
- Referral ledger: credits given and used per customer (give NZ$15 / get NZ$15; NZ$10 repost credit).

QUALITY BAR (every phase)
- Mock Supabase and every provider locally; screenshot every view at 1366px and 390px with Playwright; fix overlaps, clipped text and console errors.
- Test each edge function with sample webhook payloads (including a bad signature and a duplicate event).
- Run Supabase security advisors after each migration and fix findings except intended public RPCs (join_waitlist, waitlist_count).
- Update CLAUDE.md and README (secrets per connector, how to reconnect), commit, push to main (Pages deploys), then open the live HQ and confirm no console errors.
```
