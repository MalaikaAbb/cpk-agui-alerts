import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchMergedPulls, fetchReleasesSince, GitHubError } from "./graphql.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: { query: string; variables: Record<string, unknown> };
}

/** Stub fetch, returning queued payloads and recording what was sent. */
function stubFetch(payloads: unknown[]): Captured[] {
  const captured: Captured[] = [];
  let call = 0;

  globalThis.fetch = (async (url: string, init: RequestInit) => {
    captured.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    const payload = payloads[Math.min(call++, payloads.length - 1)];

    return {
      ok: true,
      status: 200,
      async json() {
        return payload;
      },
      async text() {
        return JSON.stringify(payload);
      },
    };
  }) as unknown as typeof fetch;

  return captured;
}

const pullsPayload = (nodes: unknown[], hasNextPage = false, endCursor: string | null = null) => ({
  data: { repository: { pullRequests: { pageInfo: { hasNextPage, endCursor }, nodes } } },
});

const prNode = (over: Record<string, unknown> = {}) => ({
  number: 1,
  title: "fix: something",
  body: "A body.",
  url: "https://github.com/o/r/pull/1",
  mergedAt: "2026-07-28T10:00:00Z",
  updatedAt: "2026-07-28T10:00:00Z",
  author: { login: "someone", __typename: "User" },
  files: { totalCount: 2, nodes: [{ path: "packages/core/a.ts" }, { path: "docs/b.mdx" }] },
  ...over,
});

const SINCE = "2026-07-28T06:00:00Z";

describe("fetchMergedPulls", () => {
  test("posts an authenticated GraphQL request", async () => {
    const captured = stubFetch([pullsPayload([])]);
    await fetchMergedPulls("o", "r", SINCE, "tok123");

    assert.equal(captured[0]?.url, "https://api.github.com/graphql");
    assert.equal(captured[0]?.headers.Authorization, "Bearer tok123");
    assert.deepEqual(captured[0]?.body.variables, { owner: "o", name: "r", cursor: null });
  });

  test("maps a PR and its files inline — no per-PR request", async () => {
    const captured = stubFetch([pullsPayload([prNode()])]);
    const result = await fetchMergedPulls("o", "r", SINCE, "t");

    assert.equal(captured.length, 1, "one request regardless of PR count");
    assert.equal(result.length, 1);
    assert.deepEqual(result[0]?.files, ["packages/core/a.ts", "docs/b.mdx"]);
    assert.equal(result[0]?.pr.number, 1);
    assert.equal(result[0]?.pr.author, "someone");
    assert.equal(result[0]?.pr.isBot, false);
    assert.equal(result[0]?.truncated, false);
  });

  test("identifies bot authors", async () => {
    stubFetch([pullsPayload([prNode({ author: { login: "dependabot", __typename: "Bot" } })])]);
    const result = await fetchMergedPulls("o", "r", SINCE, "t");

    assert.equal(result[0]?.pr.isBot, true);
  });

  test("flags PRs whose file list was cut off", async () => {
    stubFetch([
      pullsPayload([prNode({ files: { totalCount: 500, nodes: [{ path: "packages/a.ts" }] } })]),
    ]);
    const result = await fetchMergedPulls("o", "r", SINCE, "t");

    assert.equal(result[0]?.truncated, true);
  });

  test("excludes PRs merged at or before the cursor", async () => {
    stubFetch([
      pullsPayload([
        prNode({ number: 1, mergedAt: "2026-07-28T10:00:00Z" }),
        prNode({ number: 2, mergedAt: "2026-07-28T05:00:00Z" }), // before window
        prNode({ number: 3, mergedAt: SINCE }), // exactly at cursor — already reported
      ]),
    ]);
    const result = await fetchMergedPulls("o", "r", SINCE, "t");

    assert.deepEqual(result.map((r) => r.pr.number), [1]);
  });

  test("returns PRs oldest-merged first", async () => {
    stubFetch([
      pullsPayload([
        prNode({ number: 1, mergedAt: "2026-07-28T11:00:00Z" }),
        prNode({ number: 2, mergedAt: "2026-07-28T08:00:00Z" }),
      ]),
    ]);
    const result = await fetchMergedPulls("o", "r", SINCE, "t");

    assert.deepEqual(result.map((r) => r.pr.number), [2, 1]);
  });

  test("stops paginating once a page predates the window", async () => {
    const stale = prNode({ number: 9, mergedAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z" });
    const captured = stubFetch([pullsPayload([stale], true, "CURSOR")]);

    await fetchMergedPulls("o", "r", SINCE, "t");
    assert.equal(captured.length, 1, "should not fetch page 2");
  });

  test("follows the cursor when the page is still in-window", async () => {
    const captured = stubFetch([
      pullsPayload([prNode({ number: 1 })], true, "CURSOR2"),
      pullsPayload([prNode({ number: 2, mergedAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z" })]),
    ]);

    await fetchMergedPulls("o", "r", SINCE, "t");
    assert.equal(captured.length, 2);
    assert.equal(captured[1]?.body.variables.cursor, "CURSOR2");
  });

  test("rejects an empty token rather than calling anonymously", async () => {
    stubFetch([pullsPayload([])]);
    await assert.rejects(() => fetchMergedPulls("o", "r", SINCE, ""), GitHubError);
  });

  test("surfaces GraphQL errors", async () => {
    stubFetch([{ errors: [{ message: "Field 'nope' doesn't exist" }] }]);
    await assert.rejects(() => fetchMergedPulls("o", "r", SINCE, "t"), /doesn't exist/);
  });
});

describe("fetchReleasesSince", () => {
  const releasePayload = (nodes: unknown[]) => ({ data: { repository: { releases: { nodes } } } });

  const relNode = (over: Record<string, unknown> = {}) => ({
    databaseId: 101,
    name: "channels/v0.3.0",
    tagName: "channels/v0.3.0",
    url: "https://github.com/o/r/releases/tag/channels/v0.3.0",
    publishedAt: "2026-07-28T09:00:00Z",
    isDraft: false,
    isPrerelease: false,
    description: "Release channels/v0.3.0",
    ...over,
  });

  test("maps a release and resolves its package from the tag", async () => {
    stubFetch([releasePayload([relNode()])]);
    const releases = await fetchReleasesSince("o", "CopilotKit", SINCE, "t", "tag");

    assert.equal(releases.length, 1);
    assert.equal(releases[0]?.id, 101);
    assert.deepEqual(releases[0]?.packages, [{ name: "channels", version: "0.3.0" }]);
  });

  test("resolves packages from the body table when configured", async () => {
    const body = "## Packages Published\n### Python (PyPI)\n| Package | Version | Install |\n|---|---|---|\n| ag-ui-crewai | 0.2.1 | x |";
    stubFetch([releasePayload([relNode({ tagName: "release/2026-07-28", description: body })])]);

    const releases = await fetchReleasesSince("o", "ag-ui", SINCE, "t", "body");
    assert.deepEqual(releases[0]?.packages, [
      { name: "ag-ui-crewai", version: "0.2.1", ecosystem: "PyPI" },
    ]);
  });

  test("skips drafts and anything published before the cursor", async () => {
    stubFetch([
      releasePayload([
        relNode({ databaseId: 1 }),
        relNode({ databaseId: 2, isDraft: true }),
        relNode({ databaseId: 3, publishedAt: "2026-07-01T00:00:00Z" }),
        relNode({ databaseId: 4, publishedAt: null }),
      ]),
    ]);

    const releases = await fetchReleasesSince("o", "r", SINCE, "t", "tag");
    assert.deepEqual(releases.map((r) => r.id), [1]);
  });
});
