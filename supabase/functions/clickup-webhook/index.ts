// Receives ClickUp task events for the Farbird folder.
// 1. verify X-Signature (HMAC-SHA256 of the raw body with the secret ClickUp issued, held in Vault)
// 2. store the event once (retries are ignored)
// 3. apply the change to HQ
import { admin } from "../_shared/supabase.ts";
import { logSync } from "../_shared/log.ts";
import { verifyHmac, recordWebhook, finishWebhook } from "../_shared/webhook.ts";
import { loadContext, pullTask } from "../_shared/clickup_engine.ts";
import { ClickupError } from "../_shared/clickup.ts";

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  const db = admin();
  const raw = await req.text();

  const { data: secret } = await db.rpc("integrations_get_secret", { p_name: "clickup_webhook_secret" });
  const ok = await verifyHmac({ secret: secret ?? "", body: raw, signature: req.headers.get("X-Signature") });
  if (!ok) {
    await logSync(db, { integration_key: "clickup", direction: "in", status: "error", message: "Rejected webhook: bad or missing signature" });
    return reply(401, { error: "Invalid signature" });
  }

  let event: { event?: string; task_id?: string; webhook_id?: string; history_items?: { id?: string }[] };
  try { event = JSON.parse(raw); } catch { return reply(400, { error: "Invalid JSON" }); }
  if (!event.task_id) return reply(200, { ignored: "no task" });

  const eventId = `${event.webhook_id ?? "wh"}:${event.history_items?.[0]?.id ?? `${event.event}:${event.task_id}:${raw.length}`}`;
  const stored = await recordWebhook(db, { integration_key: "clickup", external_id: eventId, event_type: event.event, payload: event });
  if (stored.duplicate) return reply(200, { duplicate: true });

  const token = Deno.env.get("CLICKUP_API_TOKEN");
  if (!token) {
    await finishWebhook(db, stored.id!, "CLICKUP_API_TOKEN not set");
    return reply(200, { stored: true });
  }

  try {
    const ctx = await loadContext(db, token);
    if (event.event === "taskDeleted") {
      const ref = ctx.refByExt.get(event.task_id);
      if (ref) {
        await db.from("external_refs").delete().eq("id", ref.id);
        const hq = ctx.hqById.get(ref.entity_id);
        if (hq?.clickup_url) await db.from("hq_tasks").update({ clickup_url: null }).eq("id", hq.id);
        await logSync(db, { integration_key: "clickup", direction: "in", status: "ok", entity: "hq_tasks", entity_id: ref.entity_id, external_id: event.task_id,
          message: `"${hq?.title ?? event.task_id}" deleted in ClickUp; unlinked, HQ task kept.` });
      }
    } else {
      const task = await ctx.api.getTask(event.task_id);
      const inFolder = Object.values(ctx.cfg.lists ?? {}).includes(task.list?.id ?? "");
      if (inFolder) await pullTask(ctx, task);
    }
    await finishWebhook(db, stored.id!);
    await db.from("integrations").update({ last_sync_at: new Date().toISOString(), status: "connected", last_error: null }).eq("key", "clickup");
    return reply(200, { ok: true });
  } catch (err) {
    const message = err instanceof ClickupError && err.status === 404 ? "Task no longer exists in ClickUp" : (err as Error).message;
    await finishWebhook(db, stored.id!, message);
    await logSync(db, { integration_key: "clickup", direction: "in", status: "error", external_id: event.task_id, message });
    // 200 so ClickUp doesn't retry an event we've stored; the scheduled sync will catch up.
    return reply(200, { stored: true, error: message });
  }
});
