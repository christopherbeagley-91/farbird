// Farbird agents: Finance, Marketing and Operations.
// Each agent = a role prompt + a set of tools over HQ data (and connected services) + the Claude API tool loop.
// Used by `agent` (HQ chat, status reports, settings) and `agents-sync` (scheduled runs, auto-scheduling posts).
import type { Db } from "./supabase.ts";
import { fetchWithRetry } from "./retry.ts";

export type AgentKey = "finance" | "marketing" | "ops";
export const AGENT_KEYS: AgentKey[] = ["finance", "marketing", "ops"];
export const MODEL = "claude-sonnet-5-5";
const NZ = "Pacific/Auckland";

export type AgentSettings = { autopilot?: boolean; channels?: string[] };
export type Ctx = { db: Db; agent: AgentKey; settings: AgentSettings; now: Date };

// ---------- Time (NZ) ----------
export function nzParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-NZ", { timeZone: NZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false, weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: p.weekday as string };
}
export function nzLabel(d: Date) {
  return new Intl.DateTimeFormat("en-NZ", { timeZone: NZ, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

// ---------- Connections ----------
export type Connection = { name: string; ok: boolean; needs?: string; note: string; required: boolean };
const has = (k: string) => !!Deno.env.get(k);
export const metricoolReady = () => has("METRICOOL_API_TOKEN") && has("METRICOOL_USER_ID") && has("METRICOOL_BLOG_ID");

export function connections(agent: AgentKey): Connection[] {
  const claude: Connection = { name: "Claude API", ok: has("ANTHROPIC_API_KEY"), needs: "ANTHROPIC_API_KEY", required: true, note: "The agent's brain" };
  const hq: Connection = { name: "Farbird HQ data", ok: true, required: true, note: "Tasks, plan, suppliers, finance, waitlist" };
  if (agent === "finance") return [claude, hq,
    { name: "Stripe", ok: has("STRIPE_SECRET_KEY"), needs: "STRIPE_SECRET_KEY", required: false, note: "Live sales, refunds and payouts" },
    { name: "Shopify", ok: has("SHOPIFY_ADMIN_TOKEN") && has("SHOPIFY_STORE_DOMAIN"), needs: "SHOPIFY_ADMIN_TOKEN, SHOPIFY_STORE_DOMAIN", required: false, note: "Orders and sales from the shop" },
    { name: "Xero", ok: false, required: false, note: "Books, P&L and bills. Connect once Xero is set up" }];
  if (agent === "marketing") return [claude, hq,
    { name: "Metricool", ok: metricoolReady(), needs: "METRICOOL_API_TOKEN, METRICOOL_USER_ID, METRICOOL_BLOG_ID", required: true, note: "Schedules Instagram, TikTok and Facebook posts (Advanced plan for API)" },
    { name: "PostHog", ok: has("POSTHOG_PERSONAL_API_KEY"), needs: "POSTHOG_PERSONAL_API_KEY", required: false, note: "Waitlist funnel and traffic sources" },
    { name: "Canva", ok: false, required: false, note: "Visuals are made in Canva from the agent's briefs; paste the image link into the post" }];
  return [claude, hq,
    { name: "Shopify", ok: has("SHOPIFY_ADMIN_TOKEN") && has("SHOPIFY_STORE_DOMAIN"), needs: "SHOPIFY_ADMIN_TOKEN, SHOPIFY_STORE_DOMAIN", required: false, note: "Orders, from pre-sale" },
    { name: "Resend", ok: has("RESEND_API_KEY"), needs: "RESEND_API_KEY", required: false, note: "Customer emails and reminders" },
    { name: "Starshipit", ok: has("STARSHIPIT_API_KEY"), needs: "STARSHIPIT_API_KEY", required: false, note: "Courier labels and tracking" },
    { name: "Gmail (hello@)", ok: false, required: false, note: "Customer enquiries. Connect once hello@farbird.co exists" }];
}

// ---------- Prompts ----------
const BASE = (now: Date) => `You are part of the Farbird team, working inside Farbird HQ.
Farbird sends personalised NZ gift boxes for Kiwis living overseas: the recipient's name is printed on the sleeve, the sender's card is inside, packed in Auckland and delivered anywhere in NZ, with reminders for NZ dates. Each box has one hero item that is trending overseas plus international treats.
Christmas 2026 test: waitlist open, pre-sale 9 November, last order date Saturday 12 December, go/kill decision 16 January 2027. Shop: Shopify (being set up).
Team: Chris (GTM, P&L, tech, lives in New York), Mum (NZ ops, suppliers, courier, packing), Lauren (brand, creative, influencers), Lynn (print and packaging), Emily (design and logo).
It is now ${nzLabel(now)} in New Zealand. Money is NZD. Dates are NZ dates.
Rules: get every number from a tool and say where it came from; never invent figures, suppliers or results; if data is missing, say exactly what is missing and who can fix it. Never show customer emails or full names of the people customers buy for. You cannot pay, refund, delete or email anyone.
Write like a sharp colleague: lead with the answer, short sentences, sentence case, plain English, bullets or a small table only when they help. Name the person who should act.`;

const ROLES: Record<AgentKey, string> = {
  finance: `You are the Finance agent. You own the numbers: budget vs spend, revenue, gross profit per box, breakeven progress, cash, bills to pay, GST and the go/kill numbers for 16 January.
Targets: at least NZ$20 gross profit per box; NZ$89 Christmas box leaves about NZ$40 for items after packaging (~NZ$8), courier (~NZ$10-12) and card fees (overseas cards ~3.3% + 30c on Shopify Payments).
Weekly report format: headline (one line), numbers table (spent, budget left, revenue, boxes sold, gross profit per box, % to breakeven), three things to act on with owners.`,
  marketing: `You are the Marketing agent. You plan, write and schedule organic social content for Instagram (@farbird.nz), TikTok (@farbirdnz) and Facebook, track what drives waitlist sign-ups, and recommend paid tests (you cannot spend money).
Audience: Kiwi blokes aged 20-35 living overseas (London, Sydney, Melbourne, New York, Toronto) who love their mum, aren't creative about presents and leave it late. Partners and sisters buy too.
Brand line: "Sorted before you forget." Headline: "Mum will think you planned this." Idea: last minute on your end, thoughtful on theirs.
Voice: dry Kiwi humour, warm, never cheesy. One joke per post at most. Sentence case. Specific beats clever. Gently roast the guy who forgot; never make him feel bad.
Never use: elevate, curated, seamless, journey, unlock, loved ones, hamper, premium, artisanal, "more than just a gift", "bridging the distance", three-word staccato stacks, Kiwi caricature ("chur bro"), te reo as decoration.
Content pillars: (1) the guy who forgot (POV, time-zone panic), (2) Mum packing in Auckland and the reveal (founders appear on socials, not the website), (3) the boxes and their trending hero items, (4) NZ dates vs local dates, (5) sibling rivalry ("my sister sent flowers").
Visual briefs: Kiwiana palette, pohutukawa red (Mum), bush green (Dad), kowhai (Sibling), fig and blush (Partner), jandal blue (Kids), on a clear sky blue. Real photos only: no stock, no AI faces. Printed things have square corners.
Every post you draft needs: channel, NZ post time, caption (with a soft call to join the waitlist or order), and a visual brief Lauren or Emily can make in Canva. TikTok and Instagram need an image or video before they can go out; Facebook can go text-only.`,
  ops: `You are the Operations agent ("Dispatch"). You watch the customer side and the work: waitlist growth, the people customers are buying for and their upcoming dates, supplier progress (accounts, trade terms, samples), overdue tasks by owner, and the health of connected tools.
From pre-sale you will also handle orders, courier labels, tracking and customer enquiries, once Shopify, Starshipit, Resend and the hello@ inbox are connected; until then say plainly that they aren't connected yet.
Daily check format: what changed, what's late (by owner), what needs a decision, under 150 words.`,
};

export function systemPrompt(agent: AgentKey, now: Date, settings: AgentSettings): string {
  let extra = "";
  if (agent === "marketing") {
    extra = `\nAutopilot is ${settings.autopilot ? "ON: posts that pass the brand audit are approved automatically and scheduled to Metricool as soon as they have an image or video (Facebook text posts go straight away)" : "OFF: your drafts wait for Lauren to approve them in HQ"}.
Metricool is ${metricoolReady() ? "connected" : "NOT connected yet, so nothing can be scheduled; say so"}.`;
  }
  return `${BASE(now)}\n\n${ROLES[agent]}${extra}`;
}

export const SCHEDULED: Record<AgentKey, { due: (p: ReturnType<typeof nzParts>) => boolean; prompt: string }> = {
  marketing: {
    due: (p) => p.hour >= 8,
    prompt: `Daily run. 1) Look at the content queue for the next 3 days and the waitlist stats. 2) Draft posts so each of Instagram, TikTok and Facebook has one post per day for the next 3 days (skip any slot already filled). Vary the pillars and the boxes and tie them to the Christmas timeline. 3) Reply in under 120 words: what you drafted, what is waiting for an image or video (and who should make it), and one waitlist trend worth acting on.`,
  },
  finance: {
    due: (p) => p.weekday === "Mon" && p.hour >= 8,
    prompt: `Weekly numbers report for the team, in your weekly report format. Include breakeven progress and anything over budget.`,
  },
  ops: {
    due: (p) => p.hour >= 8,
    prompt: `Daily ops check in your daily check format.`,
  },
};

// ---------- Brand audit (deterministic first pass) ----------
const BANNED = ["elevate", "curated", "seamless", "journey", "unlock", "loved ones", "hamper", "premium", "artisanal", "more than just a gift", "bridging the distance", "chur", "sweet as"];
export function auditCaption(caption: string, channel: string, mediaUrl?: string | null) {
  const issues: string[] = [];
  const lower = caption.toLowerCase();
  for (const w of BANNED) if (lower.includes(w)) issues.push(`Uses banned phrase "${w}"`);
  const first = caption.split("\n")[0];
  if (/!/.test(first)) issues.push("Exclamation mark in the opening line");
  if (/^([A-Z][a-z]+\.\s){2,}[A-Z][a-z]+\./.test(first.trim())) issues.push("Three-word staccato opening");
  const words = first.split(/\s+/).filter((w) => /^[A-Z]{2,}$/.test(w) && !["NZ", "NZD", "POV", "UK", "US"].includes(w));
  if (words.length > 1) issues.push("Shouting in capitals");
  if (caption.length > 2200) issues.push("Too long for Instagram (2,200 characters)");
  if (channel === "tiktok" && caption.length > 2200) issues.push("Too long for TikTok");
  const needsMedia = channel !== "facebook" && !mediaUrl;
  return { pass: issues.length === 0, issues, needs_media: needsMedia, checked_at: new Date().toISOString() };
}

// ---------- Metricool ----------
const MC = "https://app.metricool.com/api";
function nzLocalIso(d: Date) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: NZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}:${p.second}`;
}

/** Schedules one queue item in Metricool. Field names follow Metricool's v2 scheduler API; check the first real post. */
export async function metricoolSchedule(item: { channel: string; caption: string; media_url: string | null; post_at: string | null }): Promise<string> {
  const token = Deno.env.get("METRICOOL_API_TOKEN")!, userId = Deno.env.get("METRICOOL_USER_ID")!, blogId = Deno.env.get("METRICOOL_BLOG_ID")!;
  const qs = `userId=${encodeURIComponent(userId)}&blogId=${encodeURIComponent(blogId)}`;
  const headers = { "X-Mc-Auth": token, "Content-Type": "application/json" };
  const media: string[] = [];
  if (item.media_url) {
    const r = await fetchWithRetry(`${MC}/actions/normalize/image/url?url=${encodeURIComponent(item.media_url)}&${qs}`, { headers }, { retries: 2 });
    const t = (await r.text()).trim();
    if (!r.ok) throw new Error(`Metricool couldn't take the image (${r.status}): ${t.slice(0, 200)}`);
    let v: unknown = t; try { v = JSON.parse(t); } catch { /* plain text */ }
    media.push(typeof v === "string" ? v : String((v as Record<string, unknown>).url ?? (v as Record<string, unknown>).mediaId ?? t));
  }
  const when = item.post_at ? new Date(item.post_at) : new Date(Date.now() + 30 * 60_000);
  const body: Record<string, unknown> = {
    text: item.caption,
    providers: [{ network: item.channel }],
    publicationDate: { dateTime: nzLocalIso(when < new Date() ? new Date(Date.now() + 15 * 60_000) : when), timezone: NZ },
    autoPublish: true,
    draft: false,
    ...(media.length ? { media } : {}),
  };
  const res = await fetchWithRetry(`${MC}/v2/scheduler/posts?${qs}`, { method: "POST", headers, body: JSON.stringify(body) }, { retries: 2 });
  const text = await res.text();
  if (!res.ok) throw new Error(`Metricool rejected the post (${res.status}): ${text.slice(0, 300)}`);
  try { const j = JSON.parse(text); return String(j.data?.id ?? j.id ?? "scheduled"); } catch { return "scheduled"; }
}

