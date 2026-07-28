/**
 * Shared types for the poller. Kept in one file because the whole surface is small
 * and every module needs most of it.
 */

/**
 * Change categories, ordered by how prominently they appear in the report.
 * `Packages` and `Docs` are the highlighted ones (priority 0); everything else
 * is reported tersely so it cannot bury them.
 */
export type Category = "Packages" | "Docs" | "ShowcaseDemo" | "Examples" | "Internal";

/**
 * Lower number = more prominent. Drives section order.
 *
 * Deliberately a total order with no ties: equal priorities would leave ordering
 * up to whichever file happened to be encountered first in a diff, making report
 * layout vary run to run. Whether a category is *highlighted* is a separate
 * question, answered by HIGHLIGHTED_CATEGORIES below.
 */
export const CATEGORY_PRIORITY: Record<Category, number> = {
  Docs: 0,
  Packages: 1,
  ShowcaseDemo: 10,
  Examples: 20,
  Internal: 30,
};

/** Categories rendered with full per-PR detail. Everything else gets a count only. */
export const HIGHLIGHTED_CATEGORIES: readonly Category[] = ["Docs", "Packages"];

export const CATEGORY_LABEL: Record<Category, string> = {
  Packages: "📦 Packages",
  Docs: "📚 Docs",
  ShowcaseDemo: "🧪 Showcase / Demo",
  Examples: "💡 Examples",
  Internal: "🔧 Internal / Meta",
};

/**
 * One path-prefix rule. Rules are evaluated in array order and the first
 * `pathPrefix` match wins for a given file, so more specific prefixes must be
 * listed before more general ones (e.g. `showcase/shell-docs/` before `showcase/`).
 */
export interface CategoryRule {
  pathPrefix: string;
  category: Category;
  /** Optional annotation surfaced in the report, e.g. "mirror, not canonical". */
  note?: string;
}

export interface RepoConfig {
  owner: string;
  repo: string;
  rules: CategoryRule[];
}

/** The `owner/repo` string used as the state-file key and in report headers. */
export type RepoKey = string;

export interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  htmlUrl: string;
  author: string;
  isBot: boolean;
  mergedAt: string;
  /** Populated for merge, squash, and rebase strategies alike. */
  mergeCommitSha: string | null;
}

export interface Release {
  id: number;
  name: string;
  tagName: string;
  htmlUrl: string;
  publishedAt: string;
  isPrerelease: boolean;
}

/** Per-category classification result for a single PR. */
export interface CategoryHit {
  count: number;
  /** Sample of matched paths, capped — used for report context, not exhaustive. */
  sampleFiles: string[];
  notes: string[];
}

export interface ClassifiedPR {
  pr: PullRequest;
  /** Every category this PR touches; a PR appears under each of them in the report. */
  categories: Map<Category, CategoryHit>;
  totalFiles: number;
  /** True when GitHub truncated the file list (very large PR). */
  truncated: boolean;
  /** Tag of the release this PR shipped in, if we could confirm one. */
  releasedIn: string | null;
}

export interface RepoReport {
  key: RepoKey;
  owner: string;
  repo: string;
  sinceISO: string;
  untilISO: string;
  prs: ClassifiedPR[];
  releases: Release[];
}

export interface Report {
  generatedAtISO: string;
  repos: RepoReport[];
}

export interface RepoState {
  lastCheckedISO: string;
  /** Dedup safety net against timestamp-boundary double-reporting. */
  reportedPRs: number[];
  reportedReleaseIds: number[];
  /**
   * Merge dates keyed by PR number, used to age out `reportedPRs` entries so the
   * state file does not grow without bound.
   */
  reportedPRDates: Record<string, string>;
}

export interface State {
  schemaVersion: number;
  repos: Record<RepoKey, RepoState>;
}
