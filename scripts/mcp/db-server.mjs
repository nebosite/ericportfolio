#!/usr/bin/env node
// Read-only SQLite MCP server for the portfolio's data.
//
// Exposes the feedback DB and the Big Tiny Games leaderboard DB to Claude as a
// small set of query tools. The connections are opened READ-ONLY and every
// statement is allow-listed to SELECT/WITH/PRAGMA, so this server can never
// mutate the databases — it's for asking questions ("recent feedback for
// big-robo-tiny-tron", "top scores per game"), not for changing data.
//
// Wired up via the repo's .mcp.json (stdio transport). DB paths default to the
// local dev files and can be overridden with env vars (e.g. to point at a copy
// pulled from the VPS): DB_FEEDBACK_PATH, DB_LEADERBOARDS_PATH.

import { fileURLToPath } from "node:url";
import path from "node:path";
import Database from "better-sqlite3";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const DEFAULT_ROW_LIMIT = 200;

/** name -> sqlite file. Overridable via env so you can point at a VPS copy. */
const DB_PATHS = {
  feedback:
    process.env.DB_FEEDBACK_PATH ??
    path.join(repoRoot, "apps/feedback/server/data.db"),
  leaderboards:
    process.env.DB_LEADERBOARDS_PATH ??
    path.join(repoRoot, "apps/bigtinygames/server/data.db"),
};

/** Lazily-opened read-only connections, cached by name. */
const open = new Map();
function getDb(name) {
  const file = DB_PATHS[name];
  if (!file) throw new Error(`Unknown database "${name}". Known: ${Object.keys(DB_PATHS).join(", ")}`);
  let db = open.get(name);
  if (!db) {
    db = new Database(file, { readonly: true, fileMustExist: true });
    open.set(name, db);
  }
  return db;
}

/** Guard: only read statements, and only one of them. */
function assertReadOnly(sql) {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (/;/.test(trimmed)) throw new Error("Only a single statement is allowed.");
  if (!/^(select|with|pragma)\b/i.test(trimmed)) {
    throw new Error("Only SELECT / WITH / PRAGMA queries are allowed (this server is read-only).");
  }
  return trimmed;
}

const TOOLS = [
  {
    name: "list_databases",
    description: "List the queryable databases (feedback, leaderboards) and their file paths.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_tables",
    description: "List the tables in a database.",
    inputSchema: {
      type: "object",
      properties: { database: { type: "string", description: "feedback | leaderboards" } },
      required: ["database"],
      additionalProperties: false,
    },
  },
  {
    name: "describe_table",
    description: "Show a table's columns and types (PRAGMA table_info).",
    inputSchema: {
      type: "object",
      properties: {
        database: { type: "string", description: "feedback | leaderboards" },
        table: { type: "string" },
      },
      required: ["database", "table"],
      additionalProperties: false,
    },
  },
  {
    name: "query",
    description:
      "Run a read-only SQL query (SELECT/WITH/PRAGMA only) against a database and return the rows as JSON.",
    inputSchema: {
      type: "object",
      properties: {
        database: { type: "string", description: "feedback | leaderboards" },
        sql: { type: "string", description: "A single SELECT/WITH/PRAGMA statement." },
        limit: {
          type: "number",
          description: `Max rows to return (default ${DEFAULT_ROW_LIMIT}).`,
        },
      },
      required: ["database", "sql"],
      additionalProperties: false,
    },
  },
];

const text = (v) => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });

function handle(name, args) {
  switch (name) {
    case "list_databases":
      return text(DB_PATHS);
    case "list_tables": {
      const rows = getDb(args.database)
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all();
      return text(rows.map((r) => r.name));
    }
    case "describe_table": {
      if (!/^[A-Za-z0-9_]+$/.test(args.table)) throw new Error("Invalid table name.");
      const rows = getDb(args.database).prepare(`PRAGMA table_info(${args.table})`).all();
      return text(rows.map((c) => ({ name: c.name, type: c.type, notnull: !!c.notnull, pk: !!c.pk })));
    }
    case "query": {
      const sql = assertReadOnly(args.sql);
      const limit = Number.isFinite(args.limit) ? Math.max(1, Math.floor(args.limit)) : DEFAULT_ROW_LIMIT;
      const rows = getDb(args.database).prepare(sql).all();
      const clipped = rows.slice(0, limit);
      const note = rows.length > limit ? `\n\n(${rows.length} rows; showing first ${limit})` : "";
      return text(JSON.stringify(clipped, null, 2) + note);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: "portfolio-db", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    return handle(req.params.name, req.params.arguments ?? {});
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: `Error: ${err.message}` }] };
  }
});

await server.connect(new StdioServerTransport());
