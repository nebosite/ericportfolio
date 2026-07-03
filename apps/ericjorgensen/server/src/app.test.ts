import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import request from "supertest";
import { createApp, initDb } from "./app";

// Each test gets a fresh in-memory database so they never touch the real file
// or each other.
function freshApp() {
  const db = new Database(":memory:");
  initDb(db);
  return createApp(db);
}

describe("GET /api/health", () => {
  it("reports ok with the app name", async () => {
    const res = await request(freshApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", app: "ericjorgensen" });
  });
});

describe("guestbook", () => {
  it("starts empty", async () => {
    const res = await request(freshApp()).get("/api/guestbook");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("accepts a valid entry and returns it", async () => {
    const app = freshApp();
    const post = await request(app)
      .post("/api/guestbook")
      .send({ name: "Ada", message: "hello there" });
    expect(post.status).toBe(201);
    expect(post.body).toMatchObject({ name: "Ada", message: "hello there" });
    expect(post.body.id).toBeTypeOf("number");

    const list = await request(app).get("/api/guestbook");
    expect(list.body).toHaveLength(1);
    expect(list.body[0].message).toBe("hello there");
  });

  it("trims whitespace before storing", async () => {
    const app = freshApp();
    const post = await request(app)
      .post("/api/guestbook")
      .send({ name: "  Grace  ", message: "  spaced  " });
    expect(post.body.name).toBe("Grace");
    expect(post.body.message).toBe("spaced");
  });

  it("rejects a missing or too-long name", async () => {
    const app = freshApp();
    expect((await request(app).post("/api/guestbook").send({ message: "hi" })).status).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/guestbook")
          .send({ name: "x".repeat(51), message: "hi" })
      ).status,
    ).toBe(400);
  });

  it("rejects a missing or too-long message", async () => {
    const app = freshApp();
    expect((await request(app).post("/api/guestbook").send({ name: "Ada" })).status).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/guestbook")
          .send({ name: "Ada", message: "x".repeat(501) })
      ).status,
    ).toBe(400);
  });
});

describe("POST /api/visit", () => {
  it("increments the counter on each hit", async () => {
    const app = freshApp();
    const first = await request(app).post("/api/visit");
    const second = await request(app).post("/api/visit");
    expect(first.body.count).toBe(1);
    expect(second.body.count).toBe(2);
  });
});

describe("GET /api/portraits", () => {
  it("returns an array of /api/media URLs", async () => {
    const res = await request(freshApp()).get("/api/portraits");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // The real squares folder ships with the repo, so there should be entries,
    // each pointing under the static media mount.
    for (const url of res.body) {
      expect(url).toMatch(/^\/api\/media\/Photos\/squares\//);
    }
  });
});

describe("GET /api/media", () => {
  it("serves a gallery contents.json", async () => {
    const res = await request(freshApp()).get("/api/media/writing/contents.json");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty("title");
    expect(res.body[0]).toHaveProperty("file");
    expect(res.body[0]).toHaveProperty("description");
  });

  it("404s for a file that does not exist", async () => {
    const res = await request(freshApp()).get("/api/media/writing/nope.json");
    expect(res.status).toBe(404);
  });
});
