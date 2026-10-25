import { auditCaption, nzParts, SCHEDULED, connections, runAgent, pushApproved, toolsFor } from "./agents.ts";

const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};

Deno.test("brand audit catches banned words, shouting and missing media", () => {
  const ok = auditCaption("POV: it's 18 December and Mum still thinks you're organised.\nJoin the waitlist.", "instagram", null);
  eq([ok.pass, ok.needs_media], [true, true], "clean caption, instagram needs media");
  const bad = auditCaption("Elevate your gifting!", "facebook", null);
  eq(bad.pass, false, "banned word and exclamation");
  eq(bad.issues.length, 2, "two issues");
  eq(auditCaption("Sorted. Planned. Delivered. Easy", "facebook").issues.some((i) => i.includes("staccato")), true, "staccato");
  eq(auditCaption("BIG NEWS EVERYONE", "facebook").pass, false, "shouting");
  eq(auditCaption("Text only is fine on Facebook", "facebook").needs_media, false, "facebook text ok");
});

Deno.test("NZ time and schedules", () => {
  const p = nzParts(new Date("2026-10-25T19:30:00Z")); // Mon 26 Oct 08:30 NZDT
  eq([p.date, p.hour, p.weekday], ["2026-10-26", 8, "Mon"], "NZ parts");
  eq(SCHEDULED.finance.due(p), true, "finance due Monday 8am");
  eq(SCHEDULED.finance.due(nzParts(new Date("2026-10-26T19:30:00Z"))), false, "not Tuesday");
  eq(SCHEDULED.marketing.due(nzParts(new Date("2026-10-25T17:00:00Z"))), false, "not before 8am");
});

Deno.test("each agent gets its own tools and connections", () => {
  eq(toolsFor("marketing").map((t) => t.name).includes("draft_post"), true, "marketing drafts");
  eq(toolsFor("finance").map((t) => t.name).includes("draft_post"), false, "finance can't post");
  eq(toolsFor("ops").map((t) => t.name).includes("integrations_status"), true, "ops sees tools");
  eq(connections("marketing").find((c) => c.name === "Metricool")?.required, true, "metricool required for marketing");
});

// ---- Fakes ----
function fakeDb(store: Record<string, any[]>) {
  return {
    from(table: string) {
      const rows = store[table] ||= [];
      let filters: [string, unknown][] = [];
      let pending: any = null;
      const b: any = {
        select() { return b; }, order() { return b; }, limit() { return b; }, lte() { return b; },
        eq(k: string, v: unknown) { filters.push([k, v]); return b; },
        insert(row: any) { pending = { op: "insert", row: { id: `id${rows.length + 1}`, ...row } }; return b; },
        update(patch: any) { pending = { op: "update", patch }; return b; },
        single() { return b.then((r: any) => r); },
        maybeSingle() { return b.then((r: any) => ({ data: r.data?.[0] ?? null, error: null })); },
        then(res: (v: any) => unknown) {
          if (pending?.op === "insert") { rows.push(pending.row); return Promise.resolve({ data: pending.row, error: null }).then(res); }
          const hit = rows.filter((r) => filters.every(([k, v]) => r[k] === v));
          if (pending?.op === "update") { hit.forEach((r) => Object.assign(r, pending.patch)); return Promise.resolve({ data: hit, error: null }).then(res); }
          return Promise.resolve({ data: hit, error: null }).then(res);
        },
      };
      return b;
    },
  } as any;
}