/** Sends every eligible Approved post to Metricool. Deterministic: no AI involved. */
export async function pushApproved(db: Db): Promise<{ scheduled: number; failed: number; waiting: number; note?: string }> {
  const { data } = await db.from("content_queue").select("*").eq("status", "Approved").order("post_at", { ascending: true }).limit(20);
  const items = data ?? [];
  const ready = items.filter((i) => i.channel === "facebook" || i.media_url);
  const out = { scheduled: 0, failed: 0, waiting: items.length - ready.length } as { scheduled: number; failed: number; waiting: number; note?: string };
  if (!ready.length) return out;
  if (!metricoolReady()) { out.note = "Metricool not connected"; out.waiting += ready.length; return out; }
  for (const i of ready) {
    try {
      const id = await metricoolSchedule(i);
      await db.from("content_queue").update({ status: "Scheduled", external_id: id, last_error: null }).eq("id", i.id);
      out.scheduled++;
    } catch (e) {
      await db.from("content_queue").update({ status: "Failed", last_error: (e as Error).message.slice(0, 500) }).eq("id", i.id);
      out.failed++;
    }
  }
  return out;
}

// ---------- Tools ----------
type Tool = { name: string; description: string; input_schema: Record<string, unknown>; agents: AgentKey[]; run: (ctx: Ctx, input: any) => Promise<unknown> };
const obj = (props: Record<string, unknown> = {}, required: string[] = []) => ({ type: "object", properties: props, required });
const today = (ctx: Ctx) => nzParts(ctx.now).date;

