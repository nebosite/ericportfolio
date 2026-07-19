import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  type GetPromptResult,
} from "@modelcontextprotocol/sdk/types.js";
import { COACH_PROMPT, COACH_PROMPT_NAME, buildCoachPrompt } from "./coach.js";
import { getProject, getProjectLessons, listProjects } from "./projects.js";
import { philosophyAsStructuredData } from "./philosophy.js";

// The Coding Mentor MCP surface. The star is the PROMPT (a workflow); the TOOLS
// are the supporting knowledge it draws on. Tools return structured JSON so the
// calling model gets data, not prose to re-parse.

const TOOLS = [
  {
    name: "list_projects",
    description:
      "List the portfolio's software projects (id, name, category, one-line summary). Use to browse what exists before fetching detail or lessons.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_project",
    description:
      "Full detail for one portfolio project (summary, description, tech, and its lessons).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Project id from list_projects." } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_project_lessons",
    description:
      "Layered-Development lessons drawn from real projects — each tied to a layer (Blank Screen / First Breath / Grow by Observation / Polish) with a transferable takeaway. Optionally scope to one project. Use to ground coaching advice in concrete examples.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Optional: restrict to one project's lessons." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_layered_development_philosophy",
    description:
      "The Layered Development method as structured data: the four layers (with purpose, practices, exit criteria) plus the cross-cutting principles and anti-patterns. Use to explain or apply the method precisely.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

const json = (v: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }],
});

/** Build the Coding Mentor MCP server (prompts + tools). Stateless: safe to build per session. */
export function buildMcpServer(): Server {
  const server = new Server(
    { name: "coding-mentor", version: "1.0.0" },
    { capabilities: { prompts: {}, tools: {} } },
  );

  // --- prompts (the workflow) ---
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [COACH_PROMPT] }));
  server.setRequestHandler(GetPromptRequestSchema, async (req): Promise<GetPromptResult> => {
    if (req.params.name !== COACH_PROMPT_NAME) {
      throw new Error(`Unknown prompt: ${req.params.name}`);
    }
    const { description, messages } = buildCoachPrompt(req.params.arguments ?? {});
    return { description, messages };
  });

  // --- tools (the supporting knowledge) ---
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      switch (name) {
        case "list_projects":
          return json(listProjects());
        case "get_project": {
          const project = getProject(String(args.id));
          if (!project) {
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: `No project with id "${String(args.id)}". Try list_projects.`,
                },
              ],
            };
          }
          return json(project);
        }
        case "get_project_lessons":
          return json(getProjectLessons(args.projectId ? String(args.projectId) : undefined));
        case "get_layered_development_philosophy":
          return json(philosophyAsStructuredData());
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
      };
    }
  });

  return server;
}