Deno.test("Claude tool loop: marketing drafts a post, autopilot approves it if it passes", async () => {
  Deno.env.set("ANTHROPIC_API_KEY", "test");
  const calls: any[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    const reply = calls.length === 1
      ? { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "draft_post", input: { channel: "facebook", post_at: "2026-10-24T19:30:00+13:00", caption: "Mum will think you planned this.", visual_brief: "Text post" } }] }
      : { stop_reason: "end_turn", content: [{ type: "text", text: "Drafted 1 Facebook post." }] };
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as typeof fetch;
  try {
    const store: Record<string, any[]> = {};
    const r = await runAgent({ db: fakeDb(store), agent: "marketing", settings: { autopilot: true }, now: new Date() }, "Daily run");
    eq(r.text, "Drafted 1 Facebook post.", "final text");
    eq(r.toolsUsed, ["draft_post"], "tools used");
    eq(store.content_queue[0].status, "Approved", "autopilot approved");
    eq(calls[0].tools.some((t: any) => t.name === "draft_post"), true, "tools sent to Claude");
    eq(calls[1].messages.at(-1).content[0].type, "tool_result", "tool result returned to Claude");
  } finally { globalThis.fetch = realFetch; }
});

Deno.test("autopilot off, or a failing audit, leaves the post as a draft", async () => {
  const realFetch = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async () => new Response(JSON.stringify(++n === 1
    ? { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "draft_post", input: { channel: "instagram", post_at: "2026-10-24T19:30:00+13:00", caption: "Elevate Christmas!", visual_brief: "x" } }] }
    : { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }), { status: 200 })) as typeof fetch;
  try {
    const store: Record<string, any[]> = {};
    await runAgent({ db: fakeDb(store), agent: "marketing", settings: { autopilot: true }, now: new Date() }, "go");
    eq(store.content_queue[0].status, "Draft", "failed audit stays draft");
  } finally { globalThis.fetch = realFetch; }
});

Deno.test("pushApproved schedules posts with media in Metricool and waits on the rest", async () => {
  Deno.env.set("METRICOOL_API_TOKEN", "t"); Deno.env.set("METRICOOL_USER_ID", "1"); Deno.env.set("METRICOOL_BLOG_ID", "2");
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
    if (url.includes("normalize")) return new Response("https://media.metricool.com/x.jpg", { status: 200 });
    return new Response(JSON.stringify({ data: { id: 99 } }), { status: 200 });
  }) as typeof fetch;
  try {
    const store: Record<string, any[]> = { content_queue: [
      { id: "a", status: "Approved", channel: "instagram", caption: "c", media_url: "https://x/y.jpg", post_at: "2030-01-01T00:00:00Z" },
      { id: "b", status: "Approved", channel: "tiktok", caption: "c", media_url: null, post_at: "2030-01-01T00:00:00Z" },
      { id: "c", status: "Approved", channel: "facebook", caption: "c", media_url: null, post_at: "2030-01-01T00:00:00Z" },
    ] };
    const out = await pushApproved(fakeDb(store));
    eq([out.scheduled, out.failed, out.waiting], [2, 0, 1], "two scheduled, tiktok waits for video");
    eq(store.content_queue.map((r) => r.status), ["Scheduled", "Approved", "Scheduled"], "statuses");
    eq(seen.filter((s) => s.startsWith("POST")).length, 2, "two posts sent");
  } finally {
    globalThis.fetch = realFetch;
    ["METRICOOL_API_TOKEN", "METRICOOL_USER_ID", "METRICOOL_BLOG_ID"].forEach((k) => Deno.env.delete(k));
  }
});

Deno.test("breakeven: defaults with the Christmas fixed costs", async () => {
  const { breakeven, BE_DEFAULTS } = await import("./agents.ts");
  const b = breakeven(BE_DEFAULTS, 2776.05);
  if (b.per_box.packing !== 3.72) throw new Error(`packing ${b.per_box.packing}`);
  if (b.gross_profit_per_box !== 23.21) throw new Error(`gp ${b.gross_profit_per_box}`);
  if (b.boxes_needed !== 120 || b.customers_needed !== 75) throw new Error(`boxes ${b.boxes_needed} customers ${b.customers_needed}`);
  if (breakeven({ ...BE_DEFAULTS, avg_price: 50 }, 1000).boxes_needed !== null) throw new Error("negative GP should give null");
});
