// Two-way sync between hq_tasks and the Farbird ClickUp folder.
// Used by clickup-sync (scheduled + Sync now) and clickup-webhook (instant ClickUp changes).
import type { Db } from "./supabase.ts";
import { functionUrl } from "./supabase.ts";
import { logSync } from "./log.ts";
import {
  clickupClient, ClickupError, type ClickupClient, type CuTask, type HqTask,
  decide, hqPatch, hqFieldsFromClickup, clickupBodyFromHq, workstreamForList, phaseFromTags,
  ownerTags, OWNER_TAGS, WEBHOOK_EVENTS,
} from "./clickup.ts";

export const HQ_URL = "https://christopherbeagley-91.github.io/farbird/hq/";
const KEY = "clickup";

type Ref = {
  id: string;
  entity_id: string;
  external_id: string;
  external_url: string | null;
  synced_at: string | null;
  external_updated_at: string | null;
};

export type Stats = {
  pulled: number; pushed: number; createdInClickup: number; createdInHq: number;
  conflicts: number; unlinked: number; errors: number; webhook?: string;
};

export type Ctx = {
  db: Db;
  api: ClickupClient;
  cfg: Record<string, any>;
  hqById: Map<string, HqTask>;
  refByExt: Map<string, Ref>;
  refByHq: Map<string, Ref>;
  handled: Set<string>;
  stats: Stats;
};

export async function loadContext(db: Db, token: string): Promise<Ctx> {
  const { data: integ, error } = await db.from("integrations").select("config").eq("key", KEY).single();
  if (error) throw new Error(`Couldn't load ClickUp settings: ${error.message}`);
  const { data: tasks, error: tErr } = await db.from("hq_tasks").select("*");
  if (tErr) throw new Error(tErr.message);
  const { data: refs, error: rErr } = await db
    .from("external_refs")
    .select("id, entity_id, external_id, external_url, synced_at, external_ref_sync(external_updated_at)")
    .eq("integration_key", KEY)
    .eq("entity", "hq_tasks");
  if (rErr) throw new Error(rErr.message);

  const refByExt = new Map<string, Ref>();
  const refByHq = new Map<string, Ref>();
  for (const r of refs ?? []) {
    const state = Array.isArray(r.external_ref_sync) ? r.external_ref_sync[0] : r.external_ref_sync;
    const ref: Ref = { ...r, external_updated_at: state?.external_updated_at ?? null } as Ref;
    refByExt.set(ref.external_id, ref);
    refByHq.set(ref.entity_id, ref);
  }
  return {
    db, api: clickupClient(token), cfg: integ.config ?? {},
    hqById: new Map((tasks ?? []).map((t: HqTask) => [t.id, t])),
    refByExt, refByHq, handled: new Set(),
    stats: { pulled: 0, pushed: 0, createdInClickup: 0, createdInHq: 0, conflicts: 0, unlinked: 0, errors: 0 },
  };
}

async function saveConfig(ctx: Ctx, patch: Record<string, unknown>) {
  ctx.cfg = { ...ctx.cfg, ...patch };
  const { error } = await ctx.db.from("integrations").update({ config: ctx.cfg }).eq("key", KEY);
  if (error) throw new Error(`Couldn't save ClickUp settings: ${error.message}`);
}

/** Records the link and the versions both sides are now at. */
async function saveRef(ctx: Ctx, hqId: string, task: CuTask, hqUpdatedAt: string) {
  const { data, error } = await ctx.db.from("external_refs").upsert({
    entity: "hq_tasks", entity_id: hqId, integration_key: KEY,
    external_id: task.id, external_url: task.url ?? `https://app.clickup.com/t/${task.id}`,
    synced_at: hqUpdatedAt,
  }, { onConflict: "entity,entity_id,integration_key" }).select("id").single();
  if (error) throw new Error(`external_refs upsert failed: ${error.message}`);
  const extAt = task.date_updated ? new Date(Number(task.date_updated)).toISOString() : null;
  const { error: sErr } = await ctx.db.from("external_ref_sync")
    .upsert({ ref_id: data.id, external_updated_at: extAt, updated_at: new Date().toISOString() });
  if (sErr) throw new Error(`external_ref_sync upsert failed: ${sErr.message}`);
  const ref: Ref = { id: data.id, entity_id: hqId, external_id: task.id, external_url: task.url ?? null, synced_at: hqUpdatedAt, external_updated_at: extAt };
  ctx.refByExt.set(task.id, ref);
  ctx.refByHq.set(hqId, ref);
}

async function updateHq(ctx: Ctx, id: string, patch: Partial<HqTask>): Promise<HqTask> {
  const { data, error } = await ctx.db.from("hq_tasks").update(patch).eq("id", id).select("*").single();
  if (error) throw new Error(`hq_tasks update failed: ${error.message}`);
  ctx.hqById.set(id, data as HqTask);
  return data as HqTask;
}

