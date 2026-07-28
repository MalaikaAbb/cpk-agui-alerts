import { ghGet, ghPaginate } from "./client.js";
import type { PullRequest, Release } from "../types.js";

interface RawRelease {
  id: number;
  name: string | null;
  tag_name: string;
  html_url: string;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
}

interface RawCompare {
  commits: Array<{ sha: string }>;
}

/**
 * Published (non-draft) releases, newest first. We fetch a window larger than the
 * poll interval because `resolveReleasedPRs` needs each new release's immediate
 * predecessor to compute a tag-to-tag diff.
 */
async function listPublishedReleases(owner: string, repo: string): Promise<RawRelease[]> {
  const { items } = await ghPaginate<RawRelease>(`/repos/${owner}/${repo}/releases`, {
    perPage: 50,
    maxPages: 1,
  });

  return items
    .filter((r) => !r.draft && r.published_at !== null)
    .sort((a, b) => Date.parse(b.published_at as string) - Date.parse(a.published_at as string));
}

export async function listReleasesSince(
  owner: string,
  repo: string,
  sinceISO: string,
): Promise<{ newReleases: Release[]; all: Release[] }> {
  const raw = await listPublishedReleases(owner, repo);
  const since = Date.parse(sinceISO);

  const all = raw.map(toRelease);
  const newReleases = all.filter((r) => Date.parse(r.publishedAt) > since);

  return { newReleases, all };
}

function toRelease(r: RawRelease): Release {
  return {
    id: r.id,
    name: r.name?.trim() || r.tag_name,
    tagName: r.tag_name,
    htmlUrl: r.html_url,
    publishedAt: r.published_at as string,
    isPrerelease: r.prerelease,
  };
}

/**
 * The package a release tag belongs to, or null when it releases the whole repo.
 *
 * CopilotKit publishes per-package tags (`channels/v0.3.0`, `angular/v0.3.0`)
 * alongside repo-wide ones (`v1.63.2`); ag-ui uses repo-wide date tags
 * (`release/2026-07-22`). Only a `<name>/<semver>` shape counts as scoped, so
 * date-style tags are correctly treated as repo-wide.
 */
export function parseTagScope(tagName: string): string | null {
  const match = /^(?<scope>.+)\/v?(?<version>\d+\.\d+\.\d+.*)$/.exec(tagName);
  return match?.groups?.scope ?? null;
}

/**
 * Does this PR touch the package a scoped release covers?
 *
 * All packages share one main branch, so a tag-to-tag commit range contains
 * every commit merged in that window regardless of package. Containment alone
 * would label a react-ui fix as shipped in `channels/v0.3.0`. Requiring the PR
 * to have actually touched a path segment matching the scope keeps attribution
 * honest.
 */
export function touchesScope(files: string[], scope: string): boolean {
  return files.some((f) => f.split("/").includes(scope));
}

/**
 * Map merged PRs to the release that shipped them.
 *
 * For each new release we diff it against the previous release of the same scope
 * and check which PRs' merge commits fall in that range. `merge_commit_sha` is
 * populated for merge, squash, and rebase strategies alike, so this works
 * regardless of how the repo merges.
 *
 * Returns PR number -> release tag. A PR absent from the map has merged but is
 * not confirmed in any release yet, which is the common case for a short window.
 */
export async function resolveReleasedPRs(
  owner: string,
  repo: string,
  newReleases: Release[],
  allReleases: Release[],
  prs: Array<{ pr: PullRequest; files: string[] }>,
): Promise<Map<number, string>> {
  const released = new Map<number, string>();
  if (newReleases.length === 0 || prs.length === 0) return released;

  const shaToPR = new Map<string, { pr: PullRequest; files: string[] }>();
  for (const entry of prs) {
    if (entry.pr.mergeCommitSha) shaToPR.set(entry.pr.mergeCommitSha, entry);
  }
  if (shaToPR.size === 0) return released;

  // Oldest-first, so when several releases land in one window each PR ends up
  // attributed to the earliest release that contained it.
  const ordered = [...newReleases].sort(
    (a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt),
  );

  for (const release of ordered) {
    const scope = parseTagScope(release.tagName);
    const previous = findPreviousRelease(release, allReleases, scope);
    if (!previous) {
      // First release of its scope, or no predecessor we can see — skip rather
      // than over-claim that these PRs shipped in it.
      continue;
    }

    let compare: RawCompare;
    try {
      compare = await ghGet<RawCompare>(
        `/repos/${owner}/${repo}/compare/${encodeURIComponent(previous.tagName)}...${encodeURIComponent(release.tagName)}`,
      );
    } catch (err) {
      // A deleted or malformed tag should downgrade the report, not fail the run.
      console.warn(
        `[releases] could not compare ${previous.tagName}...${release.tagName} in ${owner}/${repo}:`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    for (const commit of compare.commits) {
      const entry = shaToPR.get(commit.sha);
      if (!entry || released.has(entry.pr.number)) continue;
      if (scope && !touchesScope(entry.files, scope)) continue;

      released.set(entry.pr.number, release.tagName);
    }
  }

  return released;
}

/**
 * The most recent release published before `release`.
 *
 * For a scoped release we look for the previous release of the same scope, so
 * the compare range covers that package's actual release window rather than
 * whatever unrelated tag happened to be published most recently.
 */
function findPreviousRelease(release: Release, all: Release[], scope: string | null): Release | null {
  const target = Date.parse(release.publishedAt);
  const earlier = all
    .filter((r) => r.id !== release.id && Date.parse(r.publishedAt) < target)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  if (scope) {
    const sameScope = earlier.find((r) => parseTagScope(r.tagName) === scope);
    if (sameScope) return sameScope;
  }

  return earlier[0] ?? null;
}
