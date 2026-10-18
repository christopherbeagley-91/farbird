// Runs one connector's sync function (<key>-sync) and records the outcome.
// Used by "Sync now" in HQ and by the scheduler.
import type { Db } from "./supabase.ts";
import { functionUrl } from "./supabase.ts";
import { forwardAuth } from "./auth.ts";
import { logSync, markIntegration } from "./log.ts";
import { missingSecrets } from "./secrets.ts";
import { fetchWithRetry } from "./retry.ts";

export type Integration = {
  key: string;
  name: string;
  status: string;
  enabled: boolean;
  required_secrets: string[];
  sync_every_minutes: number;
  last_sync_at: string | null;
};

export type RunResult = { key: string; outcome: "ok" | "error" | "skipped"; message: string };

export async function runConnector(db: Db, req: Request, integ: Integration, trigger: "manual" | "schedule"): Promise<RunResult> {
  const missing = missingSecrets(integ.required_secrets ?? []);
  if (missing.length) {
    const message = `Add secrets first: ${missing.join(", ")}`;
    await logSync(db, { integration_key: integ.key, direction: "internal", status: "skipped", message });
    return { key: integ.key, outcome: "skipped", message };
  }

  let res: Response;
  try {
    res = await fetchWithRetry(functionUrl(`${integ.key}-sync`), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...forwardAuth(req) },
      body: JSON.stringify({ trigger }),
    }, { retries: 2 });
  } catch (err) {
    const message = `Couldn't reach ${integ.key}-sync: ${(err as Error).message}`;
    await logSync(db, { integration_key: integ.key, direction: "internal", status: "error", message });
    await markIntegration(db, integ.key, { ok: false, error: message });
    return { key: integ.key, outcome: "error", message };
  }

  if (res.status === 404) {
    await res.body?.cancel();
    const message = `The ${integ.name} connector isn't built yet (Phase 3).`;
    await logSync(db, { integration_key: integ.key, direction: "internal", status: "skipped", message });
    return { key: integ.key, outcome: "skipped", message };
  }

  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text); } catch { /* non-JSON reply */ }
  if (!res.ok) {
    const message = String(body.error ?? text ?? `HTTP ${res.status}`).slice(0, 500);
    await markIntegration(db, integ.key, { ok: false, error: message });
    return { key: integ.key, outcome: "error", message };
  }
  await markIntegration(db, integ.key, { ok: true });
  return { key: integ.key, outcome: "ok", message: String(body.message ?? "Synced") };
}

export function isDue(integ: Integration, now = Date.now()): boolean {
  if (!integ.last_sync_at) return true;
  return now - Date.parse(integ.last_sync_at) >= integ.sync_every_minutes * 60_000;
}
