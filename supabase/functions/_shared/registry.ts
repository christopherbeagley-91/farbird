// The Farbird tool stack, declared in code. integrations-status applies this to the
// public.integrations table, so adding or changing a tool is a code change + deploy.
//
// kind: "sync"   = has (or will have) a <key>-sync Edge Function and API keys in Supabase secrets
//       "manual" = an account we use by hand; HQ shows an Open link and a "Set up" switch
// decision: "now" | "before pre-sale" | "later" (tools we skipped live in the Plan, not here)

export type Tool = {
  key: string;
  name: string;
  category: string;
  description: string;
  phase: "Now" | "Before pre-sale" | "After Christmas" | "Later";
  kind: "sync" | "manual";
  required_secrets: string[];
  sync_every_minutes: number;
  sort: number;
  account_url: string;
  monthly_cost_nzd: number; // 0 = free tier
  cost_note: string;
  owner: string;
  config?: Record<string, unknown>; // defaults merged into config (existing values win)
  enabled_by_default?: boolean; // scheduled sync switched on when the row is first created
};

export const REGISTRY: Tool[] = [
  // --- Build and run ---
  { key: "clickup", name: "ClickUp", category: "Project management", phase: "Now", kind: "sync", sort: 1,
    description: "Two-way task sync with the Farbird — Christmas 2026 folder. ClickUp edits arrive instantly; HQ edits push on save and every 15 minutes.",
    required_secrets: ["CLICKUP_API_TOKEN"], sync_every_minutes: 15, owner: "Chris",
    account_url: "https://app.clickup.com/9017657384/v/f/901711976388", monthly_cost_nzd: 0, cost_note: "Free plan",
    config: { workspace_id: "9017657384", folder_id: "901711976388", default_list: "901717881420", webhook_id: null, last_pull_at: null,
      lists: { "Finance & Legal": "901717881420", "Brand": "901717881421", "Product & Suppliers": "901717881422", "Print & Packaging": "901717881423",
        "Waitlist & Tech": "901717881424", "Marketing": "901717881425", "Partnerships": "901717881425", "Ops": "901717881426", "General": "901717881420" } } },
  { key: "claude", name: "Claude", category: "Planning and building", phase: "Now", kind: "manual", sort: 2,
    description: "Plans, writes and builds Farbird (HQ, waitlist, connectors). API access later for AI gift picks.",
    required_secrets: [], sync_every_minutes: 1440, owner: "Chris",
    account_url: "https://claude.ai", monthly_cost_nzd: 34, cost_note: "About US$20/mo" },
  { key: "github", name: "GitHub", category: "Code and hosting", phase: "Now", kind: "manual", sort: 3,
    description: "Version control and free hosting for the waitlist and HQ (GitHub Pages). Every push deploys.",
    required_secrets: [], sync_every_minutes: 1440, owner: "Chris",
    account_url: "https://github.com/christopherbeagley-91/farbird", monthly_cost_nzd: 0, cost_note: "Free" },
  { key: "supabase", name: "Supabase", category: "Database and backend", phase: "Now", kind: "manual", sort: 4,
    description: "Database, sign-in, Edge Functions and secrets. Free plan pauses after a week without activity; move to Pro before pre-sale.",
    required_secrets: [], sync_every_minutes: 1440, owner: "Chris",
    account_url: "https://supabase.com/dashboard/project/fmrabsrgdwqhyxcjnfgt", monthly_cost_nzd: 0, cost_note: "Free; Pro about US$25/mo" },
  { key: "cloudflare", name: "Cloudflare", category: "Domain and DNS", phase: "Now", kind: "manual", sort: 5,
    description: "Buy the domain at cost and run DNS, pointing it at GitHub Pages. Also sells .co.nz.",
    required_secrets: [], sync_every_minutes: 1440, owner: "Chris",
    account_url: "https://dash.cloudflare.com", monthly_cost_nzd: 4, cost_note: "Domains only, about NZ$45/yr" },
  { key: "agents", name: "Farbird agents", category: "AI agents", phase: "Now", kind: "sync", sort: 6,
    description: "Finance, Marketing and Operations agents (panels on Financials, Marketing and Waitlist). Hourly: daily marketing plan and ops check at 8am NZ, finance report Mondays 8am NZ, approved posts sent to Metricool.",
    required_secrets: ["ANTHROPIC_API_KEY"], sync_every_minutes: 60, owner: "Chris",
    account_url: "https://console.anthropic.com", monthly_cost_nzd: 25, cost_note: "Claude API usage, roughly NZ$10–40/mo at this volume",
    enabled_by_default: true,
    config: { marketing: { autopilot: true, channels: ["instagram", "tiktok", "facebook"] }, finance: {}, ops: {} } },

  // --- Sell and talk to customers ---
  { key: "shopify", name: "Shopify", category: "Shop", phase: "Before pre-sale", kind: "manual", sort: 9,
    description: "The shop: product pages, checkout and Shopify Payments in NZD. Orders connector to HQ comes next.",
    required_secrets: [], sync_every_minutes: 1440, owner: "Chris",
    account_url: "https://admin.shopify.com", monthly_cost_nzd: 66, cost_note: "Basic, about US$39/mo; cards 3.3% + NZ$0.30 (international)" },
  { key: "stripe", name: "Stripe", category: "Payments", phase: "Before pre-sale", kind: "sync", sort: 10,
    description: "Backup only: Shopify Payments replaces Stripe checkout. Keep for HQ revenue sync if needed.",
    required_secrets: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"], sync_every_minutes: 60, owner: "Chris",
    account_url: "https://dashboard.stripe.com", monthly_cost_nzd: 0, cost_note: "Per sale: 3.5% + NZ$0.30" },
  { key: "resend", name: "Resend", category: "Email", phase: "Before pre-sale", kind: "sync", sort: 11,
    description: "Waitlist confirmation, early access, order, dispatch and birthday reminder emails. Free plan caps at 100 a day.",
    required_secrets: ["RESEND_API_KEY"], sync_every_minutes: 60, owner: "Chris",
    account_url: "https://resend.com/overview", monthly_cost_nzd: 0, cost_note: "Free to 3,000/mo, 100/day" },
  { key: "posthog", name: "PostHog", category: "Analytics", phase: "Before pre-sale", kind: "sync", sort: 12,
    description: "Waitlist and checkout funnel, shown on the HQ overview.",
    required_secrets: ["POSTHOG_PERSONAL_API_KEY"], sync_every_minutes: 60, owner: "Chris",
    account_url: "https://app.posthog.com", monthly_cost_nzd: 0, cost_note: "Free tier" },
  { key: "sentry", name: "Sentry", category: "Error tracking", phase: "Before pre-sale", kind: "manual", sort: 13,
    description: "Alerts when the waitlist, checkout or HQ breaks, so a failed order doesn't go unnoticed.",
    required_secrets: [], sync_every_minutes: 1440, owner: "Chris",
    account_url: "https://sentry.io", monthly_cost_nzd: 0, cost_note: "Free tier" },

  // --- Marketing channels ---
  { key: "instagram", name: "Instagram", category: "Social", phase: "Now", kind: "manual", sort: 20,
    description: "Unboxing content, creator collabs and PR-box look. Lauren's main channel.",
    required_secrets: [], sync_every_minutes: 1440, owner: "Lauren",
    account_url: "https://www.instagram.com", monthly_cost_nzd: 0, cost_note: "Free" },
  { key: "tiktok", name: "TikTok", category: "Social", phase: "Now", kind: "manual", sort: 21,
    description: "Short unboxing and \"forgot Mum's birthday\" content for the last-minute son.",
    required_secrets: [], sync_every_minutes: 1440, owner: "Lauren",
    account_url: "https://www.tiktok.com", monthly_cost_nzd: 0, cost_note: "Free" },
  { key: "reddit", name: "Reddit", category: "Community", phase: "Now", kind: "manual", sort: 22,
    description: "Founder story and gifting questions in r/newzealand and expat subs. Read each sub's self-promotion rules first.",
    required_secrets: [], sync_every_minutes: 1440, owner: "Chris",
    account_url: "https://www.reddit.com/r/newzealand", monthly_cost_nzd: 0, cost_note: "Free" },
  { key: "metricool", name: "Metricool", category: "Social scheduling", phase: "Now", kind: "manual", sort: 19,
    description: "Schedules and publishes Instagram, TikTok and Facebook posts for the Marketing agent, and reports results. API needs the Advanced plan; add METRICOOL_API_TOKEN, METRICOOL_USER_ID and METRICOOL_BLOG_ID in Supabase secrets.",
    required_secrets: [], sync_every_minutes: 1440, owner: "Lauren",
    account_url: "https://app.metricool.com", monthly_cost_nzd: 114, cost_note: "Advanced plan (API), about US$67/mo billed monthly" },
  { key: "canva", name: "Canva", category: "Design", phase: "Now", kind: "manual", sort: 23,
    description: "Sleeves, cards and social posts. Store design links against boxes and channels.",
    required_secrets: [], sync_every_minutes: 1440, owner: "Lauren",
    account_url: "https://www.canva.com", monthly_cost_nzd: 0, cost_note: "Free or existing plan" },
  { key: "ugc", name: "Social and UGC", category: "Marketing", phase: "After Christmas", kind: "manual", sort: 24,
    description: "Unboxing posts logged in HQ; repost rewards. Manual first, APIs later.",
    required_secrets: [], sync_every_minutes: 1440, owner: "Lauren",
    account_url: "https://www.instagram.com", monthly_cost_nzd: 0, cost_note: "Free" },
  { key: "substack", name: "Substack", category: "Newsletter", phase: "After Christmas", kind: "manual", sort: 25,
    description: "\"Letters home\" founder newsletter to build an audience between drops. Resend stays for order emails.",
    required_secrets: [], sync_every_minutes: 1440, owner: "Chris",
    account_url: "https://substack.com", monthly_cost_nzd: 0, cost_note: "Free" },

  // --- Operations and later ---
  { key: "google", name: "Google Workspace", category: "Calendar and files", phase: "After Christmas", kind: "sync", sort: 30,
    description: "Shared Farbird calendar for milestones; Drive links for quotes, invoices and creative.",
    required_secrets: ["GOOGLE_SERVICE_ACCOUNT_JSON"], sync_every_minutes: 60, owner: "Chris",
    account_url: "https://workspace.google.com", monthly_cost_nzd: 0, cost_note: "Existing account" },
  { key: "courier", name: "NZ courier", category: "Fulfilment", phase: "After Christmas", kind: "sync", sort: 31,
    description: "Shipments and tracking once a courier account exists. CSV export until then.",
    required_secrets: ["COURIER_API_KEY"], sync_every_minutes: 60, owner: "Mum",
    account_url: "https://www.nzpost.co.nz/business", monthly_cost_nzd: 0, cost_note: "Per parcel" },
  { key: "claude-api", name: "Claude API", category: "AI features", phase: "Later", kind: "sync", sort: 40,
    description: "AI gift picks and card-message help on the website, called from an Edge Function so the key stays private.",
    required_secrets: ["ANTHROPIC_API_KEY"], sync_every_minutes: 1440, owner: "Chris",
    account_url: "https://console.anthropic.com", monthly_cost_nzd: 0, cost_note: "Pay per use" },
  { key: "elevenlabs", name: "ElevenLabs", category: "Voice", phase: "Later", kind: "sync", sort: 41,
    description: "Optional: turn a typed card message into a voice note behind the QR code, for senders who won't record video.",
    required_secrets: ["ELEVENLABS_API_KEY"], sync_every_minutes: 1440, owner: "Chris",
    account_url: "https://elevenlabs.io", monthly_cost_nzd: 0, cost_note: "Free tier, then paid" },
  { key: "twilio", name: "Twilio", category: "SMS", phase: "Later", kind: "sync", sort: 42,
    description: "Birthday and occasion reminders by text.",
    required_secrets: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"], sync_every_minutes: 60, owner: "Chris",
    account_url: "https://console.twilio.com", monthly_cost_nzd: 0, cost_note: "Per message" },
];

export const META_KEYS = ["kind", "account_url", "monthly_cost_nzd", "cost_note", "owner"] as const;

/** Builds the insert/patch for one tool, keeping runtime state (status, enabled, sync times, saved config). */
export function rowFor(tool: Tool, existing?: { config?: Record<string, unknown> } | null) {
  const current = existing?.config ?? {};
  const config: Record<string, unknown> = { ...(tool.config ?? {}), ...current };
  for (const k of META_KEYS) config[k] = tool[k];
  return {
    key: tool.key,
    name: tool.name,
    category: tool.category,
    description: tool.description,
    phase: tool.phase,
    required_secrets: tool.required_secrets,
    sync_every_minutes: tool.sync_every_minutes,
    sort: tool.sort,
    config,
  };
}
