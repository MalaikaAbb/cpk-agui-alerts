import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  appendToBuffer,
  bucketsForRelease,
  buildReleaseReport,
  bufferSize,
  drainBuckets,
  emptyBuffer,
  MAX_BUFFERED_PER_BUCKET,
} from "./buffer.js";
import { classifyPR } from "../categorize/classify.js";
import { copilotKitRules } from "../categorize/rules.js";
import type { Release } from "../types.js";

function pr(number: number, files: string[], mergedAt = "2026-07-28T12:00:00Z") {
  return classifyPR(
    {
      number,
      title: `PR ${number}`,
      body: null,
      htmlUrl: `https://github.com/o/r/pull/${number}`,
      author: "someone",
      isBot: false,
      mergedAt,
    },
    files,
    copilotKitRules,
  );
}

function release(tagName: string, publishedAt = "2026-07-28T18:00:00Z"): Release {
  return {
    id: 1,
    name: tagName,
    tagName,
    htmlUrl: "https://github.com/o/r/releases/x",
    publishedAt,
    isPrerelease: false,
    body: null,
    packages: [],
  };
}

describe("appendToBuffer", () => {
  test("files a change under the package it touched", () => {
    const buffer = emptyBuffer();
    appendToBuffer(buffer, [pr(1, ["packages/channels/src/bot.ts"])]);

    assert.deepEqual(Object.keys(buffer.buckets), ["channels"]);
    assert.deepEqual(buffer.buckets.channels?.[0]?.areas, { channels: ["bot"] });
  });

  test("a multi-package change lands in every bucket it touched", () => {
    const buffer = emptyBuffer();
    appendToBuffer(buffer, [
      pr(1, ["packages/channels/src/bot.ts", "packages/react-core/src/lib/x.ts"]),
    ]);

    assert.deepEqual(Object.keys(buffer.buckets).sort(), ["channels", "react-core"]);
  });

  // Docs are announced when they merge and never replayed, so they must not
  // enter the buffer at all.
  test("docs and other non-package work are never buffered", () => {
    const buffer = emptyBuffer();
    appendToBuffer(buffer, [
      pr(1, ["showcase/shell-docs/src/content/docs/integrations/mastra/quickstart.mdx"]),
      pr(2, ["showcase/aimock/x.json"]),
      pr(3, ["examples/canvas/a.tsx"]),
    ]);

    assert.equal(bufferSize(buffer), 0);
    assert.deepEqual(Object.keys(buffer.buckets), []);
  });

  test("re-appending the same PR does not duplicate it", () => {
    const buffer = emptyBuffer();
    appendToBuffer(buffer, [pr(1, ["packages/core/src/a.ts"])]);
    appendToBuffer(buffer, [pr(1, ["packages/core/src/a.ts"])]);

    assert.equal(bufferSize(buffer), 1);
  });

  test("the per-bucket cap drops oldest and records the count", () => {
    const buffer = emptyBuffer();
    appendToBuffer(
      buffer,
      Array.from({ length: MAX_BUFFERED_PER_BUCKET + 5 }, (_, i) =>
        pr(i + 1, ["packages/core/src/a.ts"]),
      ),
    );

    assert.equal(buffer.buckets.core?.length, MAX_BUFFERED_PER_BUCKET);
    assert.equal(buffer.dropped.core, 5);
    assert.equal(buffer.buckets.core?.[0]?.number, 6, "oldest five were dropped");
  });
});

describe("bucketsForRelease — scoped vs repo-wide", () => {
  function seeded() {
    const buffer = emptyBuffer();
    appendToBuffer(buffer, [
      pr(1, ["packages/channels/src/bot.ts"]),
      pr(2, ["packages/react-core/src/lib/x.ts"]),
    ]);
    return buffer;
  }

  test("a scoped tag drains only its own package", () => {
    assert.deepEqual(bucketsForRelease(seeded(), "channels"), ["channels"]);
  });

  test("a repo-wide tag drains everything", () => {
    assert.deepEqual(bucketsForRelease(seeded(), null).sort(), ["channels", "react-core"]);
  });

  test("a scoped tag for a package with nothing buffered drains nothing", () => {
    assert.deepEqual(bucketsForRelease(seeded(), "voice"), []);
  });
});

/**
 * The live regression: PR #6373 touched three channels packages across eight
 * subpaths, and the deployed report listed it eight times with channels-core as
 * four separate headings.
 */
