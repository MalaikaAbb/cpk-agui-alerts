import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DEDUP_RETENTION_DAYS, DEFAULT_LOOKBACK_HOURS } from "../config/repos.js";
import type { RepoKey, RepoState, State } from "../types.js";

const SCHEMA_VERSION = 1;

/** Repo-root-relative so it works the same locally and on an Actions runner. */
export const STATE_PATH = resolve(process.cwd(), "state/state.json");

export function emptyState(): State {
  return { schemaVersion: SCHEMA_VERSION, repos: {} };
}

export async function loadState(path = STATE_PATH): Promise<State> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as State;

    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      console.warn(
        `[state] schema version ${parsed.schemaVersion} != ${SCHEMA_VERSION}, starting fresh`,
      );
      return emptyState();
    }
    return { schemaVersion: parsed.schemaVersion, repos: parsed.repos ?? {} };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      console.log("[state] no state file yet, bootstrapping");
      return emptyState();
    }
    // A corrupt state file should not wedge the poller forever.
    console.warn("[state] unreadable, starting fresh:", err instanceof Error ? err.message : err);
    return emptyState();
  }
}

export async function saveState(state: State, path = STATE_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
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
  };
}

/**
 * Advance a repo's cursor and record what we just reported.
 *
 * The dedup set guards against the timestamp boundary: a PR merged in the same
 * second the previous run started could otherwise be picked up twice. Entries age
 * out after DEDUP_RETENTION_DAYS so the file stays small.
 */
export function updateRepoState(
  state: State,
  key: RepoKey,
  update: {
    nowISO: string;
    reportedPRs: Array<{ number: number; mergedAt: string }>;
    reportedReleaseIds: number[];
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
  };
}
