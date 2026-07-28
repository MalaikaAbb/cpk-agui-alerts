import { REPOS, repoKey } from "./config/repos.js";
import { buildRepoReport, isEmpty } from "./report/buildReport.js";
import { buildChatMessage } from "./report/chatCard.js";
import { sendToGoogleChat } from "./report/send.js";
import { getRepoState, loadState, saveState, updateRepoState } from "./state/store.js";
import type { Report, RepoReport } from "./types.js";

/**
 * One poll cycle: read the cursor, collect what landed in each repo since then,
 * notify if there is anything, and advance the cursor.
 */
async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === "true";
  const webhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  // Sent when nothing changed. Off by default to keep the Space quiet.
  const heartbeat = process.env.HEARTBEAT_MODE === "always";

  // Captured once up front: using run-start (not run-end) as the next cursor
  // means anything merged while we are polling is caught next time, not skipped.
  const nowISO = new Date().toISOString();

  console.log(`[run] starting at ${nowISO}${dryRun ? " (dry run)" : ""}`);

  const state = await loadState();
  const repoReports: RepoReport[] = [];
  const failures: string[] = [];

  for (const config of REPOS) {
    const key = repoKey(config.owner, config.repo);
    const repoState = getRepoState(state, key, nowISO);

    try {
      const report = await buildRepoReport(config, repoState, nowISO);
      repoReports.push(report);

      updateRepoState(state, key, {
        nowISO,
        reportedPRs: report.prs.map((p) => ({ number: p.pr.number, mergedAt: p.pr.mergedAt })),
        reportedReleaseIds: report.releases.map((r) => r.id),
      });
    } catch (err) {
      // One repo being unreachable should not cost us the other repo's report,
      // and its cursor stays put so the window is retried next run.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${key}] failed:`, message);
      failures.push(`${key}: ${message}`);
    }
  }

  const withActivity = repoReports.filter((r) => !isEmpty(r));

  if (withActivity.length === 0) {
    console.log("[run] no merged PRs or releases in this window");
    if (heartbeat) {
      await sendHeartbeat(repoReports, nowISO, { dryRun, webhookUrl });
    }
  } else {
    const report: Report = { generatedAtISO: nowISO, repos: withActivity };
    const message = buildChatMessage(report);
    await sendToGoogleChat(message, { dryRun, webhookUrl });
  }

  // A dry run must leave no trace: advancing the cursor here would mark these PRs
  // as reported and they would never appear in a real notification.
  if (dryRun) {
    console.log("[run] dry run — cursor left unchanged");
  } else {
    // Persist even on a quiet run so the window keeps moving forward. Repos that
    // threw were never updated above, so they retry from their old cursor.
    await saveState(state);
    console.log("[run] state saved");
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length} repo(s) failed:\n${failures.join("\n")}`);
  }
}

async function sendHeartbeat(
  reports: RepoReport[],
  nowISO: string,
  opts: { dryRun: boolean; webhookUrl?: string },
): Promise<void> {
  const since = reports[0]?.sinceISO ?? nowISO;

  await sendToGoogleChat(
    {
      text: "No new merged PRs or releases in the last poll window.",
      cardsV2: [
        {
          cardId: "heartbeat",
          card: {
            header: {
              title: "No changes",
              subtitle: `${REPOS.map((r) => r.repo).join(" · ")} — since ${since}`,
            },
            sections: [
              {
                widgets: [{ textParagraph: { text: "<i>Nothing merged or released.</i>" } }],
              },
            ],
          },
        },
      ],
    },
    opts,
  );
}

main().catch((err) => {
  console.error("[run] fatal:", err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
});
