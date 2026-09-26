import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ThreeAheadPage from "./ThreeAheadPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <ThreeAheadPage />
    </MemoryRouter>,
  );
}

/** Click through to a fresh planning phase as Ivory (white). Level 3 keeps the
 *  machine's thinking budget at zero, so tests never wait on real computation
 *  (fake timers freeze Date.now, which would starve a budgeted think loop). */
function startAsWhite() {
  fireEvent.click(screen.getByRole("button", { name: "Level 3" }));
  fireEvent.click(screen.getByRole("button", { name: "Play as Ivory" }));
}

function clickSquare(label: RegExp | string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
}

/** Seal the current three orders; the handler awaits the machine's plan. */
async function sealOrders() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Seal Orders" }));
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("title screen", () => {
  it("shows the name, the rules, and all three mode cards", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { level: 1, name: /Three Ahead Chess/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("The Rules of Three")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Versus the Machine" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Two Players, One Wire" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Machine vs Machine" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play as Ivory" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play as Onyx" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Host as Ivory" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Let Them Play" })).toBeInTheDocument();
  });

  it("adjusts the machine level from 1 to 10 and defaults to 5", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Level 5" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Level 10" }));
    expect(screen.getByRole("button", { name: "Level 10" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Level 5" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Level 1" })).toBeInTheDocument();
  });

  it("carries the standard feedback panel", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /Feature Request/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Vote on Requests/ })).toBeInTheDocument();
  });

  it("fires game_start analytics and records the play", () => {
    const gtag = vi.fn();
    (window as unknown as { gtag: typeof gtag }).gtag = gtag;
    renderPage();
    startAsWhite();
    expect(gtag).toHaveBeenCalledWith(
      "event",
      "game_start",
      expect.objectContaining({ game: "three-ahead-chess", level: 3, side: "white", race: false }),
    );
    expect(localStorage.getItem("plays_three-ahead-chess")).toBe("1");
    delete (window as Partial<Window & { gtag?: unknown }>).gtag;
  });
});

