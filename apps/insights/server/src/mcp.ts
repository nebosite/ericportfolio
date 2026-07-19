import type { Database } from "better-sqlite3";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  topRequests,
  listRequests,
  recentActivity,
  appSummary,
  findDuplicates,
} from "./insights.js";

// The MCP surface for ericjorgensen.com's insights: read-only tools over the
// portfolio's feature-request (feedback) data. Cross-app *usage* analytics
// (GA4) will be added here later as additional tools.

const TOOLS = [
  {
    name: "top_requests",
    description:
      "Top feature requests for an app/game (entity), most-voted first — i.e. what users most want. Excludes already-implemented items. Use for 'what's top priority for users in <app>'.",
    inputSchema: {
      type: "object",
      properties: {
        entity: { type: "string", description: "App/game slug, e.g. big-space-tiny-invaders" },
        limit: { type: "number", description: "Max rows (default 10)." },
      },
      required: ["entity"],
      additionalProperties: false,
    },
  },
  {
    name: "list_requests",
    description: "All active feature requests for an entity, optionally filtered by status.",
    inputSchema: {
      type: "object",
      properties: {
        entity: { type: "string" },
        status: { type: "string", description: "Submitted | Suggested | Implemented" },
        limit: { type: "number", description: "Max rows (default 100)." },
      },
      required: ["entity"],
      additionalProperties: false,
    },
  },
  {
    name: "recent_activity",
    description:
      "Feature-request interaction over the last N days (new submissions per app, plus current votes on them). Use for 'how much interaction with feature requests happened this week' (default 7 days).",
    inputSchema: {
      type: "object",
      properties: { days: { type: "number", description: "Lookback window in days (default 7)." } },
      additionalProperties: false,
    },
  },
  {
    name: "app_summary",
    description:
      "Per-app feature-request engagement: total requests, counts by status, total votes, latest activity. A proxy for which apps users care about (until GA4 usage analytics is added).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "find_duplicates",
    description:
      "Candidate duplicate feature requests: pairs whose wording overlaps at/above a similarity threshold (0-1). Scoped to one entity if given, else compared within each app. Use for 'what feature requests look like duplicates'.",
    inputSchema: {
      type: "object",
      properties: {
        entity: { type: "string", description: "Optional: restrict to one app/game." },
        threshold: { type: "number", description: "Jaccard similarity 0-1 (default 0.4)." },
      },
      additionalProperties: false,
    },
  },
];

const text = (v: unknown) => ({
  content: [
    { type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) },
  ],
});

/** Build an MCP Server exposing the read-only insights tools over `db`. */
export function buildMcpServer(db: Database): Server {
  const server = new Server(
    { name: "ericjorgensen-insights", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      switch (name) {
        case "top_requests":
          return text(topRequests(db, String(args.entity), numArg(args.limit, 10)));
        case "list_requests":
          return text(
            listRequests(
              db,
              String(args.entity),
              args.status ? String(args.status) : undefined,
              numArg(args.limit, 100),
            ),
          );
        case "recent_activity":
          return text(recentActivity(db, numArg(args.days, 7)));
        case "app_summary":
          return text(appSummary(db));
        case "find_duplicates":
          return text(
            findDuplicates(
              db,
              args.entity ? String(args.entity) : undefined,
              numArg(args.threshold, 0.4),
            ),
          );
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

function numArg(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
