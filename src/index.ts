import { REPOS, repoKey } from "./config/repos.js";
import { buildRepoReport, isEmpty } from "./report/buildReport.js";
import { buildChatMessage } from "./report/chatCard.js";
import { sendToGoogleChat } from "./report/send.js";
import { bucketsForRelease, drainBuckets } from "./state/buffer.js";
import { getRepoState, loadState, saveState, updateRepoState } from "./state/store.js";
import type { Env, Report, RepoReport, RepoState, State } from "./types.js";

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
  const fetched: Array<{ key: string; report: RepoReport; repoState: RepoState }> = [];
  const failures: string[] = [];

  // Phase 1 — fetch and buffer. buildRepoReport appends to repoState.buffer in
  // place; nothing is committed to KV yet.
  for (const config of REPOS) {
    const key = repoKey(config.owner, config.repo);
    const repoState = getRepoState(state, key, nowISO);

    try {
      const report = await buildRepoReport(config, repoState, nowISO, env.GITHUB_TOKEN);
      fetched.push({ key, report, repoState });
    } catch (err) {
      // One repo being unreachable should not cost us the other repo's report,
      // and its cursor stays put so the window is retried next run.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${key}] failed:`, message);
      failures.push(`${key}: ${message}`);
    }
  }

  // Phase 2 — decide, send, and only then commit.
  const reported = fetched.filter((f) => !isEmpty(f.report));
  const quiet = fetched.filter((f) => isEmpty(f.report));
  let sent = false;

  if (reported.length === 0) {
    console.log("[run] no docs changes or package releases in this window");
    if (heartbeat) {
      await sendHeartbeat(
        fetched.map((f) => f.report),
        nowISO,
        { dryRun, webhookUrl: env.GOOGLE_CHAT_WEBHOOK_URL },
      );
    }
  } else {
    const report: Report = { generatedAtISO: nowISO, repos: reported.map((r) => r.report) };
    const result = await sendToGoogleChat(buildChatMessage(report), {
      dryRun,
      webhookUrl: env.GOOGLE_CHAT_WEBHOOK_URL,
    });
    sent = result.sent;
  }

  // A repo with nothing to report can always advance — it was not part of any
  // message, so there is nothing to lose by moving its cursor forward.
  for (const entry of quiet) commit(state, entry, nowISO);

  if (sent) {
    // Confirmed delivered: drain the flushed buckets and advance the cursor.
    for (const entry of reported) {
      drainDelivered(entry.repoState, entry.report);
      commit(state, entry, nowISO);
    }
  } else if (reported.length > 0 && !dryRun) {
    // Leave the cursor AND the buffer untouched for these repos. Advancing the
    // cursor here would move the window past the release, so the next run would
    // never re-detect it and the buffered changelog would be stranded forever.
    //
    // With a multi-message report this is all-or-nothing: if message 2 of 3
    // failed, the first was still delivered and the retry will duplicate it.
    // Duplicated lines are recoverable; a lost changelog is not.
    console.warn(
      `[run] send not confirmed — ${reported.length} repo(s) left un-advanced to retry next run`,
    );
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
    summary:
      reported.length === 0 ? "no reportable changes" : `reported ${reported.length} repo(s)`,
  };
}

/** Advance a repo's cursor and record what it reported. */
function commit(
  state: State,
  entry: { key: string; report: RepoReport; repoState: RepoState },
  nowISO: string,
): void {
  updateRepoState(state, entry.key, {
    nowISO,
    reportedPRs: entry.report.prs.map((p) => ({
      number: p.pr.number,
      mergedAt: p.pr.mergedAt,
    })),
    reportedReleaseIds: entry.report.releases.map((r) => r.id),
    buffer: entry.repoState.buffer,
  });
}

/**
 * Purge the buckets whose changelog just went out.
 *
 * A scoped release drains only its own package; a repo-wide one drains
 * everything. Called only after the webhook confirmed delivery.
 */
function drainDelivered(repoState: RepoState, report: RepoReport): void {
  for (const releaseReport of report.releaseReports) {
    const buckets = bucketsForRelease(repoState.buffer, releaseReport.scope);
    drainBuckets(repoState.buffer, buckets);

    if (buckets.length > 0) {
      console.log(
        `[${report.key}] drained ${buckets.length} bucket(s) for ${releaseReport.release.tagName}` +
          ` (${releaseReport.totalChanges} changes)`,
      );
    }
  }
}

async function sendHeartbeat(
  reports: RepoReport[],
  nowISO: string,
  opts: { dryRun: boolean; webhookUrl?: string },
): Promise<void> {
  const since = reports[0]?.sinceISO ?? nowISO;

  await sendToGoogleChat(
    [
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
    ],
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
