// Sends the Resend "Waitlist confirmation" template to a new waitlist signup.
//   POST {waitlist_id}            -> send once per signup (idempotent; a repeat call is skipped)
//   POST {waitlist_id, test_to}   -> send a test copy to test_to (team only; not recorded as sent)
// Callers: the waitlist insert trigger (internal secret) or a signed-in team member.
// Reply-to and site URL live in integrations.config for key "resend" (reply_to, site_url).
import { json, preflight, readJson } from "../_shared/http.ts";
import { admin } from "../_shared/supabase.ts";
import { authorize } from "../_shared/auth.ts";
import { requireSecret } from "../_shared/secrets.ts";
import { logSync, upsertRef, findRef, markIntegration } from "../_shared/log.ts";
import { fetchWithRetry } from "../_shared/retry.ts";

const TEMPLATE_ID = "c2e5c53c-6545-4883-9c4a-b4377b396850";
const ENTITY = "waitlist_confirmation";

type Body = { waitlist_id?: string; test_to?: string };

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const db = admin();
  const caller = await authorize(req, db);
  if (!caller) return json(req, { error: "Not allowed." }, 401);

  const body = await readJson<Body>(req);
  if (!body.waitlist_id) return json(req, { error: "Missing waitlist_id." }, 400);
  const isTest = Boolean(body.test_to);

  try {
    const { data: row, error } = await db
      .from("waitlist")
      .select("id, email, first_name, referral_code")
      .eq("id", body.waitlist_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return json(req, { error: "Signup not found." }, 404);

    if (!isTest) {
      const already = await findRef(db, "resend", ENTITY, row.id);
      if (already) {
        await logSync(db, { integration_key: "resend", direction: "out", status: "skipped", entity: ENTITY, entity_id: row.id, external_id: already.external_id, message: "Confirmation already sent" });
        return json(req, { skipped: true, email_id: already.external_id });
      }
    }

    const { data: integ } = await db.from("integrations").select("config").eq("key", "resend").maybeSingle();
    const cfg = (integ?.config ?? {}) as Record<string, unknown>;
    const site = String(cfg.site_url ?? "https://farbird.co").replace(/\/$/, "");
    const replyTo = cfg.reply_to ? String(cfg.reply_to) : null;

    const payload = {
      to: [isTest ? body.test_to : row.email],
      template: {
        id: TEMPLATE_ID,
        variables: {
          NAME: (row.first_name ?? "").trim() || "there",
          REFERRAL_LINK: `${site}/?ref=${encodeURIComponent(row.referral_code)}`,
        },
      },
      ...(replyTo ? { reply_to: replyTo } : {}),
      tags: [{ name: "type", value: isTest ? "waitlist_confirmation_test" : "waitlist_confirmation" }],
    };

    const res = await fetchWithRetry("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireSecret("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
        "Idempotency-Key": isTest ? `waitlist-confirmation-test/${row.id}/${crypto.randomUUID()}` : `waitlist-confirmation/${row.id}`,
      },
      body: JSON.stringify(payload),
    }, { retries: 3 });

    const out = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok || !out.id) {
      const message = `Resend ${res.status}: ${String(out.message ?? out.name ?? "send failed")}`;
      await logSync(db, { integration_key: "resend", direction: "out", status: "error", entity: ENTITY, entity_id: row.id, message });
      await markIntegration(db, "resend", { ok: false, error: message, touchSync: false });
      return json(req, { error: message }, 502);
    }

    const emailId = String(out.id);
    if (!isTest) {
      await upsertRef(db, { entity: ENTITY, entity_id: row.id, integration_key: "resend", external_id: emailId, external_url: `https://resend.com/emails/${emailId}` });
    }
    await logSync(db, { integration_key: "resend", direction: "out", status: "ok", entity: ENTITY, entity_id: row.id, external_id: emailId, message: isTest ? "Test confirmation sent" : "Confirmation sent" });
    await markIntegration(db, "resend", { ok: true });
    return json(req, { sent: true, test: isTest, email_id: emailId });
  } catch (err) {
    const message = (err as Error).message;
    console.error(err);
    await logSync(db, { integration_key: "resend", direction: "out", status: "error", entity: ENTITY, entity_id: body.waitlist_id, message });
    return json(req, { error: message }, 500);
  }
});
