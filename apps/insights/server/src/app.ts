import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import type { Database } from "better-sqlite3";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { buildMcpServer } from "./mcp.js";

// The ericjorgensen.com "insights" service: a remote MCP endpoint exposing
// read-only feature-request (feedback) tools over Streamable HTTP. Gated by a
// bearer token (INSIGHTS_TOKEN); if that's unset the MCP endpoint is closed
// entirely, like the feedback admin API. It opens the shared feedback DB
// read-only, so it can never mutate data.
//
// Sessions are stateful (spec-compliant): an `initialize` POST mints an
// mcp-session-id the client returns on subsequent requests; the transport for
// that session is kept in memory and torn down on close.

const APP = "insights";

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function createApp(db: Database, token = process.env.INSIGHTS_TOKEN ?? ""): express.Express {
  const app = express();
  app.use(helmet());
  app.use(cors({ exposedHeaders: ["mcp-session-id"] }));
  app.use(morgan("tiny"));
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", app: APP, timestamp: new Date().toISOString() });
  });

  const requireToken: express.RequestHandler = (req, res, next) => {
    if (!token) {
      return res.status(401).json({ error: "insights MCP is not configured" });
    }
    const header = req.headers.authorization ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!provided || !constantTimeEqual(provided, token)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    next();
  };

  // Live transports keyed by session id.
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp", requireToken, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      if (sessionId || !isInitializeRequest(req.body)) {
        return res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: no valid session for this request" },
          id: null,
        });
      }
      // New session: mint a transport + fresh MCP server and register it.
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (sid) => {
          transports.set(sid, transport as StreamableHTTPServerTransport);
        },
      });
      transport.onclose = () => {
        if (transport?.sessionId) transports.delete(transport.sessionId);
      };
      await buildMcpServer(db).connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  });

  // GET (open the SSE stream) and DELETE (end the session) act on an existing session.
  const bySession: express.RequestHandler = async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) return res.status(400).json({ error: "invalid or missing session id" });
    await transport.handleRequest(req, res);
  };
  app.get("/mcp", requireToken, bySession);
  app.delete("/mcp", requireToken, bySession);

  return app;
}
