import type { ReleasePackageSource, ReleasedPackage } from "../types.js";

/**
 * The package a release tag belongs to, or null when it releases the whole repo.
 *
 * CopilotKit publishes per-package tags (`channels/v0.3.0`, `angular/v0.3.0`)
 * alongside repo-wide ones (`v1.63.2`); ag-ui uses repo-wide date tags
 * (`release/2026-07-22`). Only a `<name>/<semver>` shape counts as scoped, so
 * date-style tags are correctly treated as repo-wide.
 */
export function parseTagScope(tagName: string): string | null {
  const match = /^(?<scope>.+)\/v?(?<version>\d+\.\d+\.\d+.*)$/.exec(tagName);
  return match?.groups?.scope ?? null;
}

/**
 * Which packages a release actually published.
 *
 * The two watched repos record this differently, so the strategy is per-repo
 * config rather than guesswork:
 *
 * - CopilotKit tags name the package (`channels/v0.3.0`) and its release body is
 *   just "Release channels/v0.3.0", so the tag is the only real source.
 * - ag-ui tags are repo-wide dates (`release/2026-07-28`) and the package list
 *   lives in a "Packages Published" table in the body.
 */
export function extractReleasedPackages(
  release: { tagName: string; body: string | null },
  source: ReleasePackageSource,
  repoName: string,
): ReleasedPackage[] {
  if (source === "body") {
    const fromBody = parsePackagesTable(release.body);
    // Fall back to the tag so a release with an unexpected body shape still
    // reports something rather than silently vanishing.
    return fromBody.length > 0 ? fromBody : fromTag(release.tagName, repoName);
  }

  return fromTag(release.tagName, repoName);
}

/**
 * Derive a package from a tag.
 *
 * `channels/v0.3.0` -> channels 0.3.0. A repo-wide tag like `v1.63.2` has no
 * scope, so it is reported under the repo's own name.
 */
function fromTag(tagName: string, repoName: string): ReleasedPackage[] {
  const scope = parseTagScope(tagName);
  const version = parseTagVersion(tagName);

  if (!version) {
    // Date-style or otherwise non-semver tag with nothing parseable in the body.
    return [{ name: repoName, version: tagName }];
  }

  return [{ name: scope ?? repoName, version }];
}

/** The semver portion of a tag, if it has one. */
export function parseTagVersion(tagName: string): string | null {
  const match = /(?:^|\/)v?(?<version>\d+\.\d+\.\d+[^/]*)$/.exec(tagName);
  return match?.groups?.version ?? null;
}

/**
 * Parse the markdown tables ag-ui puts under "## Packages Published".
 *
 * Shape:
 *   ### Python (PyPI) - published at 15:15:02 UTC
 *   | Package | Version | Install |
 *   |---------|---------|--------|
 *   | ag-ui-crewai | 0.2.1 | `pip install ...` |
 */
export function parsePackagesTable(body: string | null): ReleasedPackage[] {
  if (!body) return [];

  const packages: ReleasedPackage[] = [];
  let ecosystem: string | undefined;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();

    const heading = /^#{2,4}\s+(?<label>.+)$/.exec(line);
    if (heading?.groups?.label) {
      ecosystem = normalizeEcosystem(heading.groups.label);
      continue;
    }

    if (!line.startsWith("|") || !line.endsWith("|")) continue;

    const cells = line
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
    if (cells.length < 2) continue;

    const [name, version] = cells;
    if (!name || !version) continue;
    // Skip the header row and the |---|---| separator.
    if (/^packages?$/i.test(name)) continue;
    if (/^:?-{2,}:?$/.test(name)) continue;
    if (!/\d/.test(version)) continue;

    packages.push(ecosystem ? { name, version, ecosystem } : { name, version });
  }

  return packages;
}

/**
 * "Python (PyPI) - published at 15:15:02 UTC" -> "PyPI".
 * Falls back to the whole label when there is no parenthesised registry name.
 */
function normalizeEcosystem(label: string): string | undefined {
  const cleaned = label.split(/\s+-\s+published/i)[0]?.trim();
  if (!cleaned) return undefined;
  // Ignore the section heading itself.
  if (/^packages published$/i.test(cleaned)) return undefined;

  const registry = /\(([^)]+)\)/.exec(cleaned);
  return registry?.[1] ?? cleaned;
}
