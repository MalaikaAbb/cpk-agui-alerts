import { classifyPR } from "../categorize/classify.js";
import { repoKey } from "../config/repos.js";
import { fetchMergedPulls, fetchReleasesSince } from "../github/graphql.js";
import { parseTagScope } from "../github/packages.js";
import { appendToBuffer, buildReleaseReport } from "../state/buffer.js";
import { NOTIFY_TRIGGER_CATEGORIES, RELEASE_DRIVEN_CATEGORIES } from "../types.js";
import type { ClassifiedPR, ReleaseReport, RepoConfig, RepoReport, RepoState } from "../types.js";

/**
 * Collect and classify everything that landed in one repo since its cursor.
 *
 * Two GraphQL requests per repo — PRs (with their files inline) and releases —
 * regardless of how much merged in the window.
 */
export async function buildRepoReport(
  config: RepoConfig,
  repoState: RepoState,
  nowISO: string,
  token: string,
): Promise<RepoReport> {
  const { owner, repo } = config;
  const key = repoKey(owner, repo);
  const since = repoState.lastCheckedISO;

  const merged = await fetchMergedPulls(owner, repo, since, token);

  // Dedup safety net for PRs that straddle the window boundary.
  const alreadyReported = new Set(repoState.reportedPRs);
  const fresh = merged.filter((m) => !alreadyReported.has(m.pr.number));

  console.log(
    `[${key}] ${merged.length} merged since ${since}` +
      (merged.length !== fresh.length ? ` (${merged.length - fresh.length} already reported)` : ""),
  );

  const classified: ClassifiedPR[] = fresh.map(({ pr, files, truncated }) =>
    classifyPR(pr, files, config.rules, { truncated }),
  );

  // Buffer BEFORE resolving releases: a PR that merges and releases inside the
  // same 3-hour window must still appear in its own release report.
  appendToBuffer(repoState.buffer, classified);

  const newReleases = await fetchReleasesSince(
    owner,
    repo,
    since,
    token,
    config.releasePackageSource,
  );
  const seenReleases = new Set(repoState.reportedReleaseIds);
  const freshReleases = newReleases.filter((r) => !seenReleases.has(r.id));

  // Oldest first, and sharing one `claimed` set, so several releases in a single
  // window partition the buffer between them rather than each repeating all of it.
  const claimed = new Set<number>();
  const releaseReports: ReleaseReport[] = [...freshReleases]
    .sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt))
    .map((release) =>
      buildReleaseReport(repoState.buffer, release, parseTagScope(release.tagName), claimed),
    );

  return {
    key,
    owner,
    repo,
    sinceISO: since,
    untilISO: nowISO,
    prs: classified,
    releases: freshReleases,
    releaseReports,
  };
}

/**
 * PRs the report will actually show.
 *
 * A PR that only touched package code is excluded: package work is announced by
 * its release, not by its merge. Such a PR still resolves into the report data,
 * it just has nothing to render until a release ships it.
 */
export function displayablePRs(report: RepoReport): ClassifiedPR[] {
  return report.prs.filter((p) =>
    [...p.categories.keys()].some((c) => !RELEASE_DRIVEN_CATEGORIES.includes(c)),
  );
}

/**
 * True when there is nothing worth notifying about.
 *
 * Only two things earn a notification: a docs change, or a package release.
 * A window containing nothing but showcase, example, internal, or unreleased
 * package work stays completely silent — those appear only as context on a
 * notification that a docs change or release already earned.
 */
export function isEmpty(report: RepoReport): boolean {
  if (report.releases.length > 0) return false;

  return !report.prs.some((p) =>
    [...p.categories.keys()].some((c) => NOTIFY_TRIGGER_CATEGORIES.includes(c)),
  );
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
