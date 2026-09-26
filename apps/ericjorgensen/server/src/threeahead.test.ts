import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import request from "supertest";
import type express from "express";
import { createApp, initDb } from "./app";
import { GAME_TTL_MS, validateOrders } from "./threeahead";

// The relay's one sacred invariant: opponent orders for a round stay hidden
// until the caller has sealed their own. Everything else is limits and hygiene.

function freshApp(now?: () => number): express.Express {
  const db = new Database(":memory:");
  initDb(db);
  return createApp(db, now ? { now } : {});
}

const WHITE_ORDERS = [
  { pieceId: 12, from: 12, to: 28, capture: false },
  { pieceId: 6, from: 6, to: 21, capture: false },
  { pieceId: 5, from: 5, to: 26, capture: false },
];
const BLACK_ORDERS = [
  { pieceId: 28, from: 52, to: 36, capture: false },
  { pieceId: 17, from: 57, to: 42, capture: false },
  { pieceId: 27, from: 51, to: 43, capture: false },
];

async function makeMatch(app: express.Express) {
  const created = await request(app).post("/api/threeahead/games").send({ side: "white" });
  const joined = await request(app).post(`/api/threeahead/games/${created.body.code}/join`).send();
  return {
    code: created.body.code as string,
    white: created.body.token as string,
    black: joined.body.token as string,
  };
}

describe("match-making", () => {
  it("creates a game with a shareable code and the chosen side", async () => {
    const res = await request(freshApp()).post("/api/threeahead/games").send({ side: "black" });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(res.body.side).toBe("black");
    expect(res.body.token).toMatch(/^[0-9a-f]{36}$/);
  });

  it("gives the joiner the open side", async () => {
    const app = freshApp();
    const created = await request(app).post("/api/threeahead/games").send({ side: "black" });
    const joined = await request(app)
      .post(`/api/threeahead/games/${created.body.code}/join`)
      .send();
    expect(joined.status).toBe(200);
    expect(joined.body.side).toBe("white");
  });

  it("rejects joining a full or unknown game", async () => {
    const app = freshApp();
    const match = await makeMatch(app);
    const third = await request(app).post(`/api/threeahead/games/${match.code}/join`).send();
    expect(third.status).toBe(409);
    const ghost = await request(app).post("/api/threeahead/games/QQQQQQ/join").send();
    expect(ghost.status).toBe(404);
  });

  it("accepts the code case-insensitively", async () => {
    const app = freshApp();
    const created = await request(app).post("/api/threeahead/games").send();
    const joined = await request(app)
      .post(`/api/threeahead/games/${created.body.code.toLowerCase()}/join`)
      .send();
    expect(joined.status).toBe(200);
  });
});

describe("sealed orders", () => {
  it("keeps the opponent's orders hidden until you seal your own", async () => {
    const app = freshApp();
    const { code, white, black } = await makeMatch(app);

    await request(app)
      .post(`/api/threeahead/games/${code}/orders`)
      .set("Authorization", `Bearer ${black}`)
      .send({ round: 1, orders: BLACK_ORDERS });

    // White has not sealed — no peeking.
    const before = await request(app)
      .get(`/api/threeahead/games/${code}/state?round=1`)
      .set("Authorization", `Bearer ${white}`);
    expect(before.body.opponentSealed).toBe(true);
    expect(before.body.opponentOrders).toBeNull();

    await request(app)
      .post(`/api/threeahead/games/${code}/orders`)
      .set("Authorization", `Bearer ${white}`)
      .send({ round: 1, orders: WHITE_ORDERS });

    const after = await request(app)
      .get(`/api/threeahead/games/${code}/state?round=1`)
      .set("Authorization", `Bearer ${white}`);
    expect(after.body.opponentOrders).toEqual(BLACK_ORDERS);
  });

  it("refuses a second submission for the same round", async () => {
    const app = freshApp();
    const { code, white } = await makeMatch(app);
    const first = await request(app)
      .post(`/api/threeahead/games/${code}/orders`)
      .set("Authorization", `Bearer ${white}`)
      .send({ round: 1, orders: WHITE_ORDERS });
    expect(first.status).toBe(201);
    const again = await request(app)
      .post(`/api/threeahead/games/${code}/orders`)
      .set("Authorization", `Bearer ${white}`)
      .send({ round: 1, orders: WHITE_ORDERS });
    expect(again.status).toBe(409);
  });

  it("rejects submissions without a valid token", async () => {
    const app = freshApp();
    const { code } = await makeMatch(app);
    const res = await request(app)
      .post(`/api/threeahead/games/${code}/orders`)
      .set("Authorization", "Bearer forged")
      .send({ round: 1, orders: WHITE_ORDERS });
    expect(res.status).toBe(403);
  });

  it("rejects malformed plans and moves of the opponent's pieces", async () => {
    const app = freshApp();
    const { code, white } = await makeMatch(app);
    const send = (orders: unknown, round: unknown = 1) =>
      request(app)
        .post(`/api/threeahead/games/${code}/orders`)
        .set("Authorization", `Bearer ${white}`)
        .send({ round, orders });

    expect((await send([WHITE_ORDERS[0]])).status).toBe(400); // not 3
    expect((await send(BLACK_ORDERS)).status).toBe(400); // black pieces as white
    expect(
      (await send([{ pieceId: 3, from: 0, to: 99, capture: false }, ...WHITE_ORDERS.slice(1)]))
        .status,
    ).toBe(400); // off board
    expect((await send(WHITE_ORDERS, 0)).status).toBe(400); // bad round
    expect((await send(WHITE_ORDERS, "x")).status).toBe(400);
  });
});

