/**
 * Regenerate src/config/reference-pages.ts from a local CopilotKit clone.
 *
 *   node dist/dev/generate-reference-index.js [path-to-CopilotKit-repo]
 *
 * The snapshot exists so we only link to reference pages that actually exist —
 * roughly half of react-core's hook files are internal and have no page, and
 * linking by naming convention alone would 404 on all of them.
 *
 * Dev-only: nothing in src/index.ts imports this, so wrangler never bundles it.
 */
import { readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const DEFAULT_REPO = "/home/malaika-fiqros/copilotkit/CopilotKit/CopilotKit";
const CONTENT = "showcase/shell-docs/src/content/reference";
const OUT = resolve(process.cwd(), "src/config/reference-pages.ts");

/** Collect every `<section>/<PageName>` under the reference tree. */
async function collect(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const found: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      found.push(...(await collect(join(root, entry.name), `${prefix}${entry.name}/`)));
    } else if (entry.name.endsWith(".mdx") && entry.name !== "index.mdx") {
      found.push(`${prefix}${entry.name.slice(0, -4)}`);
    }
  }

  return found;
}

const repo = process.argv[2] ?? DEFAULT_REPO;
const root = join(repo, CONTENT);

const pages = (await collect(root)).sort();
if (pages.length === 0) {
  console.error(`No reference pages found under ${root} — is the repo path right?`);
  process.exit(1);
}

const body = `/**
 * Snapshot of every page under the CopilotKit docs reference tree.
 *
 * GENERATED — do not edit by hand. Regenerate with:
 *   npm run build && node dist/dev/generate-reference-index.js [path-to-repo]
 *
 * Used to verify a derived reference URL exists before linking it. A symbol with
 * no entry here is internal and correctly gets no link.
 *
 * Generated from ${pages.length} pages.
 */
export const REFERENCE_PAGES: ReadonlySet<string> = new Set([
${pages.map((p) => `  ${JSON.stringify(p)},`).join("\n")}
]);
`;

await writeFile(OUT, body, "utf8");
console.log(`wrote ${pages.length} reference pages to ${OUT}`);
