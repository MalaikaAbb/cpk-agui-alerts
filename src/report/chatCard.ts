import { categoriesInReport, prsInCategory } from "../categorize/classify.js";
import { MAX_PRS_PER_SECTION } from "../config/repos.js";
import {
  CATEGORY_LABEL,
  PR_DETAIL_CATEGORIES,
  RELEASE_DRIVEN_CATEGORIES,
  type Category,
  type ClassifiedPR,
  type DocsLabel,
  type ReleaseReport,
  type Report,
  type RepoReport,
} from "../types.js";
import { displayablePRs, mergedSearchUrl, summarizeBody, truncateTitle } from "./buildReport.js";

/**
 * Google Chat cardsV2 payload.
 *
 * Card text supports a small HTML subset (<b>, <i>, <a>, <font>, <br>), which is
 * why everything user-supplied goes through escapeHtml first.
 */
export interface ChatMessage {
  text?: string;
  cardsV2: Array<{ cardId: string; card: ChatCard }>;
}

export interface ChatCard {
  header: { title: string; subtitle?: string };
  sections: ChatSection[];
}

export interface ChatSection {
  header?: string;
  collapsible?: boolean;
  uncollapsibleWidgetsCount?: number;
  widgets: ChatWidget[];
}

export type ChatWidget =
  | { decoratedText: { text: string; wrapText?: boolean; startIcon?: { knownIcon: string } } }
  | { textParagraph: { text: string } };

/**
 * Render a report as one or more Chat messages.
 *
 * Returns an array because a large release must not be truncated — see
 * `paginate`. The common case is a single message.
 */
export function buildChatMessage(report: Report): ChatMessage[] {
  const message: ChatMessage = {
    // Fallback text for notification previews and clients that don't render cards.
    text: summaryLine(report),
    cardsV2: report.repos.map((repoReport) => ({
      cardId: repoReport.key.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase(),
      card: buildRepoCard(repoReport),
    })),
  };

  return paginate(message);
}

/** Google Chat rejects webhook payloads above 32 KB. Stay clear of the edge. */
const PAYLOAD_BUDGET = 28_000;
/** Ceiling on messages per run, so a pathological backlog cannot flood the Space. */
const MAX_MESSAGES = 10;
/** Conservative allowance for the JSON envelope around a card and each line. */
const BASE_OVERHEAD = 400;
const SECTION_OVERHEAD = 120;
const LINE_OVERHEAD = 12;

/** Exact byte cost of one line, escaping included. Called once per line. */
function lineCost(line: string): number {
  return JSON.stringify(line).length;
}

/**
 * Split an over-budget message into a sequence of messages.
 *
 * Truncating is not acceptable — a big release is exactly when the detail
 * matters — so content is packed across as many messages as it needs. A section
 * too large on its own is split at line boundaries, so any volume survives.
 *
 * Deliberately linear: every line is measured **once** and packing is integer
 * addition. The previous approach re-serialised the whole growing message on
 * each check, which is O(n²) and would burn the Worker's CPU budget on a large
 * release.
 */
