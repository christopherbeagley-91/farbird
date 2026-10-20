// ClickUp API client and the mapping between ClickUp tasks and hq_tasks.
// Pure mapping functions are exported for unit tests (clickup_test.ts).
import { fetchWithRetry } from "./retry.ts";

export const CLICKUP_API = "https://api.clickup.com/api/v2";

// ---------- Types ----------
export type CuTask = {
  id: string;
  name: string;
  url?: string;
  status?: { status?: string; type?: string };
  date_updated?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  tags?: { name: string }[];
  list?: { id: string };
  archived?: boolean;
};

export type HqTask = {
  id: string;
  title: string;
  workstream: string;
  phase: string | null;
  owner: string | null;
  status: "To do" | "In progress" | "Blocked" | "Done";
  start_date: string | null;
  due_date: string | null;
  notes: string | null;
  clickup_url: string | null;
  updated_at: string;
};

// ---------- Status ----------
export function toClickupStatus(status: HqTask["status"]): string {
  if (status === "Done") return "complete";
  if (status === "In progress" || status === "Blocked") return "in progress";
  return "to do";
}

export function fromClickupStatus(task: CuTask): HqTask["status"] {
  const tags = (task.tags ?? []).map((t) => t.name.toLowerCase());
  if (task.status?.type === "closed" || task.status?.type === "done") return "Done";
  if (tags.includes("blocked")) return "Blocked";
  const s = (task.status?.status ?? "").toLowerCase();
  if (s === "to do" || s === "open" || task.status?.type === "open") return "To do";
  return "In progress";
}

// ---------- Dates ----------
// HQ stores dates; ClickUp stores ms timestamps. We send noon UTC with *_date_time = false
// (ClickUp normalises to midnight in the token owner's time zone). Reading back, we take the
// UTC date 14 hours later, which lands on the right day for anyone from UTC-10 to UTC+14.
export function dateToMs(date: string | null): number | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 12);
}

export function msToDate(ms: string | number | null | undefined): string | null {
  if (ms === null || ms === undefined || ms === "") return null;
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  return new Date(n + 14 * 3600_000).toISOString().slice(0, 10);
}

// ---------- Owners and phases (as ClickUp tags) ----------
export const OWNER_TAGS = ["chris", "mum", "lauren", "lynn"] as const;
const OWNER_NAMES: Record<string, string> = { chris: "Chris", mum: "Mum", lauren: "Lauren", lynn: "Lynn" };

export function ownerTags(owner: string | null): string[] {
  if (!owner) return [];
  if (owner.trim().toLowerCase() === "all") return [...OWNER_TAGS];
  return owner.split("+").map((s) => s.trim().toLowerCase()).filter((s) => (OWNER_TAGS as readonly string[]).includes(s));
}

export function ownerFromTags(tags: { name: string }[] | undefined): string | null {
  const present = OWNER_TAGS.filter((t) => (tags ?? []).some((x) => x.name.toLowerCase() === t));
  if (!present.length) return null;
  if (present.length === OWNER_TAGS.length) return "All";
  return present.map((t) => OWNER_NAMES[t]).join(" + ");
}

/** Same people, regardless of order or wording ("Lauren + Mum" == "Mum + Lauren"). */
export function sameOwners(a: string | null, b: string | null): boolean {
  const x = new Set(ownerTags(a));
  const y = new Set(ownerTags(b));
  return x.size === y.size && [...x].every((v) => y.has(v));
}

export const PHASE_TAGS: Record<string, string> = {
  "1. Lock": "1-lock",
  "2. Build demand": "2-build-demand",
  "3. Pre-sale": "3-pre-sale",
  "4. Sell & batch-buy": "4-sell",
  "5. Last-minute push": "5-last-minute",
  "6. Dispatch": "6-dispatch",
  "7. Convert": "7-convert",
};

export function phaseFromTags(tags: { name: string }[] | undefined): string | null {
  for (const [phase, tag] of Object.entries(PHASE_TAGS)) {
    if ((tags ?? []).some((t) => t.name.toLowerCase() === tag)) return phase;
  }
  return null;
}

// ---------- Mapping ----------
export function workstreamForList(listId: string | undefined, lists: Record<string, string>): string | null {
  if (!listId) return null;
  // Several workstreams can share a list (Marketing + Partnerships); the first one wins.
  const hit = Object.entries(lists).find(([, id]) => id === listId);
  return hit ? hit[0] : null;
}

/** Fields HQ should hold for this ClickUp task. Only fields ClickUp is the source for. */
export function hqFieldsFromClickup(task: CuTask) {
  return {
    title: task.name,
    status: fromClickupStatus(task),
    start_date: msToDate(task.start_date),
    due_date: msToDate(task.due_date),
    owner: ownerFromTags(task.tags),
    clickup_url: task.url ?? `https://app.clickup.com/t/${task.id}`,
  };
}

/** The patch to apply to HQ, or {} when nothing meaningful changed. */
export function hqPatch(hq: Pick<HqTask, "title" | "status" | "start_date" | "due_date" | "owner" | "clickup_url">, task: CuTask) {
  const want = hqFieldsFromClickup(task);
  const patch: Partial<HqTask> = {};
  if (want.title !== hq.title) patch.title = want.title;
  if (want.status !== hq.status) patch.status = want.status;
  if (want.start_date !== hq.start_date) patch.start_date = want.start_date;
  if (want.due_date !== hq.due_date) patch.due_date = want.due_date;
  if (want.owner && !sameOwners(want.owner, hq.owner)) patch.owner = want.owner;
  if (want.clickup_url !== hq.clickup_url) patch.clickup_url = want.clickup_url;
  return patch;
}