async function waitlistStats(ctx: Ctx, input: { days?: number }) {
  const days = Math.min(Math.max(input.days ?? 14, 1), 90);
  const { data: wl, error } = await ctx.db.from("waitlist").select("created_at, country, referred_by, source, utm_source, utm_campaign");
  if (error) return { error: error.message };
  const { data: ppl } = await ctx.db.from("waitlist_people").select("relationship");
  const rows = wl ?? [];
  const since = Date.now() - days * 864e5;
  const count = (arr: any[], k: string) => arr.reduce((o: Record<string, number>, r) => { const v = r[k] || "(none)"; o[v] = (o[v] || 0) + 1; return o; }, {});
  const byDay: Record<string, number> = {};
  rows.filter((r) => Date.parse(r.created_at) >= since).forEach((r) => { const d = nzParts(new Date(r.created_at)).date; byDay[d] = (byDay[d] || 0) + 1; });
  return {
    total_signups: rows.length,
    last_7_days: rows.filter((r) => Date.parse(r.created_at) >= Date.now() - 7 * 864e5).length,
    by_day: byDay, by_country: count(rows, "country"), by_utm_source: count(rows, "utm_source"), by_source: count(rows, "source"),
    joined_via_referral: rows.filter((r) => r.referred_by).length,
    recipients_total: (ppl ?? []).length, recipients_by_relationship: count(ppl ?? [], "relationship"),
    note: "Includes any test sign-ups (emails ending example.com are tests).",
  };
}

