// Run: deno test --allow-env supabase/functions/_shared/clickup_test.ts
import {
  toClickupStatus, fromClickupStatus, dateToMs, msToDate, ownerTags, ownerFromTags, sameOwners,
  phaseFromTags, workstreamForList, hqPatch, clickupBodyFromHq, decide, type CuTask, type HqTask,
} from "./clickup.ts";
import { pullTask, runSync, type Ctx } from "./clickup_engine.ts";
import { REGISTRY, rowFor } from "./registry.ts";

function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }
function eq(a: unknown, b: unknown, msg: string) { assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

const tag = (...names: string[]) => names.map((name) => ({ name }));

Deno.test("status maps both ways", () => {
  eq(toClickupStatus("To do"), "to do", "to do");
  eq(toClickupStatus("In progress"), "in progress", "in progress");
  eq(toClickupStatus("Blocked"), "in progress", "blocked goes in progress");
  eq(toClickupStatus("Done"), "complete", "done");
  eq(fromClickupStatus({ id: "1", name: "x", status: { status: "complete", type: "closed" } }), "Done", "closed");
  eq(fromClickupStatus({ id: "1", name: "x", status: { status: "in progress", type: "custom" }, tags: tag("blocked") }), "Blocked", "blocked tag");
  eq(fromClickupStatus({ id: "1", name: "x", status: { status: "in progress", type: "custom" } }), "In progress", "custom");
  eq(fromClickupStatus({ id: "1", name: "x", status: { status: "to do", type: "open" } }), "To do", "open");
});

Deno.test("dates round-trip and read ClickUp's midnight timestamps correctly", () => {
  // ClickUp snaps a date-only value (due_date_time: false) to midnight in the token owner's time zone:
  // we sent 16:00Z for 12 Dec when creating tasks and it stored 04:00Z (midnight New York, EDT).
  const snapToNewYorkMidnight = (ms: number) => {
    const d = new Date(ms - 5 * 3600_000); // EST is enough to pick the calendar day
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 5);
  };
  eq(msToDate(snapToNewYorkMidnight(dateToMs("2026-12-12")!)), "2026-12-12", "round trip through ClickUp");
  eq(msToDate(snapToNewYorkMidnight(dateToMs("2026-10-19")!)), "2026-10-19", "round trip in October");
  eq(msToDate(1797048000000), "2026-12-12", "midnight New York (EDT) as ClickUp stored it");
  eq(msToDate(Date.UTC(2026, 11, 11, 11)), "2026-12-12", "midnight Auckland (NZDT)");
  eq(msToDate(Date.UTC(2026, 11, 12, 5)), "2026-12-12", "midnight New York (EST)");
  eq(msToDate(Date.UTC(2026, 11, 11, 13)), "2026-12-12", "midnight Sydney (AEDT)");
  eq(msToDate(Date.UTC(2026, 11, 12, 0)), "2026-12-12", "midnight London");
  eq(msToDate(null), null, "null");
  eq(dateToMs(null), null, "null out");
});

Deno.test("owners map to tags and back, order-insensitive", () => {
  eq(ownerTags("Chris + Mum"), ["chris", "mum"], "pair");
  eq(ownerTags("All"), ["chris", "mum", "lauren", "lynn"], "all");
  eq(ownerTags(null), [], "none");
  eq(ownerFromTags(tag("mum", "lauren", "1-lock")), "Mum + Lauren", "from tags");
  eq(ownerFromTags(tag("chris", "mum", "lauren", "lynn")), "All", "everyone");
  eq(ownerFromTags(tag("1-lock")), null, "no owner tags");
  assert(sameOwners("Lauren + Mum", "Mum + Lauren"), "order-insensitive");
  assert(!sameOwners("Chris", "Chris + Mum"), "different sets");
});

Deno.test("phase and workstream come from tags and lists", () => {
  eq(phaseFromTags(tag("mum", "2-build-demand")), "2. Build demand", "phase");
  eq(phaseFromTags(tag("mum")), null, "no phase");
  const lists = { "Marketing": "L5", "Partnerships": "L5", "Ops": "L6" };
  eq(workstreamForList("L5", lists), "Marketing", "shared list picks first");
  eq(workstreamForList("ZZ", lists), null, "unknown list");
});

const hqBase: HqTask = {
  id: "h1", title: "Final order date", workstream: "Ops", phase: "5. Last-minute push", owner: "Mum",
  status: "To do", start_date: "2026-12-12", due_date: "2026-12-12", notes: null,
  clickup_url: "https://app.clickup.com/t/c1", updated_at: "2026-10-18T17:20:00Z",
};
const cuBase: CuTask = {
  id: "c1", name: "Final order date", url: "https://app.clickup.com/t/c1",
  status: { status: "to do", type: "open" }, start_date: "1797048000000", due_date: "1797048000000",
  tags: tag("mum", "5-last-minute"), list: { id: "L6" }, date_updated: "1792344330322",
};

