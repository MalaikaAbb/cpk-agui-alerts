import { DOCS_BASE_URL } from "./frameworks.js";
import type { DocsAffected } from "../types.js";

/**
 * Conceptual guide pages each package's behavior is described on.
 *
 * Hand-maintained on purpose: unlike reference pages (derived from the symbol
 * name), the association between a package and a guide is editorial. Keep it
 * short — these are the pages someone would need to re-read after a change,
 * not an exhaustive index.
 */
const GUIDES: Record<string, Array<[label: string, path: string]>> = {
  "react-core": [
    ["Frontend Tools", "frontend-tools"],
    ["Human in the Loop", "human-in-the-loop"],
    ["Shared State", "shared-state"],
    ["Generative UI", "generative-ui"],
  ],
  "react-ui": [
    ["Custom Look and Feel", "custom-look-and-feel/headless-ui"],
    ["Prebuilt Components", "prebuilt-components"],
  ],
  "react-textarea": [["Prebuilt Components", "prebuilt-components"]],
  angular: [["Angular", "angular"]],
  vue: [["Frontends", "frontends"]],
  "react-native": [["Frontends", "frontends"]],
  "web-components": [["Prebuilt Components", "prebuilt-components"]],

  runtime: [
    ["Copilot Runtime", "backend"],
    ["Deploy", "deploy"],
  ],
  "runtime-client-gql": [["Copilot Runtime", "backend"]],
  "sdk-js": [["Build with Agents", "build-with-agents"]],
  "sqlite-runner": [["Threads Lifecycle", "threads-lifecycle"]],
  "agentcore-runner": [["Deploy", "deploy"]],
  "sdk-python": [["Build with Agents", "build-with-agents"]],
  core: [["Threads", "threads"]],

  channels: [["Channels", "channels"]],
  "channels-core": [["Channels", "channels"]],
  "channels-ui": [["Channels", "channels"]],
  "channels-intelligence": [["Channels — Intelligence", "channels/intelligence"]],
  "channels-slack": [["Channels", "channels"]],
  "channels-teams": [["Channels", "channels"]],
  "channels-discord": [["Channels", "channels"]],
  "channels-telegram": [["Channels", "channels"]],
  "channels-whatsapp": [["Channels", "channels"]],

  voice: [["Voice", "voice"]],
  "web-inspector": [["Inspector", "inspector"]],
  "a2ui-renderer": [["Generative UI — A2UI", "generative-ui/a2ui"]],
};

/** Guide pages for a package, or an empty list when it has no user-facing docs. */
export function guidesFor(pkg: string): DocsAffected[] {
  return (GUIDES[pkg] ?? []).map(([text, path]) => ({
    text: `${text} (guide)`,
    url: `${DOCS_BASE_URL}/${path}`,
    kind: "guide" as const,
  }));
}
