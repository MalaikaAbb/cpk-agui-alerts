/**
 * Docs folder -> how to name and link a framework.
 *
 * Two traps this map exists to handle:
 *
 * 1. The folder under `content/docs/integrations/` is often NOT the URL slug.
 *    `crewai-flows/` serves at `/crewai-crews`, `adk/` at `/google-adk`.
 * 2. The relationship is one-to-many: `langgraph/` backs `langgraph-python`,
 *    `-typescript`, and `-fastapi`. Emitting three near-identical bullets for one
 *    edit would be noise, so we pick a single display name and canonical slug.
 *
 * Mirrors DOCS_FOLDER_OVERRIDES and the integration manifests in the CopilotKit
 * repo (`showcase/shell-docs/src/lib/registry.ts`). A folder missing here falls
 * back to title-casing its own name, which is right for the many folders whose
 * name already equals their slug (mastra, agno, llamaindex, ...).
 */
export interface FrameworkInfo {
  /** Display name, e.g. "Google ADK". */
  name: string;
  /** Slug used to build the public docs URL. */
  slug: string;
}

export const DOCS_FOLDERS: Record<string, FrameworkInfo> = {
  // Folder name differs from the URL slug.
  adk: { name: "Google ADK", slug: "google-adk" },
  "crewai-flows": { name: "CrewAI", slug: "crewai-crews" },
  "aws-strands": { name: "AWS Strands", slug: "strands" },
  "microsoft-agent-framework": { name: "MS Agent Framework", slug: "ms-agent-python" },
  langgraph: { name: "LangGraph", slug: "langgraph-python" },

  // Folder matches the slug, but the display name needs specific casing.
  mastra: { name: "Mastra", slug: "mastra" },
  agno: { name: "Agno", slug: "agno" },
  ag2: { name: "AG2", slug: "ag2" },
  llamaindex: { name: "LlamaIndex", slug: "llamaindex" },
  "pydantic-ai": { name: "PydanticAI", slug: "pydantic-ai" },
  "claude-sdk-python": { name: "Claude Agent SDK (Python)", slug: "claude-sdk-python" },
  "claude-sdk-typescript": { name: "Claude Agent SDK (TypeScript)", slug: "claude-sdk-typescript" },
  deepagents: { name: "Deep Agents", slug: "deepagents" },
  a2a: { name: "A2A", slug: "a2a" },
  "agent-spec": { name: "Agent Spec", slug: "agent-spec" },
  langroid: { name: "Langroid", slug: "langroid" },
  "spring-ai": { name: "Spring AI", slug: "spring-ai" },

  // Serves at the bare docs root rather than under a framework prefix.
  "built-in-agent": { name: "Built-in Agent", slug: "" },
};

export const DOCS_BASE_URL = "https://docs.copilotkit.ai";

export function frameworkFor(folder: string): FrameworkInfo {
  return DOCS_FOLDERS[folder] ?? { name: titleCase(folder), slug: folder };
}

/** "state-rendering" -> "State Rendering". Also handles underscores. */
export function titleCase(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