export function paginate(message: ChatMessage): ChatMessage[] {
  const sections = message.cardsV2.flatMap((c) =>
    c.card.sections.map((section) => ({ cardId: c.cardId, card: c.card, section })),
  );

  const messages: ChatMessage[] = [];
  let current: ChatMessage | null = null;
  let used = 0;

  const startMessage = () => {
    current = { cardsV2: [] };
    used = BASE_OVERHEAD;
    messages.push(current);
    return current;
  };

  const addSection = (
    origin: { cardId: string; card: ChatCard },
    section: ChatSection,
    cost: number,
  ) => {
    const msg = current ?? startMessage();
    let entry = msg.cardsV2.find((c) => c.cardId === origin.cardId);

    if (!entry) {
      entry = { cardId: origin.cardId, card: { header: origin.card.header, sections: [] } };
      msg.cardsV2.push(entry);
      used += BASE_OVERHEAD;
    }

    entry.card.sections.push(section);
    used += cost;
  };

  for (const { cardId, card, section } of sections) {
    const lines = sectionLines(section);
    const costs = lines.map(lineCost);
    const total = costs.reduce((sum, c) => sum + c + LINE_OVERHEAD, SECTION_OVERHEAD);

    if (!current) startMessage();

    if (used + total <= PAYLOAD_BUDGET) {
      addSection({ cardId, card }, section, total);
      continue;
    }

    // Whole section does not fit here. If it fits in a fresh message, move it;
    // otherwise split it across messages at line boundaries.
    if (total + BASE_OVERHEAD <= PAYLOAD_BUDGET) {
      startMessage();
      addSection({ cardId, card }, section, total);
      continue;
    }

    let chunk: string[] = [];
    let chunkCost = SECTION_OVERHEAD;
    for (let i = 0; i < lines.length; i++) {
      const cost = (costs[i] ?? 0) + LINE_OVERHEAD;

      if (chunk.length > 0 && used + chunkCost + cost > PAYLOAD_BUDGET) {
        addSection({ cardId, card }, chunkSection(section, chunk), chunkCost);
        startMessage();
        chunk = [];
        chunkCost = SECTION_OVERHEAD;
      }

      chunk.push(lines[i] as string);
      chunkCost += cost;
    }
    if (chunk.length > 0) addSection({ cardId, card }, chunkSection(section, chunk), chunkCost);
  }

  return label(messages, message.text);
}

/** The renderable lines of a section, so oversized sections can be split. */
function sectionLines(section: ChatSection): string[] {
  return section.widgets.flatMap((w) => {
    const text = "textParagraph" in w ? w.textParagraph.text : w.decoratedText.text;
    return text.split("<br>");
  });
}

function chunkSection(section: ChatSection, lines: string[]): ChatSection {
  return { header: section.header, widgets: [{ textParagraph: { text: lines.join("<br>") } }] };
}

/**
 * Number the sequence and enforce the message ceiling.
 *
 * Only the first message carries the fallback `text`, so a multi-part report
 * produces one notification ping rather than one per part.
 */
function label(messages: ChatMessage[], text: string | undefined): ChatMessage[] {
  const kept = messages.filter((m) => m.cardsV2.length > 0);

  if (kept.length > MAX_MESSAGES) {
    console.warn(
      `[card] ${kept.length} messages exceeds the ${MAX_MESSAGES} cap; ` +
        `the remainder stays buffered for the next run`,
    );
    kept.length = MAX_MESSAGES;
  }

  return kept.map((message, index) => {
    if (index === 0) return text ? { ...message, text } : message;

    return {
      ...message,
      cardsV2: message.cardsV2.map((c) => ({
        ...c,
        card: {
          ...c.card,
          header: {
            ...c.card.header,
            subtitle: `continued ${index + 1}/${kept.length}`,
          },
        },
      })),
    };
  });
}

function summaryLine(report: Report): string {
  const parts = report.repos.map((r) => {
    const packageCount = r.releases.reduce((sum, rel) => sum + rel.packages.length, 0);
    const bits: string[] = [];
    if (packageCount > 0) bits.push(`${packageCount} package${packageCount === 1 ? "" : "s"} released`);

    const prCount = displayablePRs(r).length;
    if (prCount > 0) bits.push(`${prCount} PR${prCount === 1 ? "" : "s"}`);

    return `${r.repo}: ${bits.join(", ")}`;
  });

  return `Repo activity — ${parts.join(" · ")}`;
}

