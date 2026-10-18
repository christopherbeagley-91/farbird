// Run: deno test supabase/functions/_shared/shared_test.ts
import { hmac, verifyHmac, timingSafeEqual } from "./webhook.ts";
import { fetchWithRetry } from "./retry.ts";
import { isDue } from "./dispatch.ts";

function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }

Deno.test("hmac matches a known SHA-256 vector", async () => {
  // RFC 4231 test case 2
  const sig = await hmac("Jefe", "what do ya want for nothing?");
  assert(sig === "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843", `got ${sig}`);
});

Deno.test("verifyHmac accepts good and rejects bad signatures", async () => {
  const body = '{"event":"taskUpdated","task_id":"abc"}';
  const sig = await hmac("s3cret", body);
  assert(await verifyHmac({ secret: "s3cret", body, signature: sig }), "good hex rejected");
  assert(!(await verifyHmac({ secret: "s3cret", body: body.replace("abc", "abd"), signature: sig })), "tampered accepted");
  assert(!(await verifyHmac({ secret: "wrong", body, signature: sig })), "wrong secret accepted");
  assert(!(await verifyHmac({ secret: "s3cret", body, signature: null })), "missing accepted");
  assert(!(await verifyHmac({ secret: "", body, signature: sig })), "empty secret accepted");
  const b64 = await hmac("s3cret", body, "base64");
  assert(await verifyHmac({ secret: "s3cret", body, signature: "sha256=" + b64, encoding: "base64", prefix: "sha256=" }), "prefixed base64 rejected");
});

Deno.test("timingSafeEqual handles different lengths", () => {
  assert(timingSafeEqual("abc", "abc"), "equal");
  assert(!timingSafeEqual("abc", "abcd"), "length");
  assert(!timingSafeEqual("abc", "abd"), "content");
});

Deno.test("fetchWithRetry retries 503 then succeeds, and does not retry 404", async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    calls++;
    return Promise.resolve(new Response("x", { status: calls < 3 ? 503 : 200 }));
  }) as typeof fetch;
  try {
    const res = await fetchWithRetry("https://example.test", {}, { retries: 3, baseMs: 1 });
    assert(res.status === 200 && calls === 3, `status ${res.status}, calls ${calls}`);
    calls = 0;
    globalThis.fetch = (() => { calls++; return Promise.resolve(new Response("nope", { status: 404 })); }) as typeof fetch;
    const r404 = await fetchWithRetry("https://example.test", {}, { retries: 3, baseMs: 1 });
    assert(r404.status === 404 && calls === 1, `404 retried ${calls} times`);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("isDue respects the interval", () => {
  const base = { key: "x", name: "X", status: "connected", enabled: true, required_secrets: [], sync_every_minutes: 15 };
  assert(isDue({ ...base, last_sync_at: null }), "never synced should be due");
  assert(!isDue({ ...base, last_sync_at: new Date(Date.now() - 5 * 60_000).toISOString() }), "5 min ago not due");
  assert(isDue({ ...base, last_sync_at: new Date(Date.now() - 16 * 60_000).toISOString() }), "16 min ago due");
});
