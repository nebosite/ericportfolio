import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import request from "supertest";
import { createApp, initDb } from "./app";

const TOKEN = "test-secret-token";

function fresh() {
  const db = new Database(":memory:");
  initDb(db);
  return { db, app: createApp(db, TOKEN) };
}

const auth = (req: request.Test) => req.set("Authorization", `Bearer ${TOKEN}`);

describe("public feedback API", () => {
  it("submits, lists, and upvotes feedback", async () => {
    const { app } = fresh();
    const created = await request(app)
      .post("/api/feedback")
      .send({ entity: "snake", text: "add a pause button" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ entity: "snake", votes: 0, status: "Suggested" });

    const list = await request(app).get("/api/feedback/random?entity=snake");
    expect(list.body).toHaveLength(1);

    const vote = await request(app).post(`/api/feedback/${created.body.id}/vote`);
    expect(vote.body).toEqual({ id: created.body.id, votes: 1 });
  });

  it("validates entity and text length", async () => {
    const { app } = fresh();
    expect(
      (await request(app).post("/api/feedback").send({ entity: "BAD!", text: "hi" })).status,
    ).toBe(400);
    expect(
      (await request(app).post("/api/feedback").send({ entity: "snake", text: "" })).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/feedback")
          .send({ entity: "snake", text: "x".repeat(1001) })
      ).status,
    ).toBe(400);
  });

  it("does not offer implemented requests for voting", async () => {
    const { db, app } = fresh();
    const keep = await request(app)
      .post("/api/feedback")
      .send({ entity: "snake", text: "still open" });
    const done = await request(app)
      .post("/api/feedback")
      .send({ entity: "snake", text: "already done" });
    db.prepare("UPDATE feedback SET status = 'Implemented' WHERE id = ?").run(done.body.id);

    const res = await request(app).get("/api/feedback/random?entity=snake");
    expect(res.body.map((r: { id: number }) => r.id)).toEqual([keep.body.id]);
  });
});

describe("admin auth", () => {
  it("rejects missing or wrong tokens, accepts the right one", async () => {
    const { app } = fresh();
    expect((await request(app).get("/api/admin/feedback")).status).toBe(401);
    expect(
      (await request(app).get("/api/admin/feedback").set("Authorization", "Bearer nope")).status,
    ).toBe(401);
    expect((await auth(request(app).get("/api/admin/feedback"))).status).toBe(200);
  });

  it("closes the admin API entirely when no token is configured", async () => {
    const db = new Database(":memory:");
    initDb(db);
    const app = createApp(db, ""); // no admin token
    expect(
      (await request(app).get("/api/admin/feedback").set("Authorization", "Bearer x")).status,
    ).toBe(401);
  });
});

describe("admin list", () => {
  it("returns all items across entities, newest first", async () => {
    const { app } = fresh();
    await request(app).post("/api/feedback").send({ entity: "snake", text: "one" });
    await request(app).post("/api/feedback").send({ entity: "pixelwhimsy", text: "two" });
    const res = await auth(request(app).get("/api/admin/feedback"));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toHaveProperty("entity");
    expect(res.body.items[0]).toHaveProperty("status");
    expect(res.body.items[0]).toHaveProperty("isNew");
    const entities = res.body.items.map((i: { entity: string }) => i.entity).sort();
    expect(entities).toEqual(["pixelwhimsy", "snake"]);
  });

  it("flags items created since the last check and advances the marker", async () => {
    const { db, app } = fresh();
    // Deterministic timestamps avoid wall-clock flakiness.
    db.prepare(
      "INSERT INTO feedback (entity, text, created_at) VALUES ('snake','old','2024-01-01 00:00:00')",
    ).run();
    db.prepare("UPDATE admin_meta SET last_seen = '2024-06-01 00:00:00' WHERE id = 1").run();
    db.prepare(
      "INSERT INTO feedback (entity, text, created_at) VALUES ('snake','fresh','2024-12-01 00:00:00')",
    ).run();

    const res = await auth(request(app).get("/api/admin/feedback"));
    const byText = Object.fromEntries(
      res.body.items.map((i: { text: string; isNew: boolean }) => [i.text, i.isNew]),
    );
    expect(byText.old).toBe(false);
    expect(byText.fresh).toBe(true);

    // The marker advanced to ~now, so a second check flags nothing as new.
    const second = await auth(request(app).get("/api/admin/feedback"));
    expect(second.body.items.every((i: { isNew: boolean }) => i.isNew === false)).toBe(true);
  });
});

describe("admin mutations", () => {
  it("changes status between the two allowed values", async () => {
    const { app } = fresh();
    const created = await request(app)
      .post("/api/feedback")
      .send({ entity: "snake", text: "do it" });
    const id = created.body.id;
    const ok = await auth(
      request(app).patch(`/api/admin/feedback/${id}`).send({ status: "Implemented" }),
    );
    expect(ok.body).toMatchObject({ id, status: "Implemented" });

    const list = await auth(request(app).get("/api/admin/feedback"));
    expect(list.body.items.find((i: { id: number }) => i.id === id).status).toBe("Implemented");
  });

  it("edits notes and returns them on the admin list", async () => {
    const { app } = fresh();
    const created = await request(app)
      .post("/api/feedback")
      .send({ entity: "snake", text: "idea" });
    const id = created.body.id;
    const res = await auth(
      request(app).patch(`/api/admin/feedback/${id}`).send({ notes: "planned for v2" }),
    );
    expect(res.body).toMatchObject({ id, notes: "planned for v2" });

    const list = await auth(request(app).get("/api/admin/feedback"));
    expect(list.body.items.find((i: { id: number }) => i.id === id).notes).toBe("planned for v2");
  });

  it("can update status and notes together", async () => {
    const { app } = fresh();
    const created = await request(app)
      .post("/api/feedback")
      .send({ entity: "snake", text: "two at once" });
    const res = await auth(
      request(app)
        .patch(`/api/admin/feedback/${created.body.id}`)
        .send({ status: "Implemented", notes: "shipped" }),
    );
    expect(res.body).toMatchObject({ status: "Implemented", notes: "shipped" });
  });

  it("rejects an invalid status and an empty patch", async () => {
    const { app } = fresh();
    const created = await request(app).post("/api/feedback").send({ entity: "snake", text: "x" });
    expect(
      (
        await auth(
          request(app).patch(`/api/admin/feedback/${created.body.id}`).send({ status: "Done" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await auth(request(app).patch(`/api/admin/feedback/${created.body.id}`).send({}))).status,
    ).toBe(400);
  });

  it("deletes an item", async () => {
    const { app } = fresh();
    const created = await request(app).post("/api/feedback").send({ entity: "snake", text: "bye" });
    const del = await auth(request(app).delete(`/api/admin/feedback/${created.body.id}`));
    expect(del.body).toEqual({ id: created.body.id, deleted: true });
    const list = await auth(request(app).get("/api/admin/feedback"));
    expect(list.body.items).toHaveLength(0);
  });

  it("404s deleting or patching an unknown id", async () => {
    const { app } = fresh();
    expect((await auth(request(app).delete("/api/admin/feedback/999"))).status).toBe(404);
    expect(
      (await auth(request(app).patch("/api/admin/feedback/999").send({ status: "Implemented" })))
        .status,
    ).toBe(404);
  });
});
