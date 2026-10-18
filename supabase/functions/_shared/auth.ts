// Who is calling? Either a signed-in team member (HQ) or the internal scheduler.
// Functions are deployed with verify_jwt = false and authorise here, so the same
// function can serve HQ buttons, pg_cron and other functions.
import type { Db } from "./supabase.ts";

export const INTERNAL_HEADER = "x-farbird-internal";

export type Caller =
  | { kind: "team"; email: string }
  | { kind: "internal" };

export async function authorize(req: Request, db: Db): Promise<Caller | null> {
  const internal = req.headers.get(INTERNAL_HEADER);
  if (internal) {
    const { data, error } = await db.rpc("integrations_check_internal_secret", { p_secret: internal });
    return !error && data === true ? { kind: "internal" } : null;
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: userData, error: userError } = await db.auth.getUser(token);
  const email = userData?.user?.email;
  if (userError || !email) return null;

  const { data: member } = await db
    .from("team_members")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  return member ? { kind: "team", email } : null;
}

/** Headers that pass the caller's own credential on to another Farbird function. */
export function forwardAuth(req: Request): Record<string, string> {
  const internal = req.headers.get(INTERNAL_HEADER);
  if (internal) return { [INTERNAL_HEADER]: internal };
  const auth = req.headers.get("Authorization");
  const apikey = req.headers.get("apikey");
  return {
    ...(auth ? { Authorization: auth } : {}),
    ...(apikey ? { apikey } : {}),
  };
}
