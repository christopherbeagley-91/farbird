// Inbound webhook helpers: signature checks and idempotent storage.
// Pattern for every <provider>-webhook function:
//   1. read the raw body as text
//   2. verify the provider's signature (verifyHmac or a provider-specific parser)
//   3. recordWebhook() — returns duplicate: true for retries, so return 200 and stop
//   4. process, then finishWebhook()
import type { Db } from "./supabase.ts";

const enc = new TextEncoder();

export async function hmac(
  secret: string,
  message: string,
  encoding: "hex" | "base64" = "hex",
  hash: "SHA-256" | "SHA-1" = "SHA-256",
): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  if (encoding === "base64") return btoa(String.fromCharCode(...sig));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function verifyHmac(opts: {
  secret: string;
  body: string;
  signature: string | null;
  encoding?: "hex" | "base64";
  hash?: "SHA-256" | "SHA-1";
  prefix?: string; // e.g. "sha256=" for providers that prefix the digest
}): Promise<boolean> {
  if (!opts.signature || !opts.secret) return false;
  const provided = opts.prefix && opts.signature.startsWith(opts.prefix)
    ? opts.signature.slice(opts.prefix.length)
    : opts.signature;
  const expected = await hmac(opts.secret, opts.body, opts.encoding ?? "hex", opts.hash ?? "SHA-256");
  return timingSafeEqual(provided.trim(), expected);
}

/** Stores the event once. A provider retry with the same external_id comes back as duplicate. */
export async function recordWebhook(db: Db, event: {
  integration_key: string;
  external_id: string;
  event_type?: string;
  payload?: unknown;
}): Promise<{ id: number | null; duplicate: boolean }> {
  const { data, error } = await db.from("webhook_events").insert(event).select("id").single();
  if (error) {
    if (error.code === "23505") return { id: null, duplicate: true };
    throw new Error(`webhook_events insert failed: ${error.message}`);
  }
  return { id: data.id as number, duplicate: false };
}

export async function finishWebhook(db: Db, id: number, error?: string): Promise<void> {
  await db.from("webhook_events").update({ processed: !error, error: error ?? null }).eq("id", id);
}
