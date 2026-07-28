import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  emptyState,
  getRepoState,
  loadState,
  saveState,
  STATE_KEY,
  updateRepoState,
} from "./store.js";
import { DEFAULT_LOOKBACK_HOURS } from "../config/repos.js";
import type { KVStore } from "../types.js";

const KEY = "CopilotKit/CopilotKit";
const NOW = "2026-07-28T12:00:00.000Z";

/** In-memory stand-in for Workers KV. */
function fakeKV(initial: string | null = null): KVStore & { value: string | null } {
  return {
    value: initial,
    async get() {
      return this.value;
    },
    async put(_key: string, value: string) {
      this.value = value;
    },
  };
}

describe("loadState", () => {
  test("bootstraps when KV has nothing stored", async () => {
    assert.deepEqual(await loadState(fakeKV()), emptyState());
  });

  test("round-trips a saved state", async () => {
    const kv = fakeKV();
    const state = emptyState();
    updateRepoState(state, KEY, { nowISO: NOW, reportedPRs: [], reportedReleaseIds: [7] });

    await saveState(kv, state);
    const loaded = await loadState(kv);

    assert.equal(loaded.repos[KEY]?.lastCheckedISO, NOW);
    assert.deepEqual(loaded.repos[KEY]?.reportedReleaseIds, [7]);
  });

  test("starts fresh rather than throwing on corrupt data", async () => {
    assert.deepEqual(await loadState(fakeKV("{not json")), emptyState());
  });

  test("starts fresh on a schema version it does not understand", async () => {
    const stored = JSON.stringify({ schemaVersion: 99, repos: { x: {} } });
    assert.deepEqual(await loadState(fakeKV(stored)), emptyState());
  });

  test("survives a KV read failure", async () => {
    const kv: KVStore = {
      async get() {
        throw new Error("KV unavailable");
      },
      async put() {},
    };

    assert.deepEqual(await loadState(kv), emptyState());
  });

  test("writes under the expected key", async () => {
    const seen: string[] = [];
    const kv: KVStore = {
      async get() {
        return null;
      },
      async put(key: string) {
        seen.push(key);
      },
    };

    await saveState(kv, emptyState());
    assert.deepEqual(seen, [STATE_KEY]);
  });
});

describe("getRepoState", () => {
  test("first run looks back exactly one poll interval", () => {
    const repoState = getRepoState(emptyState(), KEY, NOW);
    const expected = new Date(
      Date.parse(NOW) - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000,
    ).toISOString();

    assert.equal(repoState.lastCheckedISO, expected);
    assert.deepEqual(repoState.reportedPRs, []);
  });

  test("returns the stored cursor when one exists", () => {
    const state = emptyState();
    state.repos[KEY] = {
      lastCheckedISO: "2026-07-01T00:00:00.000Z",
      reportedPRs: [1],
      reportedReleaseIds: [9],
      reportedPRDates: { "1": "2026-07-01T00:00:00.000Z" },
    };

    assert.equal(getRepoState(state, KEY, NOW).lastCheckedISO, "2026-07-01T00:00:00.000Z");
  });
});

describe("updateRepoState", () => {
  test("advances the cursor and records reported ids", () => {
    const state = emptyState();
    updateRepoState(state, KEY, {
      nowISO: NOW,
      reportedPRs: [{ number: 42, mergedAt: "2026-07-28T09:00:00.000Z" }],
      reportedReleaseIds: [7],
    });

    const repoState = state.repos[KEY];
    assert.equal(repoState?.lastCheckedISO, NOW);
    assert.deepEqual(repoState?.reportedPRs, [42]);
    assert.deepEqual(repoState?.reportedReleaseIds, [7]);
  });

  test("merges with previously reported ids rather than replacing them", () => {
    const state = emptyState();
    state.repos[KEY] = {
      lastCheckedISO: "2026-07-28T06:00:00.000Z",
      reportedPRs: [10],
      reportedReleaseIds: [1],
      reportedPRDates: { "10": "2026-07-28T05:00:00.000Z" },
    };

    updateRepoState(state, KEY, {
      nowISO: NOW,
      reportedPRs: [{ number: 11, mergedAt: "2026-07-28T09:00:00.000Z" }],
      reportedReleaseIds: [2],
    });

    assert.deepEqual(state.repos[KEY]?.reportedPRs, [10, 11]);
    assert.deepEqual(state.repos[KEY]?.reportedReleaseIds, [1, 2]);
  });

  test("ages out dedup entries past the retention window", () => {
    const state = emptyState();
    state.repos[KEY] = {
      lastCheckedISO: "2026-07-28T06:00:00.000Z",
      reportedPRs: [1, 2],
      reportedReleaseIds: [],
      reportedPRDates: {
        "1": "2026-01-01T00:00:00.000Z",
        "2": "2026-07-20T00:00:00.000Z",
      },
    };

    updateRepoState(state, KEY, { nowISO: NOW, reportedPRs: [], reportedReleaseIds: [] });

    assert.deepEqual(state.repos[KEY]?.reportedPRs, [2]);
    assert.equal(state.repos[KEY]?.reportedPRDates["1"], undefined);
  });

  test("a quiet run still advances the cursor", () => {
    const state = emptyState();
    state.repos[KEY] = {
      lastCheckedISO: "2026-07-28T06:00:00.000Z",
      reportedPRs: [],
      reportedReleaseIds: [],
      reportedPRDates: {},
    };

    updateRepoState(state, KEY, { nowISO: NOW, reportedPRs: [], reportedReleaseIds: [] });
    assert.equal(state.repos[KEY]?.lastCheckedISO, NOW);
  });
});