function buildRepoCard(report: RepoReport): ChatCard {
  const sections: ChatSection[] = [];

  // Packages are announced by release, so this section comes from published
  // releases rather than from merged PRs.
  if (report.releases.length > 0) {
    sections.push(buildPackageReleaseSection(report));

    // Followed by what actually shipped in each of them, and which docs that
    // may have invalidated.
    for (const releaseReport of report.releaseReports) {
      if (releaseReport.totalChanges === 0) continue;

      sections.push(buildChangelogSection(releaseReport));
      const affected = buildDocsAffectedSection(releaseReport);
      if (affected) sections.push(affected);
    }
  }

  const shown = displayablePRs(report);
  const present = categoriesInReport(shown).filter(
    (c) => !RELEASE_DRIVEN_CATEGORIES.includes(c),
  );
  const detailed = PR_DETAIL_CATEGORIES.filter((c) => present.includes(c));
  const secondary = present.filter((c) => !PR_DETAIL_CATEGORIES.includes(c));

  for (const category of detailed) {
    const section = buildDetailSection(category, report, shown);
    // A Docs category can be present via file counts yet yield no named pages
    // (e.g. only meta.json changed) — don't render an empty "0 pages" section.
    if (section) sections.push(section);
  }

  // Everything else is a one-line count so it cannot crowd out the above.
  if (secondary.length > 0) {
    sections.push(buildSecondarySection(secondary, report, shown));
  }

  if (sections.length === 0) {
    sections.push({
      widgets: [{ textParagraph: { text: "<i>No reportable changes in this window.</i>" } }],
    });
  }

  return {
    header: {
      title: `${report.owner}/${report.repo}`,
      subtitle: cardSubtitle(report),
    },
    sections,
  };
}

function cardSubtitle(report: RepoReport): string {
  const packageCount = report.releases.reduce((sum, r) => sum + r.packages.length, 0);
  const prCount = displayablePRs(report).length;

  const bits: string[] = [];
  if (packageCount > 0) {
    bits.push(`${packageCount} package${packageCount === 1 ? "" : "s"} released`);
  }
  if (prCount > 0) {
    bits.push(`${prCount} merged PR${prCount === 1 ? "" : "s"}`);
  }
  bits.push(`since ${formatTime(report.sinceISO)}`);

  return bits.join(" · ");
}

/**
 * Docs section, listed by page rather than by PR.
 *
 * "Mastra — State Rendering" tells a reader what actually changed; the PR title
 * ("docs(mastra): update state rendering guide") does not. One PR touching three
 * pages produces three bullets, each linked to its page and its PR.
 */
function buildDetailSection(
  category: Category,
  report: RepoReport,
  source: ClassifiedPR[],
): ChatSection | null {
  const prs = prsInCategory(source, category);

  if (category === "Docs") {
    const pages = collectDocsPages(prs);
    if (pages.length === 0) return null;

    const shown = pages.slice(0, MAX_PRS_PER_SECTION);
    const overflow = pages.length - shown.length;

    const lines = shown.map(({ label, prNumbers, prUrl }) => {
      const page = label.url
        ? `<a href="${label.url}"><b>${escapeHtml(label.text)}</b></a>`
        : `<b>${escapeHtml(label.text)}</b>`;
      const refs = prNumbers.map((n) => `<a href="${prUrl(n)}">#${n}</a>`).join(" ");
      const note = label.note ? ` <font color="#b06000">⚠ ${escapeHtml(label.note)}</font>` : "";

      return `• ${page} &nbsp;<font color="#5f6368">${refs}</font>${note}`;
    });

    if (overflow > 0) {
      lines.push(
        `<a href="${mergedSearchUrl(report)}">+${overflow} more page${overflow === 1 ? "" : "s"} →</a>`,
      );
    }

    return {
      header: `<b>${CATEGORY_LABEL.Docs}</b> — ${pages.length} page${pages.length === 1 ? "" : "s"}`,
      widgets: [{ textParagraph: { text: lines.join("<br>") } }],
    };
  }

  const shown = prs.slice(0, MAX_PRS_PER_SECTION);
  const overflow = prs.length - shown.length;

  const widgets: ChatWidget[] = shown.map((p) => ({
    decoratedText: { text: renderPR(p, category), wrapText: true },
  }));

  if (overflow > 0) {
    widgets.push({
      textParagraph: {
        text: `<a href="${mergedSearchUrl(report)}">+${overflow} more merged PR${overflow === 1 ? "" : "s"} →</a>`,
      },
    });
  }

  return {
    header: `<b>${CATEGORY_LABEL[category]}</b> — ${prs.length} PR${prs.length === 1 ? "" : "s"}`,
    widgets,
  };
}

