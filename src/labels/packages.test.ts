import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { labelPackagePath } from "./packages.js";

describe("labelPackagePath — per-symbol areas", () => {
  // CopilotKit is file-per-symbol, so the filename identifies the change.
  // The displayed name comes from the reference page, giving canonical casing.
  const symbols: Array<[path: string, bucket: string, subpath: string]> = [
    ["packages/react-core/src/v2/hooks/use-frontend-tool.tsx", "react-core", "useFrontendTool"],
    ["packages/react-core/src/v2/hooks/use-human-in-the-loop.tsx", "react-core", "useHumanInTheLoop"],
    ["packages/react-core/src/v2/hooks/use-threads.tsx", "react-core", "useThreads"],
    ["packages/react-core/src/hooks/use-copilot-readable.ts", "react-core", "useCopilotReadable"],
    ["packages/react-core/src/v2/components/chat/CopilotSidebar.tsx", "react-core", "CopilotSidebar"],
  ];

  for (const [path, bucket, subpath] of symbols) {
    test(`${path} -> ${subpath}`, () => {
      const label = labelPackagePath(path);
      assert.equal(label?.bucket, bucket);
      assert.equal(label?.subpath, subpath);
    });
  }

  // Naive kebab->camel yields useCoagentStateRender / useLanggraphInterrupt.
  // Normalized matching against the reference index recovers the real casing.
  test("compound names get their true capitalisation", () => {
    assert.equal(
      labelPackagePath("packages/react-core/src/hooks/use-coagent-state-render.ts")?.subpath,
      "useCoAgentStateRender",
    );
    assert.equal(
      labelPackagePath("packages/react-core/src/hooks/use-langgraph-interrupt.ts")?.subpath,
      "useLangGraphInterrupt",
    );
  });

  // Internal hooks have no reference page; we show the filename rather than
  // guessing at capitalisation, and emit no reference link.
  test("internal hooks keep their filename and get no reference link", () => {
    const label = labelPackagePath("packages/react-core/src/hooks/use-tree.ts");
    assert.equal(label?.subpath, "use-tree");
    assert.equal(label?.docs.some((d) => d.kind === "reference"), false);
  });
});

describe("labelPackagePath — directory areas (unchanged)", () => {
  const areas: Array<[path: string, bucket: string, subpath: string]> = [
    ["packages/runtime/src/agents/runner.ts", "runtime", "agents"],
    ["packages/runtime/src/service-adapters/openai.ts", "runtime", "service-adapters"],
    ["packages/core/src/core/suggestion-engine.ts", "core", "core"],
    ["packages/react-ui/src/css/sidebar.css", "react-ui", "css"],
    ["packages/channels-slack/src/adapter.ts", "channels-slack", "adapter"],
    ["sdk-python/copilotkit/langgraph.py", "sdk-python", "langgraph"],
    ["sdks/typescript/packages/core/src/events.ts", "core", "events"],
    ["integrations/crew-ai/python/agent.py", "crew-ai", "python"],
    ["middlewares/mcp-middleware/src/index.ts", "mcp-middleware", "index"],
  ];

  for (const [path, bucket, subpath] of areas) {
    test(`${path} -> ${subpath}`, () => {
      const label = labelPackagePath(path);
      assert.equal(label?.bucket, bucket);
      assert.equal(label?.subpath, subpath);
    });
  }

  test("a top-level source file uses its own stem", () => {
    assert.equal(labelPackagePath("packages/core/src/memory.ts")?.subpath, "memory");
  });

  test("test files do not invent their own area", () => {
    assert.equal(
      labelPackagePath("packages/channels-intelligence/src/delivery-transport.test.ts")?.subpath,
      "delivery-transport",
    );
    assert.equal(labelPackagePath("packages/core/src/memory.spec.ts")?.subpath, "memory");
  });

  // A monorepo release PR bumps every package.json at once.
  test("manifest-only edits are not reported as package changes", () => {
    assert.equal(labelPackagePath("packages/channels/package.json"), null);
    assert.equal(labelPackagePath("packages/core/CHANGELOG.md"), null);
    assert.equal(labelPackagePath("sdk-python/pyproject.toml"), null);
  });
});

describe("labelPackagePath — docs affected", () => {
  test("a documented hook links to its reference page and its guide", () => {
    const docs = labelPackagePath("packages/react-core/src/v2/hooks/use-frontend-tool.tsx")?.docs ?? [];

    const reference = docs.find((d) => d.kind === "reference");
    assert.equal(reference?.url, "https://docs.copilotkit.ai/reference/hooks/useFrontendTool");
    assert.ok(docs.some((d) => d.kind === "guide" && d.url.endsWith("/frontend-tools")));
  });

  // The same filename exists in both hook trees and documents different pages.
  test("v1 and v2 use-frontend-tool resolve to different reference pages", () => {
    const v2 = labelPackagePath("packages/react-core/src/v2/hooks/use-frontend-tool.tsx");
    const v1 = labelPackagePath("packages/react-core/src/hooks/use-frontend-tool.ts");

    const url = (l: typeof v1) => l?.docs.find((d) => d.kind === "reference")?.url;
    assert.equal(url(v2), "https://docs.copilotkit.ai/reference/hooks/useFrontendTool");
    assert.equal(url(v1), "https://docs.copilotkit.ai/reference/v1/hooks/useFrontendTool");
    assert.notEqual(url(v1), url(v2));
  });

  test("a package with no reference surface still carries its guide", () => {
    const docs = labelPackagePath("packages/voice/src/transcription/openai.ts")?.docs ?? [];
    assert.ok(docs.some((d) => d.url.endsWith("/voice")));
  });

  test("packages with no docs surface yield no links", () => {
    assert.deepEqual(labelPackagePath("packages/demo-agents/src/openai.ts")?.docs, []);
  });
});

describe("labelPackagePath — non-package paths", () => {
  const nonPackages = [
    "showcase/shell-docs/src/content/docs/quickstart.mdx",
    "examples/canvas/app/page.tsx",
    "dev-docs/architecture/ARCHITECTURE.md",
    "README.md",
    "patches/eventsource@3.0.7.patch",
    "apps/dojo/src/page.tsx",
  ];

  for (const path of nonPackages) {
    test(`${path} has no package`, () => {
      assert.equal(labelPackagePath(path), null);
    });
  }
});
