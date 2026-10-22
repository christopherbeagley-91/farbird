// Hourly agent scheduler (integrations key "agents"; called by the HQ dispatcher and "Sync now").
// Calls the `agent` function once per agent in parallel, so each run has its own time limit.
// Marketing and ops run daily from 8am NZ, finance on Mondays from 8am NZ; approved posts go to Metricool every hour.
import { json, preflight } from "../_shared/http.ts";
import { admin, functionUrl } from "../_shared/supabase.ts";
import { authorize, forwardAuth } from "../_shared/auth.ts";

const AGENTS = ["marketing", "ops", "finance"];

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const db = admin();
  if (!(await authorize(req, db))) return json(req, { error: "Unauthorised" }, 401);
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json(req, { error: "Add the ANTHROPIC_API_KEY secret in Supabase to switch the agents on." }, 400);

  const results = await Promise.all(AGENTS.map(async (agent) => {
    try {
      const res = await fetch(functionUrl("agent"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...forwardAuth(req) },
        body: JSON.stringify({ action: "scheduled", agent }),
      });
      const body = await res.json().catch(() => ({}));
      return res.ok ? { agent, ...body } : { agent, error: body.error ?? `HTTP ${res.status}` };
    } catch (e) {
      return { agent, error: (e as Error).message };
    }
  }));

  const ran = results.filter((r: any) => r.ran).map((r) => r.agent);
  const errors = results.filter((r: any) => r.error).map((r: any) => `${r.agent}: ${r.error}`);
  const p = (results.find((r) => r.agent === "marketing") as any)?.pushed ?? {};
  const parts = [
    ran.length ? `Ran ${ran.join(", ")}` : "No agent jobs due",
    p.scheduled ? `${p.scheduled} posts scheduled` : "",
    p.failed ? `${p.failed} posts failed` : "",
    p.waiting ? `${p.waiting} approved posts waiting${p.note ? ` (${p.note})` : " for an image or video"}` : "",
  ].filter(Boolean);
  if (errors.length) return json(req, { error: errors.join("; "), results }, 502);
  return json(req, { message: parts.join(", "), results });
});
