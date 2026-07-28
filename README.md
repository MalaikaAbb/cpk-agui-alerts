# cpk-agui-alert

Polls [CopilotKit/CopilotKit](https://github.com/CopilotKit/CopilotKit) and
[ag-ui-protocol/ag-ui](https://github.com/ag-ui-protocol/ag-ui) every 3 hours and posts a
categorized change report to a Google Chat Space.

Docs and package changes are reported in full detail and listed first; demo, example, and
internal changes are collapsed to a one-line count so they cannot crowd out the things that
matter.

## What a report contains

Per repo, one card:

- **📚 Docs** and **📦 Packages** — every PR listed with its number, title, a one-line excerpt
  of the PR description, author, `MERGED` / `RELEASED <tag>` status, and how many files it
  changed in that area. Capped at 8 per section, with a "+N more" link to the exact GitHub
  search for the window.
- **Other areas** — 🧪 Showcase/Demo, 💡 Examples, 🔧 Internal as counts only.
- **Releases published** — any new GitHub Release in the window.

A PR that spans several areas appears under each area it touched, so a small docs change riding
along with a large refactor still shows up under Docs.

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

## MERGED vs RELEASED

- **MERGED** — the PR landed on the default branch inside the polling window.
- **RELEASED `<tag>`** — its merge commit is additionally confirmed inside a published GitHub
  Release.

CopilotKit publishes per-package tags (`channels/v0.3.0`, `angular/v0.3.0`) alongside repo-wide
ones (`v1.63.2`), and every package shares one main branch. That means a tag-to-tag commit range
contains everything merged in that window regardless of package — so containment alone would
label a `react-ui` fix as shipped in `channels/v0.3.0`. For a package-scoped tag we additionally
require that the PR actually touched that package. ag-ui's date-style tags
(`release/2026-07-22`) are repo-wide and need no such filter.

## Setup

1. Push this repo to GitHub.
2. Add the Google Chat incoming webhook URL as a repository secret named
   **`GOOGLE_CHAT_WEBHOOK_URL`** (Settings → Secrets and variables → Actions).
   `GITHUB_TOKEN` is provided automatically by Actions — no PAT needed, since both watched
   repos are public.
3. Run the workflow once manually with **`dry_run: true`** (Actions → Poll and Report → Run
   workflow) and check the logged payload before letting it post for real.

After that the `schedule` trigger takes over every 3 hours (00:00 / 03:00 / 06:00 / … UTC).

To change the cadence, update the `cron` in
[`.github/workflows/poll-and-report.yml`](.github/workflows/poll-and-report.yml) and keep
`DEFAULT_LOOKBACK_HOURS` in [`src/config/repos.ts`](src/config/repos.ts) in step with it.

## Local development

```bash
npm install
npm test            # 63 unit tests, no network
npm run typecheck

# Dry run against the live repos — prints the exact Chat payload, posts nothing.
# A token is strongly recommended: unauthenticated GitHub allows only 60 requests/hour,
# which one full run can exhaust.
GITHUB_TOKEN=ghp_xxx npm run dry-run
```

To check a wider window locally, edit `lastCheckedISO` in `state/state.json` before running.

## State

`state/state.json` holds each repo's cursor and is committed back by the workflow after every
run, since Actions runners keep no disk between runs.

- `lastCheckedISO` is captured at run *start*, so anything merged mid-run is picked up next
  time rather than skipped.
- `reportedPRs` / `reportedReleaseIds` are a dedup safety net against a PR merging exactly on
  the window boundary. Entries age out after 30 days.
- First run for a repo looks back one poll interval (3 hours), so enabling this does not dump
  the whole backlog.
- A run where one repo's API calls fail leaves that repo's cursor untouched, so its window is
  retried on the next run rather than silently lost.

## Configuration

| Env var | Purpose |
| --- | --- |
| `GOOGLE_CHAT_WEBHOOK_URL` | Target Chat Space. Required unless `DRY_RUN=true`. |
| `GITHUB_TOKEN` | Raises the API rate limit. Supplied automatically in Actions. |
| `DRY_RUN` | `true` prints the payload instead of posting it. |
| `HEARTBEAT_MODE` | `always` posts an "all quiet" card when nothing changed. Default is to stay silent. |

Watched repos and tuning constants (section caps, lookback, retention) live in
[`src/config/repos.ts`](src/config/repos.ts).
