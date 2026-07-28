import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mergedSearchUrl, summarizeBody, truncateTitle } from "./buildReport.js";
import type { RepoReport } from "../types.js";

describe("summarizeBody", () => {
  test("returns null for empty or missing bodies", () => {
    assert.equal(summarizeBody(null), null);
    assert.equal(summarizeBody(""), null);
    assert.equal(summarizeBody("   \n  "), null);
  });

  test("strips the HTML comments PR templates are full of", () => {
    const body = "<!-- Please describe your change -->\nFixes a race in the runtime.";
    assert.equal(summarizeBody(body), "Fixes a race in the runtime.");
  });

  test("strips headings, bullets, and checklists", () => {
    const body = "## Summary\n- [x] done\n- Adds retry logic to the client";
    assert.equal(summarizeBody(body), "Summary done Adds retry logic to the client");
  });

  test("keeps link text but drops URLs", () => {
    assert.equal(summarizeBody("See [the docs](https://example.com) for details"), "See the docs for details");
  });

  test("drops fenced code blocks", () => {
    assert.equal(summarizeBody("Before\n```ts\nconst x = 1;\n```\nAfter"), "Before After");
  });

  test("truncates with an ellipsis at the limit", () => {
    const result = summarizeBody("x".repeat(300));
    assert.equal(result?.length, 150);
    assert.ok(result?.endsWith("…"));
  });

  test("returns null when nothing survives stripping", () => {
    assert.equal(summarizeBody("<!-- only a comment -->"), null);
  });
});

describe("truncateTitle", () => {
  test("leaves short titles alone", () => {
    assert.equal(truncateTitle("fix: small bug"), "fix: small bug");
  });

  test("truncates long titles to the limit", () => {
    const result = truncateTitle("y".repeat(120));
    assert.equal(result.length, 80);
    assert.ok(result.endsWith("…"));
  });
});

describe("mergedSearchUrl", () => {
  test("builds a window-scoped GitHub PR search link", () => {
    const report = {
      key: "CopilotKit/CopilotKit",
      owner: "CopilotKit",
      repo: "CopilotKit",
      sinceISO: "2026-07-28T06:00:00.000Z",
      untilISO: "2026-07-28T12:00:00.000Z",
      prs: [],
      releases: [],
    } satisfies RepoReport;

    const url = mergedSearchUrl(report);
    assert.ok(url.startsWith("https://github.com/CopilotKit/CopilotKit/pulls?q="));
    assert.ok(decodeURIComponent(url).includes("merged:2026-07-28T06:00:00Z..2026-07-28T12:00:00Z"));
  });
});
