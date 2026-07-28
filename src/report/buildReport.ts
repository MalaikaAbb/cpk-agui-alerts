import { classifyPR } from "../categorize/classify.js";
import { repoKey } from "../config/repos.js";
import { getDefaultBranch, listMergedPullsSince, listPullFiles } from "../github/pulls.js";
import { listReleasesSince, resolveReleasedPRs } from "../github/releases.js";
import type { ClassifiedPR, RepoConfig, RepoReport, RepoState } from "../types.js";

/**
 * Collect and classify everything that landed in one repo since its cursor.
 *
 * Returns the report plus the ids we consumed, so the caller can advance state
 * even when it decides not to send a notification.
 */
export async function buildRepoReport(
  config: RepoConfig,
  repoState: RepoState,
  nowISO: string,
): Promise<RepoReport> {
  const { owner, repo } = config;
  const key = repoKey(owner, repo);
  const since = repoState.lastCheckedISO;

  const defaultBranch = await getDefaultBranch(owner, repo);
  const merged = await listMergedPullsSince(owner, repo, defaultBranch, since);

  // Dedup safety net for PRs that straddle the window boundary.
  const alreadyReported = new Set(repoState.reportedPRs);
  const fresh = merged.filter((pr) => !alreadyReported.has(pr.number));

  console.log(
    `[${key}] ${merged.length} merged since ${since}` +
      (merged.length !== fresh.length ? ` (${merged.length - fresh.length} already reported)` : ""),
  );

  // Files come first: release attribution needs them to tell whether a PR
  // actually belongs to a package-scoped release.
  const withFiles: Array<{ pr: (typeof fresh)[number]; files: string[]; truncated: boolean }> = [];
  for (const pr of fresh) {
    const { files, truncated } = await listPullFiles(owner, repo, pr.number);
    withFiles.push({ pr, files, truncated });
  }

  const { newReleases, all } = await listReleasesSince(owner, repo, since);
  const seenReleases = new Set(repoState.reportedReleaseIds);
  const freshReleases = newReleases.filter((r) => !seenReleases.has(r.id));

  const releasedMap = await resolveReleasedPRs(owner, repo, newReleases, all, withFiles);

  const classified: ClassifiedPR[] = withFiles.map(({ pr, files, truncated }) =>
    classifyPR(pr, files, config.rules, {
      truncated,
      releasedIn: releasedMap.get(pr.number) ?? null,
    }),
  );

  return {
    key,
    owner,
    repo,
    sinceISO: since,
    untilISO: nowISO,
    prs: classified,
    releases: freshReleases,
  };
}

/** True when there is nothing worth notifying about. */
export function isEmpty(report: RepoReport): boolean {
  return report.prs.length === 0 && report.releases.length === 0;
}

/**
 * Condense a PR body into a single line for the card.
 *
 * Strips the markdown that shows up in these repos' PR templates (headings,
 * comments, checklists, links, code fences) so the excerpt reads as prose rather
 * than as template scaffolding.
 */
export function summarizeBody(body: string | null, maxLength = 150): string | null {
  if (!body) return null;

  const cleaned = body
    .replace(/<!--[\s\S]*?-->/g, " ") // HTML comments (PR templates are full of them)
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/`([^`]*)`/g, "$1") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links -> text
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/gm, "") // task list markers
    .replace(/^\s*[-*+]\s+/gm, "") // bullets
    .replace(/[*_>#]/g, "") // leftover emphasis
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;

  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trimEnd()}…` : cleaned;
}

export function truncateTitle(title: string, maxLength = 80): string {
  return title.length > maxLength ? `${title.slice(0, maxLength - 1).trimEnd()}…` : title;
}

/** GitHub search URL scoped to the exact window, used for "+N more" links. */
export function mergedSearchUrl(report: RepoReport): string {
  const since = report.sinceISO.slice(0, 19) + "Z";
  const until = report.untilISO.slice(0, 19) + "Z";
  const query = `is:pr is:merged merged:${since}..${until}`;

  return `https://github.com/${report.owner}/${report.repo}/pulls?q=${encodeURIComponent(query)}`;
}
