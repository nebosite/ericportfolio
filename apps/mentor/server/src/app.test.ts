import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "./app";

// HTTP-surface tests. The full MCP handshake (initialize → prompts/get →
// tools/call) is exercised by a real SDK client in scripts/mcp/mentor-smoke.mjs.

describe("mentor service", () => {
  it("health endpoint is open", async () => {
    const res = await request(createApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", app: "mentor" });
  });

  it("is public — no auth required — but rejects a non-initialize POST without a session", async () => {
    // A bare tools/call with no session id is a protocol error (400), not an auth error (401).
    const res = await request(createApp())
      .post("/coach")
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(res.status).toBe(400);
  });

  it("rejects a GET on /coach without a session id", async () => {
    const res = await request(createApp()).get("/coach");
    expect(res.status).toBe(400);
  });
});
