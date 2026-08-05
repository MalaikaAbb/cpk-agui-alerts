import { DOCS_BASE_URL, frameworkFor, titleCase } from "../config/frameworks.js";
import type { DocsLabel } from "../types.js";

const DOCS_ROOT = "showcase/shell-docs/src/content/";

/**
 * Turn a changed docs file into the page name a reader would recognise.
 *
 *   .../docs/integrations/mastra/generative-ui/state-rendering.mdx
 *     -> "Mastra — State Rendering"  https://docs.copilotkit.ai/mastra/generative-ui/state-rendering
 *
 * Titles come from the filename rather than the file's `title:` frontmatter,
 * which would cost one content fetch per changed file. Every page does carry
 * frontmatter, so that is a possible upgrade — but kebab-case filenames already
 * produce the intended labels.
 *
 * Returns null for paths that are not a docs page (components, lib, config).
 */
export function labelDocsPath(path: string): DocsLabel | null {
  if (!path.startsWith(DOCS_ROOT)) return null;

  const rest = path.slice(DOCS_ROOT.length);
  if (!rest.endsWith(".mdx") && !rest.endsWith(".md")) return null;

  // The AG-UI tree is a downstream mirror; edits here never reach docs.ag-ui.com.
  if (rest.startsWith("ag-ui/")) {
    return {
      text: `AG-UI mirror — ${pageTitle(rest.slice("ag-ui/".length))}`,
      note: "mirror — canonical source is the ag-ui repo",
    };
  }

  // Shared snippets are inlined into one page across many frameworks.
  if (rest.startsWith("snippets/")) {
    const withoutPrefix = rest.replace(/^snippets\/(shared\/)?/, "");
    return {
      text: `Shared — ${pageTitle(withoutPrefix)}`,
      note: "shared snippet — affects all frameworks using this page",
    };
  }

  if (rest.startsWith("reference/")) {
    const sub = routePath(rest.slice("reference/".length));
    return {
      text: `Reference — ${pageTitle(rest.slice("reference/".length))}`,
      url: `${DOCS_BASE_URL}/reference/${sub}`,
    };
  }

  if (rest.startsWith("framework-overviews/")) {
    return { text: `Framework overview — ${pageTitle(rest.slice("framework-overviews/".length))}` };
  }

  if (!rest.startsWith("docs/")) return null;
  const docPath = rest.slice("docs/".length);

  // Framework-owned page: docs/integrations/<folder>/<rest>
  if (docPath.startsWith("integrations/")) {
    const afterIntegrations = docPath.slice("integrations/".length);
    const slash = afterIntegrations.indexOf("/");
    if (slash === -1) return null; // e.g. integrations/meta.json — not a page

    const folder = afterIntegrations.slice(0, slash);
    const pagePath = afterIntegrations.slice(slash + 1);
    const framework = frameworkFor(folder);
    const sub = routePath(pagePath);

    return {
      text: `${framework.name} — ${pageTitle(pagePath)}`,
      // built-in-agent serves at the bare root, with no framework prefix.
      url: framework.slug
        ? `${DOCS_BASE_URL}/${framework.slug}/${sub}`
        : `${DOCS_BASE_URL}/${sub}`,
    };
  }

  // Root/agnostic page — served bare and mirrored under every framework prefix.
  // No note: the "All frameworks" prefix already says it, and repeating it on
  // every bullet drowns the labels.
  return {
    text: `All frameworks — ${pageTitle(docPath)}`,
    url: `${DOCS_BASE_URL}/${routePath(docPath)}`,
  };
}

/**
 * The URL path for a content path: extension dropped, `index` collapsed into its
 * directory, and `(route-group)` segments stripped the way the site's router does.
 */
function routePath(pagePath: string): string {
  const segments = withoutExtension(pagePath)
    .split("/")
    .filter((s) => s && !(s.startsWith("(") && s.endsWith(")")));

  if (segments[segments.length - 1] === "index") segments.pop();

  return segments.join("/");
}

/**
 * Display title for a page. `index.mdx` takes its parent directory's name, so
 * `human-in-the-loop/index.mdx` reads "Human In The Loop" rather than "Index".
 */
function pageTitle(pagePath: string): string {
  const segments = routePath(pagePath).split("/").filter(Boolean);
  const last = segments[segments.length - 1];

  return last ? titleCase(last) : "Overview";
}

function withoutExtension(p: string): string {
  return p.replace(/\.mdx?$/, "");
}
