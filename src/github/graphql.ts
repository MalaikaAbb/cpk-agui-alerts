import { extractReleasedPackages } from "./packages.js";
import type { PullRequest, Release, ReleasePackageSource } from "../types.js";

const GRAPHQL_URL = "https://api.github.com/graphql";

/** PRs fetched per page, and files fetched per PR. */
const PR_PAGE_SIZE = 50;
const FILES_PER_PR = 100;
/** Safety bound on pagination; a 3-hour window never approaches this. */
const MAX_PR_PAGES = 3;

export class GitHubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubError";
  }
}

/**
 * PRs merged since a timestamp, each with its changed file paths.
 *
 * REST needed one `pulls/{n}/files` call per PR, which put a busy window over
 * Cloudflare's 50-subrequest-per-invocation limit. GraphQL returns the files
 * inline, so a whole repo costs one request regardless of how many PRs merged.
 */
const PULLS_QUERY = `
query Pulls($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(
      states: MERGED
      orderBy: { field: UPDATED_AT, direction: DESC }
      first: ${PR_PAGE_SIZE}
      after: $cursor
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        body
        url
        mergedAt
        updatedAt
        author { login __typename }
        files(first: ${FILES_PER_PR}) {
          totalCount
          nodes { path }
        }
      }
    }
  }
}`;

const RELEASES_QUERY = `
query Releases($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    releases(first: 25, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes {
        databaseId
        name
        tagName
        url
        publishedAt
        isDraft
        isPrerelease
        description
      }
    }
  }
}`;

interface RawPullNode {
  number: number;
  title: string;
  body: string | null;
  url: string;
  mergedAt: string | null;
  updatedAt: string;
  author: { login: string; __typename: string } | null;
  files: { totalCount: number; nodes: Array<{ path: string }> } | null;
}

interface RawReleaseNode {
  databaseId: number;
  name: string | null;
  tagName: string;
  url: string;
  publishedAt: string | null;
  isDraft: boolean;
  isPrerelease: boolean;
  description: string | null;
}

export interface PullWithFiles {
  pr: PullRequest;
  files: string[];
  /** True when the PR changed more files than we fetched. */
  truncated: boolean;
}

async function graphql<T>(query: string, variables: Record<string, unknown>, token: string): Promise<T> {
  // GraphQL has no unauthenticated tier at all, unlike REST's 60/hour.
  if (!token) throw new GitHubError("GITHUB_TOKEN is required (the GraphQL API rejects anonymous requests)");

  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "cpk-agui-alert",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GitHubError(`GitHub GraphQL ${res.status}: ${body.slice(0, 300)}`);
  }

  const payload = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (payload.errors?.length) {
    throw new GitHubError(`GitHub GraphQL: ${payload.errors.map((e) => e.message).join("; ")}`);
  }
  if (!payload.data) throw new GitHubError("GitHub GraphQL returned no data");

  return payload.data;
}

export async function fetchMergedPulls(
  owner: string,
  repo: string,
  sinceISO: string,
  token: string,
): Promise<PullWithFiles[]> {
  const since = Date.parse(sinceISO);
  const collected: PullWithFiles[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PR_PAGES; page++) {
    const data: { repository: { pullRequests: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawPullNode[] } } } =
      await graphql(PULLS_QUERY, { owner, name: repo, cursor }, token);

    const { nodes, pageInfo } = data.repository.pullRequests;

    for (const node of nodes) {
      if (!node.mergedAt || Date.parse(node.mergedAt) <= since) continue;
      collected.push(toPullWithFiles(node));
    }

    // Sorted by updatedAt desc, so once a whole page predates the window there
    // is nothing older left worth fetching.
    const pageIsStale = nodes.every((n) => Date.parse(n.updatedAt) < since);
    if (pageIsStale || !pageInfo.hasNextPage) break;

    cursor = pageInfo.endCursor;
  }

  return collected.sort((a, b) => Date.parse(a.pr.mergedAt) - Date.parse(b.pr.mergedAt));
}

function toPullWithFiles(node: RawPullNode): PullWithFiles {
  const files = node.files?.nodes.map((f) => f.path) ?? [];

  return {
    pr: {
      number: node.number,
      title: node.title,
      body: node.body,
      htmlUrl: node.url,
      author: node.author?.login ?? "unknown",
      isBot: node.author?.__typename === "Bot",
      mergedAt: node.mergedAt as string,
    },
    files,
    truncated: (node.files?.totalCount ?? 0) > files.length,
  };
}

export async function fetchReleasesSince(
  owner: string,
  repo: string,
  sinceISO: string,
  token: string,
  packageSource: ReleasePackageSource,
): Promise<Release[]> {
  const data: { repository: { releases: { nodes: RawReleaseNode[] } } } = await graphql(
    RELEASES_QUERY,
    { owner, name: repo },
    token,
  );

  const since = Date.parse(sinceISO);

  return data.repository.releases.nodes
    .filter((r) => !r.isDraft && r.publishedAt !== null)
    .filter((r) => Date.parse(r.publishedAt as string) > since)
    .map((r) => toRelease(r, packageSource, repo))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

function toRelease(r: RawReleaseNode, packageSource: ReleasePackageSource, repo: string): Release {
  return {
    id: r.databaseId,
    name: r.name?.trim() || r.tagName,
    tagName: r.tagName,
    htmlUrl: r.url,
    publishedAt: r.publishedAt as string,
    isPrerelease: r.isPrerelease,
    body: r.description,
    packages: extractReleasedPackages(
      { tagName: r.tagName, body: r.description },
      packageSource,
      repo,
    ),
  };
}
