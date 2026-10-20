# Farbird

Christmas gifts home, sorted. Personalised NZ gift boxes for Kiwis abroad.

| Part | File | Who sees it |
| --- | --- | --- |
| Waitlist page | `index.html` | Public |
| Farbird HQ (plan, tasks, CRM) | `hq/index.html` | Team only (magic-link sign-in) |
| Database | Supabase `farbird` (Sydney) | Via the two pages |

## Go live (about 15 minutes)

1. **Push this repo to GitHub** (private is fine for Pages on paid plans; public works on free).
2. **Turn on GitHub Pages:** repo Settings → Pages → Source: GitHub Actions. The workflow in `.github/workflows/pages.yml` deploys on every push to `main`.
   - Waitlist: `https://<you>.github.io/farbird/`
   - HQ: `https://<you>.github.io/farbird/hq/`
3. **Tell Supabase where HQ lives** (needed for sign-in links): Supabase dashboard → Authentication → URL Configuration
   - Site URL: your waitlist URL
   - Redirect URLs: add `https://<you>.github.io/farbird/hq/` (and your custom domain's `/hq/` later)
4. **Sign in to HQ** with the email listed in `team_members`.
5. **Add the team** (Supabase → SQL editor):
   ```sql
   insert into public.team_members (email, name, role) values
     ('mum@example.com', 'Mum', 'NZ Operations'),
     ('lauren@example.com', 'Lauren', 'Brand & Creative'),
     ('lynn@example.com', 'Lynn', 'Print & Packaging');
   ```
6. **Clear the four test signups** made while testing:
   ```sql
   delete from public.waitlist where email like 'test%+farbird@example.com';
   ```
7. **Custom domain** (once the name is final): add a `CNAME` file with the domain, point DNS at GitHub Pages, then add the new HQ URL to Supabase redirect URLs.

## Sharing links

- Referral: every signup gets `?ref=<code>`; referrals are credited automatically.
- Campaign tracking: add `?utm_source=kea&utm_campaign=xmas` (or `?src=flatwhite-nyc`). It shows in HQ → Waitlist.

## Integrations

Every outside tool connects through Supabase Edge Functions. API keys live in **Supabase → Edge Functions → Secrets** and never touch the browser.

| Piece | Where |
| --- | --- |
| Tool list, status, settings | `integrations` table, shown in HQ → Integrations |
| What happened | `sync_log` (kept 90 days) |
| Farbird row ↔ other tool's record | `external_refs` (ClickUp task links already moved here) |
| Inbound webhooks, stored once | `webhook_events` (unique per tool + event id) |
| Status, Sync now, self-test | `supabase/functions/integrations-status` |
| Scheduler (pg_cron every 5 min) | `supabase/functions/integrations-cron` |
| Shared helpers | `supabase/functions/_shared/` (auth, secrets, logging, retry, webhook signatures, dispatch) |
| Tool list (source of truth) | `_shared/registry.ts`: name, phase, owner, cost, account link, sync or manual. Applied to `integrations` on every status check |

**Connect a tool:** add its secrets in Supabase, open HQ → Integrations → Check connections, then Sync now. Tick "Scheduled sync" to run it on its interval.

| Tool | Secrets |
| --- | --- |
| ClickUp | `CLICKUP_API_TOKEN` (the webhook secret is created and stored in Vault automatically) |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Resend | `RESEND_API_KEY` |
| PostHog | `POSTHOG_PERSONAL_API_KEY` |
| Google Workspace | `GOOGLE_SERVICE_ACCOUNT_JSON` |
| NZ courier | `COURIER_API_KEY` |
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` |

**Manual tools** (GitHub, Cloudflare, Sentry, Canva and so on) have no sync. Their card shows owner, cost, an Open link and an "Account set up" tick.

### ClickUp (live)

1. ClickUp → Settings → Apps → API Token → Generate. Copy it.
2. Supabase → Edge Functions → Secrets → add `CLICKUP_API_TOKEN`.
3. HQ → Integrations → ClickUp → Sync now. The first run registers a webhook on the Farbird folder and saves its signing secret to Vault.

After that: saving a task in HQ pushes it to ClickUp; edits in ClickUp arrive by webhook within seconds; the scheduler reconciles every 15 minutes. Last write wins and conflicts are logged. Status mapping: To do ↔ to do, In progress/Blocked ↔ in progress (Blocked adds a `blocked` tag), Done ↔ complete. Owners and phases are tags.

**Test leftovers to clear once** (the MCP can't run deletes): `delete from webhook_events where external_id like 'selftest:%'; delete from waitlist where email like '%@example.com';`

**Add a connector:** deploy `<key>-sync` (and `<key>-webhook` if the tool sends events) using `_shared/`. The dispatcher finds it by name; until it exists, Sync now reports "isn't built yet".

**Tests:** `deno test --allow-env supabase/functions/_shared/` (signatures, retry, scheduling, ClickUp mapping and a full sync simulation). HQ → Integrations → Run self-test checks the live database path.

## How it's secured

- The public key in the HTML can only call `join_waitlist()` and `waitlist_count()`. Row-level security returns nothing to anonymous reads.
- HQ tables allow read/write only for emails in `team_members`.
