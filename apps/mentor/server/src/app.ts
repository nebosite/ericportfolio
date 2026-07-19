import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import crypto from "node:crypto";
import { buildMcpServer } from "./mcp.js";

// The Coding Mentor service: a PUBLIC, read-only MCP endpoint (Streamable HTTP)
// at ericjorgensen.com/coach. Intentionally unauthenticated — it exposes only
// static knowledge (a coaching prompt + portfolio examples) with no user data
// and no writes, so anyone's AI client can discover and use it. Sessions are
// stateful per the MCP spec (an initialize POST mints an mcp-session-id).

const APP = "mentor";

export function createApp(): express.Express {
  const app = express();
  app.use(helmet());
  app.use(cors({ exposedHeaders: ["mcp-session-id"] }));
  app.use(morgan("tiny"));
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", app: APP, timestamp: new Date().toISOString() });
  });

  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post("/coach", async (req, res) => {
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
      await buildMcpServer().connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  });

  const bySession: express.RequestHandler = async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) return res.status(400).json({ error: "invalid or missing session id" });
    await transport.handleRequest(req, res);
  };
  app.get("/coach", bySession);
  app.delete("/coach", bySession);

  return app;
}