/** Collapse PRs into the set of docs pages they touched, page -> PR numbers. */
function collectDocsPages(prs: ClassifiedPR[]): Array<{
  label: DocsLabel;
  prNumbers: number[];
  prUrl: (n: number) => string;
}> {
  const byPage = new Map<string, { label: DocsLabel; prNumbers: number[] }>();
  const urlByPR = new Map<number, string>();

  for (const p of prs) {
    urlByPR.set(p.pr.number, p.pr.htmlUrl);
    for (const label of p.docsLabels) {
      const entry = byPage.get(label.text) ?? { label, prNumbers: [] };
      if (!entry.prNumbers.includes(p.pr.number)) entry.prNumbers.push(p.pr.number);
      byPage.set(label.text, entry);
    }
  }

  return [...byPage.values()]
    .sort((a, b) => a.label.text.localeCompare(b.label.text))
    .map((entry) => ({ ...entry, prUrl: (n: number) => urlByPR.get(n) ?? "#" }));
}

/**
 * One line per remaining category. These are deliberately terse — they exist for
 * awareness, not for review.
 */
function buildSecondarySection(
  categories: Category[],
  report: RepoReport,
  source: ClassifiedPR[],
): ChatSection {
  const lines = categories.map((category) => {
    const prs = prsInCategory(source, category);
    const files = prs.reduce((sum, p) => sum + (p.categories.get(category)?.count ?? 0), 0);
    return (
      `${CATEGORY_LABEL[category]}: ${prs.length} PR${prs.length === 1 ? "" : "s"} ` +
      `(${files} file${files === 1 ? "" : "s"})`
    );
  });

  return {
    header: "Other areas",
    collapsible: true,
    uncollapsibleWidgetsCount: 1,
    widgets: [
      { textParagraph: { text: lines.join("<br>") } },
      {
        textParagraph: {
          text: `<a href="${mergedSearchUrl(report)}">View all merged PRs in this window →</a>`,
        },
      },
    ],
  };
}

/**
 * The package section: which packages shipped, at which versions.
 *
 * No PRs here by design — a merged package PR is not usable by anyone until it
 * is published, so this section answers "what can I install now?" rather than
 * "what did people work on?".
 */
function buildPackageReleaseSection(report: RepoReport): ChatSection {
  const lines: string[] = [];
  let packageCount = 0;

  for (const release of report.releases) {
    const suffix = release.isPrerelease ? ' <i>(prerelease)</i>' : "";
    lines.push(
      `🚀 <a href="${release.htmlUrl}"><b>${escapeHtml(release.name)}</b></a>` +
        `${suffix} — ${formatTime(release.publishedAt)}`,
    );

    for (const pkg of release.packages) {
      packageCount++;
      const ecosystem = pkg.ecosystem ? ` <font color="#5f6368">(${escapeHtml(pkg.ecosystem)})</font>` : "";
      lines.push(
        `&nbsp;&nbsp;&nbsp;&nbsp;📦 <b>${escapeHtml(pkg.name)}</b> ` +
          // Plain text, not <code>: Chat's card renderer supports only
          // b/i/u/s/font/a/br, and an unsupported tag can render literally.
          `${escapeHtml(pkg.version)}${ecosystem}`,
      );
    }
  }

  return {
    header: `<b>${CATEGORY_LABEL.Packages} released</b> — ${packageCount || report.releases.length}`,
    widgets: [{ textParagraph: { text: lines.join("<br>") } }],
  };
}

