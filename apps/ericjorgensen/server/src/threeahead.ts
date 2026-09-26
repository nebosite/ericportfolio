import crypto from "crypto";
import type express from "express";
import type { Database } from "better-sqlite3";

// Three Ahead Chess — network two-player relay.
//
// The server is deliberately dumb about chess: both clients run the same
// deterministic rules engine, so the API only has to (a) match two players up
// and (b) exchange each round's SEALED orders without leaking them early.
// The sealed-bid property is the one invariant that matters: a player may not
// see the opponent's round-N orders until their own round-N orders are in.
//
// Protections:
//   - per-IP rate limit across all threeahead endpoints (in-memory window)
//   - cap on concurrently active games; idle games expire after GAME_TTL_MS
//   - unguessable game codes + per-player bearer tokens
//   - strict order validation (exactly 3, in-range squares, own pieces only)

export const GAME_TTL_MS = 60 * 60 * 1000; // idle games die after an hour
export const MAX_ACTIVE_GAMES = 200;
export const MAX_ROUNDS = 500;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX_REQUESTS = 30;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
const CODE_LENGTH = 6;

interface GameRow {
  code: string;
  white_token: string | null;
  black_token: string | null;
  resigned: string | null;
  race: number;
  created_at: number;
  updated_at: number;
}

export interface ThreeAheadOptions {
  /** Injectable clock (ms) so tests can drive TTL and rate limiting. */
  now?: () => number;
}

