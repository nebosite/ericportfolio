import { Order, Side } from "./engine/chess";

// Thin client for the two-player relay (see the server's threeahead.ts).
// The server only match-makes and exchanges sealed orders; both browsers run
// the same deterministic engine, so exchanging orders is exchanging the game.

const BASE = "/api/threeahead";

export interface NetSession {
  code: string;
  token: string;
  side: Side;
  /** The first-to-seal house rule, fixed by the host at creation. */
  race: boolean;
}

export interface NetState {
  side: Side;
  opponentJoined: boolean;
  resigned: Side | null;
  race: boolean;
  round: number;
  youSealed: boolean;
  opponentSealed: boolean;
  /** Who sealed this round first (set once both plans are in). */
  firstSealer: Side | null;
  opponentOrders: Order[] | null;
}

export class NetError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new NetError(0, "the wire is down");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new NetError(res.status, (body as { error?: string }).error ?? "request failed");
  return body as T;
}

const auth = (session: NetSession) => ({ Authorization: `Bearer ${session.token}` });
const json = { "Content-Type": "application/json" };

export function createGame(side: Side, race: boolean): Promise<NetSession> {
  return call<NetSession>("/games", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ side, race }),
  });
}

export function joinGame(code: string): Promise<NetSession> {
  return call<NetSession>(`/games/${encodeURIComponent(code.trim().toUpperCase())}/join`, {
    method: "POST",
  });
}

export function submitOrders(session: NetSession, round: number, orders: Order[]): Promise<void> {
  return call(`/games/${session.code}/orders`, {
    method: "POST",
    headers: { ...json, ...auth(session) },
    body: JSON.stringify({ round, orders }),
  });
}

export function fetchState(session: NetSession, round: number): Promise<NetState> {
  return call<NetState>(`/games/${session.code}/state?round=${round}`, { headers: auth(session) });
}

/** Fire-and-forget concession; failures don't matter on the way out. */
export function resign(session: NetSession): void {
  void call(`/games/${session.code}/resign`, {
    method: "POST",
    headers: auth(session),
  }).catch(() => undefined);
}