const TOOLS: Tool[] = [
  { name: "list_tasks", agents: ["finance", "marketing", "ops"],
    description: "HQ tasks with owner, status and dates. Filter by workstream, owner, open only, or overdue only.",
    input_schema: obj({ workstream: { type: "string" }, owner: { type: "string" }, open_only: { type: "boolean" }, overdue_only: { type: "boolean" } }),
    run: async (ctx, i) => {
      let q = ctx.db.from("hq_tasks").select("title, workstream, phase, owner, status, start_date, due_date").order("due_date", { ascending: true }).limit(80);
      if (i.workstream) q = q.eq("workstream", i.workstream);
      if (i.owner) q = q.ilike("owner", `%${i.owner}%`);
      if (i.open_only || i.overdue_only) q = q.neq("status", "Done");
      if (i.overdue_only) q = q.lt("due_date", today(ctx));
      const { data, error } = await q; return error ? { error: error.message } : data;
    } },
  { name: "read_plan", agents: ["finance", "marketing", "ops"],
    description: "The HQ business plan. With no key, lists the sections. With a key, returns that section's text.",
    input_schema: obj({ key: { type: "string" } }),
    run: async (ctx, i) => {
      if (!i.key) { const { data } = await ctx.db.from("hq_plan").select("key, title").order("sort"); return data; }
      const { data } = await ctx.db.from("hq_plan").select("title, body, updated_at").eq("key", i.key).maybeSingle();
      return data ? { ...data, body: String(data.body).slice(0, 8000) } : { error: "No such section" };
    } },
  { name: "list_suppliers", agents: ["finance", "ops"],
    description: "Suppliers with category, status (Prospect, Contacted, Quoted, Sampling, Approved, Rejected), owner, MOQ, unit cost and notes.",
    input_schema: obj({ category: { type: "string" }, status: { type: "string" } }),
    run: async (ctx, i) => {
      let q = ctx.db.from("hq_suppliers").select("name, category, status, owner, unit_cost_nzd, moq, lead_time_days, notes");
      if (i.category) q = q.eq("category", i.category);
      if (i.status) q = q.eq("status", i.status);
      const { data, error } = await q; return error ? { error: error.message } : (data ?? []).map((s) => ({ ...s, notes: s.notes?.slice(0, 300) }));
    } },
  { name: "finance_summary", agents: ["finance", "ops"],
    description: "Budget, actual spend and revenue by category, the box range with price and cost of goods, and breakeven maths.",
    input_schema: obj(),
    run: async (ctx) => {
      const { data: lines } = await ctx.db.from("hq_finance").select("kind, category, item, amount_nzd, entry_date");
      const { data: boxes } = await ctx.db.from("hq_boxes").select("name, tier, price_nzd, cogs_nzd, status");
      const sum = (k: string) => (lines ?? []).filter((l) => l.kind === k).reduce((s, l) => s + Number(l.amount_nzd || 0), 0);
      const byCat: Record<string, Record<string, number>> = {};
      (lines ?? []).forEach((l) => { byCat[l.category] ||= {}; byCat[l.category][l.kind] = (byCat[l.category][l.kind] || 0) + Number(l.amount_nzd || 0); });
      const costed = (boxes ?? []).filter((b) => b.price_nzd && b.cogs_nzd);
      const gp = costed.length ? costed.reduce((s, b) => s + (b.price_nzd - b.cogs_nzd), 0) / costed.length : null;
      const budget = sum("Budget"), spent = sum("Actual cost"), revenue = sum("Revenue");
      const costs = Math.max(budget, spent);
      return {
        totals: { budget, spent, revenue, budget_left: budget - spent }, by_category: byCat, boxes,
        breakeven: { costs_to_cover: costs, gross_profit_per_box: gp, gross_profit_basis: gp === null ? "No box has cost of goods yet; the HQ default assumption is NZ$25" : `Average of ${costed.length} costed boxes`,
          boxes_needed: Math.ceil(costs / (gp ?? 25)), customers_needed_at_1_6_boxes: Math.ceil(Math.ceil(costs / (gp ?? 25)) / 1.6) },
      };
    } },
  { name: "stripe_summary", agents: ["finance"],
    description: "Live Stripe balance and charges over the last N days (if Stripe is connected).",
    input_schema: obj({ days: { type: "number" } }),
    run: async (_ctx, i) => {
      const key = Deno.env.get("STRIPE_SECRET_KEY");
      if (!key) return { connected: false, note: "Add STRIPE_SECRET_KEY in Supabase secrets (or connect Shopify) to see live sales." };
      const h = { Authorization: `Bearer ${key}` };
      const since = Math.floor((Date.now() - (i.days ?? 30) * 864e5) / 1000);
      const [b, c] = await Promise.all([
        fetchWithRetry("https://api.stripe.com/v1/balance", { headers: h }).then((r) => r.json()),
        fetchWithRetry(`https://api.stripe.com/v1/charges?limit=100&created[gte]=${since}`, { headers: h }).then((r) => r.json()),
      ]);
      const charges = (c.data ?? []) as any[];
      const paid = charges.filter((x) => x.paid && !x.refunded);
      return { balance: b.available, pending: b.pending, charges: charges.length, paid_count: paid.length,
        gross: paid.reduce((s, x) => s + x.amount, 0) / 100, refunded: charges.filter((x) => x.refunded).length, currency: paid[0]?.currency ?? "nzd" };
    } },
  { name: "waitlist_stats", agents: ["marketing", "ops", "finance"],
    description: "Waitlist sign-ups: totals, by day, by country, by traffic source and campaign, referrals, and the relationships of people customers are buying for. No personal details.",
    input_schema: obj({ days: { type: "number", description: "Days of daily history, default 14" } }),
    run: waitlistStats },
  { name: "upcoming_dates", agents: ["ops", "marketing"],
    description: "How many recipients have birthdays in the next N days, by relationship (counts only), plus fixed NZ dates.",
    input_schema: obj({ days: { type: "number" } }),
    run: async (ctx, i) => {
      const days = i.days ?? 30;
      const { data } = await ctx.db.from("waitlist_people").select("relationship, birthday_day, birthday_month");
      const out: Record<string, number> = {};
      const now = ctx.now;
      for (const p of data ?? []) {
        if (!p.birthday_day || !p.birthday_month) continue;
        let d = new Date(Date.UTC(now.getUTCFullYear(), p.birthday_month - 1, p.birthday_day));
        if (d.getTime() < now.getTime() - 864e5) d = new Date(Date.UTC(now.getUTCFullYear() + 1, p.birthday_month - 1, p.birthday_day));
        if (d.getTime() - now.getTime() <= days * 864e5) out[p.relationship || "Other"] = (out[p.relationship || "Other"] || 0) + 1;
      }
      return { window_days: days, birthdays_by_relationship: out, fixed_dates: { christmas_last_order: "2026-12-12", nz_mothers_day: "2nd Sunday in May", nz_fathers_day: "1st Sunday in September" } };
    } },
  { name: "integrations_status", agents: ["ops"],
    description: "Status of every connected tool (connected, not connected, error) with the last error.",
    input_schema: obj(),
    run: async (ctx) => { const { data } = await ctx.db.from("integrations").select("name, status, last_sync_at, last_error, phase").neq("key", "system").order("sort"); return data; } },
  { name: "list_channels", agents: ["marketing"],
    description: "Marketing channels and partnerships with owner, status, target and cost.",
    input_schema: obj(),
    run: async (ctx) => { const { data } = await ctx.db.from("hq_channels").select("*"); return data; } },
  { name: "list_content_queue", agents: ["marketing"],
    description: "Posts in the content queue (drafts, approved, scheduled, posted, failed) with channel, time, caption, visual brief, whether media is attached and audit result.",
    input_schema: obj({ status: { type: "string" }, days_ahead: { type: "number" } }),
    run: async (ctx, i) => {
      let q = ctx.db.from("content_queue").select("id, channel, post_at, status, caption, visual_brief, media_url, audit, last_error").order("post_at", { ascending: true }).limit(60);
      if (i.status) q = q.eq("status", i.status);
      if (i.days_ahead) q = q.lte("post_at", new Date(Date.now() + i.days_ahead * 864e5).toISOString());
      const { data } = await q;
      return (data ?? []).map((r) => ({ ...r, has_media: !!r.media_url, media_url: undefined, caption: r.caption.slice(0, 400) }));
    } },
  { name: "draft_post", agents: ["marketing"],
    description: "Adds a post to the content queue. It is checked against the brand rules; with autopilot on, a passing post is approved and goes to Metricool once it has an image or video (Facebook can go text-only).",
    input_schema: obj({
      channel: { type: "string", enum: ["instagram", "tiktok", "facebook"] },
      post_at: { type: "string", description: "ISO date-time with offset, in NZ time, e.g. 2026-10-24T19:30:00+13:00" },
      caption: { type: "string" },
      visual_brief: { type: "string", description: "What Lauren or Emily should make in Canva or film: format, shot, text on screen, colours" },
    }, ["channel", "post_at", "caption", "visual_brief"]),
    run: async (ctx, i) => {
      const audit = auditCaption(i.caption, i.channel, null);
      const approve = !!ctx.settings.autopilot && audit.pass;
      const { data, error } = await ctx.db.from("content_queue").insert({
        channel: i.channel, post_at: i.post_at, caption: i.caption, visual_brief: i.visual_brief, audit, status: approve ? "Approved" : "Draft",
      }).select("id, status").single();
      if (error) return { error: error.message };
      return { ...data, audit, next: approve ? (audit.needs_media ? "Approved; waiting for an image or video" : "Approved; will be scheduled on the next run") : (audit.pass ? "Waiting for approval in HQ" : "Needs fixing before it can go out") };
    } },
];