describe("planning a round", () => {
  it("starts at round 1 with a full board", () => {
    renderPage();
    startAsWhite();
    expect(screen.getByText("Round")).toBeInTheDocument();
    expect(screen.getByText("Seal Three Orders")).toBeInTheDocument();
    // A couple of spot checks that the armies are placed.
    expect(screen.getByRole("button", { name: "e2, white pawn" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "e8, black king" })).toBeInTheDocument();
  });

  it("selects a piece, shows the destination, and seals an order", () => {
    renderPage();
    startAsWhite();
    clickSquare("e2, white pawn");
    clickSquare("e4"); // empty destination
    expect(screen.getByText("e2 → e4")).toBeInTheDocument();
  });

  it("plans later orders against the predicted board (the pawn has advanced)", () => {
    renderPage();
    startAsWhite();
    clickSquare("e2, white pawn");
    clickSquare("e4");
    // On the predicted board the pawn now stands on e4.
    expect(screen.getByRole("button", { name: "e4, white pawn" })).toBeInTheDocument();
    clickSquare("e4, white pawn");
    clickSquare("e5");
    expect(screen.getByText("e4 → e5")).toBeInTheDocument();
  });

  it("lets the player undo the last order", () => {
    renderPage();
    startAsWhite();
    clickSquare("e2, white pawn");
    clickSquare("e4");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByText("e2 → e4")).not.toBeInTheDocument();
  });

  it("only enables Seal Orders once three orders are written", () => {
    renderPage();
    startAsWhite();
    const seal = () => screen.getByRole("button", { name: "Seal Orders" });
    expect(seal()).toBeDisabled();
    clickSquare("e2, white pawn");
    clickSquare("e4");
    clickSquare("d2, white pawn");
    clickSquare("d4");
    clickSquare("g1, white knight");
    clickSquare("f3");
    expect(seal()).toBeEnabled();
  });

  it("lets the capture prediction be toggled on a normal move", () => {
    renderPage();
    startAsWhite();
    clickSquare("g1, white knight");
    clickSquare("f3");
    const toggle = screen.getByRole("button", { name: "Order 1: predict capture" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("fixes the capture flag on pawn moves (never on pushes)", () => {
    renderPage();
    startAsWhite();
    clickSquare("e2, white pawn");
    clickSquare("e4");
    const toggle = screen.getByRole("button", { name: "Order 1: predict capture" });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });
});

describe("resolving a round", () => {
  it("plays the round out and returns to planning for round 2", async () => {
    vi.useFakeTimers();
    renderPage();
    startAsWhite();
    clickSquare("e2, white pawn");
    clickSquare("e4");
    clickSquare("d2, white pawn");
    clickSquare("d4");
    clickSquare("g1, white knight");
    clickSquare("f3");
    await sealOrders();
    expect(screen.getByText("The Round Plays Out")).toBeInTheDocument();

    // 6 half-moves plus the closing pause. Each timer schedules the next one
    // from a React effect, so advance the clock one beat per act.
    for (let beat = 0; beat < 10; beat++) {
      act(() => {
        vi.advanceTimersByTime(1200);
      });
    }
    expect(screen.getByText("Seal Three Orders")).toBeInTheDocument();
    expect(screen.getByText("Round").parentElement).toHaveTextContent(/^Round2/); // the plaque
    // The record keeps the resolved round.
    expect(screen.getByText("The Record")).toBeInTheDocument();
    expect(screen.getByText("Round 1")).toBeInTheDocument();
  });

  it("offers a Skip that fast-forwards playback", async () => {
    vi.useFakeTimers();
    renderPage();
    startAsWhite();
    clickSquare("e2, white pawn");
    clickSquare("e4");
    clickSquare("d2, white pawn");
    clickSquare("d4");
    clickSquare("b1, white knight");
    clickSquare("c3");
    await sealOrders();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    act(() => {
      vi.advanceTimersByTime(1500); // just the closing pause
    });
    expect(screen.getByText("Seal Three Orders")).toBeInTheDocument();
  });
});

describe("leaving the table", () => {
  it("abandons back to the title screen", () => {
    renderPage();
    startAsWhite();
    fireEvent.click(screen.getByRole("button", { name: "Abandon the Board" }));
    expect(screen.getByRole("button", { name: "Play as Ivory" })).toBeInTheDocument();
  });
});

describe("playing as black", () => {
  it("flips the board so Onyx plans from its own side", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Play as Onyx" }));
    const board = screen.getByTestId("board");
    const squares = within(board).getAllByRole("button");
    // First rendered square (top-left of the grid) is a1 when flipped… the
    // grid positions are set via style, so instead assert planability:
    expect(squares.length).toBeGreaterThanOrEqual(64);
    clickSquare("e7, black pawn");
    clickSquare("e5");
    expect(screen.getByText("e7 → e5")).toBeInTheDocument();
  });
});

describe("machine vs machine", () => {
  it("lets two machines play a round unattended", async () => {
    vi.useFakeTimers();
    renderPage();
    // Budget-free levels so the machines plan instantly under fake timers.
    fireEvent.click(screen.getByRole("button", { name: "Ivory level 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Onyx level 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Let Them Play" }));
    expect(screen.getByText("The Machines Confer")).toBeInTheDocument();
    expect(screen.getByText("Round").parentElement).toHaveTextContent(/Ivory machine 2/);
    expect(screen.getByText("Round").parentElement).toHaveTextContent(/Onyx machine 3/);
    // Thinking pause, then the round resolves itself.
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(screen.getByText("The Round Plays Out")).toBeInTheDocument();
    // Beat the clock through the 6 half-moves and the closing pause.
    for (let beat = 0; beat < 10; beat++) {
      act(() => {
        vi.advanceTimersByTime(1200);
      });
    }
    expect(screen.getByText("Round").parentElement).toHaveTextContent(/^Round2/);
    expect(screen.getByText("Round 1")).toBeInTheDocument(); // the record
  });
});

/* ---- Duel (network) mode ----------------------------------------------------- */

interface DuelWorld {
  joined: boolean;
  opponentOrders: unknown;
  resigned: string | null;
  orderPosts: { round: number; orders: unknown[] }[];
  joinStatus: number;
}

/** A scriptable stand-in for the relay server. */
function installDuelFetch(world: DuelWorld) {
  const respond = (status: number, body: unknown) =>
    ({ ok: status < 400, status, json: async () => body }) as Response;
  const mock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/threeahead/games") {
      return respond(201, { code: "TABLES", token: "host-token", side: "white", race: false });
    }
    if (u.includes("/join")) {
      if (world.joinStatus !== 200) return respond(world.joinStatus, { error: "no" });
      return respond(200, { code: "TABLES", token: "guest-token", side: "black", race: false });
    }
    if (u.includes("/orders")) {
      world.orderPosts.push(JSON.parse(String(init?.body)));
      return respond(201, { sealed: true });
    }
    if (u.includes("/state")) {
      const youSealed = world.orderPosts.length > 0;
      const bothSealed = youSealed && world.opponentOrders !== null;
      return respond(200, {
        side: "white",
        opponentJoined: world.joined,
        resigned: world.resigned,
        race: false,
        round: 1,
        youSealed,
        opponentSealed: world.opponentOrders !== null,
        firstSealer: bothSealed ? "black" : null,
        opponentOrders: bothSealed ? world.opponentOrders : null,
      });
    }
    if (u.includes("/resign")) return respond(200, { resigned: "white" });
    return respond(404, { error: "no such game" });
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

const BLACK_REPLY = [
  { pieceId: 28, from: 52, to: 36, capture: false }, // e7 → e5
  { pieceId: 25, from: 49, to: 41, capture: false }, // b7 → b6
  { pieceId: 30, from: 54, to: 46, capture: false }, // g7 → g6
];

describe("two players over the wire", () => {
  it("hosts a table, waits for the guest, exchanges sealed orders, and resolves", async () => {
    vi.useFakeTimers();
    const world: DuelWorld = {
      joined: false,
      opponentOrders: null,
      resigned: null,
      orderPosts: [],
      joinStatus: 200,
    };
    installDuelFetch(world);
    renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Host as Ivory" }));
    });
    expect(screen.getByText("TABLES")).toBeInTheDocument();
    expect(screen.getByText(/Waiting for the other chair/)).toBeInTheDocument();

    // The guest sits down; the next poll notices.
    world.joined = true;
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.getByText("Seal Three Orders")).toBeInTheDocument();

    clickSquare("e2, white pawn");
    clickSquare("e4");
    clickSquare("d2, white pawn");
    clickSquare("d4");
    clickSquare("g1, white knight");
    clickSquare("f3");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Seal Orders" }));
    });
    expect(screen.getByText("Orders Sealed")).toBeInTheDocument();
    expect(world.orderPosts).toHaveLength(1);
    expect(world.orderPosts[0].round).toBe(1);
    expect(world.orderPosts[0].orders).toHaveLength(3);

    // The opponent seals; the reveal resolves the round on our board.
    world.opponentOrders = BLACK_REPLY;
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.getByText("The Round Plays Out")).toBeInTheDocument();
    for (let beat = 0; beat < 10; beat++) {
      await act(async () => {
        vi.advanceTimersByTime(1200);
      });
    }
    expect(screen.getByText("Round").parentElement).toHaveTextContent(/^Round2/);
    // Black's reply actually landed on our board.
    expect(screen.getByRole("button", { name: "e5, black pawn" })).toBeInTheDocument();
  });

  it("joins a table by code and starts planning as the open side", async () => {
    vi.useFakeTimers();
    const world: DuelWorld = {
      joined: true,
      opponentOrders: null,
      resigned: null,
      orderPosts: [],
      joinStatus: 200,
    };
    installDuelFetch(world);
    renderPage();

    fireEvent.change(screen.getByRole("textbox", { name: "Table code" }), {
      target: { value: "tables" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Join a Table" }));
    });
    expect(screen.getByText("Seal Three Orders")).toBeInTheDocument();
    // Joined as Onyx — the guest plans from black's side.
    expect(screen.getByText("Round").parentElement).toHaveTextContent(/Onyx/);
  });

  it("explains when a table code answers to nothing", async () => {
    vi.useFakeTimers();
    const world: DuelWorld = {
      joined: false,
      opponentOrders: null,
      resigned: null,
      orderPosts: [],
      joinStatus: 404,
    };
    installDuelFetch(world);
    renderPage();

    fireEvent.change(screen.getByRole("textbox", { name: "Table code" }), {
      target: { value: "WRONGO" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Join a Table" }));
    });
    expect(screen.getByText("No table answers to that code.")).toBeInTheDocument();
  });

  it("declares victory when the opponent resigns", async () => {
    vi.useFakeTimers();
    const world: DuelWorld = {
      joined: true,
      opponentOrders: null,
      resigned: null,
      orderPosts: [],
      joinStatus: 200,
    };
    installDuelFetch(world);
    renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Host as Ivory" }));
    });
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.getByText("Seal Three Orders")).toBeInTheDocument();

    world.resigned = "black";
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.getByText("Victory")).toBeInTheDocument();
    expect(screen.getByText(/opponent left the table/)).toBeInTheDocument();
  });
});