describe("buildReleaseReport — no repetition (live case #6373)", () => {
  function liveCase() {
    const buffer = emptyBuffer();
    appendToBuffer(buffer, [
      pr(6373, [
        "packages/channels-core/src/canonical-run-loop.ts",
        "packages/channels-core/src/delivery-error.ts",
        "packages/channels-core/src/index.ts",
        "packages/channels-core/src/run-loop.ts",
        "packages/channels-intelligence/src/delivery-transport.ts",
        "packages/channels-intelligence/src/index.ts",
        "packages/channels-intelligence/src/realtime-gateway.ts",
        "packages/channels-slack/src/__tests__/a.test.ts",
      ]),
      pr(6371, ["packages/channels-intelligence/src/realtime-gateway.ts"]),
    ]);
    return buffer;
  }

  test("each PR appears exactly once", () => {
    const report = buildReleaseReport(liveCase(), release("v1.66.2"), null);
    const numbers = report.entries.map((e) => e.change.number);

    assert.deepEqual(numbers.sort(), [6371, 6373]);
    assert.equal(new Set(numbers).size, numbers.length, "no PR listed twice");
  });

  test("each package appears once per PR, with its subpaths collapsed", () => {
    const report = buildReleaseReport(liveCase(), release("v1.66.2"), null);
    const entry = report.entries.find((e) => e.change.number === 6373);

    const pkgs = entry?.packages.map((p) => p.pkg) ?? [];
    assert.deepEqual(pkgs, ["channels-core", "channels-intelligence", "channels-slack"]);
    assert.equal(new Set(pkgs).size, pkgs.length, "no package listed twice");

    assert.deepEqual(entry?.packages[0]?.subpaths, [
      "canonical-run-loop",
      "delivery-error",
      "index",
      "run-loop",
    ]);
  });

  test("the count is PRs, not areas — 2 rather than the old 6", () => {
    assert.equal(buildReleaseReport(liveCase(), release("v1.66.2"), null).totalChanges, 2);
  });

  test("a scoped release shows only the released package's subpaths", () => {
    const report = buildReleaseReport(liveCase(), release("channels-core/v1.0.0"), "channels-core");
    const entry = report.entries.find((e) => e.change.number === 6373);

    assert.deepEqual(entry?.packages.map((p) => p.pkg), ["channels-core"]);
  });
});

describe("buildReleaseReport — docs affected", () => {
  test("collects deduped pages, reference before guide", () => {
    const buffer = emptyBuffer();
    appendToBuffer(buffer, [
      pr(1, ["packages/react-core/src/v2/hooks/use-frontend-tool.tsx"]),
      pr(2, ["packages/react-core/src/v2/hooks/use-human-in-the-loop.tsx"]),
    ]);

    const { docsAffected } = buildReleaseReport(buffer, release("v1.0.0"), null);

    assert.equal(docsAffected[0]?.kind, "reference");
    assert.equal(new Set(docsAffected.map((d) => d.url)).size, docsAffected.length, "deduped");
    assert.ok(docsAffected.some((d) => d.url.endsWith("/reference/hooks/useFrontendTool")));
    assert.ok(docsAffected.some((d) => d.url.endsWith("/reference/hooks/useHumanInTheLoop")));
  });

  test("a release with no documented surface has none", () => {
    const buffer = emptyBuffer();
    appendToBuffer(buffer, [pr(1, ["packages/demo-agents/src/openai.ts"])]);

    assert.deepEqual(buildReleaseReport(buffer, release("v1.0.0"), null).docsAffected, []);
  });
});

describe("buildReleaseReport — claiming and purging", () => {
  test("a change cannot ship in a release cut before it merged", () => {
    const buffer = emptyBuffer();
    appendToBuffer(buffer, [pr(1, ["packages/core/src/a.ts"], "2026-07-28T20:00:00Z")]);

    const report = buildReleaseReport(buffer, release("v1.0.0", "2026-07-28T18:00:00Z"), null);
    assert.equal(report.totalChanges, 0);
  });

  test("two releases in one run partition the buffer instead of repeating it", () => {
    const buffer = emptyBuffer();
    appendToBuffer(buffer, [
      pr(1, ["packages/core/src/a.ts"], "2026-07-28T08:00:00Z"),
      pr(2, ["packages/core/src/b.ts"], "2026-07-28T16:00:00Z"),
    ]);

    const claimed = new Set<number>();
    const first = buildReleaseReport(buffer, release("v1.0.0", "2026-07-28T12:00:00Z"), null, claimed);
    const second = buildReleaseReport(buffer, release("v1.1.0", "2026-07-28T20:00:00Z"), null, claimed);

    assert.deepEqual(first.entries.map((e) => e.change.number), [1]);
    assert.deepEqual(second.entries.map((e) => e.change.number), [2]);
  });

  test("building a report does not mutate the buffer", () => {
    const buffer = emptyBuffer();
    appendToBuffer(buffer, [pr(1, ["packages/channels/src/bot.ts"])]);

    buildReleaseReport(buffer, release("channels/v0.3.0"), "channels");
    assert.equal(bufferSize(buffer), 1, "buffer must survive until the send is confirmed");
  });

  test("a scoped drain leaves other packages waiting", () => {
    const buffer = emptyBuffer();
    appendToBuffer(buffer, [
      pr(1, ["packages/channels/src/bot.ts"]),
      pr(2, ["packages/react-core/src/lib/x.ts"]),
    ]);

    drainBuckets(buffer, bucketsForRelease(buffer, "channels"));

    assert.equal(buffer.buckets.channels, undefined);
    assert.equal(buffer.buckets["react-core"]?.length, 1);
  });

  test("a repo-wide drain empties the buffer and its dropped counters", () => {
    const buffer = emptyBuffer();
    appendToBuffer(
      buffer,
      Array.from({ length: MAX_BUFFERED_PER_BUCKET + 2 }, (_, i) =>
        pr(i + 1, ["packages/core/src/a.ts"]),
      ),
    );

    drainBuckets(buffer, bucketsForRelease(buffer, null));
    assert.equal(bufferSize(buffer), 0);
    assert.equal(buffer.dropped.core, undefined);
  });
});
