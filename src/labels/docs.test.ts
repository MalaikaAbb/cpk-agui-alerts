import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { labelDocsPath } from "./docs.js";

const DOCS = "showcase/shell-docs/src/content/";

describe("labelDocsPath — the two cases this feature was built for", () => {
  // Real file backing https://docs.copilotkit.ai/mastra/generative-ui/state-rendering
  test("Mastra state rendering", () => {
    const label = labelDocsPath(`${DOCS}docs/integrations/mastra/generative-ui/state-rendering.mdx`);

    assert.equal(label?.text, "Mastra — State Rendering");
    assert.equal(label?.url, "https://docs.copilotkit.ai/mastra/generative-ui/state-rendering");
  });

  // Real file backing .../agno/generative-ui/your-components/display-only
  test("Agno display-only", () => {
    const label = labelDocsPath(
      `${DOCS}docs/integrations/agno/generative-ui/your-components/display-only.mdx`,
    );

    assert.equal(label?.text, "Agno — Display Only");
    assert.equal(
      label?.url,
      "https://docs.copilotkit.ai/agno/generative-ui/your-components/display-only",
    );
  });
});

describe("labelDocsPath — folder names that are not URL slugs", () => {
  const cases: Array<[string, string, string]> = [
    ["adk", "Google ADK — Quickstart", "https://docs.copilotkit.ai/google-adk/quickstart"],
    ["crewai-flows", "CrewAI — Quickstart", "https://docs.copilotkit.ai/crewai-crews/quickstart"],
    ["aws-strands", "AWS Strands — Quickstart", "https://docs.copilotkit.ai/strands/quickstart"],
    [
      "microsoft-agent-framework",
      "MS Agent Framework — Quickstart",
      "https://docs.copilotkit.ai/ms-agent-python/quickstart",
    ],
    ["langgraph", "LangGraph — Quickstart", "https://docs.copilotkit.ai/langgraph-python/quickstart"],
  ];

  for (const [folder, expectedText, expectedUrl] of cases) {
    test(`${folder} -> ${expectedText}`, () => {
      const label = labelDocsPath(`${DOCS}docs/integrations/${folder}/quickstart.mdx`);
      assert.equal(label?.text, expectedText);
      assert.equal(label?.url, expectedUrl);
    });
  }

  test("an unknown folder falls back to title-casing its own name", () => {
    const label = labelDocsPath(`${DOCS}docs/integrations/some-new-agent/quickstart.mdx`);
    assert.equal(label?.text, "Some New Agent — Quickstart");
  });

  // built-in-agent serves at the bare root, with no framework prefix.
  test("built-in-agent links to the bare root", () => {
    const label = labelDocsPath(`${DOCS}docs/integrations/built-in-agent/quickstart.mdx`);
    assert.equal(label?.url, "https://docs.copilotkit.ai/quickstart");
  });
});

describe("labelDocsPath — path shapes", () => {
  test("index.mdx takes its parent directory's name", () => {
    const label = labelDocsPath(`${DOCS}docs/integrations/mastra/human-in-the-loop/index.mdx`);

    assert.equal(label?.text, "Mastra — Human In The Loop");
    assert.equal(label?.url, "https://docs.copilotkit.ai/mastra/human-in-the-loop");
  });

  // Parenthesised segments are route groups; the site strips them from URLs.
  test("route-group segments are stripped", () => {
    const label = labelDocsPath(`${DOCS}docs/integrations/aws-strands/(other)/telemetry/index.mdx`);

    assert.equal(label?.text, "AWS Strands — Telemetry");
    assert.equal(label?.url, "https://docs.copilotkit.ai/strands/telemetry");
  });

  test("nested pages use the leaf name", () => {
    const label = labelDocsPath(
      `${DOCS}docs/integrations/langgraph/generative-ui/a2ui/fixed-schema.mdx`,
    );
    assert.equal(label?.text, "LangGraph — Fixed Schema");
  });
});

describe("labelDocsPath — the non-framework tiers", () => {
  test("a root page is marked as serving every framework", () => {
    const label = labelDocsPath(`${DOCS}docs/generative-ui/state-rendering.mdx`);

    assert.equal(label?.text, "All frameworks — State Rendering");
    assert.equal(label?.url, "https://docs.copilotkit.ai/generative-ui/state-rendering");
    // No note — the "All frameworks" prefix already conveys it.
    assert.equal(label?.note, undefined);
  });

  // A snippet edit changes one page across ~11 frameworks at once.
  test("a shared snippet is flagged as fanning out", () => {
    const label = labelDocsPath(`${DOCS}snippets/shared/generative-ui/display-only.mdx`);

    assert.equal(label?.text, "Shared — Display Only");
    assert.match(label?.note ?? "", /affects all frameworks/i);
  });

  test("reference pages are labelled and linked", () => {
    const label = labelDocsPath(`${DOCS}reference/hooks/use-agent.mdx`);

    assert.equal(label?.text, "Reference — Use Agent");
    assert.equal(label?.url, "https://docs.copilotkit.ai/reference/hooks/use-agent");
  });

  // Editing this tree never reaches docs.ag-ui.com — the reader must be told.
  test("the AG-UI mirror carries its caveat and no link", () => {
    const label = labelDocsPath(`${DOCS}ag-ui/concepts/events.mdx`);

    assert.equal(label?.text, "AG-UI mirror — Events");
    assert.equal(label?.url, undefined);
    assert.match(label?.note ?? "", /canonical/i);
  });
});

describe("labelDocsPath — non-pages", () => {
  const nonPages = [
    `${DOCS}docs/integrations/meta.json`,
    `showcase/shell-docs/src/lib/registry.ts`,
    `showcase/shell-docs/src/components/nav.tsx`,
    `showcase/shell-docs/package.json`,
    `packages/core/src/index.ts`,
  ];

  for (const path of nonPages) {
    test(`${path} is not a docs page`, () => {
      assert.equal(labelDocsPath(path), null);
    });
  }
});
