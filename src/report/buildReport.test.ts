import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { displayablePRs, isEmpty, mergedSearchUrl, summarizeBody, truncateTitle } from "./buildReport.js";
import { classifyPR } from "../categorize/classify.js";
import { copilotKitRules } from "../categorize/rules.js";
import type { ClassifiedPR, Release, RepoReport } from "../types.js";

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

function prWith(files: string[], number = 1): ClassifiedPR {
  return classifyPR(
    {
      number,
      title: "t",
      body: null,
      htmlUrl: "https://github.com/o/r/pull/1",
      author: "a",
      isBot: false,
      mergedAt: "2026-07-28T12:00:00Z",
    },
    files,
    copilotKitRules,
  );
}

function reportWith(prs: ClassifiedPR[], releases: Release[] = []): RepoReport {
  return {
    key: "CopilotKit/CopilotKit",
    owner: "CopilotKit",
    repo: "CopilotKit",
    sinceISO: "2026-07-28T06:00:00.000Z",
    untilISO: "2026-07-28T12:00:00.000Z",
    prs,
    releases,
    releaseReports: [],
  };
}

const aRelease: Release = {
  id: 1,
  name: "channels/v0.3.0",
  tagName: "channels/v0.3.0",
  htmlUrl: "https://github.com/o/r/releases/tag/channels/v0.3.0",
  publishedAt: "2026-07-28T10:00:00.000Z",
  isPrerelease: false,
  body: "Release channels/v0.3.0",
  packages: [{ name: "channels", version: "0.3.0" }],
};

describe("isEmpty — only docs changes and package releases notify", () => {
  test("a docs PR triggers a notification", () => {
    assert.equal(isEmpty(reportWith([prWith(["showcase/shell-docs/src/content/a.mdx"])])), false);
  });

  test("a package release triggers a notification", () => {
    assert.equal(isEmpty(reportWith([], [aRelease])), false);
  });

  test("package PRs with no release stay silent", () => {
    assert.equal(isEmpty(reportWith([prWith(["packages/react-ui/src/a.ts"])])), true);
  });

  test("showcase-only activity stays silent", () => {
    assert.equal(isEmpty(reportWith([prWith(["showcase/aimock/d6/x.json"])])), true);
  });

  test("examples and internal activity stays silent", () => {
    assert.equal(
      isEmpty(reportWith([prWith(["examples/canvas/a.tsx"], 1), prWith(["dev-docs/x.md"], 2)])),
      true,
    );
  });

  test("a totally empty window stays silent", () => {
    assert.equal(isEmpty(reportWith([])), true);
  });

  // Docs riding along inside a bigger change still counts as a docs change.
  test("a mixed PR touching docs triggers a notification", () => {
    assert.equal(
      isEmpty(
        reportWith([
          prWith(["packages/core/a.ts", "showcase/aimock/b.json", "showcase/shell-docs/c.mdx"]),
        ]),
      ),
      false,
    );
  });
});

describe("displayablePRs", () => {
  test("package-only PRs are never rendered", () => {
    const report = reportWith([
      prWith(["packages/react-ui/src/a.ts"], 1),
      prWith(["showcase/shell-docs/src/content/b.mdx"], 2),
    ]);

    assert.deepEqual(
      displayablePRs(report).map((p) => p.pr.number),
      [2],
    );
  });

  test("a PR touching packages and docs is still rendered", () => {
    const report = reportWith([prWith(["packages/core/a.ts", "showcase/shell-docs/b.mdx"], 7)]);
    assert.equal(displayablePRs(report).length, 1);
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
      releaseReports: [],
    } satisfies RepoReport;

    const url = mergedSearchUrl(report);
    assert.ok(url.startsWith("https://github.com/CopilotKit/CopilotKit/pulls?q="));
    assert.ok(decodeURIComponent(url).includes("merged:2026-07-28T06:00:00Z..2026-07-28T12:00:00Z"));
  });
});