Deno.test("hqPatch is empty when nothing meaningful changed (first sync is a no-op)", () => {
  eq(hqPatch(hqBase, cuBase), {}, "identical");
  eq(hqPatch({ ...hqBase, owner: "Lauren + Mum" }, { ...cuBase, tags: tag("mum", "lauren") }), {}, "owner order");
});

Deno.test("hqPatch carries real ClickUp edits", () => {
  const p = hqPatch(hqBase, { ...cuBase, name: "Final order date (Sat)", status: { status: "complete", type: "closed" }, due_date: String(Date.UTC(2026, 11, 13, 5)) });
  eq(p, { title: "Final order date (Sat)", status: "Done", due_date: "2026-12-13" }, "patch");
});

Deno.test("ClickUp body from HQ", () => {
  const create = clickupBodyFromHq({ ...hqBase, status: "Blocked", owner: "Chris + Mum", notes: "Call courier" }, { create: true, hqUrl: "https://hq" });
  eq(create.status, "in progress", "blocked status");
  eq(create.tags, ["chris", "mum", "5-last-minute", "blocked"], "tags");
  assert(String(create.description).includes("Call courier") && String(create.description).includes("https://hq"), "description");
  const update = clickupBodyFromHq(hqBase, { create: false });
  assert(!("description" in update) && !("tags" in update), "update leaves description and tags alone");
  eq(update.due_date, Date.UTC(2026, 11, 12, 12), "due ms");
});

Deno.test("decide: who changed what", () => {
  const synced = "2026-10-19T10:00:00Z";
  const seen = "2026-10-19T10:00:00Z";
  eq(decide({ hqUpdatedAt: synced, refSyncedAt: synced, cuUpdatedAt: Date.parse(seen), refExternalUpdatedAt: seen }), { direction: "none", conflict: false }, "no changes");
  eq(decide({ hqUpdatedAt: "2026-10-19T11:00:00Z", refSyncedAt: synced, cuUpdatedAt: Date.parse(seen), refExternalUpdatedAt: seen }), { direction: "push", conflict: false }, "HQ edit");
  eq(decide({ hqUpdatedAt: synced, refSyncedAt: synced, cuUpdatedAt: Date.parse("2026-10-19T11:00:00Z"), refExternalUpdatedAt: seen }), { direction: "pull", conflict: false }, "ClickUp edit");
  eq(decide({ hqUpdatedAt: "2026-10-19T11:00:00Z", refSyncedAt: synced, cuUpdatedAt: Date.parse("2026-10-19T12:00:00Z"), refExternalUpdatedAt: seen }), { direction: "pull", conflict: true }, "both, ClickUp newer");
  eq(decide({ hqUpdatedAt: "2026-10-19T13:00:00Z", refSyncedAt: synced, cuUpdatedAt: Date.parse("2026-10-19T12:00:00Z"), refExternalUpdatedAt: seen }), { direction: "push", conflict: true }, "both, HQ newer");
  eq(decide({ hqUpdatedAt: "2026-10-19T10:00:00.500Z", refSyncedAt: synced, cuUpdatedAt: null, refExternalUpdatedAt: seen }), { direction: "none", conflict: false }, "our own write within grace");
  eq(decide({ hqUpdatedAt: synced, refSyncedAt: synced, cuUpdatedAt: Date.parse(seen), refExternalUpdatedAt: null }), { direction: "pull", conflict: false }, "first sight of ClickUp version");
});

Deno.test("registry rows keep saved config and set metadata", () => {
  const tool = REGISTRY.find((t) => t.key === "clickup")!;
  const row = rowFor(tool, { config: { webhook_id: "w1", last_pull_at: "x" } });
  eq(row.config.webhook_id, "w1", "keeps saved webhook id");
  eq(row.config.kind, "sync", "kind set");
  eq(row.required_secrets, ["CLICKUP_API_TOKEN"], "only token needed");
  const keys = REGISTRY.map((t) => t.key);
  eq(new Set(keys).size, keys.length, "unique keys");
  assert(keys.every((k) => /^[a-z0-9-]+$/.test(k)), "keys are function-name safe");
});

