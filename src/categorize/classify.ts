import {
  CATEGORY_PRIORITY,
  type Category,
  type CategoryHit,
  type CategoryRule,
  type ClassifiedPR,
  type PullRequest,
} from "../types.js";

/** How many example paths we keep per category for report context. */
const SAMPLE_FILE_LIMIT = 3;

/**
 * Classify one file path. Rules are evaluated in order and the first prefix match
 * wins, so rule arrays must list specific prefixes before general ones. Anything
 * unmatched (root config files, stray dotfiles) falls back to Internal.
 */
export function classifyFile(
  path: string,
  rules: CategoryRule[],
): { category: Category; note?: string } {
  const rule = rules.find((r) => path.startsWith(r.pathPrefix));
  if (!rule) return { category: "Internal" };

  return rule.note ? { category: rule.category, note: rule.note } : { category: rule.category };
}

/**
 * Aggregate a PR's changed files into per-category hits.
 *
 * A PR that spans several areas is recorded under every category it touches
 * rather than being reduced to one "primary" area — otherwise a small docs change
 * riding along with a large showcase refactor would disappear from the Docs
 * section, which is exactly what this report exists to surface.
 */
export function classifyPR(
  pr: PullRequest,
  files: string[],
  rules: CategoryRule[],
  opts: { truncated?: boolean } = {},
): ClassifiedPR {
  const categories = new Map<Category, CategoryHit>();

  for (const path of files) {
    const { category, note } = classifyFile(path, rules);

    let hit = categories.get(category);
    if (!hit) {
      hit = { count: 0, sampleFiles: [], notes: [] };
      categories.set(category, hit);
    }

    hit.count++;
    if (hit.sampleFiles.length < SAMPLE_FILE_LIMIT) {
      hit.sampleFiles.push(path);
    }
    if (note && !hit.notes.includes(note)) {
      hit.notes.push(note);
    }
  }

  return {
    pr,
    categories,
    totalFiles: files.length,
    truncated: opts.truncated ?? false,
  };
}

/** Categories present on a PR, most prominent first. */
export function sortedCategories(classified: ClassifiedPR): Category[] {
  return [...classified.categories.keys()].sort(
    (a, b) => CATEGORY_PRIORITY[a] - CATEGORY_PRIORITY[b],
  );
}

/** All categories seen across a set of PRs, most prominent first. */
export function categoriesInReport(prs: ClassifiedPR[]): Category[] {
  const seen = new Set<Category>();
  for (const p of prs) {
    for (const category of p.categories.keys()) seen.add(category);
  }

  return [...seen].sort((a, b) => CATEGORY_PRIORITY[a] - CATEGORY_PRIORITY[b]);
}

/** PRs touching a given category, largest contribution to that category first. */
export function prsInCategory(prs: ClassifiedPR[], category: Category): ClassifiedPR[] {
  return prs
    .filter((p) => p.categories.has(category))
    .sort((a, b) => {
      const aCount = a.categories.get(category)?.count ?? 0;
      const bCount = b.categories.get(category)?.count ?? 0;
      return bCount - aCount;
    });
}