async function unlink(ctx: Ctx, ref: Ref, reason: string) {
  await ctx.db.from("external_refs").delete().eq("id", ref.id);
  ctx.refByExt.delete(ref.external_id);
  ctx.refByHq.delete(ref.entity_id);
  const hq = ctx.hqById.get(ref.entity_id);
  if (hq?.clickup_url) await updateHq(ctx, hq.id, { clickup_url: null });
  ctx.stats.unlinked++;
  await logSync(ctx.db, { integration_key: KEY, direction: "in", status: "ok", entity: "hq_tasks", entity_id: ref.entity_id, external_id: ref.external_id,
    message: `Unlinked "${hq?.title ?? ref.entity_id}": ${reason}. The HQ task was kept.` });
}

/** Apply one ClickUp task to HQ (or push HQ if HQ holds the newer edit). */
export async function pullTask(ctx: Ctx, task: CuTask): Promise<void> {
  const ref = ctx.refByExt.get(task.id);

  if (!ref) {
    if (task.archived) return;
    const f = hqFieldsFromClickup(task);
    const row = {
      title: f.title, status: f.status, start_date: f.start_date, due_date: f.due_date, owner: f.owner,
      clickup_url: f.clickup_url,
      workstream: workstreamForList(task.list?.id, ctx.cfg.lists ?? {}) ?? "General",
      phase: phaseFromTags(task.tags) ?? "Backlog",
    };
    const { data, error } = await ctx.db.from("hq_tasks").insert(row).select("*").single();
    if (error) throw new Error(`hq_tasks insert failed: ${error.message}`);
    ctx.hqById.set(data.id, data as HqTask);
    await saveRef(ctx, data.id, task, data.updated_at);
    ctx.handled.add(data.id);
    ctx.stats.createdInHq++;
    await logSync(ctx.db, { integration_key: KEY, direction: "in", status: "ok", entity: "hq_tasks", entity_id: data.id, external_id: task.id,
      message: `New task from ClickUp: "${task.name}"` });
    return;
  }

  const hq = ctx.hqById.get(ref.entity_id);
  if (!hq) {
    await logSync(ctx.db, { integration_key: KEY, direction: "in", status: "skipped", external_id: task.id,
      message: `"${task.name}" was deleted in HQ; ClickUp copy left as is.` });
    return;
  }

  const d = decide({ hqUpdatedAt: hq.updated_at, refSyncedAt: ref.synced_at, cuUpdatedAt: task.date_updated, refExternalUpdatedAt: ref.external_updated_at });
  if (d.conflict) {
    ctx.stats.conflicts++;
    await logSync(ctx.db, { integration_key: KEY, direction: "internal", status: "ok", entity: "hq_tasks", entity_id: hq.id, external_id: task.id,
      message: `"${hq.title}" changed in both places; kept the ${d.direction === "pull" ? "ClickUp" : "HQ"} version (newer).` });
  }
  ctx.handled.add(hq.id);

  if (d.direction === "pull") {
    const patch = hqPatch(hq, task);
    let updatedAt = hq.updated_at;
    if (Object.keys(patch).length) {
      const fresh = await updateHq(ctx, hq.id, patch);
      updatedAt = fresh.updated_at;
      ctx.stats.pulled++;
      await logSync(ctx.db, { integration_key: KEY, direction: "in", status: "ok", entity: "hq_tasks", entity_id: hq.id, external_id: task.id,
        message: `Updated "${fresh.title}" from ClickUp: ${Object.keys(patch).join(", ")}`, payload: patch });
    }
    await saveRef(ctx, hq.id, task, updatedAt);
  } else if (d.direction === "push") {
    await pushTask(ctx, hq, task);
  }
}

/** Create or update the ClickUp copy of an HQ task. `current` = the ClickUp task if already fetched. */
export async function pushTask(ctx: Ctx, hq: HqTask, current?: CuTask): Promise<void> {
  const ref = ctx.refByHq.get(hq.id);
  try {
    if (!ref) {
      const listId = ctx.cfg.lists?.[hq.workstream] ?? ctx.cfg.default_list;
      const created = await ctx.api.createTask(listId, clickupBodyFromHq(hq, { create: true, hqUrl: HQ_URL }));
      let updatedAt = hq.updated_at;
      const url = created.url ?? `https://app.clickup.com/t/${created.id}`;
      if (hq.clickup_url !== url) updatedAt = (await updateHq(ctx, hq.id, { clickup_url: url })).updated_at;
      await saveRef(ctx, hq.id, created, updatedAt);
      ctx.stats.createdInClickup++;
      await logSync(ctx.db, { integration_key: KEY, direction: "out", status: "ok", entity: "hq_tasks", entity_id: hq.id, external_id: created.id,
        message: `Created "${hq.title}" in ClickUp` });
      return;
    }

    const updated = await ctx.api.updateTask(ref.external_id, clickupBodyFromHq(hq, { create: false }));
    const have = new Set((current ?? updated).tags?.map((t) => t.name.toLowerCase()) ?? []);
    const wantOwners = ownerTags(hq.owner);
    let tagged = false;
    const add = async (t: string) => { if (!have.has(t)) { await ctx.api.addTag(ref.external_id, t); tagged = true; } };
    const remove = async (t: string) => { if (have.has(t)) { await ctx.api.removeTag(ref.external_id, t); tagged = true; } };
    if (hq.status === "Blocked") await add("blocked"); else await remove("blocked");
    for (const t of wantOwners) await add(t);
    if (wantOwners.length) for (const t of OWNER_TAGS) if (!wantOwners.includes(t)) await remove(t);

    const fresh = tagged ? await ctx.api.getTask(ref.external_id) : updated;
    await saveRef(ctx, hq.id, fresh, hq.updated_at);
    ctx.stats.pushed++;
    await logSync(ctx.db, { integration_key: KEY, direction: "out", status: "ok", entity: "hq_tasks", entity_id: hq.id, external_id: ref.external_id,
      message: `Updated "${hq.title}" in ClickUp` });
  } catch (err) {
    if (ref && err instanceof ClickupError && err.status === 404) {
      await unlink(ctx, ref, "deleted in ClickUp");
      return;
    }
    ctx.stats.errors++;
    await logSync(ctx.db, { integration_key: KEY, direction: "out", status: "error", entity: "hq_tasks", entity_id: hq.id,
      message: (err as Error).message });
  }
}

