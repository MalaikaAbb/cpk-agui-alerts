import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseTagScope, touchesScope } from "./releases.js";

describe("parseTagScope", () => {
  test("CopilotKit per-package tags report their package", () => {
    assert.equal(parseTagScope("channels/v0.3.0"), "channels");
    assert.equal(parseTagScope("angular/v0.3.0"), "angular");
    assert.equal(parseTagScope("channels-whatsapp/v0.0.2"), "channels-whatsapp");
  });

  test("repo-wide semver tags are unscoped", () => {
    assert.equal(parseTagScope("v1.63.2"), null);
    assert.equal(parseTagScope("1.63.2"), null);
  });

  // The trap: ag-ui tags look scoped but the suffix is a date, not a semver.
  // Treating them as scoped would drop every ag-ui release attribution.
  test("ag-ui date-style release tags are unscoped", () => {
    assert.equal(parseTagScope("release/2026-07-22"), null);
    assert.equal(parseTagScope("release/2026-06-08"), null);
  });

  test("prerelease suffixes still resolve their scope", () => {
    assert.equal(parseTagScope("channels/v0.3.0-rc.1"), "channels");
    assert.equal(parseTagScope("v1.63.2-beta.0"), null);
  });
});

/**
 * Paths below are the real diffs from the CopilotKit PRs that were mislabeled
 * "RELEASED channels/v0.3.0" before scope checking existed — every package shares
 * one main branch, so commit-range containment alone is not evidence of shipping.
 */
describe("touchesScope", () => {
  test("a channels PR counts toward a channels release", () => {
    assert.equal(
      touchesScope(["packages/channels/package.json", "packages/channels/src/index.ts"], "channels"),
      true,
    );
  });

  test("a react-ui fix does not count toward a channels release", () => {
    assert.equal(
      touchesScope(["packages/react-ui/src/css/sidebar.css"], "channels"),
      false,
    );
  });

  test("an sdk-python fix does not count toward a channels release", () => {
    assert.equal(touchesScope(["sdk-python/copilotkit/langgraph.py"], "channels"), false);
  });

  test("scope matching is on whole path segments, not substrings", () => {
    // packages/channels-whatsapp/ must not satisfy the "channels" scope.
    assert.equal(touchesScope(["packages/channels-whatsapp/src/a.ts"], "channels"), false);
    assert.equal(
      touchesScope(["packages/channels-whatsapp/src/a.ts"], "channels-whatsapp"),
      true,
    );
  });

  test("angular releases match the angular package", () => {
    assert.equal(touchesScope(["packages/angular/src/lib/core.ts"], "angular"), true);
    assert.equal(touchesScope(["packages/vue/src/index.ts"], "angular"), false);
  });
});
