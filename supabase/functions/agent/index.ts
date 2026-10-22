// HQ agent panels: status, chat, status reports, run-now and settings.
//   POST {action: "status", agent}                       -> connections, settings, recent runs (+ queue counts for marketing)
//   POST {action: "chat", agent, message, history?}      -> the agent's answer (logged to agent_runs)
//   POST {action: "report", agent}                       -> a status report
//   POST {action: "run", agent}                          -> the agent's scheduled job, now
//   POST {action: "settings", agent, settings: {...}}    -> e.g. marketing autopilot on/off
//   POST {action: "scheduled", agent}                    -> called hourly by agents-sync: runs the job if due today, then sends approved posts
import { json, preflight, readJson } from "../_shared/http.ts";
import { admin } from "../_shared/supabase.ts";
import { authorize } from "../_shared/auth.ts";
import { AGENT_KEYS, type AgentKey, connections, loadSettings, logRun, runAgent, SCHEDULED, pushApproved, metricoolReady, nzParts } from "../_shared/agents.ts";

const REPORT = "Give me a status report for your area right now: what's working, what's off track, what needs a decision, with owners. Keep it short.";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const db = admin();
  const caller = await authorize(req, db);
  if (!caller) return json(req, { error: "Sign in as a Farbird team member." }, 401);
  const who = caller.kind === "team" ? caller.email : "scheduler";

  const body = await readJson<{ action?: string; agent?: AgentKey; message?: string; history?: { role: "user" | "assistant"; content: string }[]; settings?: Record<string, unknown> }>(req);
  const agent = body.agent;
  if (!agent || !AGENT_KEYS.includes(agent)) return json(req, { error: "Unknown agent" }, 400);
  const all = await loadSettings(db);
  const ctx = { db, agent, settings: all[agent], now: new Date() };

  try {
    switch (body.action) {
      case "status": {
        const { data: runs } = await db.from("agent_runs").select("id, trigger, prompt, reply, status, tools_used, asked_by, created_at, finished_at")
          .eq("agent", agent).order("created_at", { ascending: false }).limit(6);
        let queue: Record<string, number> | undefined;
        if (agent === "marketing") {
          const { data } = await db.from("content_queue").select("status");
          queue = (data ?? []).reduce((o: Record<string, number>, r) => { o[r.status] = (o[r.status] || 0) + 1; return o; }, {});
        }
        const conns = connections(agent);
        const ready = conns.filter((c) => c.required).every((c) => c.ok);
        return json(req, { agent, ready, connections: conns, settings: all[agent], runs: runs ?? [], queue });
      }
      case "chat": {
        const msg = (body.message ?? "").trim();
        if (!msg) return json(req, { error: "Ask the agent something." }, 400);
        const r = await logRun(db, agent, "chat", msg, who, () => runAgent(ctx, msg, body.history ?? []));
        return json(req, { reply: r.text, tools: r.toolsUsed, run_id: r.id });
      }
      case "report": {
        const r = await logRun(db, agent, "report", REPORT, who, () => runAgent(ctx, REPORT));
        return json(req, { reply: r.text, tools: r.toolsUsed, run_id: r.id });
      }
      case "run": {
        const job = SCHEDULED[agent];
        const r = await logRun(db, agent, "manual", job.prompt, who, () => runAgent(ctx, job.prompt));
        const pushed = agent === "marketing" ? await pushApproved(db) : undefined;
        return json(req, { reply: r.text, tools: r.toolsUsed, pushed, run_id: r.id });
      }
      case "settings": {
        if (caller.kind !== "team") return json(req, { error: "Team only" }, 403);
        const { data } = await db.from("integrations").select("config").eq("key", "agents").maybeSingle();
        const cfg = (data?.config ?? {}) as Record<string, Record<string, unknown>>;
        const allowed = Object.fromEntries(Object.entries(body.settings ?? {}).filter(([k]) => ["autopilot"].includes(k)));
        cfg[agent] = { ...(cfg[agent] ?? {}), ...allowed };
        const { error } = await db.from("integrations").update({ config: cfg }).eq("key", "agents");
        if (error) throw new Error(error.message);
        return json(req, { settings: cfg[agent], metricool: metricoolReady() });
      }
      case "scheduled": {
        const nz = nzParts(ctx.now);
        let ran = false;
        if (SCHEDULED[agent].due(nz)) {
          const { data: last } = await db.from("agent_runs").select("created_at").eq("agent", agent).eq("trigger", "schedule")
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          if (!last || nzParts(new Date(last.created_at)).date !== nz.date) {
            await logRun(db, agent, "schedule", SCHEDULED[agent].prompt, "scheduler", () => runAgent(ctx, SCHEDULED[agent].prompt));
            ran = true;
          }
        }
        const pushed = agent === "marketing" ? await pushApproved(db) : undefined;
        return json(req, { agent, ran, pushed });
      }
      default:
        return json(req, { error: "Unknown action" }, 400);
    }
  } catch (e) {
    return json(req, { error: (e as Error).message }, 502);
  }
});
