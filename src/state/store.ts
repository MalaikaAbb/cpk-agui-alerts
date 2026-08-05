import { DEDUP_RETENTION_DAYS, DEFAULT_LOOKBACK_HOURS } from "../config/repos.js";
import { emptyBuffer } from "./buffer.js";
import type { KVStore, RepoKey, RepoState, State } from "../types.js";

/** v3: buffer holds package changes only, with structured per-package subpaths. */
const SCHEMA_VERSION = 3;

/** Single KV key holding the whole cursor document — it is a few KB at most. */
export const STATE_KEY = "poll-state";

export function emptyState(): State {
  return { schemaVersion: SCHEMA_VERSION, repos: {} };
}

export async function loadState(kv: KVStore): Promise<State> {
  let raw: string | null;
  try {
    raw = await kv.get(STATE_KEY);
  } catch (err) {
    // A KV read failure should not wedge the poller; fall back to a fresh cursor.
    console.warn("[state] KV read failed, starting fresh:", err instanceof Error ? err.message : err);
    return emptyState();
  }

  if (raw === null) {
    console.log("[state] no stored state yet, bootstrapping");
    return emptyState();
  }

  try {
    const parsed = JSON.parse(raw) as State;
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      console.warn(`[state] schema ${parsed.schemaVersion} != ${SCHEMA_VERSION}, starting fresh`);
      return emptyState();
    }

    // Defend against a partially-written document: a repo entry missing its
    // buffer would otherwise throw on first append.
    const repos: Record<RepoKey, RepoState> = {};
    for (const [key, repoState] of Object.entries(parsed.repos ?? {})) {
      repos[key] = { ...repoState, buffer: normalizeBuffer(repoState.buffer) };
    }

    return { schemaVersion: parsed.schemaVersion, repos };
  } catch (err) {
    console.warn("[state] unparseable, starting fresh:", err instanceof Error ? err.message : err);
    return emptyState();
  }
}

export async function saveState(kv: KVStore, state: State): Promise<void> {
  await kv.put(STATE_KEY, JSON.stringify(state));
}

function normalizeBuffer(buffer: RepoState["buffer"] | undefined): RepoState["buffer"] {
  if (!buffer || typeof buffer !== "object") return emptyBuffer();
  return { buckets: buffer.buckets ?? {}, dropped: buffer.dropped ?? {} };
}

/**
 * The cursor for a repo. First time we see one, look back a single poll interval
 * rather than dumping the entire backlog into the first notification.
 */
export function getRepoState(state: State, key: RepoKey, nowISO: string): RepoState {
  const existing = state.repos[key];
  if (existing) return existing;

  const lookbackMs = DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000;
  return {
    lastCheckedISO: new Date(Date.parse(nowISO) - lookbackMs).toISOString(),
    reportedPRs: [],
    reportedReleaseIds: [],
    reportedPRDates: {},
    buffer: emptyBuffer(),
  };
}

/**
 * Advance a repo's cursor and record what we just reported.
 *
 * The dedup set guards against the timestamp boundary: a PR merged in the same
 * second the previous run started could otherwise be picked up twice. Entries age
 * out after DEDUP_RETENTION_DAYS so the document stays small.
 */
export function updateRepoState(
  state: State,
  key: RepoKey,
  update: {
    nowISO: string;
    reportedPRs: Array<{ number: number; mergedAt: string }>;
    reportedReleaseIds: number[];
    buffer?: RepoState["buffer"];
  },
): void {
  const previous = state.repos[key];

  const reportedPRDates: Record<string, string> = { ...(previous?.reportedPRDates ?? {}) };
  for (const pr of update.reportedPRs) {
    reportedPRDates[String(pr.number)] = pr.mergedAt;
  }

  const cutoff = Date.parse(update.nowISO) - DEDUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const retained: Record<string, string> = {};
  for (const [number, mergedAt] of Object.entries(reportedPRDates)) {
    if (Date.parse(mergedAt) >= cutoff) retained[number] = mergedAt;
  }

  const releaseIds = new Set([
    ...(previous?.reportedReleaseIds ?? []),
    ...update.reportedReleaseIds,
  ]);

  state.repos[key] = {
    lastCheckedISO: update.nowISO,
    reportedPRs: Object.keys(retained)
      .map(Number)
      .sort((a, b) => a - b),
    // Releases are far rarer than PRs; keep the most recent 200 as a flat cap.
    reportedReleaseIds: [...releaseIds].sort((a, b) => a - b).slice(-200),
    reportedPRDates: retained,
    // The caller mutates the buffer in place (append / drain), so carry the live
    // object through rather than rebuilding it — rebuilding would drop pending
    // changes that have not been released yet.
    buffer: update.buffer ?? previous?.buffer ?? emptyBuffer(),
  };
}
