import { ghGet, ghPaginate } from "./client.js";
import type { PullRequest } from "../types.js";

interface RawRepo {
  default_branch: string;
}

interface RawPull {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  merged_at: string | null;
  updated_at: string;
  merge_commit_sha: string | null;
  user: { login: string; type: string } | null;
}

interface RawFile {
  filename: string;
  /** Present when a file was renamed; the old path is not counted separately. */
  previous_filename?: string;
}

export async function getDefaultBranch(owner: string, repo: string): Promise<string> {
  const data = await ghGet<RawRepo>(`/repos/${owner}/${repo}`);
  return data.default_branch;
}

/**
 * List PRs merged into `baseBranch` strictly after `sinceISO`.
 *
 * Sorted by `updated` so we can stop paginating once a page is entirely older
 * than the window. A PR can surface here for reasons other than merging (a late
 * comment bumps `updated_at`), so the `merged_at` filter is what actually decides
 * inclusion.
 */
export async function listMergedPullsSince(
  owner: string,
  repo: string,
  baseBranch: string,
  sinceISO: string,
): Promise<PullRequest[]> {
  const since = Date.parse(sinceISO);

  const { items } = await ghPaginate<RawPull>(
    `/repos/${owner}/${repo}/pulls?state=closed&base=${encodeURIComponent(baseBranch)}` +
      `&sort=updated&direction=desc`,
    {
      // Once an entire page predates the window, nothing older can qualify.
      shouldStop: (page) => page.every((pr) => Date.parse(pr.updated_at) < since),
    },
  );

  return items
    .filter((pr) => pr.merged_at !== null && Date.parse(pr.merged_at) > since)
    .map(toPullRequest)
    .sort((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt));
}

function toPullRequest(pr: RawPull): PullRequest {
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body,
    htmlUrl: pr.html_url,
    author: pr.user?.login ?? "unknown",
    isBot: pr.user?.type === "Bot",
    // Safe: callers filter on merged_at !== null before mapping.
    mergedAt: pr.merged_at as string,
    mergeCommitSha: pr.merge_commit_sha,
  };
}

/**
 * Changed file paths for a PR.
 *
 * GitHub caps this endpoint at 3000 files; `truncated` reports whether we hit a
 * page limit so the report can say the classification is based on a partial diff.
 */
export async function listPullFiles(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ files: string[]; truncated: boolean }> {
  const { items, truncated } = await ghPaginate<RawFile>(
    `/repos/${owner}/${repo}/pulls/${prNumber}/files`,
    { maxPages: 5 },
  );

  return { files: items.map((f) => f.filename), truncated };
}
