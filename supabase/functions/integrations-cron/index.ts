// Scheduler. pg_cron calls this every 5 minutes with the internal secret header.
// Runs each enabled, connected integration whose sync interval has passed.
import { json, preflight } from "../_shared/http.ts";
import { admin } from "../_shared/supabase.ts";
import { authorize } from "../_shared/auth.ts";
import { logSync } from "../_shared/log.ts";
import { runConnector, isDue, type Integration } from "../_shared/dispatch.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const db = admin();
  const caller = await authorize(req, db);
  if (caller?.kind !== "internal") return json(req, { error: "Scheduler only." }, 401);

  const { data, error } = await db
    .from("integrations")
    .select("*")
    .eq("enabled", true)
    .eq("status", "connected")
    .neq("key", "system");
  if (error) return json(req, { error: error.message }, 500);

  const due = (data as Integration[]).filter((i) => isDue(i));
  const results = [];
  for (const integ of due) results.push(await runConnector(db, req, integ, "schedule"));

  // Log only when something ran, so the log isn't flooded every 5 minutes.
  if (results.length) {
    await logSync(db, {
      integration_key: "system", direction: "internal",
      status: results.some((r) => r.outcome === "error") ? "error" : "ok",
      message: `Scheduler ran ${results.length}: ${results.map((r) => `${r.key} ${r.outcome}`).join(", ")}`,
      payload: results,
    });
  }
  await db.from("integrations").update({ last_sync_at: new Date().toISOString() }).eq("key", "system");
  return json(req, { ran: results.length, results });
});
