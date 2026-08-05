# cpk-agui-alert

A Cloudflare Worker that polls [CopilotKit/CopilotKit](https://github.com/CopilotKit/CopilotKit)
and [ag-ui-protocol/ag-ui](https://github.com/ag-ui-protocol/ag-ui) every 3 hours and posts a
categorized change report to a Google Chat Space.

Docs and package changes are the two things reported prominently; demo, example, and internal
changes are collapsed to a one-line count so they cannot crowd out the things that matter.

## When a notification is sent

Only two things earn a notification:

1. a **docs change** merged, or
2. a **package release** published.

Anything else — showcase, examples, internal, or package PRs that have not been released — is
**silent**. Those still appear as context on a notification that a docs change or release
already earned, but they never trigger one on their own. A window with nothing but showcase
churn produces no message at all.

| Window contains | Result |
| --- | --- |
| Nothing | silent |
| Package PRs merged, no release | silent |
| Showcase / examples / internal only | silent |
| A docs PR | **sent** |
| A package release | **sent** |

To change what counts as a trigger, edit `NOTIFY_TRIGGER_CATEGORIES` in
[`src/types.ts`](src/types.ts).

## What a report contains

Per repo, one card:

- **📦 Packages released** — driven by **releases, not merges**. Lists the package names and
  versions that were actually published, with the registry where known.
- **📋 What shipped in `<release>`** — the changelog, **PR-first**. Each PR appears exactly once
  with the packages it touched nested under it, one line per package listing that package's
  changed subpaths. In `react-core` those subpaths are the actual symbols
  (`useFrontendTool, useHumanInTheLoop`), not just `hooks`.
- **📖 Docs Affected** — documentation the released changes may have made stale: the reference
  page for each changed symbol, plus the conceptual guides for the packages involved.
- **📚 Docs** — driven by merges, since docs deploy from `main` rather than being versioned.
  Listed **by page**, not by PR: `Mastra — State Rendering`, linked to the live docs page and
  to the PRs that touched it.
- **Other areas** — 🧪 Showcase/Demo, 💡 Examples, 🔧 Internal as counts only.

A PR that spans several areas appears under each area it touched, so a small docs change riding
along with a large refactor still shows up under Docs. A PR that touched **only** package code
is not shown at all — it will be represented by its release when one ships.

### Buffering

Package changes accumulate in a per-package buffer in KV and are flushed when that package
releases. A **scoped** tag (`channels/v0.3.0`) drains only its own bucket, so accumulated
`react-core` work keeps waiting for its own release; a **repo-wide** tag (`v1.63.2`,
`release/2026-07-28`) drains everything.

**Docs are never buffered.** A docs change is announced within 3 hours of merging and never
replayed in a later release report — so the buffer holds exactly "package work that has not
shipped yet".

The buffer is purged only after the webhook confirms delivery — a failed send leaves both the
buffer and the cursor untouched so the next run retries. Advancing the cursor on failure would
move the window past the release, stranding the changelog permanently.

Two kinds of noise are deliberately filtered out of changelogs:

- **Manifest-only edits.** A monorepo release PR bumps every `package.json` at once; counting
  that as a change in each package buried the real work (one release went from 17 entries to 1).
- **Test-file suffixes.** `delivery-transport.test.ts` reports under `delivery-transport`
  rather than inventing a `.test` area.
- **Per-area PR repetition.** An earlier version grouped by `package — area`, which made one PR
  repeat once per area — a live report listed a single PR eight times with `channels-core` as
  four separate headings. Grouping PR-first fixed it, and the header now counts PRs, not areas.

### Overflow

A report too large for Google Chat's 32 KB limit is **split across consecutive messages**, never
truncated — a big release is exactly when the detail matters. Only the first message carries the
notification text, so a multi-part report pings once. Delivery is all-or-nothing: the buffer is
purged only when every message lands, so a mid-sequence failure retries the whole set next run
(which can duplicate lines — recoverable, unlike a lost changelog).

### How package names are resolved

The two repos record published packages differently, so the strategy is per-repo
(`releasePackageSource` in [`src/config/repos.ts`](src/config/repos.ts)):

| Repo | Source | Example |
| --- | --- | --- |
| CopilotKit | `tag` — the tag names the package | `channels/v0.3.0` → **channels 0.3.0**; repo-wide `v1.63.2` → **CopilotKit 1.63.2** |
| ag-ui | `body` — a "Packages Published" table in the release notes, since tags are repo-wide dates | `release/2026-07-28` → **ag-ui-crewai 0.2.1 (PyPI)** |

If an ag-ui release body ever drops that table, it falls back to the tag so the release still
gets reported rather than vanishing.

## Categorization

Each repo has an ordered list of path-prefix rules in [`src/categorize/rules.ts`](src/categorize/rules.ts).
Every changed file is classified independently; the first matching prefix wins, so specific
prefixes must be listed before general ones.

| Category | CopilotKit | ag-ui |
| --- | --- | --- |
| 📚 Docs | `showcase/shell-docs/` | `docs/` |
| 📦 Packages | `packages/`, `sdk-python/` | `sdks/`, `integrations/`, `middlewares/` |
| 🧪 Showcase / Demo | `showcase/` (everything else) | `apps/dojo/` |
| 💡 Examples | `examples/` | `apps/client-cli-example/` |
| 🔧 Internal | `dev-docs/`, `skills/`, root config | `skills/`, root config |

Two things worth knowing about these repos:

- CopilotKit's top-level `docs/` is only a symlink to `showcase/shell-docs/`, so real docs
  changes land under the latter. Rule order matters here: `showcase/shell-docs/` must be
  matched before the generic `showcase/` rule.
- `showcase/shell-docs/src/content/ag-ui/` is a downstream mirror of the ag-ui protocol docs,
  whose canonical source is the ag-ui repo. Changes there are flagged with a warning note.

## Why packages are release-driven

An earlier version tried to label each merged PR with the release that shipped it. That does not
work on these repos: every package shares one `main` branch, so a tag-to-tag commit range
contains everything merged in that window regardless of package — it would label a `react-ui`
fix as shipped in `channels/v0.3.0` purely because it merged in between.

Reporting packages straight from the release (name + version, no PR correlation) sidesteps the
problem entirely and answers the more useful question anyway: **what can I install right now?**

The tradeoff to be aware of: package work is invisible between releases. If you need to see
package PRs as they merge, remove `"Packages"` from `RELEASE_DRIVEN_CATEGORIES` in
[`src/types.ts`](src/types.ts) and add it to `PR_DETAIL_CATEGORIES`.

## Setup

Prerequisites: a Cloudflare account (free plan is enough) and `npm install`.

**1. Create the KV namespace** that holds the poll cursor:

```bash
npx wrangler kv namespace create STATE
```

Paste the printed `id` into `wrangler.toml`, replacing `REPLACE_WITH_KV_NAMESPACE_ID`.

**2. Create a GitHub token.** Unlike GitHub Actions, Cloudflare has no automatic token, and
the GraphQL API rejects anonymous requests entirely. A **fine-grained PAT** with *Public
repositories (read-only)* access is sufficient — no write scopes, no org access.

**3. Set both secrets** (these never go in `wrangler.toml`, which is committed):

```bash
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put GOOGLE_CHAT_WEBHOOK_URL
```

**4. Verify before deploying** — hits the real GitHub API, posts nothing:

```bash
GITHUB_TOKEN=github_pat_xxx npm run dry-run 24    # look back 24h
```

**5. Deploy:**

```bash
npx wrangler deploy
```

The cron in `wrangler.toml` takes over from there. Watch it live with `npx wrangler tail`.

## Triggering a run manually

The Worker also exposes an HTTP endpoint, the equivalent of `workflow_dispatch`:

```bash
curl https://cpk-agui-alert.<your-subdomain>.workers.dev/         # real run
curl https://cpk-agui-alert.<your-subdomain>.workers.dev/?dry=1   # dry run
```

`?dry=1` logs the payload without posting to Chat and without advancing the cursor, so you can
run it as often as you like.

## Local development

```bash
npm install
npm test                                  # 176 unit tests, no network
npm run typecheck
npx wrangler dev                          # run the Worker locally

# Real GitHub calls, prints the Chat payload, posts nothing, writes nothing.
GITHUB_TOKEN=github_pat_xxx npm run dry-run [hoursBack]
```

## Why GraphQL

The REST version needed one `pulls/{n}/files` request per merged PR. A busy window hit 27 PRs
on CopilotKit alone, which would blow through Cloudflare's **50-subrequest-per-invocation**
limit on the free plan — and it would have failed only under load, not in testing.

The GraphQL query returns each PR's changed files inline, so a run costs **2 requests per repo**
(pulls + releases) no matter how much merged. That keeps it comfortably inside the free tier
permanently, and made local dry runs practical too.

## State

The poll cursor lives in a single Workers KV key (`poll-state`), replacing the JSON file the
GitHub Actions version had to commit back to git on every run.

- `lastCheckedISO` is captured at run *start*, so anything merged mid-run is picked up next
  time rather than skipped.
- `reportedPRs` / `reportedReleaseIds` are a dedup safety net against a PR merging exactly on
  the window boundary. Entries age out after 30 days.
- First run for a repo looks back one poll interval (3 hours), so enabling this does not dump
  the whole backlog.
- A run where one repo's API calls fail leaves that repo's cursor untouched, so its window is
  retried on the next run rather than silently lost.
- **Dry runs do not write state at all.** A dry run that advanced the cursor would mark those
  PRs as reported and they would never appear in a real notification.

To inspect or reset the cursor:

```bash
npx wrangler kv key get --binding=STATE poll-state
npx wrangler kv key delete --binding=STATE poll-state    # next run looks back 3h
```

## Configuration

| Binding | Kind | Purpose |
| --- | --- | --- |
| `STATE` | KV namespace | Holds the poll cursor. Configured in `wrangler.toml`. |
| `GITHUB_TOKEN` | secret | Fine-grained PAT, public read-only. **Required** — GraphQL has no anonymous tier. |
| `GOOGLE_CHAT_WEBHOOK_URL` | secret | Target Chat Space. Required unless `DRY_RUN=true`. |
| `DRY_RUN` | var | `true` prints the payload instead of posting it. |
| `HEARTBEAT_MODE` | var | `always` posts an "all quiet" card when a window produced no docs change and no package release. Default is to stay silent. |

Watched repos and tuning constants (section caps, lookback, retention) live in
[`src/config/repos.ts`](src/config/repos.ts).

To change the cadence, update `crons` in [`wrangler.toml`](wrangler.toml) and keep
`DEFAULT_LOOKBACK_HOURS` in [`src/config/repos.ts`](src/config/repos.ts) in step with it.
Cloudflare Cron Triggers are interpreted in UTC.
