// Service-role client. Only ever used inside Edge Functions; never sent to a browser.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export type Db = SupabaseClient;

export function admin(): Db {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function functionUrl(name: string): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/${name}`;
}
