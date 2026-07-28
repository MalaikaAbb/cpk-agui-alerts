/**
 * Minimal GitHub REST client. Native fetch only — the whole surface is four
 * endpoint shapes, so an SDK would cost more than it saves.
 */

const API_ROOT = "https://api.github.com";

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "cpk-agui-alert",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/**
 * GET a single JSON resource. Retries once on 5xx and on secondary rate limiting,
 * which GitHub signals with 403 + a Retry-After header.
 */
export async function ghGet<T>(path: string): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_ROOT}${path}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers: authHeaders() });

    if (res.ok) {
      return (await res.json()) as T;
    }

    const retryable = res.status >= 500 || isRateLimited(res);
    if (retryable && attempt === 0) {
      await sleep(retryAfterMs(res));
      continue;
    }

    const body = await res.text().catch(() => "");
    throw new GitHubError(
      `GitHub ${res.status} for ${url}: ${body.slice(0, 300)}`,
      res.status,
      url,
    );
  }

  // Unreachable: the loop either returns or throws.
  throw new GitHubError(`GitHub request failed for ${url}`, 0, url);
}

function isRateLimited(res: Response): boolean {
  if (res.status !== 403 && res.status !== 429) return false;
  return res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after");
}

function retryAfterMs(res: Response): number {
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 60_000);
  }
  return 2_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Walk a paginated list endpoint.
 *
 * `shouldStop` lets callers bail out early once results fall outside the time
 * window — important for `/pulls`, where the full closed-PR history is enormous
 * but we only ever want the last few hours of it.
 */
export async function ghPaginate<T>(
  path: string,
  opts: {
    perPage?: number;
    maxPages?: number;
    shouldStop?: (page: T[]) => boolean;
  } = {},
): Promise<{ items: T[]; truncated: boolean }> {
  const perPage = opts.perPage ?? 100;
  const maxPages = opts.maxPages ?? 10;
  const items: T[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const pageItems = await ghGet<T[]>(`${path}${sep}per_page=${perPage}&page=${page}`);

    items.push(...pageItems);

    if (pageItems.length < perPage) {
      return { items, truncated: false };
    }
    if (opts.shouldStop?.(pageItems)) {
      return { items, truncated: false };
    }
  }

  // Hit maxPages with a full final page — there is more data we did not fetch.
  return { items, truncated: true };
}
