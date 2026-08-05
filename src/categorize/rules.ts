import type { CategoryRule } from "../types.js";

/**
 * Path-prefix rules per repo.
 *
 * ORDER MATTERS: the first matching prefix wins for a given file, so specific
 * prefixes must precede general ones. The classic trap here is `showcase/` —
 * `showcase/shell-docs/` is the docs site and must be matched before the generic
 * `showcase/` demo-app rule, or every docs change would be miscategorized.
 */

/**
 * CopilotKit/CopilotKit.
 *
 * Note: the repo's top-level `docs/` is only a symlink to `showcase/shell-docs/`,
 * so real docs changes land under the latter path in a diff. The `docs/` rule is
 * kept as a defensive fallback in case a commit ever touches the link itself.
 */
export const copilotKitRules: CategoryRule[] = [
  // Functional product code.
  { pathPrefix: "packages/", category: "Packages" },
  { pathPrefix: "sdk-python/", category: "Packages" },

  // Docs site. The ag-ui subtree is a downstream mirror of the ag-ui repo, whose
  // canonical source lives upstream — flag it so nobody edits it expecting it to stick.
  {
    pathPrefix: "showcase/shell-docs/src/content/ag-ui/",
    category: "Docs",
    note: "AG-UI mirror — canonical source is ag-ui-protocol/ag-ui",
  },
  { pathPrefix: "showcase/shell-docs/", category: "Docs" },
  { pathPrefix: "docs/", category: "Docs" },

  // Everything else under showcase/ is the internal demo + test dashboard.
  { pathPrefix: "showcase/", category: "ShowcaseDemo" },

  { pathPrefix: "examples/", category: "Examples" },

  { pathPrefix: "dev-docs/", category: "Internal" },
  { pathPrefix: "patches/", category: "Internal" },
  { pathPrefix: "skills/", category: "Internal" },
  { pathPrefix: ".claude/", category: "Internal" },
  { pathPrefix: ".github/", category: "Internal" },
  { pathPrefix: "scripts/", category: "Internal" },
  { pathPrefix: "codemods/", category: "Internal" },
  { pathPrefix: "community/", category: "Internal" },
];

/**
 * ag-ui-protocol/ag-ui.
 *
 * `integrations/` and `middlewares/` are framework adapters and middleware
 * packages — functional code, so they classify as Packages rather than examples.
 */
export const agUiRules: CategoryRule[] = [
  // Protocol SDKs across all languages.
  { pathPrefix: "sdks/typescript/", category: "Packages" },
  { pathPrefix: "sdks/python/", category: "Packages" },
  { pathPrefix: "sdks/dotnet/", category: "Packages" },
  { pathPrefix: "sdks/community/", category: "Packages", note: "community-maintained SDK" },
  { pathPrefix: "sdks/", category: "Packages" },

  // Framework adapters and middleware — functional code.
  { pathPrefix: "integrations/", category: "Packages" },
  { pathPrefix: "middlewares/", category: "Packages" },

  // Mintlify docs site (publishes docs.ag-ui.com) — canonical for protocol docs.
  { pathPrefix: "docs/", category: "Docs" },

  // The Dojo is the live protocol demo app.
  { pathPrefix: "apps/dojo/", category: "ShowcaseDemo" },
  { pathPrefix: "apps/client-cli-example/", category: "Examples" },
  { pathPrefix: "apps/", category: "ShowcaseDemo" },

  { pathPrefix: "skills/", category: "Internal" },
  { pathPrefix: ".claude/", category: "Internal" },
  { pathPrefix: ".github/", category: "Internal" },
  { pathPrefix: "scripts/", category: "Internal" },
];