// ---------- Engine with a fake ClickUp and a fake database ----------
function fakeDb(state: { hq: HqTask[]; refs: any[]; sync: any[]; logs: any[]; config: any }) {
  const table = (name: string) => {
    let rows: any[] = name === "hq_tasks" ? state.hq : name === "external_refs" ? state.refs : name === "external_ref_sync" ? state.sync : name === "sync_log" ? state.logs : [{ key: "clickup", config: state.config }];
    let filters: [string, unknown][] = [];
    let op: { kind: string; payload?: any; conflict?: string } = { kind: "select" };
    const apply = () => {
      const match = (r: any) => filters.every(([k, v]) => r[k] === v);
      if (op.kind === "insert") {
        const row = { id: crypto.randomUUID(), updated_at: new Date().toISOString(), ...op.payload };
        rows.push(row); return row;
      }
      if (op.kind === "upsert") {
        const keys = (op.conflict ?? (name === "external_ref_sync" ? "ref_id" : "id")).split(",");
        let row = rows.find((r) => keys.every((k) => r[k] === op.payload[k]));
        if (row) Object.assign(row, op.payload); else { row = { id: crypto.randomUUID(), ...op.payload }; rows.push(row); }
        return row;
      }
      if (op.kind === "update") {
        const hit = rows.filter(match);
        hit.forEach((r) => Object.assign(r, op.payload, name === "hq_tasks" ? { updated_at: new Date(Date.now() + 5).toISOString() } : {}));
        if (name === "integrations") state.config = op.payload.config ?? state.config;
        return hit[0];
      }
      if (op.kind === "delete") { const keep = rows.filter((r) => !match(r)); rows.splice(0, rows.length, ...keep); return null; }
      const out = rows.filter(match);
      if (name === "external_refs") return out.map((r) => ({ ...r, external_ref_sync: state.sync.filter((s) => s.ref_id === r.id) }));
      if (name === "integrations") return [{ config: state.config }];
      return out;
    };
    const b: any = {
      select() { return b; },
      eq(k: string, v: unknown) { filters.push([k, v]); return b; },
      insert(p: any) { op = { kind: "insert", payload: p }; return b; },
      upsert(p: any, o?: { onConflict?: string }) { op = { kind: "upsert", payload: p, conflict: o?.onConflict }; return b; },
      update(p: any) { op = { kind: "update", payload: p }; return b; },
      delete() { op = { kind: "delete" }; return b; },
      single() { const r = apply(); return Promise.resolve({ data: Array.isArray(r) ? r[0] : r, error: null }); },
      then(res: any) { return Promise.resolve({ data: apply(), error: null }).then(res); },
    };
    return b;
  };
  return { from: table, rpc: async () => ({ data: "secret", error: null }) } as any;
}

function fakeApi(tasks: Map<string, CuTask>, calls: string[]) {
  let n = 100;
  return {
    listTasks: async () => [...tasks.values()],
    getTask: async (id: string) => tasks.get(id)!,
    createTask: async (listId: string, body: any) => {
      calls.push(`create ${listId} ${body.name}`);
      const t: CuTask = { id: `new${n++}`, name: body.name, url: `https://app.clickup.com/t/new${n}`, status: { status: body.status }, list: { id: listId }, tags: (body.tags ?? []).map((x: string) => ({ name: x })), date_updated: String(Date.now()) };
      tasks.set(t.id, t); return t;
    },
    updateTask: async (id: string, body: any) => {
      calls.push(`update ${id} ${body.name} ${body.status}`);
      const t = { ...tasks.get(id)!, name: body.name, status: { status: body.status, type: body.status === "complete" ? "closed" : "custom" }, date_updated: String(Date.now()) };
      tasks.set(id, t); return t;
    },
    addTag: async (id: string, t: string) => { calls.push(`tag+ ${id} ${t}`); },
    removeTag: async (id: string, t: string) => { calls.push(`tag- ${id} ${t}`); },
    createWebhook: async () => ({ id: "wh1", webhook: { id: "wh1", secret: "s" } }),
    deleteWebhook: async () => ({}),
  };
}

function ctxFor(state: any, api: any): Ctx {
  const db = fakeDb(state);
  const refByExt = new Map(); const refByHq = new Map();
  for (const r of state.refs) {
    const ref = { ...r, external_updated_at: state.sync.find((s: any) => s.ref_id === r.id)?.external_updated_at ?? null };
    refByExt.set(r.external_id, ref); refByHq.set(r.entity_id, ref);
  }
  return { db, api, cfg: state.config, hqById: new Map(state.hq.map((t: HqTask) => [t.id, t])), refByExt, refByHq, handled: new Set(),
    stats: { pulled: 0, pushed: 0, createdInClickup: 0, createdInHq: 0, conflicts: 0, unlinked: 0, errors: 0 } };
}