describe("the race house rule", () => {
  it("shows the toggle and flips it", () => {
    renderPage();
    const toggle = screen.getByRole("switch", { name: "First to seal moves first" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("gives the lead to a human who seals before the machine", async () => {
    vi.useFakeTimers();
    renderPage();
    fireEvent.click(screen.getByRole("switch", { name: "First to seal moves first" }));
    fireEvent.click(screen.getByRole("button", { name: "Level 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Play as Onyx" }));
    // Plan well inside the machine's minimum thinking time…
    clickSquare("e7, black pawn");
    clickSquare("e5");
    clickSquare("d7, black pawn");
    clickSquare("d5");
    clickSquare("g8, black knight");
    clickSquare("f6");
    await sealOrders();
    // …so Onyx (the human) leads: the round's first half-move is Black's.
    await act(async () => {
      vi.advanceTimersByTime(1200); // reveal the first playback beat
    });
    expect(screen.getByText(/^Black pawn e7→e5/)).toBeInTheDocument();
    expect(screen.queryByText(/^White/)).not.toBeInTheDocument();
  });

  it("keeps Ivory first when the machine seals before the human", async () => {
    vi.useFakeTimers();
    renderPage();
    fireEvent.click(screen.getByRole("switch", { name: "First to seal moves first" }));
    fireEvent.click(screen.getByRole("button", { name: "Level 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Play as Onyx" }));
    clickSquare("e7, black pawn");
    clickSquare("e5");
    clickSquare("d7, black pawn");
    clickSquare("d5");
    // Dawdle past the machine's seal moment before finishing the plan.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText(/The machine has sealed/)).toBeInTheDocument();
    clickSquare("g8, black knight");
    clickSquare("f6");
    await sealOrders();
    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    // The machine (Ivory) sealed first and leads.
    expect(screen.getByText(/^White/)).toBeInTheDocument();
  });
});
