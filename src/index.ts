import { REPOS, repoKey } from "./config/repos.js";
import { buildRepoReport, isEmpty } from "./report/buildReport.js";
import { buildChatMessage } from "./report/chatCard.js";
import { sendToGoogleChat } from "./report/send.js";
import { getRepoState, loadState, saveState, updateRepoState } from "./state/store.js";
import type { Env, Report, RepoReport } from "./types.js";

/**
 * One poll cycle: read the cursor, collect what landed in each repo since then,
 * notify if a docs change or package release earned it, and advance the cursor.
 *
 * Exported separately from the Worker handlers so both `scheduled` (cron) and
 * `fetch` (manual trigger) run exactly the same path.
 */
export async function runPoll(env: Env): Promise<{ sent: boolean; summary: string }> {
  const dryRun = env.DRY_RUN === "true";
  const heartbeat = env.HEARTBEAT_MODE === "always";

  // Captured once up front: using run-start (not run-end) as the next cursor
  // means anything merged while we are polling is caught next time, not skipped.
  const nowISO = new Date().toISOString();

  console.log(`[run] starting at ${nowISO}${dryRun ? " (dry run)" : ""}`);

  const state = await loadState(env.STATE);
  const repoReports: RepoReport[] = [];
  const failures: string[] = [];

  for (const config of REPOS) {
    const key = repoKey(config.owner, config.repo);
    const repoState = getRepoState(state, key, nowISO);

    try {
      const report = await buildRepoReport(config, repoState, nowISO, env.GITHUB_TOKEN);
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
  let sent = false;

  if (withActivity.length === 0) {
    console.log("[run] no docs changes or package releases in this window");
    if (heartbeat) {
      await sendHeartbeat(repoReports, nowISO, { dryRun, webhookUrl: env.GOOGLE_CHAT_WEBHOOK_URL });
    }
  } else {
    const report: Report = { generatedAtISO: nowISO, repos: withActivity };
    const result = await sendToGoogleChat(buildChatMessage(report), {
      dryRun,
      webhookUrl: env.GOOGLE_CHAT_WEBHOOK_URL,
    });
    sent = result.sent;
  }

  // A dry run must leave no trace: advancing the cursor would mark these PRs as
  // reported and they would never appear in a real notification.
  if (dryRun) {
    console.log("[run] dry run — cursor left unchanged");
  } else {
    // Persist even on a quiet run so the window keeps moving forward. Repos that
    // threw were never updated above, so they retry from their old cursor.
    await saveState(env.STATE, state);
    console.log("[run] state saved");
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length} repo(s) failed:\n${failures.join("\n")}`);
  }

  return {
    sent,
    summary: withActivity.length === 0 ? "no reportable changes" : `reported ${withActivity.length} repo(s)`,
  };
}

async function sendHeartbeat(
  reports: RepoReport[],
  nowISO: string,
  opts: { dryRun: boolean; webhookUrl?: string },
): Promise<void> {
  const since = reports[0]?.sinceISO ?? nowISO;

  await sendToGoogleChat(
    {
      text: "No docs changes or package releases in the last poll window.",
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
                widgets: [
                  { textParagraph: { text: "<i>Nothing merged to docs, nothing released.</i>" } },
                ],
              },
            ],
          },
        },
      ],
    },
    opts,
  );
}

export default {
  /** Cron Trigger entrypoint — schedule lives in wrangler.toml. */
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(
      runPoll(env).catch((err) => {
        console.error("[run] fatal:", err instanceof Error ? (err.stack ?? err.message) : err);
      }),
    );
  },

  /**
   * Manual trigger, the equivalent of workflow_dispatch. Append `?dry=1` to log
   * the payload without posting or advancing the cursor.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const dry = new URL(request.url).searchParams.get("dry") === "1";

    try {
      const result = await runPoll(dry ? { ...env, DRY_RUN: "true" } : env);
      return new Response(`ok — ${result.summary}${dry ? " (dry run)" : ""}\n`);
    } catch (err) {
      const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
      console.error("[run] fatal:", message);
      return new Response(`error\n${message}\n`, { status: 500 });
    }
  },
};