/** Body for creating or updating the ClickUp task from HQ. */
export function clickupBodyFromHq(hq: HqTask, opts: { create: boolean; hqUrl?: string }) {
  const body: Record<string, unknown> = {
    name: hq.title,
    status: toClickupStatus(hq.status),
    start_date: dateToMs(hq.start_date),
    start_date_time: false,
    due_date: dateToMs(hq.due_date),
    due_date_time: false,
  };
  if (opts.create) {
    const lines = [`Phase: ${hq.phase ?? "Backlog"}`, `Owner: ${hq.owner ?? "Unassigned"}`];
    if (hq.notes) lines.push("", hq.notes);
    if (opts.hqUrl) lines.push("", `Tracked in Farbird HQ: ${opts.hqUrl}`);
    body.description = lines.join("\n");
    const tags = [...ownerTags(hq.owner)];
    const phase = hq.phase ? PHASE_TAGS[hq.phase] : undefined;
    if (phase) tags.push(phase);
    if (hq.status === "Blocked") tags.push("blocked");
    body.tags = tags;
  }
  return body;
}

// ---------- Who changed what ----------
export type Direction = "push" | "pull" | "none";

/**
 * hqChanged: the HQ row was edited after our last sync of it.
 * cuChanged: ClickUp's copy was edited after the version we last saw.
 * Both changed: the most recent edit wins (and the caller logs a conflict).
 */
export function decide(input: {
  hqUpdatedAt: string;
  refSyncedAt: string | null;
  cuUpdatedAt: string | number | null | undefined;
  refExternalUpdatedAt: string | null;
}): { direction: Direction; conflict: boolean } {
  const hqMs = Date.parse(input.hqUpdatedAt);
  const syncedMs = input.refSyncedAt ? Date.parse(input.refSyncedAt) : 0;
  const cuMs = input.cuUpdatedAt === null || input.cuUpdatedAt === undefined ? null : Number(input.cuUpdatedAt);
  const seenMs = input.refExternalUpdatedAt ? Date.parse(input.refExternalUpdatedAt) : 0;

  const hqChanged = hqMs > syncedMs + 1000; // 1s grace for our own writes
  const cuChanged = cuMs !== null && cuMs > seenMs;

  if (hqChanged && cuChanged) return { direction: cuMs! > hqMs ? "pull" : "push", conflict: true };
  if (cuChanged) return { direction: "pull", conflict: false };
  if (hqChanged) return { direction: "push", conflict: false };
  return { direction: "none", conflict: false };
}

// ---------- API client ----------
export class ClickupError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function clickupClient(token: string) {
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetchWithRetry(`${CLICKUP_API}${path}`, {
      ...init,
      headers: { Authorization: token, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { const j = JSON.parse(text); msg = j.err ?? j.error ?? text; } catch { /* keep text */ }
      throw new ClickupError(res.status, `ClickUp ${init.method ?? "GET"} ${path} failed (${res.status}): ${String(msg).slice(0, 300)}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  return {
    user: () => call<{ user: { id: number; email: string; timezone?: string } }>("/user"),
    getTask: (id: string) => call<CuTask>(`/task/${id}`),
    createTask: (listId: string, body: Record<string, unknown>) =>
      call<CuTask>(`/list/${listId}/task`, { method: "POST", body: JSON.stringify(body) }),
    updateTask: (id: string, body: Record<string, unknown>) =>
      call<CuTask>(`/task/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    addTag: (id: string, tag: string) =>
      call(`/task/${id}/tag/${encodeURIComponent(tag)}`, { method: "POST" }),
    removeTag: (id: string, tag: string) =>
      call(`/task/${id}/tag/${encodeURIComponent(tag)}`, { method: "DELETE" }),
    /** Every task in a list updated after `sinceMs` (all when null), including closed ones. */
    async listTasks(listId: string, sinceMs: number | null): Promise<CuTask[]> {
      const out: CuTask[] = [];
      for (let page = 0; page < 20; page++) {
        const q = new URLSearchParams({ include_closed: "true", subtasks: "true", page: String(page) });
        if (sinceMs) q.set("date_updated_gt", String(sinceMs));
        const res = await call<{ tasks: CuTask[]; last_page?: boolean }>(`/list/${listId}/task?${q}`);
        out.push(...res.tasks);
        if (res.last_page !== false || res.tasks.length < 100) break;
      }
      return out;
    },
    createWebhook: (workspaceId: string, body: Record<string, unknown>) =>
      call<{ id: string; webhook: { id: string; secret: string } }>(`/team/${workspaceId}/webhook`, { method: "POST", body: JSON.stringify(body) }),
    deleteWebhook: (id: string) => call(`/webhook/${id}`, { method: "DELETE" }),
  };
}

export type ClickupClient = ReturnType<typeof clickupClient>;

export const WEBHOOK_EVENTS = ["taskCreated", "taskUpdated", "taskDeleted", "taskStatusUpdated", "taskDueDateUpdated", "taskTagUpdated", "taskMoved"];