/**
 * The changelog for one release, PR-first.
 *
 * Each PR is listed exactly once with the packages it touched nested under it,
 * one line per package. Grouping the other way round (by `pkg — area`) made a
 * single PR repeat once per area — a live report listed one PR eight times and
 * `channels-core` as four separate headings.
 */
function buildChangelogSection(report: ReleaseReport): ChatSection {
  const lines: string[] = [];

  for (const { change, packages } of report.entries) {
    lines.push(
      `• <a href="${change.url}">#${change.number}</a> ` +
        `${escapeHtml(truncateTitle(change.title))} ` +
        `<font color="#5f6368">@${escapeHtml(change.author)}</font>`,
    );

    for (const { pkg, subpaths } of packages) {
      lines.push(
        `&nbsp;&nbsp;&nbsp;&nbsp;<b>${escapeHtml(pkg)}</b> ` +
          `<font color="#5f6368">${escapeHtml(subpaths.join(", "))}</font>`,
      );
    }
  }

  if (report.droppedCount > 0) {
    lines.push(`<i>+${report.droppedCount} older changes dropped from the buffer</i>`);
  }

  const scope = report.scope ? `${report.scope} ` : "";
  const header =
    `<b>📋 What shipped in ${escapeHtml(scope)}${escapeHtml(report.release.name)}</b>` +
    ` — ${report.totalChanges} change${report.totalChanges === 1 ? "" : "s"}`;

  return {
    header,
    widgets: [
      {
        textParagraph: {
          text: lines.length > 0 ? lines.join("<br>") : "<i>No buffered changes for this release.</i>",
        },
      },
    ],
  };
}

/**
 * Documentation the released changes may have made stale.
 *
 * Distinct from the Docs section: that reports docs pages someone *edited*,
 * this reports pages that now describe changed behavior and may need revisiting.
 */
function buildDocsAffectedSection(report: ReleaseReport): ChatSection | null {
  if (report.docsAffected.length === 0) return null;

  const lines = report.docsAffected.map(
    (doc) => `• <a href="${doc.url}">${escapeHtml(doc.text)}</a>`,
  );

  return {
    header: `<b>📖 Docs Affected</b> — ${report.docsAffected.length} page${report.docsAffected.length === 1 ? "" : "s"}`,
    widgets: [{ textParagraph: { text: lines.join("<br>") } }],
  };
}

/**
 * A single PR entry: title, merge/release state, author, the file count for the
 * category it is being listed under, and a one-line body excerpt.
 */
function renderPR(classified: ClassifiedPR, category: Category): string {
  const { pr } = classified;
  const hit = classified.categories.get(category);

  const parts: string[] = [
    `<a href="${pr.htmlUrl}"><b>#${pr.number}</b></a> ${escapeHtml(truncateTitle(pr.title))}`,
  ];

  const meta: string[] = [
    "<b>MERGED</b>",
    `@${escapeHtml(pr.author)}${pr.isBot ? " [bot]" : ""}`,
  ];
  if (hit) {
    meta.push(`${hit.count} file${hit.count === 1 ? "" : "s"} here`);
  }
  if (classified.truncated) {
    meta.push("<i>partial file list</i>");
  }
  parts.push(`<font color="#5f6368">${meta.join(" · ")}</font>`);

  const excerpt = summarizeBody(pr.body);
  if (excerpt) {
    parts.push(`<i>${escapeHtml(excerpt)}</i>`);
  }

  // Surface caveats like the AG-UI docs mirror note.
  for (const note of hit?.notes ?? []) {
    parts.push(`<font color="#b06000">⚠ ${escapeHtml(note)}</font>`);
  }

  return parts.join("<br>");
}

function formatTime(iso: string): string {
  return new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