/** Registers the folder webhook once; ClickUp's signing secret goes straight into Vault. */
export async function ensureWebhook(ctx: Ctx): Promise<string> {
  if (ctx.cfg.webhook_id) {
    const { data: secret } = await ctx.db.rpc("integrations_get_secret", { p_name: "clickup_webhook_secret" });
    if (secret) return "already registered";
  }
  const res = await ctx.api.createWebhook(String(ctx.cfg.workspace_id), {
    endpoint: functionUrl("clickup-webhook"),
    events: WEBHOOK_EVENTS,
    folder_id: Number(ctx.cfg.folder_id),
  });
  const { error } = await ctx.db.rpc("integrations_set_secret", { p_name: "clickup_webhook_secret", p_value: res.webhook.secret });
  if (error) throw new Error(`Couldn't store webhook secret: ${error.message}`);
  await saveConfig(ctx, { webhook_id: res.id });
  await logSync(ctx.db, { integration_key: KEY, direction: "internal", status: "ok", message: "Registered ClickUp webhook for the Farbird folder" });
  return "registered";
}

export async function removeWebhook(ctx: Ctx): Promise<void> {
  if (ctx.cfg.webhook_id) {
    try { await ctx.api.deleteWebhook(String(ctx.cfg.webhook_id)); } catch (e) {
      if (!(e instanceof ClickupError && e.status === 404)) throw e;
    }
  }
  await saveConfig(ctx, { webhook_id: null });
}

/** Full sync: pull ClickUp changes since last run, then push HQ changes. */
export async function runSync(ctx: Ctx): Promise<Stats> {
  const runStart = new Date();
  try {
    ctx.stats.webhook = await ensureWebhook(ctx);
  } catch (err) {
    ctx.stats.webhook = "failed";
    await logSync(ctx.db, { integration_key: KEY, direction: "internal", status: "error",
      message: `Webhook not registered (sync still works on schedule): ${(err as Error).message}` });
  }

  const since = ctx.cfg.last_pull_at ? Date.parse(ctx.cfg.last_pull_at) - 120_000 : null;
  const listIds = [...new Set(Object.values(ctx.cfg.lists ?? {}) as string[])];
  for (const listId of listIds) {
    const tasks = await ctx.api.listTasks(listId, since);
    for (const task of tasks) {
      try { await pullTask(ctx, task); } catch (err) {
        ctx.stats.errors++;
        await logSync(ctx.db, { integration_key: KEY, direction: "in", status: "error", external_id: task.id, message: (err as Error).message });
      }
    }
  }

  for (const hq of [...ctx.hqById.values()]) {
    if (ctx.handled.has(hq.id)) continue;
    const ref = ctx.refByHq.get(hq.id);
    if (!ref) { await pushTask(ctx, hq); continue; }
    const d = decide({ hqUpdatedAt: hq.updated_at, refSyncedAt: ref.synced_at, cuUpdatedAt: null, refExternalUpdatedAt: ref.external_updated_at });
    if (d.direction === "push") await pushTask(ctx, hq);
  }

  await saveConfig(ctx, { last_pull_at: runStart.toISOString() });
  return ctx.stats;
}

export function summary(s: Stats): string {
  const parts = [
    s.pulled && `${s.pulled} updated from ClickUp`,
    s.pushed && `${s.pushed} pushed to ClickUp`,
    s.createdInClickup && `${s.createdInClickup} created in ClickUp`,
    s.createdInHq && `${s.createdInHq} new from ClickUp`,
    s.conflicts && `${s.conflicts} conflicts resolved`,
    s.unlinked && `${s.unlinked} unlinked`,
    s.errors && `${s.errors} errors`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "Everything already in sync";
}
