// HQ Integrations page backend.
//   GET  or POST {action:"status"}         -> every integration with which secrets are set (names only)
//   POST {action:"sync", key}              -> run that connector now
//   POST {action:"selftest"}               -> check signatures, idempotency, refs and logging end to end
// Callers: signed-in team members (HQ) or the internal scheduler.
import { json, preflight, readJson } from "../_shared/http.ts";
import { admin } from "../_shared/supabase.ts";
import { authorize } from "../_shared/auth.ts";
import { secretStatus, missingSecrets } from "../_shared/secrets.ts";
import { logSync, upsertRef, findByExternalId } from "../_shared/log.ts";
import { hmac, verifyHmac, recordWebhook, finishWebhook } from "../_shared/webhook.ts";
import { runConnector, type Integration } from "../_shared/dispatch.ts";
import { REGISTRY, rowFor } from "../_shared/registry.ts";

type Body = { action?: string; key?: string };

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const db = admin();
  const caller = await authorize(req, db);
  if (!caller) return json(req, { error: "Sign in as a Farbird team member." }, 401);

  const body = await readJson<Body>(req);
  const action = body.action ?? "status";

  try {
    if (action === "status") return json(req, await status(db));
    if (action === "sync") {
      if (!body.key) return json(req, { error: "Missing integration key." }, 400);
      const { data: integ } = await db.from("integrations").select("*").eq("key", body.key).maybeSingle();
      if (!integ || integ.key === "system") return json(req, { error: `Unknown integration: ${body.key}` }, 404);
      const result = await runConnector(db, req, integ as Integration, "manual");
      await logSync(db, {
        integration_key: "system", direction: "internal", status: result.outcome === "error" ? "error" : "ok",
        message: `Sync now on ${integ.name} by ${caller.kind === "team" ? caller.email : "scheduler"}: ${result.message}`,
      });
      return json(req, result);
    }
    if (action === "selftest") return json(req, await selftest(db));
    return json(req, { error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error(err);
    return json(req, { error: (err as Error).message }, 500);
  }
});

/** JSON with sorted keys, so Postgres's jsonb key order doesn't count as a change. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/** Makes public.integrations match the tool list declared in _shared/registry.ts. */
async function applyRegistry(db: ReturnType<typeof admin>) {
  const { data: rows, error } = await db.from("integrations").select("*");
  if (error) throw new Error(error.message);
  const byKey = new Map((rows ?? []).map((r) => [r.key, r]));
  for (const tool of REGISTRY) {
    const existing = byKey.get(tool.key);
    const want = rowFor(tool, existing);
    if (!existing) {
      const { error: insErr } = await db.from("integrations").insert({ ...want, status: "not_connected", enabled: tool.enabled_by_default ?? false });
      if (insErr) console.error("registry insert failed", tool.key, insErr.message);
      continue;
    }
    const changed = (["name", "category", "description", "phase", "sync_every_minutes", "sort"] as const)
      .some((k) => existing[k] !== want[k])
      || stable(existing.required_secrets ?? []) !== stable(want.required_secrets)
      || stable(existing.config ?? {}) !== stable(want.config);
    if (changed) {
      const { error: upErr } = await db.from("integrations").update(want).eq("key", tool.key);
      if (upErr) console.error("registry update failed", tool.key, upErr.message);
    }
  }
}

async function status(db: ReturnType<typeof admin>) {
  await applyRegistry(db);
  const { data, error } = await db.from("integrations").select("*").order("sort");
  if (error) throw new Error(error.message);
  const out = [];
  for (const integ of data ?? []) {
    const secrets = secretStatus(integ.required_secrets ?? []);
    const missing = missingSecrets(integ.required_secrets ?? []);
    // Status follows the secrets unless a person paused it or the last sync failed.
    // Tools with no secrets only become connected after their connector syncs successfully.
    let next = integ.status;
    const needsKeys = (integ.required_secrets ?? []).length > 0 && integ.config?.kind !== "manual";
    if (integ.key !== "system" && integ.status !== "paused" && needsKeys) {
      if (missing.length) next = "not_connected";
      else if (integ.status === "not_connected") next = "connected";
    }
    if (next !== integ.status) {
      await db.from("integrations").update({ status: next }).eq("key", integ.key);
    }
    out.push({ ...integ, status: next, secrets });
  }
  return { integrations: out, checked_at: new Date().toISOString() };
}

async function selftest(db: ReturnType<typeof admin>) {
  const results: { check: string; pass: boolean; detail?: string }[] = [];
  const add = (check: string, pass: boolean, detail?: string) => results.push({ check, pass, detail });
  const runId = crypto.randomUUID();

  // 1. Signatures
  const secret = "test-secret-" + runId;
  const payload = JSON.stringify({ hello: "farbird", runId });
  const goodHex = await hmac(secret, payload);
  add("Valid signature accepted", await verifyHmac({ secret, body: payload, signature: goodHex }));
  add("Tampered body rejected", !(await verifyHmac({ secret, body: payload + " ", signature: goodHex })));
  add("Wrong secret rejected", !(await verifyHmac({ secret: secret + "x", body: payload, signature: goodHex })));
  add("Missing signature rejected", !(await verifyHmac({ secret, body: payload, signature: null })));
  const goodB64 = await hmac(secret, payload, "base64");
  add("Base64 + prefix signature accepted", await verifyHmac({ secret, body: payload, signature: "sha256=" + goodB64, encoding: "base64", prefix: "sha256=" }));

  // 2. Duplicate webhook delivery is stored once
  const extId = "selftest-" + runId;
  const first = await recordWebhook(db, { integration_key: "system", external_id: extId, event_type: "selftest", payload: { runId } });
  const second = await recordWebhook(db, { integration_key: "system", external_id: extId, event_type: "selftest", payload: { runId } });
  add("First delivery stored", !first.duplicate && first.id !== null);
  add("Duplicate delivery ignored", second.duplicate);
  if (first.id) await finishWebhook(db, first.id);
  await db.from("webhook_events").delete().eq("external_id", extId);

  // 3. External reference map is idempotent
  const ref = { entity: "selftest", entity_id: runId, integration_key: "system", external_id: extId, external_url: "https://example.com/" + runId };
  await upsertRef(db, ref);
  await upsertRef(db, { ...ref, external_url: ref.external_url + "?v=2" });
  const { count } = await db.from("external_refs").select("id", { count: "exact", head: true }).eq("entity", "selftest").eq("entity_id", runId);
  const found = await findByExternalId(db, "system", extId);
  add("External ref upsert keeps one row", count === 1, `rows: ${count}`);
  add("Lookup by external id works", found?.entity_id === runId && String(found?.external_url).endsWith("?v=2"));
  await db.from("external_refs").delete().eq("entity", "selftest");

  const pass = results.every((r) => r.pass);
  await logSync(db, {
    integration_key: "system", direction: "internal", status: pass ? "ok" : "error",
    message: `Self-test ${pass ? "passed" : "FAILED"}: ${results.filter((r) => r.pass).length}/${results.length} checks`,
    payload: results,
  });
  return { pass, results };
}
