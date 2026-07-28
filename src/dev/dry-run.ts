/**
 * Local dry run — exercises the real GraphQL calls and prints the Chat payload
 * without deploying, without posting, and without touching any stored cursor.
 *
 *   GITHUB_TOKEN=ghp_xxx node dist/dev/dry-run.js [hoursBack]
 *
 * Not part of the Worker bundle: wrangler only bundles what is reachable from
 * `main`, and nothing in src/index.ts imports this.
 */
import { runPoll } from "../index.js";
import type { Env, KVStore } from "../types.js";

const hoursBack = Number(process.argv[2] ?? 3);

if (!process.env.GITHUB_TOKEN) {
  console.error("GITHUB_TOKEN is required — the GraphQL API rejects anonymous requests.");
  process.exit(1);
}

// In-memory KV seeded with a cursor `hoursBack` in the past.
const seeded = JSON.stringify({
  schemaVersion: 1,
  repos: {
    "CopilotKit/CopilotKit": {
      lastCheckedISO: new Date(Date.now() - hoursBack * 3600_000).toISOString(),
      reportedPRs: [],
      reportedReleaseIds: [],
      reportedPRDates: {},
    },
    "ag-ui-protocol/ag-ui": {
      lastCheckedISO: new Date(Date.now() - hoursBack * 3600_000).toISOString(),
      reportedPRs: [],
      reportedReleaseIds: [],
      reportedPRDates: {},
    },
  },
});

const memoryKV: KVStore = {
  async get() {
    return seeded;
  },
  async put() {
    throw new Error("dry run must never write state");
  },
};

const env: Env = {
  STATE: memoryKV,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GOOGLE_CHAT_WEBHOOK_URL: process.env.GOOGLE_CHAT_WEBHOOK_URL,
  DRY_RUN: "true",
};

console.log(`[dev] dry run over the last ${hoursBack}h\n`);

runPoll(env)
  .then((r) => console.log(`\n[dev] done — ${r.summary}`))
  .catch((err) => {
    console.error("[dev] failed:", err instanceof Error ? (err.stack ?? err.message) : err);
    process.exitCode = 1;
  });