export function initThreeAheadDb(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS threeahead_games (
      code TEXT PRIMARY KEY,
      white_token TEXT,
      black_token TEXT,
      resigned TEXT,
      race INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS threeahead_orders (
      code TEXT NOT NULL,
      round INTEGER NOT NULL,
      side TEXT NOT NULL,
      orders TEXT NOT NULL,
      PRIMARY KEY (code, round, side)
    );
  `);
  // Databases created before the race house rule shipped lack the column.
  try {
    db.exec("ALTER TABLE threeahead_games ADD COLUMN race INTEGER NOT NULL DEFAULT 0");
  } catch {
    /* column already exists */
  }
}

function randomCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

const randomToken = (): string => crypto.randomBytes(18).toString("hex");

/** One sealed order as the client submits it. */
interface WireOrder {
  pieceId: number;
  from: number;
  to: number;
  capture: boolean;
}

/** Validate a submitted plan: exactly 3 orders, well-formed, own pieces only.
 *  (Piece ids 0–15 are white's, 16–31 black's — fixed by the engine's setup.) */
export function validateOrders(raw: unknown, side: "white" | "black"): WireOrder[] | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const clean: WireOrder[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const { pieceId, from, to, capture } = item as Record<string, unknown>;
    if (!Number.isInteger(pieceId) || !Number.isInteger(from) || !Number.isInteger(to)) return null;
    if (typeof capture !== "boolean") return null;
    const p = pieceId as number;
    if (side === "white" ? p < 0 || p > 15 : p < 16 || p > 31) return null;
    const f = from as number;
    const t = to as number;
    if (f < 0 || f > 63 || t < 0 || t > 63) return null;
    clean.push({ pieceId: p, from: f, to: t, capture });
  }
  return clean;
}

export function mountThreeAhead(
  app: express.Express,
  db: Database,
  opts: ThreeAheadOptions = {},
): void {
  const now = opts.now ?? Date.now;

  /* -- Rate limiting: a sliding window of request timestamps per IP. -------- */
  const hits = new Map<string, number[]>();
  const rateLimited = (ip: string): boolean => {
    const t = now();
    const list = (hits.get(ip) ?? []).filter((h) => t - h < RATE_WINDOW_MS);
    list.push(t);
    hits.set(ip, list);
    if (hits.size > 10_000) hits.clear(); // pathological ip churn — just reset
    return list.length > RATE_MAX_REQUESTS;
  };

  const sweepStale = () => {
    const cutoff = now() - GAME_TTL_MS;
    db.prepare(
      "DELETE FROM threeahead_orders WHERE code IN (SELECT code FROM threeahead_games WHERE updated_at < ?)",
    ).run(cutoff);
    db.prepare("DELETE FROM threeahead_games WHERE updated_at < ?").run(cutoff);
  };

  const getGame = (code: string): GameRow | undefined =>
    db.prepare("SELECT * FROM threeahead_games WHERE code = ?").get(code) as GameRow | undefined;

  const bearer = (req: express.Request): string | null => {
    const header = req.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
    return header.slice(7);
  };

  const sideOf = (game: GameRow, token: string | null): "white" | "black" | null => {
    if (!token) return null;
    if (game.white_token === token) return "white";
    if (game.black_token === token) return "black";
    return null;
  };

  const guard: express.RequestHandler = (req, res, next) => {
    if (rateLimited(req.ip ?? "unknown")) {
      res.status(429).json({ error: "slow down" });
      return;
    }
    sweepStale();
    next();
  };
  app.use("/api/threeahead", guard);

  /** Create a game; the creator picks a side and receives the join code. */
  app.post("/api/threeahead/games", (req, res) => {
    const active = db.prepare("SELECT COUNT(*) AS n FROM threeahead_games").get() as { n: number };
    if (active.n >= MAX_ACTIVE_GAMES) {
      return res.status(503).json({ error: "the salon is full — try again later" });
    }
    const side = req.body?.side === "black" ? "black" : "white";
    const race = req.body?.race === true ? 1 : 0;
    const code = randomCode();
    const token = randomToken();
    const t = now();
    db.prepare(
      "INSERT INTO threeahead_games (code, white_token, black_token, race, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(code, side === "white" ? token : null, side === "black" ? token : null, race, t, t);
    res.status(201).json({ code, token, side, race: race === 1 });
  });

  /** Join by code; the joiner gets whichever side is open. */
  app.post("/api/threeahead/games/:code/join", (req, res) => {
    const game = getGame(String(req.params.code).toUpperCase());
    if (!game) return res.status(404).json({ error: "no such game" });
    const side = game.white_token === null ? "white" : game.black_token === null ? "black" : null;
    if (!side) return res.status(409).json({ error: "the table is already full" });
    const token = randomToken();
    db.prepare(`UPDATE threeahead_games SET ${side}_token = ?, updated_at = ? WHERE code = ?`).run(
      token,
      now(),
      game.code,
    );
    res.json({ code: game.code, token, side, race: game.race === 1 });
  });

  /** Submit this round's sealed orders (idempotence: one submission only). */
  app.post("/api/threeahead/games/:code/orders", (req, res) => {
    const game = getGame(String(req.params.code).toUpperCase());
    if (!game) return res.status(404).json({ error: "no such game" });
    const side = sideOf(game, bearer(req));
    if (!side) return res.status(403).json({ error: "not your table" });
    const round = req.body?.round;
    if (!Number.isInteger(round) || round < 1 || round > MAX_ROUNDS) {
      return res.status(400).json({ error: "bad round" });
    }
    const orders = validateOrders(req.body?.orders, side);
    if (!orders)
      return res.status(400).json({ error: "orders must be exactly 3 legal-looking moves" });
    const existing = db
      .prepare("SELECT 1 FROM threeahead_orders WHERE code = ? AND round = ? AND side = ?")
      .get(game.code, round, side);
    if (existing)
      return res.status(409).json({ error: "orders for this round are already sealed" });
    db.prepare("INSERT INTO threeahead_orders (code, round, side, orders) VALUES (?, ?, ?, ?)").run(
      game.code,
      round,
      side,
      JSON.stringify(orders),
    );
    db.prepare("UPDATE threeahead_games SET updated_at = ? WHERE code = ?").run(now(), game.code);
    res.status(201).json({ sealed: true });
  });

  /** Poll game state. Opponent orders for round N are revealed ONLY once the
   *  caller's own round-N orders are sealed — that is the whole game. */
  app.get("/api/threeahead/games/:code/state", (req, res) => {
    const game = getGame(String(req.params.code).toUpperCase());
    if (!game) return res.status(404).json({ error: "no such game" });
    const side = sideOf(game, bearer(req));
    if (!side) return res.status(403).json({ error: "not your table" });
    const round = Number(req.query.round ?? 1);
    if (!Number.isInteger(round) || round < 1 || round > MAX_ROUNDS) {
      return res.status(400).json({ error: "bad round" });
    }
    const other = side === "white" ? "black" : "white";
    const mine = db
      .prepare(
        "SELECT rowid, orders FROM threeahead_orders WHERE code = ? AND round = ? AND side = ?",
      )
      .get(game.code, round, side) as { rowid: number; orders: string } | undefined;
    const theirs = db
      .prepare(
        "SELECT rowid, orders FROM threeahead_orders WHERE code = ? AND round = ? AND side = ?",
      )
      .get(game.code, round, other) as { rowid: number; orders: string } | undefined;
    // Under the first-to-seal house rule the earlier submission (by insertion
    // order) leads the round; both clients read the same answer from here.
    const firstSealer = mine && theirs ? (mine.rowid < theirs.rowid ? side : other) : null;
    res.json({
      side,
      opponentJoined: game.white_token !== null && game.black_token !== null,
      resigned: game.resigned,
      race: game.race === 1,
      round,
      youSealed: mine !== undefined,
      opponentSealed: theirs !== undefined,
      firstSealer,
      // Sealed-bid reveal: only after you have committed your own orders.
      opponentOrders: mine && theirs ? JSON.parse(theirs.orders) : null,
    });
  });

  /** Concede the game; the opponent's next poll sees it. */
  app.post("/api/threeahead/games/:code/resign", (req, res) => {
    const game = getGame(String(req.params.code).toUpperCase());
    if (!game) return res.status(404).json({ error: "no such game" });
    const side = sideOf(game, bearer(req));
    if (!side) return res.status(403).json({ error: "not your table" });
    db.prepare("UPDATE threeahead_games SET resigned = ?, updated_at = ? WHERE code = ?").run(
      side,
      now(),
      game.code,
    );
    res.json({ resigned: side });
  });
}
