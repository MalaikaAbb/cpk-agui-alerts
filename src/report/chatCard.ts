import { categoriesInReport, prsInCategory } from "../categorize/classify.js";
import { MAX_PRS_PER_SECTION } from "../config/repos.js";
import {
  CATEGORY_LABEL,
  HIGHLIGHTED_CATEGORIES,
  type Category,
  type ClassifiedPR,
  type Report,
  type RepoReport,
} from "../types.js";
import { mergedSearchUrl, summarizeBody, truncateTitle } from "./buildReport.js";

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

interface ChatCard {
  header: { title: string; subtitle?: string };
  sections: ChatSection[];
}

interface ChatSection {
  header?: string;
  collapsible?: boolean;
  uncollapsibleWidgetsCount?: number;
  widgets: ChatWidget[];
}

type ChatWidget =
  | { decoratedText: { text: string; wrapText?: boolean; startIcon?: { knownIcon: string } } }
  | { textParagraph: { text: string } };

export function buildChatMessage(report: Report): ChatMessage {
  return {
    // Fallback text for notification previews and clients that don't render cards.
    text: summaryLine(report),
    cardsV2: report.repos.map((repoReport) => ({
      cardId: repoReport.key.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase(),
      card: buildRepoCard(repoReport),
    })),
  };
}

function summaryLine(report: Report): string {
  const parts = report.repos.map((r) => {
    const bits = [`${r.prs.length} PR${r.prs.length === 1 ? "" : "s"}`];
    if (r.releases.length > 0) {
      bits.push(`${r.releases.length} release${r.releases.length === 1 ? "" : "s"}`);
    }
    return `${r.repo}: ${bits.join(", ")}`;
  });

  return `Repo activity — ${parts.join(" · ")}`;
}

function buildRepoCard(report: RepoReport): ChatCard {
  const sections: ChatSection[] = [];

  const present = categoriesInReport(report.prs);
  const highlighted = HIGHLIGHTED_CATEGORIES.filter((c) => present.includes(c));
  const secondary = present.filter((c) => !HIGHLIGHTED_CATEGORIES.includes(c));

  // Docs and Packages get full per-PR detail, listed first.
  for (const category of highlighted) {
    sections.push(buildDetailSection(category, report));
  }

  // Everything else is a one-line count so it cannot crowd out the above.
  if (secondary.length > 0) {
    sections.push(buildSecondarySection(secondary, report));
  }

  if (report.releases.length > 0) {
    sections.push(buildReleaseSection(report));
  }

  if (sections.length === 0) {
    sections.push({
      widgets: [{ textParagraph: { text: "<i>No merged pull requests in this window.</i>" } }],
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
  const prCount = report.prs.length;
  const releasedCount = report.prs.filter((p) => p.releasedIn !== null).length;

  const bits = [`${prCount} merged PR${prCount === 1 ? "" : "s"}`];
  if (releasedCount > 0) bits.push(`${releasedCount} released`);
  if (report.releases.length > 0) {
    bits.push(`${report.releases.length} new release${report.releases.length === 1 ? "" : "s"}`);
  }
  bits.push(`since ${formatTime(report.sinceISO)}`);

  return bits.join(" · ");
}

function buildDetailSection(category: Category, report: RepoReport): ChatSection {
  const prs = prsInCategory(report.prs, category);
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

/**
 * One line per remaining category. These are deliberately terse — they exist for
 * awareness, not for review.
 */
function buildSecondarySection(categories: Category[], report: RepoReport): ChatSection {
  const lines = categories.map((category) => {
    const prs = prsInCategory(report.prs, category);
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

function buildReleaseSection(report: RepoReport): ChatSection {
  const lines = report.releases.map((r) => {
    const tag = r.isPrerelease ? `${escapeHtml(r.name)} <i>(prerelease)</i>` : escapeHtml(r.name);
    return `🚀 <a href="${r.htmlUrl}"><b>${tag}</b></a> — ${formatTime(r.publishedAt)}`;
  });

  return {
    header: `<b>Releases published</b> — ${report.releases.length}`,
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

  const tags: string[] = ["<b>MERGED</b>"];
  if (classified.releasedIn) {
    tags.push(`<b>RELEASED ${escapeHtml(classified.releasedIn)}</b>`);
  }

  const parts: string[] = [
    `<a href="${pr.htmlUrl}"><b>#${pr.number}</b></a> ${escapeHtml(truncateTitle(pr.title))}`,
  ];

  const meta: string[] = [
    tags.join(" · "),
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
