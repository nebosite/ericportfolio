import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import request from "supertest";
import { createApp } from "./app";

// HTTP-surface tests: health is open, and the MCP endpoint is bearer-gated /
// closed when unconfigured. The full MCP protocol handshake is exercised
// separately by a real SDK client (see scripts/mcp/insights-smoke.mjs), which
// is more faithful than hand-rolling Streamable-HTTP framing here.

function fresh(token = "test-token") {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE feedback (
    id INTEGER PRIMARY KEY, entity TEXT NOT NULL, text TEXT NOT NULL,
    votes INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'Submitted',
    notes TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  return createApp(db, token);
}

describe("insights service", () => {
  it("health endpoint is open", async () => {
    const res = await request(fresh()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", app: "insights" });
  });

  it("MCP endpoint rejects missing or wrong bearer tokens", async () => {
    const app = fresh();
    const noAuth = await request(app)
      .post("/mcp")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(noAuth.status).toBe(401);
    const wrong = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer nope")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(wrong.status).toBe(401);
  });

  it("MCP endpoint is closed entirely when no token is configured", async () => {
    const res = await request(fresh(""))
      .post("/mcp")
      .set("Authorization", "Bearer anything")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(res.status).toBe(401);
  });
});
