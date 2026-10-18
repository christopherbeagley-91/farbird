// Sync log, external reference map and integration status updates.
import type { Db } from "./supabase.ts";

export type SyncEntry = {
  integration_key: string;
  direction: "in" | "out" | "internal";
  status: "ok" | "error" | "skipped";
  entity?: string;
  entity_id?: string;
  external_id?: string;
  message?: string;
  payload?: unknown;
};

export async function logSync(db: Db, entry: SyncEntry): Promise<void> {
  const { error } = await db.from("sync_log").insert({
    ...entry,
    message: entry.message?.slice(0, 2000),
  });
  if (error) console.error("sync_log insert failed", error.message);
}

export type ExternalRef = {
  entity: string;
  entity_id: string;
  integration_key: string;
  external_id: string;
  external_url?: string | null;
};

/** One row per (entity, entity_id, integration). Re-running is safe. */
export async function upsertRef(db: Db, ref: ExternalRef): Promise<void> {
  const { error } = await db
    .from("external_refs")
    .upsert({ ...ref, synced_at: new Date().toISOString() }, { onConflict: "entity,entity_id,integration_key" });
  if (error) throw new Error(`external_refs upsert failed: ${error.message}`);
}

export async function findRef(db: Db, integration_key: string, entity: string, entity_id: string) {
  const { data } = await db
    .from("external_refs")
    .select("*")
    .eq("integration_key", integration_key)
    .eq("entity", entity)
    .eq("entity_id", entity_id)
    .maybeSingle();
  return data;
}

export async function findByExternalId(db: Db, integration_key: string, external_id: string) {
  const { data } = await db
    .from("external_refs")
    .select("*")
    .eq("integration_key", integration_key)
    .eq("external_id", external_id)
    .maybeSingle();
  return data;
}

/** Record the outcome of a sync on the integration row. */
export async function markIntegration(
  db: Db,
  key: string,
  outcome: { ok: boolean; error?: string; touchSync?: boolean },
): Promise<void> {
  const patch: Record<string, unknown> = outcome.ok
    ? { status: "connected", last_error: null }
    : { status: "error", last_error: (outcome.error ?? "Unknown error").slice(0, 1000) };
  if (outcome.touchSync !== false) patch.last_sync_at = new Date().toISOString();
  const { error } = await db.from("integrations").update(patch).eq("key", key);
  if (error) console.error("integrations update failed", error.message);
}