Deno.test("engine: first sync changes nothing, then each side's edits flow to the other", async () => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  const state = {
    hq: [structuredClone(hqBase)],
    refs: [{ id: "r1", entity: "hq_tasks", entity_id: "h1", integration_key: "clickup", external_id: "c1", external_url: cuBase.url, synced_at: "2026-10-18T18:05:00Z" }],
    sync: [] as any[], logs: [] as any[],
    config: { workspace_id: "9", folder_id: "8", lists: { Ops: "L6" }, default_list: "L6", webhook_id: null, last_pull_at: null },
  };
  const tasks = new Map([["c1", structuredClone(cuBase)]]);
  const calls: string[] = [];

  // 1. First run: identical data -> no writes either way, webhook registered, baseline stored
  let stats = await runSync(ctxFor(state, fakeApi(tasks, calls)));
  eq([stats.pulled, stats.pushed, stats.createdInClickup, stats.createdInHq, stats.errors], [0, 0, 0, 0, 0], "first run no-op");
  eq(calls, [], "no ClickUp writes");
  assert(state.sync.length === 1 && state.sync[0].external_updated_at, "baseline recorded");
  eq(state.config.webhook_id, "wh1", "webhook saved");

  // 2. ClickUp edit -> pulled into HQ
  tasks.set("c1", { ...tasks.get("c1")!, status: { status: "complete", type: "closed" }, date_updated: String(Date.now() + 1000) });
  stats = await runSync(ctxFor(state, fakeApi(tasks, calls)));
  eq(stats.pulled, 1, "pulled");
  eq(state.hq[0].status, "Done", "HQ now Done");
  eq(calls, [], "pull doesn't echo back to ClickUp");

  // 3. Re-run with no edits -> nothing happens (no ping-pong)
  stats = await runSync(ctxFor(state, fakeApi(tasks, calls)));
  eq([stats.pulled, stats.pushed], [0, 0], "stable");

  // 4. HQ edit -> pushed to ClickUp
  state.hq[0].title = "Final order date (Sat 12 Dec)";
  state.hq[0].status = "Blocked";
  state.hq[0].updated_at = new Date(Date.now() + 60_000).toISOString();
  stats = await runSync(ctxFor(state, fakeApi(tasks, calls)));
  eq(stats.pushed, 1, "pushed");
  assert(calls.some((c) => c.startsWith("update c1 Final order date (Sat 12 Dec) in progress")), `update call: ${calls}`);
  assert(calls.includes("tag+ c1 blocked"), "blocked tag added");

  // 5. New HQ task without a link -> created in ClickUp in its workstream's list
  state.hq.push({ ...structuredClone(hqBase), id: "h2", title: "Claim social handles", clickup_url: null, updated_at: new Date().toISOString() });
  calls.length = 0;
  stats = await runSync(ctxFor(state, fakeApi(tasks, calls)));
  eq(stats.createdInClickup, 1, "created");
  assert(calls[0] === "create L6 Claim social handles", `create call: ${calls}`);
  assert(state.hq[1].clickup_url?.includes("clickup.com"), "HQ has the new link");

  // 6. New task made in ClickUp -> appears in HQ
  tasks.set("c9", { id: "c9", name: "Ring the printer", url: "https://app.clickup.com/t/c9", status: { status: "to do", type: "open" }, tags: tag("lynn"), list: { id: "L6" }, date_updated: String(Date.now() + 5000) });
  stats = await runSync(ctxFor(state, fakeApi(tasks, calls)));
  eq(stats.createdInHq, 1, "new from ClickUp");
  const added = state.hq.find((t) => t.title === "Ring the printer")!;
  eq([added.owner, added.workstream], ["Lynn", "Ops"], "owner and workstream");
});

Deno.test("engine: webhook event for a task already in sync is a no-op", async () => {
  const state = {
    hq: [structuredClone(hqBase)],
    refs: [{ id: "r1", entity: "hq_tasks", entity_id: "h1", integration_key: "clickup", external_id: "c1", synced_at: hqBase.updated_at }],
    sync: [{ ref_id: "r1", external_updated_at: new Date(Number(cuBase.date_updated)).toISOString() }], logs: [] as any[],
    config: { lists: { Ops: "L6" } },
  };
  const calls: string[] = [];
  const ctx = ctxFor(state, fakeApi(new Map([["c1", structuredClone(cuBase)]]), calls));
  await pullTask(ctx, structuredClone(cuBase));
  eq([ctx.stats.pulled, ctx.stats.pushed, calls.length], [0, 0, 0], "no-op");
});
