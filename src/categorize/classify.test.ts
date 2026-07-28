import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyFile, classifyPR, prsInCategory, sortedCategories } from "./classify.js";
import { agUiRules, copilotKitRules } from "./rules.js";
import type { PullRequest } from "../types.js";

function fakePR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 1,
    title: "Test PR",
    body: null,
    htmlUrl: "https://github.com/o/r/pull/1",
    author: "someone",
    isBot: false,
    mergedAt: "2026-07-28T12:00:00Z",
    ...overrides,
  };
}

describe("classifyFile — CopilotKit", () => {
  const cases: Array<[string, string]> = [
    ["packages/react-core/src/hooks/useAgent.ts", "Packages"],
    ["packages/runtime/src/agents/index.ts", "Packages"],
    ["packages/channels-slack/src/bot.ts", "Packages"],
    ["sdk-python/copilotkit/agent.py", "Packages"],
    ["showcase/shell-docs/src/content/docs/quickstart.mdx", "Docs"],
    ["showcase/shell-docs/src/lib/registry.ts", "Docs"],
    ["showcase/shell-docs/src/content/reference/hooks/use-agent.mdx", "Docs"],
    ["showcase/integrations/mastra/backend.ts", "ShowcaseDemo"],
    ["showcase/aimock/d6/mastra/fixture.json", "ShowcaseDemo"],
    ["showcase/shared/tools.ts", "ShowcaseDemo"],
    ["examples/canvas/app/page.tsx", "Examples"],
    ["dev-docs/architecture/ARCHITECTURE.md", "Internal"],
    ["skills/copilotkit-setup/SKILL.md", "Internal"],
    ["CLAUDE.md", "Internal"],
    ["package.json", "Internal"],
  ];

  for (const [path, expected] of cases) {
    test(`${path} -> ${expected}`, () => {
      assert.equal(classifyFile(path, copilotKitRules).category, expected);
    });
  }

  // The ordering trap: shell-docs lives under showcase/, so a generic showcase/
  // rule placed first would swallow every docs change.
  test("shell-docs wins over the generic showcase/ rule", () => {
    assert.equal(
      classifyFile("showcase/shell-docs/src/content/docs/x.mdx", copilotKitRules).category,
      "Docs",
    );
    assert.equal(classifyFile("showcase/shell-dojo/src/x.tsx", copilotKitRules).category, "ShowcaseDemo");
  });

  test("the AG-UI docs mirror carries a caveat note", () => {
    const result = classifyFile(
      "showcase/shell-docs/src/content/ag-ui/introduction.mdx",
      copilotKitRules,
    );
    assert.equal(result.category, "Docs");
    assert.match(result.note ?? "", /canonical/i);
  });
});

describe("classifyFile — ag-ui", () => {
  const cases: Array<[string, string]> = [
    ["sdks/typescript/packages/core/src/events.ts", "Packages"],
    ["sdks/python/ag_ui/core/types.py", "Packages"],
    ["sdks/dotnet/src/AGUI.Client/Client.cs", "Packages"],
    ["sdks/community/go/pkg/agent.go", "Packages"],
    ["integrations/langgraph/src/agent.ts", "Packages"],
    ["integrations/crew-ai/python/agent.py", "Packages"],
    ["middlewares/mcp-middleware/src/index.ts", "Packages"],
    ["docs/concepts/events.mdx", "Docs"],
    ["docs/quickstart/server.mdx", "Docs"],
    ["apps/dojo/src/app/page.tsx", "ShowcaseDemo"],
    ["apps/client-cli-example/src/main.ts", "Examples"],
    ["skills/ag-ui-a2ui-integration/SKILL.md", "Internal"],
    ["README.md", "Internal"],
  ];

  for (const [path, expected] of cases) {
    test(`${path} -> ${expected}`, () => {
      assert.equal(classifyFile(path, agUiRules).category, expected);
    });
  }

  test("client-cli-example wins over the generic apps/ rule", () => {
    assert.equal(classifyFile("apps/client-cli-example/x.ts", agUiRules).category, "Examples");
    assert.equal(classifyFile("apps/dojo/x.ts", agUiRules).category, "ShowcaseDemo");
  });

  test("community SDKs are flagged as community-maintained", () => {
    const result = classifyFile("sdks/community/rust/crates/core/src/lib.rs", agUiRules);
    assert.equal(result.category, "Packages");
    assert.match(result.note ?? "", /community/i);
  });
});

describe("classifyPR", () => {
  test("a PR spanning areas is recorded under every category it touches", () => {
    const classified = classifyPR(
      fakePR(),
      [
        "packages/react-core/src/index.ts",
        "packages/react-core/src/hooks/useAgent.ts",
        "showcase/shell-docs/src/content/docs/guide.mdx",
        "showcase/integrations/mastra/main.ts",
      ],
      copilotKitRules,
    );

    assert.deepEqual(sortedCategories(classified), ["Docs", "Packages", "ShowcaseDemo"]);
    assert.equal(classified.categories.get("Packages")?.count, 2);
    assert.equal(classified.categories.get("Docs")?.count, 1);
    assert.equal(classified.totalFiles, 4);
  });

  test("highlighted categories sort ahead of secondary ones", () => {
    const classified = classifyPR(
      fakePR(),
      ["examples/a.ts", "dev-docs/b.md", "packages/core/c.ts"],
      copilotKitRules,
    );

    assert.equal(sortedCategories(classified)[0], "Packages");
  });

  test("sample files are capped but counts are not", () => {
    const files = Array.from({ length: 10 }, (_, i) => `packages/core/src/f${i}.ts`);
    const classified = classifyPR(fakePR(), files, copilotKitRules);

    assert.equal(classified.categories.get("Packages")?.count, 10);
    assert.equal(classified.categories.get("Packages")?.sampleFiles.length, 3);
  });

  test("an empty diff produces no categories", () => {
    const classified = classifyPR(fakePR(), [], copilotKitRules);
    assert.equal(classified.categories.size, 0);
  });

  test("a truncated file list is flagged", () => {
    const classified = classifyPR(fakePR(), ["packages/core/a.ts"], copilotKitRules, {
      truncated: true,
    });

    assert.equal(classified.truncated, true);
  });
});

describe("prsInCategory", () => {
  test("selects only PRs touching the category, biggest contribution first", () => {
    const small = classifyPR(fakePR({ number: 1 }), ["packages/core/a.ts"], copilotKitRules);
    const big = classifyPR(
      fakePR({ number: 2 }),
      ["packages/core/a.ts", "packages/core/b.ts", "packages/core/c.ts"],
      copilotKitRules,
    );
    const docsOnly = classifyPR(
      fakePR({ number: 3 }),
      ["showcase/shell-docs/src/content/x.mdx"],
      copilotKitRules,
    );

    const result = prsInCategory([small, big, docsOnly], "Packages");
    assert.deepEqual(
      result.map((p) => p.pr.number),
      [2, 1],
    );
  });
});
