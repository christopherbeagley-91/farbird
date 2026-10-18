// fetch with exponential backoff for 429 / 5xx / network errors. Honors Retry-After.

export type RetryOptions = { retries?: number; baseMs?: number; maxMs?: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  { retries = 3, baseMs = 500, maxMs = 8000 }: RetryOptions = {},
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === retries) return res;
      const retryAfter = Number(res.headers.get("Retry-After"));
      await res.body?.cancel();
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, maxMs)
        : Math.min(baseMs * 2 ** attempt + Math.random() * 100, maxMs);
      await sleep(wait);
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
      await sleep(Math.min(baseMs * 2 ** attempt, maxMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("fetch failed after retries");
}