describe("validateOrders (unit)", () => {
  it("accepts a clean white plan and strips nothing it shouldn't", () => {
    expect(validateOrders(WHITE_ORDERS, "white")).toEqual(WHITE_ORDERS);
  });
  it("rejects non-arrays, extra/missing orders, and bad fields", () => {
    expect(validateOrders(null, "white")).toBeNull();
    expect(validateOrders([], "white")).toBeNull();
    expect(validateOrders([...WHITE_ORDERS, WHITE_ORDERS[0]], "white")).toBeNull();
    expect(
      validateOrders(
        [{ pieceId: 3, from: 0, to: 8, capture: "yes" }, ...WHITE_ORDERS.slice(1)],
        "white",
      ),
    ).toBeNull();
  });
});

describe("resign", () => {
  it("marks the resigning side and surfaces it in state", async () => {
    const app = freshApp();
    const { code, white, black } = await makeMatch(app);
    await request(app)
      .post(`/api/threeahead/games/${code}/resign`)
      .set("Authorization", `Bearer ${black}`);
    const state = await request(app)
      .get(`/api/threeahead/games/${code}/state?round=1`)
      .set("Authorization", `Bearer ${white}`);
    expect(state.body.resigned).toBe("black");
  });
});

describe("limits and hygiene", () => {
  it("expires idle games after the TTL", async () => {
    let t = 1_000_000;
    const app = freshApp(() => t);
    const { code, white } = await makeMatch(app);
    t += GAME_TTL_MS + 1;
    const res = await request(app)
      .get(`/api/threeahead/games/${code}/state?round=1`)
      .set("Authorization", `Bearer ${white}`);
    expect(res.status).toBe(404);
  });

  it("rate-limits a hammering client", async () => {
    // Freeze the clock so every request lands inside one window.
    const app = freshApp(() => 1_000_000);
    let limited = false;
    for (let i = 0; i < 40; i++) {
      const res = await request(app).post("/api/threeahead/games/NOPE/join").send();
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});

describe("first-to-seal house rule", () => {
  it("stores the race flag and hands it to the joiner", async () => {
    const app = freshApp();
    const created = await request(app)
      .post("/api/threeahead/games")
      .send({ side: "white", race: true });
    expect(created.body.race).toBe(true);
    const joined = await request(app)
      .post(`/api/threeahead/games/${created.body.code}/join`)
      .send();
    expect(joined.body.race).toBe(true);
  });

  it("defaults race off", async () => {
    const app = freshApp();
    const created = await request(app).post("/api/threeahead/games").send({ side: "white" });
    expect(created.body.race).toBe(false);
  });

  it("reports the first sealer once both plans are in", async () => {
    const app = freshApp();
    const { code, white, black } = await makeMatch(app);
    await request(app)
      .post(`/api/threeahead/games/${code}/orders`)
      .set("Authorization", `Bearer ${black}`)
      .send({ round: 1, orders: BLACK_ORDERS });
    // Before white seals, no verdict is revealed.
    const before = await request(app)
      .get(`/api/threeahead/games/${code}/state?round=1`)
      .set("Authorization", `Bearer ${black}`);
    expect(before.body.firstSealer).toBeNull();
    await request(app)
      .post(`/api/threeahead/games/${code}/orders`)
      .set("Authorization", `Bearer ${white}`)
      .send({ round: 1, orders: WHITE_ORDERS });
    // Black sealed first; both players read the same verdict.
    for (const token of [white, black]) {
      const state = await request(app)
        .get(`/api/threeahead/games/${code}/state?round=1`)
        .set("Authorization", `Bearer ${token}`);
      expect(state.body.firstSealer).toBe("black");
    }
  });
});
