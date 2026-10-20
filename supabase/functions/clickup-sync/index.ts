// ClickUp two-way sync. Called by HQ "Sync now", the scheduler, and after HQ task saves.
//   POST {}                       -> full sync (registers the webhook on first run)
//   POST {action: "disconnect"}   -> remove the ClickUp webhook
import { json, preflight, readJson } from "../_shared/http.ts";
import { admin } from "../_shared/supabase.ts";
import { authorize } from "../_shared/auth.ts";
import { logSync, markIntegration } from "../_shared/log.ts";
import { loadContext, runSync, removeWebhook, summary } from "../_shared/clickup_engine.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const db = admin();
  const caller = await authorize(req, db);
  if (!caller) return json(req, { error: "Sign in as a Farbird team member." }, 401);

  const token = Deno.env.get("CLICKUP_API_TOKEN");
  if (!token) return json(req, { error: "Add the CLICKUP_API_TOKEN secret in Supabase first." }, 400);

  const body = await readJson<{ action?: string; trigger?: string }>(req);
  try {
    const ctx = await loadContext(db, token);
    if (body.action === "disconnect") {
      await removeWebhook(ctx);
      await logSync(db, { integration_key: "clickup", direction: "internal", status: "ok", message: "ClickUp webhook removed" });
      return json(req, { message: "ClickUp webhook removed" });
    }
    const stats = await runSync(ctx);
    const message = summary(stats);
    await logSync(db, { integration_key: "clickup", direction: "internal", status: stats.errors ? "error" : "ok",
      message: `Sync (${body.trigger ?? "manual"}): ${message}`, payload: stats });
    await markIntegration(db, "clickup", stats.errors ? { ok: false, error: `${stats.errors} errors in last sync; see activity` } : { ok: true });
    return json(req, { message, stats });
  } catch (err) {
    const message = (err as Error).message;
    await logSync(db, { integration_key: "clickup", direction: "internal", status: "error", message });
    await markIntegration(db, "clickup", { ok: false, error: message });
    return json(req, { error: message }, 502);
  }
});
