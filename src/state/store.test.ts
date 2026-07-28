import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { emptyState, getRepoState, updateRepoState } from "./store.js";
import { DEFAULT_LOOKBACK_HOURS } from "../config/repos.js";

const KEY = "CopilotKit/CopilotKit";
const NOW = "2026-07-28T12:00:00.000Z";

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
        // Well outside the 30-day retention window.
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
