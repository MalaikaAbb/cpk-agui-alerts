import { guidesFor } from "../config/package-docs.js";
import { resolveReference } from "./reference.js";
import type { DocsAffected, PackageLabel } from "../types.js";

/**
 * Turn a changed source file into the package it belongs to and the area within
 * it, plus the docs pages that change may have invalidated.
 *
 *   packages/react-core/src/v2/hooks/use-frontend-tool.tsx
 *     -> { bucket: "react-core", subpath: "useFrontendTool",
 *          docs: [Reference — useFrontendTool, Frontend Tools (guide)] }
 *   packages/runtime/src/agents/runner.ts
 *     -> { bucket: "runtime", subpath: "agents", docs: [Copilot Runtime (guide)] }
 *
 * The bucket is what drives flushing: a `channels/v0.3.0` release drains the
 * `channels` bucket and nothing else. Returns null for non-package paths.
 */
export function labelPackagePath(path: string): PackageLabel | null {
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  // CopilotKit: packages/<pkg>/...
  if (segments[0] === "packages" && segments[1]) {
    return build(path, segments[1], segments.slice(2));
  }

  // CopilotKit: sdk-python/copilotkit/<area>/...
  if (segments[0] === "sdk-python") {
    return build(path, "sdk-python", segments.slice(1));
  }

  if (segments[0] === "sdks") {
    // ag-ui: sdks/typescript/packages/<pkg>/..., sdks/community/<lang>/...
    if (segments[1] === "typescript" && segments[2] === "packages" && segments[3]) {
      return build(path, segments[3], segments.slice(4));
    }
    if (segments[1] === "community" && segments[2]) {
      return build(path, segments[2], segments.slice(3));
    }
    // ag-ui: sdks/python/..., sdks/dotnet/...
    if (segments[1]) {
      return build(path, segments[1], segments.slice(2));
    }
  }

  // ag-ui: integrations/<name>/..., middlewares/<name>/...
  if ((segments[0] === "integrations" || segments[0] === "middlewares") && segments[1]) {
    return build(path, segments[1], segments.slice(2));
  }

  return null;
}

/**
 * Resolve the area within a package.
 *
 * Inside a symbol directory we drill one level deeper and name the **symbol**,
 * because CopilotKit is file-per-symbol: `hooks/use-frontend-tool.ts` is
 * `useFrontendTool`, not an anonymous member of "hooks". Everywhere else the
 * first meaningful directory is the area, which keeps `runtime — agents` and the
 * flat `channels-*` packages reading as before.
 */
function build(path: string, pkg: string, rest: string[]): PackageLabel | null {
  const inner = rest[0] && SOURCE_ROOTS.has(rest[0]) ? rest.slice(1) : rest;
  // A version directory (v2/) is structural, not an area of its own.
  const scoped = inner[0] && VERSION_DIRS.has(inner[0]) ? inner.slice(1) : inner;
  const head = scoped[0];

  if (!head) return null;

  // Manifest-only edits are version bumps, not changes worth naming. Dropping
  // them keeps a release PR (which touches every package.json in the monorepo)
  // from appearing under a dozen packages and burying the real work.
  if (scoped.length === 1 && MANIFEST_FILES.has(head)) return null;

  const raw = SYMBOL_DIRS.has(head) ? symbolIn(scoped) : areaIn(scoped);
  if (!raw) return null;

  // Prefer the reference page's canonical casing, so a change to
  // `use-frontend-tool.ts` reads as `useFrontendTool`. Without a match we show
  // the filename as-is rather than guessing at capitalisation.
  const reference = resolveReference(path, raw);
  const docs: DocsAffected[] = [];
  if (reference) docs.push(reference.doc);
  docs.push(...guidesFor(pkg));

  return { bucket: pkg, subpath: reference?.name ?? raw, docs };
}

/**
 * The symbol a file defines, taken from its basename. Handles nesting like
 * `components/chat/CopilotSidebar.tsx`, where the symbol is two levels down.
 */
function symbolIn(segments: string[]): string | null {
  const file = segments[segments.length - 1];
  if (!file || segments.length < 2) return null;

  const stem = stripExtensions(file);
  // An index barrel names no symbol; fall back to its directory.
  if (!stem || stem === "index") return segments[segments.length - 2] ?? null;

  return stem;
}

/** The first meaningful directory, or the file's stem if it sits at the root. */
function areaIn(segments: string[]): string | null {
  const head = segments[0];
  if (!head) return null;

  return segments.length === 1 ? stripExtensions(head) || null : head;
}

/** `delivery-transport.test.ts` -> `delivery-transport`; `agent.py` -> `agent`. */
function stripExtensions(filename: string): string {
  return filename.replace(/(\.(test|spec|d))?\.[^.]+$/, "");
}

/**
 * Directories whose files each define one exported symbol, so the filename is
 * more informative than the directory name.
 */
const SYMBOL_DIRS = new Set(["hooks", "components", "providers", "services", "composables"]);

/** Structural version directories that are not an area in their own right. */
const VERSION_DIRS = new Set(["v2", "v1"]);

/**
 * Directory names that wrap a package's source rather than naming an area of it.
 * `sdk-python/copilotkit/` and ag-ui's `sdks/python/ag_ui/` are module roots in
 * exactly the way `src/` is, so reporting them as the area would say nothing.
 */
const SOURCE_ROOTS = new Set(["src", "lib", "copilotkit", "ag_ui"]);

/**
 * Files whose change carries no information about what the package does.
 * A monorepo release PR touches one of these in every package at once.
 */
const MANIFEST_FILES = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "CHANGELOG.md",
  "pyproject.toml",
  "poetry.lock",
  "uv.lock",
  "setup.py",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
]);
