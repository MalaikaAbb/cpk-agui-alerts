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
 * question, answered by PR_DETAIL_CATEGORIES below.
 */
export const CATEGORY_PRIORITY: Record<Category, number> = {
  Docs: 0,
  Packages: 1,
  ShowcaseDemo: 10,
  Examples: 20,
  Internal: 30,
};

/** Categories rendered with full per-PR detail. Everything else gets a count only. */
export const PR_DETAIL_CATEGORIES: readonly Category[] = ["Docs"];

/**
 * Categories reported only when a release ships them, never on merge.
 *
 * Package work is reported as "these packages were published at these versions",
 * not as a stream of merged PRs — a merged package PR is not yet usable by
 * anyone, so it is deliberately silent until a release makes it real.
 */
export const RELEASE_DRIVEN_CATEGORIES: readonly Category[] = ["Packages"];

/**
 * PR categories that on their own justify sending a notification.
 *
 * A published release always triggers one too. Everything else — showcase,
 * examples, internal — is context that rides along on a notification something
 * else earned; it never fires one by itself.
 */
export const NOTIFY_TRIGGER_CATEGORIES: readonly Category[] = ["Docs"];

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

/**
 * Where a repo records which packages a release published.
 *
 * - `tag`  — the tag itself names the package (CopilotKit: `channels/v0.3.0`).
 * - `body` — the release notes contain a "Packages Published" table (ag-ui,
 *            whose tags are repo-wide dates like `release/2026-07-28`).
 */
export type ReleasePackageSource = "tag" | "body";

export interface RepoConfig {
  owner: string;
  repo: string;
  rules: CategoryRule[];
  releasePackageSource: ReleasePackageSource;
}

/** A package confirmed published by a release. */
export interface ReleasedPackage {
  name: string;
  version: string;
  /** e.g. "PyPI", "NuGet" — only known when parsed from a release body. */
  ecosystem?: string;
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
}

export interface Release {
  id: number;
  name: string;
  tagName: string;
  htmlUrl: string;
  publishedAt: string;
  isPrerelease: boolean;
  body: string | null;
  /** Packages this release published, resolved per the repo's source strategy. */
  packages: ReleasedPackage[];
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
  /** Human-readable docs labels, e.g. "Mastra — State Rendering". */
  docsLabels: DocsLabel[];
  /** Human-readable package labels, e.g. "runtime — agents". */
  packageLabels: PackageLabel[];
}

/**
 * A docs page a change touched, named the way a reader would recognise it
 * rather than by file path or PR title.
 */
export interface DocsLabel {
  /** Rendered label, e.g. "Mastra — State Rendering". */
  text: string;
  /** Public docs URL, when the path maps to one. */
  url?: string;
  /** Caveat to surface, e.g. the AG-UI mirror warning or shared-page fan-out. */
  note?: string;
}

/** A package area a change touched, e.g. bucket "runtime", text "runtime — agents". */
export interface PackageLabel {
  /** Buffer bucket key — the package directory name. */
  bucket: string;
  /** The area within the package: a directory, a file stem, or a symbol name. */
  subpath: string;
  /** Docs pages this change may have made stale. */
  docs: DocsAffected[];
}

/** A docs page a package change may have invalidated. */
export interface DocsAffected {
  text: string;
  url: string;
  /** Reference pages sort before conceptual guides. */
  kind: "reference" | "guide";
}

/**
 * One merged package change held in the buffer until its package releases.
 *
 * Docs changes are NOT buffered — they are reported in the run that finds them
 * and never replayed, so the buffer holds only unreleased package work.
 */
export interface BufferedChange {
  number: number;
  title: string;
  url: string;
  author: string;
  mergedAt: string;
  /**
   * Subpaths touched, keyed by package. Structured rather than pre-rendered
   * `pkg — area` strings so the renderer can group by package without parsing.
   */
  areas: Record<string, string[]>;
  /** Docs pages these changes may have invalidated. */
  docs: DocsAffected[];
}

/** Pending package changes per package, flushed when that package releases. */
export interface ChangeBuffer {
  buckets: Record<string, BufferedChange[]>;
  /** Entries dropped by the per-bucket cap, keyed by bucket. */
  dropped: Record<string, number>;
}

/** One PR in a changelog, with the packages it touched nested under it. */
export interface ChangelogEntry {
  change: BufferedChange;
  packages: Array<{ pkg: string; subpaths: string[] }>;
}

/** What a release flush produced, ready to render. */
export interface ReleaseReport {
  release: Release;
  /** null for a repo-wide release, which flushes everything. */
  scope: string | null;
  /** One entry per PR — a PR is never listed twice. */
  entries: ChangelogEntry[];
  /** Deduped docs pages the released changes may have invalidated. */
  docsAffected: DocsAffected[];
  /** Distinct PR count, not an area count. */
  totalChanges: number;
  droppedCount: number;
}

export interface RepoReport {
  key: RepoKey;
  owner: string;
  repo: string;
  sinceISO: string;
  untilISO: string;
  prs: ClassifiedPR[];
  releases: Release[];
  /** One per release that flushed a buffer bucket in this run. */
  releaseReports: ReleaseReport[];
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
  /** Changes accumulated since each package last released. */
  buffer: ChangeBuffer;
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

/**
 * The subset of Cloudflare's KVNamespace we use.
 *
 * Declared structurally rather than pulling in `@cloudflare/workers-types`,
 * which collides with `@types/node` over globals like fetch and Response. The
 * real KVNamespace satisfies this, and tests can pass a plain in-memory stub.
 */
export interface KVStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

/** Bindings and secrets configured in wrangler.toml / `wrangler secret put`. */
export interface Env {
  /** KV namespace holding the poll cursor. Bound in wrangler.toml. */
  STATE: KVStore;
  /** Fine-grained PAT with public read access. GraphQL rejects anonymous calls. */
  GITHUB_TOKEN: string;
  GOOGLE_CHAT_WEBHOOK_URL?: string;
  /** "true" logs the payload instead of posting it. */
  DRY_RUN?: string;
  /** "always" posts an all-quiet card when a window produced nothing. */
  HEARTBEAT_MODE?: string;
}
