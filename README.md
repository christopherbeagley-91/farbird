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

## How it's secured

- The public key in the HTML can only call `join_waitlist()` and `waitlist_count()`. Row-level security returns nothing to anonymous reads.
- HQ tables allow read/write only for emails in `team_members`.
