import { REFERENCE_PAGES } from "../config/reference-pages.js";
import { DOCS_BASE_URL } from "../config/frameworks.js";
import type { DocsAffected } from "../types.js";

/**
 * Which reference section a source path documents into.
 *
 * ORDER MATTERS: `react-core/src/v2/` must be tested before `react-core/src/`,
 * or every V2 symbol would resolve to the V1 tree. `use-frontend-tool` exists in
 * both trees and maps to two different pages.
 */
const SECTIONS: Array<{ prefix: string; section: string }> = [
  { prefix: "packages/react-core/src/v2/hooks/", section: "hooks" },
  { prefix: "packages/react-core/src/v2/components/", section: "components" },
  { prefix: "packages/react-core/src/v2/providers/", section: "components" },
  { prefix: "packages/react-core/src/hooks/", section: "v1/hooks" },
  { prefix: "packages/react-core/src/components/", section: "v1/components" },
  { prefix: "packages/react-ui/src/components/", section: "v1/components" },
  { prefix: "packages/react-textarea/src/", section: "v1/components" },
  { prefix: "packages/angular/src/lib/", section: "angular" },
  { prefix: "packages/vue/src/", section: "vue" },
  { prefix: "packages/react-native/src/", section: "react-native" },
  { prefix: "packages/channels-core/src/", section: "channels" },
  { prefix: "packages/channels/src/", section: "channels" },
  { prefix: "packages/core/src/", section: "core" },
];

/**
 * Index of reference pages by normalized name, e.g.
 * `hooks|usecoagentstaterender` -> `hooks/useCoAgentStateRender`.
 *
 * Built once at module load; the snapshot is static.
 */
const INDEX: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const page of REFERENCE_PAGES) {
    const slash = page.lastIndexOf("/");
    const section = slash === -1 ? "" : page.slice(0, slash);
    const name = page.slice(slash + 1);
    map.set(`${section}|${normalize(name)}`, page);
  }
  return map;
})();

/**
 * Lowercase and strip separators so kebab-case filenames match camelCase exports.
 *
 * This is what makes compound names work without a hand-maintained override map:
 * `use-coagent-state-render` and `useCoAgentStateRender` both normalize to
 * `usecoagentstaterender`. Naive kebab->camel would produce `useCoagent…` and miss.
 */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[-_]/g, "");
}

/**
 * The reference page documenting the symbol a changed file defines, if one exists.
 *
 * Also returns the page's **canonical name**, so the report can display
 * `useFrontendTool` rather than the kebab-case filename `use-frontend-tool`.
 *
 * Returns null for internal symbols — roughly half of react-core's hooks
 * (`use-tree`, `use-flat-category-store`) have no page, and that is the correct
 * answer rather than a gap to paper over with a guessed URL.
 */
export function resolveReference(
  path: string,
  symbol: string,
): { name: string; doc: DocsAffected } | null {
  const match = SECTIONS.find((s) => path.startsWith(s.prefix));
  if (!match) return null;

  const page = INDEX.get(`${match.section}|${normalize(symbol)}`);
  if (!page) return null;

  const name = page.slice(page.lastIndexOf("/") + 1);

  return {
    name,
    doc: {
      text: `Reference — ${name}`,
      url: `${DOCS_BASE_URL}/reference/${page}`,
      kind: "reference",
    },
  };
}
