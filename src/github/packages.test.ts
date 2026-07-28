import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  extractReleasedPackages,
  parsePackagesTable,
  parseTagScope,
  parseTagVersion,
} from "./packages.js";

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
  test("ag-ui date-style release tags are unscoped", () => {
    assert.equal(parseTagScope("release/2026-07-22"), null);
    assert.equal(parseTagScope("release/2026-06-08"), null);
  });

  test("prerelease suffixes still resolve their scope", () => {
    assert.equal(parseTagScope("channels/v0.3.0-rc.1"), "channels");
    assert.equal(parseTagScope("v1.63.2-beta.0"), null);
  });
});

describe("parseTagVersion", () => {
  test("extracts the version from scoped and unscoped tags", () => {
    assert.equal(parseTagVersion("channels/v0.3.0"), "0.3.0");
    assert.equal(parseTagVersion("v1.63.2"), "1.63.2");
    assert.equal(parseTagVersion("channels/v0.3.0-rc.1"), "0.3.0-rc.1");
  });

  test("date-style tags have no semver to extract", () => {
    assert.equal(parseTagVersion("release/2026-07-28"), null);
  });
});

/**
 * Real body shape from ag-ui's release notes — the package list lives here
 * because the tag itself is only a date.
 */
const AG_UI_BODY = `## Packages Published
### Python (PyPI) - published at 15:15:02 UTC
| Package | Version | Install |
|---------|---------|--------|
| ag-ui-crewai | 0.2.1 | \`pip install ag-ui-crewai==0.2.1\` |
`;

const AG_UI_MULTI_BODY = `## Packages Published
### .NET (NuGet) - published at 23:25:52 UTC
| Package | Version | Install |
|---------|---------|--------|
| AGUI.Abstractions | 0.0.4 | \`dotnet add package AGUI.Abstractions --version 0.0.4\` |
| AGUI.Formatting | 0.0.4 | \`dotnet add package AGUI.Formatting --version 0.0.4\` |
| AGUI.Client | 0.0.4 | \`dotnet add package AGUI.Client --version 0.0.4\` |
`;

describe("parsePackagesTable", () => {
  test("extracts a single published package with its registry", () => {
    assert.deepEqual(parsePackagesTable(AG_UI_BODY), [
      { name: "ag-ui-crewai", version: "0.2.1", ecosystem: "PyPI" },
    ]);
  });

  test("extracts every row of a multi-package table", () => {
    const packages = parsePackagesTable(AG_UI_MULTI_BODY);
    assert.equal(packages.length, 3);
    assert.deepEqual(
      packages.map((p) => p.name),
      ["AGUI.Abstractions", "AGUI.Formatting", "AGUI.Client"],
    );
    assert.ok(packages.every((p) => p.ecosystem === "NuGet"));
  });

  test("skips header and separator rows", () => {
    const names = parsePackagesTable(AG_UI_BODY).map((p) => p.name);
    assert.ok(!names.includes("Package"));
    assert.ok(!names.some((n) => /^-+$/.test(n)));
  });

  test("handles bodies with no table", () => {
    assert.deepEqual(parsePackagesTable("Release channels/v0.3.0"), []);
    assert.deepEqual(parsePackagesTable(null), []);
  });
});

describe("extractReleasedPackages", () => {
  test("CopilotKit scoped tag yields the package and version", () => {
    assert.deepEqual(
      extractReleasedPackages(
        { tagName: "channels/v0.3.0", body: "Release channels/v0.3.0" },
        "tag",
        "CopilotKit",
      ),
      [{ name: "channels", version: "0.3.0" }],
    );
  });

  test("CopilotKit repo-wide tag is reported under the repo name", () => {
    assert.deepEqual(
      extractReleasedPackages({ tagName: "v1.63.2", body: "Release v1.63.2" }, "tag", "CopilotKit"),
      [{ name: "CopilotKit", version: "1.63.2" }],
    );
  });

  test("ag-ui reads the package list out of the release body", () => {
    assert.deepEqual(
      extractReleasedPackages({ tagName: "release/2026-07-28", body: AG_UI_BODY }, "body", "ag-ui"),
      [{ name: "ag-ui-crewai", version: "0.2.1", ecosystem: "PyPI" }],
    );
  });

  // A release whose body drops the table should still surface something.
  test("body strategy falls back to the tag when no table is present", () => {
    assert.deepEqual(
      extractReleasedPackages({ tagName: "release/2026-07-28", body: "no table here" }, "body", "ag-ui"),
      [{ name: "ag-ui", version: "release/2026-07-28" }],
    );
  });
});
