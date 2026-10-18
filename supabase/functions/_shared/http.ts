// CORS and JSON helpers shared by every Farbird Edge Function.

const ALLOWED_ORIGINS = [
  "https://christopherbeagley-91.github.io",
  "http://localhost:8000",
  "http://localhost:5173",
];

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

/** Returns a response for CORS preflight, or null for every other request. */
export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders(req) }) : null;
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  if (req.method === "GET") return {} as T;
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
