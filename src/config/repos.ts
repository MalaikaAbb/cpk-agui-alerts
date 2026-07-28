import type { RepoConfig } from "../types.js";
import { agUiRules, copilotKitRules } from "../categorize/rules.js";

/**
 * The repos we watch. Plain source rather than env config so adding a third repo
 * is a reviewable one-line diff.
 */
export const REPOS: RepoConfig[] = [
  { owner: "CopilotKit", repo: "CopilotKit", rules: copilotKitRules },
  { owner: "ag-ui-protocol", repo: "ag-ui", rules: agUiRules },
];

/**
 * Lookback used the first time we see a repo (no state entry yet).
 * Keep this in step with the workflow's cron interval so a first run covers
 * exactly one window instead of dumping the backlog.
 */
export const DEFAULT_LOOKBACK_HOURS = 3;

/** Per-section cap on individually-listed PRs, to keep the Chat payload bounded. */
export const MAX_PRS_PER_SECTION = 8;

/** How long a PR number stays in the dedup set before being aged out. */
export const DEDUP_RETENTION_DAYS = 30;

export function repoKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}