export function toolsFor(agent: AgentKey) { return TOOLS.filter((t) => t.agents.includes(agent)); }

// ---------- Claude tool loop ----------
type Msg = { role: "user" | "assistant"; content: unknown };

export async function runAgent(ctx: Ctx, prompt: string, history: { role: "user" | "assistant"; content: string }[] = []):
  Promise<{ text: string; toolsUsed: string[] }> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("Add the ANTHROPIC_API_KEY secret in Supabase to switch the agents on.");
  const tools = toolsFor(ctx.agent);
  const messages: Msg[] = [...history.slice(-8).map((h) => ({ role: h.role, content: String(h.content).slice(0, 4000) })), { role: "user", content: prompt }];
  const used: string[] = [];
  let text = "";
  for (let turn = 0; turn < 10; turn++) {
    const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 2500, system: systemPrompt(ctx.agent, ctx.now, ctx.settings), messages,
        tools: tools.map(({ name, description, input_schema }) => ({ name, description, input_schema })) }),
    }, { retries: 2 });
    const raw = await res.text();
    if (!res.ok) throw new Error(`Claude API error ${res.status}: ${raw.slice(0, 300)}`);
    const out = JSON.parse(raw) as { content: any[]; stop_reason: string };
    messages.push({ role: "assistant", content: out.content });
    text = out.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim() || text;
    if (out.stop_reason !== "tool_use") break;
    const results = [];
    for (const b of out.content.filter((x) => x.type === "tool_use")) {
      const tool = tools.find((t) => t.name === b.name);
      used.push(b.name);
      try {
        const r = tool ? await tool.run(ctx, b.input ?? {}) : { error: `Unknown tool ${b.name}` };
        results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(r).slice(0, 15000) });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: b.id, content: `Error: ${(e as Error).message}`, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { text: text || "Done.", toolsUsed: [...new Set(used)] };
}

// ---------- Settings and logging ----------
export async function loadSettings(db: Db): Promise<Record<AgentKey, AgentSettings>> {
  const { data } = await db.from("integrations").select("config").eq("key", "agents").maybeSingle();
  const c = (data?.config ?? {}) as Record<string, AgentSettings>;
  return { finance: c.finance ?? {}, marketing: { autopilot: true, ...(c.marketing ?? {}) }, ops: c.ops ?? {} };
}

export async function logRun(db: Db, agent: AgentKey, trigger: string, prompt: string, askedBy: string | null,
  fn: () => Promise<{ text: string; toolsUsed: string[] }>) {
  const { data: row } = await db.from("agent_runs").insert({ agent, trigger, prompt: prompt.slice(0, 4000), asked_by: askedBy }).select("id").single();
  try {
    const r = await fn();
    await db.from("agent_runs").update({ status: "ok", reply: r.text, tools_used: r.toolsUsed, finished_at: new Date().toISOString() }).eq("id", row?.id);
    return { id: row?.id, ...r };
  } catch (e) {
    await db.from("agent_runs").update({ status: "error", reply: (e as Error).message, finished_at: new Date().toISOString() }).eq("id", row?.id);
    throw e;
  }
}
