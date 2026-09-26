import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import FeedbackPanel from "../../components/FeedbackPanel";
import SiteFooter from "../../components/SiteFooter";
import { trackEvent } from "../../lib/analytics";
import { useEngagement } from "../../lib/engagement";
import { recordPlay } from "../../lib/plays";
import {
  Board,
  MoveOption,
  Order,
  Piece,
  PieceType,
  RoundResult,
  Side,
  Square,
  cloneBoard,
  describeOutcome,
  executeOrder,
  fileOf,
  initialBoard,
  moveOptions,
  otherSide,
  rankOf,
  resolveRound,
  squareName,
} from "./engine/chess";
import { MAX_LEVEL, MIN_LEVEL, levelBudgetMs, planOrdersDeep } from "./engine/ai";
import { NetSession, createGame, fetchState, joinGame, resign, submitOrders } from "./net";
import PieceGlyph from "./pieces";
import styles from "./ThreeAheadPage.module.css";

// Three Ahead Chess — chess where both players secretly seal three orders at a
// time, then watch the round play out W,B,W,B,W,B with no further say. The
// rules engine and the computer player live in ./engine, the network relay
// client in ./net; this file is the art deco salon they perform in.
//
// Three ways to play:
//   solo  — you against the machine (level 1–10)
//   duel  — two humans over the wire, matched by a six-letter table code
//   watch — two machines play each other while you spectate

const ENTITY = "three-ahead-chess";
const STEP_MS = 1150; // playback beat per half-move
const ROUND_END_MS = 900; // pause before returning control
const WATCH_THINK_MS = 500; // beat before the machines start computing
const POLL_MS = 2000; // network polling cadence
/** Under the race rule even an instant-planning machine "seals" no sooner than
 *  this, so a quick human always has a chance to move first. */
const RACE_MIN_THINK_MS = 1500;

type Phase = "title" | "waiting" | "planning" | "sealing" | "resolving" | "over";
type Mode = "solo" | "duel" | "watch";

interface SealedOrder {
  order: Order;
  /** Whether the capture flag may still be toggled (pawn pushes/diagonals and
   *  castling are fixed by the rules). */
  forced: boolean;
  isCastle: boolean;
}

/** id → original identity, for the captured-pieces trays (promotions keep
 *  their original tray glyph — what fell is what you mourn). */
const ORIGINALS = (() => {
  const map = new Map<number, { type: PieceType; side: Side }>();
  for (const piece of initialBoard()) {
    if (piece) map.set(piece.id, { type: piece.type, side: piece.side });
  }
  return map;
})();

const sideTitle = (side: Side): string => (side === "white" ? "Ivory" : "Onyx");

const PIECE_LETTER: Record<string, string> = {
  pawn: "",
  knight: "N",
  bishop: "B",
  rook: "R",
  queen: "Q",
  king: "K",
};

export default function ThreeAheadPage() {
  useEngagement(ENTITY);

  const [phase, setPhase] = useState<Phase>("title");
  const [mode, setMode] = useState<Mode>("solo");
  const [level, setLevel] = useState(5); // solo machine, and watch-mode Ivory
  const [levelB, setLevelB] = useState(5); // watch-mode Onyx
  const [humanSide, setHumanSide] = useState<Side>("white");
  const [board, setBoard] = useState<Board>(initialBoard);
  const [round, setRound] = useState(1);
  const [sealed, setSealed] = useState<SealedOrder[]>([]);
  const [selected, setSelected] = useState<Square | null>(null);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [stepIndex, setStepIndex] = useState(-1);
  const [log, setLog] = useState<{ round: number; lines: string[] }[]>([]);
  const [winner, setWinner] = useState<Side | null>(null);
  const [winBy, setWinBy] = useState<"capture" | "resign" | null>(null);
  const [net, setNet] = useState<NetSession | null>(null);
  const [netError, setNetError] = useState<string | null>(null);
  const [netBusy, setNetBusy] = useState(false);
  const [opponentSealed, setOpponentSealed] = useState(false);
  // House rule: whoever seals their orders first leads the round.
  const [raceRule, setRaceRule] = useState(false);
  const [aiStatus, setAiStatus] = useState<"thinking" | "sealed" | null>(null);

  // The machine plans DURING the human's planning time (up to 10s at level 10).
  const matchIdRef = useRef(0); // bumps on every new game/abandon; stale thinks are dropped
  const aiPlanRef = useRef<Promise<Order[]> | null>(null);
  const machineSealedAtRef = useRef<number | null>(null);

  const aiSide = otherSide(humanSide);
  const interactive = mode !== "watch";

  /* ---- Planning state ----------------------------------------------------- */

  // The board the player plans against: their own earlier orders assumed to
  // succeed, the enemy assumed frozen. Rebuilt whenever the plan changes.
  const predicted = useMemo(() => {
    const sim = cloneBoard(board);
    for (const s of sealed) executeOrder(sim, s.order);
    return sim;
  }, [board, sealed]);

  const options: MoveOption[] = useMemo(
    () =>
      selected !== null && phase === "planning" && interactive
        ? moveOptions(predicted, selected)
        : [],
    [predicted, selected, phase, interactive],
  );
  const optionAt = (sq: Square) => options.find((o) => o.to === sq);

  // Enemy pieces the plan already claims as victims — shown as fading ghosts.
  const ghostSquares = useMemo(() => {
    if (phase !== "planning" || !interactive) return new Map<Square, Board[number]>();
    const alive = new Set(predicted.filter(Boolean).map((p) => p!.id));
    const ghosts = new Map<Square, Board[number]>();
    board.forEach((piece, sq) => {
      if (piece && !alive.has(piece.id)) ghosts.set(sq, piece);
    });
    return ghosts;
  }, [phase, board, predicted, interactive]);

  /* ---- Display board ------------------------------------------------------ */

  const displayedBoard: Board =
    phase === "resolving" && roundResult
      ? stepIndex < 0
        ? board
        : roundResult.steps[stepIndex].boardAfter
      : phase === "planning" && interactive
        ? predicted
        : board;

  const lastStep =
    phase === "resolving" && roundResult && stepIndex >= 0 ? roundResult.steps[stepIndex] : null;

  // Board is drawn from the human's side of the table (white for spectators).
  const toDisplay = (sq: Square): { col: number; row: number } =>
    humanSide === "white"
      ? { col: fileOf(sq), row: 7 - rankOf(sq) }
      : { col: 7 - fileOf(sq), row: rankOf(sq) };

  /* ---- Starting games ----------------------------------------------------- */

  const beginMatch = (nextMode: Mode, side: Side) => {
    matchIdRef.current++;
    aiPlanRef.current = null;
    machineSealedAtRef.current = null;
    setMode(nextMode);
    setHumanSide(side);
    setBoard(initialBoard());
    setRound(1);
    setSealed([]);
    setSelected(null);
    setRoundResult(null);
    setStepIndex(-1);
    setLog([]);
    setWinner(null);
    setWinBy(null);
    setNetError(null);
    setOpponentSealed(false);
    setAiStatus(null);
    recordPlay(ENTITY);
  };

  const startSolo = (side: Side) => {
    beginMatch("solo", side);
    setNet(null);
    setPhase("planning");
    trackEvent("game_start", { game: ENTITY, mode: "solo", level, side, race: raceRule });
  };

  const startWatch = () => {
    beginMatch("watch", "white");
    setNet(null);
    setPhase("planning");
    trackEvent("game_start", {
      game: ENTITY,
      mode: "watch",
      level,
      level_b: levelB,
      race: raceRule,
    });
  };

  const startDuelCreate = async (side: Side) => {
    setNetBusy(true);
    setNetError(null);
    try {
      const session = await createGame(side, raceRule);
      beginMatch("duel", session.side);
      setNet(session);
      setPhase("waiting");
      trackEvent("game_start", {
        game: ENTITY,
        mode: "duel",
        role: "host",
        side: session.side,
        race: session.race,
      });
    } catch {
      setNetError("Could not open a table — the wire may be down.");
    } finally {
      setNetBusy(false);
    }
  };

  const startDuelJoin = async (code: string) => {
    setNetBusy(true);
    setNetError(null);
    try {
      const session = await joinGame(code);
      beginMatch("duel", session.side);
      setNet(session);
      setPhase("planning");
      trackEvent("game_start", { game: ENTITY, mode: "duel", role: "guest", side: session.side });
    } catch (e) {
      const status = (e as { status?: number }).status;
      setNetError(
        status === 404
          ? "No table answers to that code."
          : status === 409
            ? "That table is already full."
            : "Could not join — the wire may be down.",
      );
    } finally {
      setNetBusy(false);
    }
  };

  /* ---- Planning actions ---------------------------------------------------- */

  const clickSquare = (sq: Square) => {
    if (phase !== "planning" || !interactive) return;
    const option = optionAt(sq);
    if (option && sealed.length < 3 && selected !== null) {
      const piece = predicted[selected]!;
      setSealed([
        ...sealed,
        {
          order: {
            pieceId: piece.id,
            from: selected,
            to: sq,
            capture: option.captureForced ?? option.captureDefault,
          },
          forced: option.captureForced !== undefined,
          isCastle: option.isCastle ?? false,
        },
      ]);
      setSelected(null);
      return;
    }
    const piece = predicted[sq];
    if (piece && piece.side === humanSide && sealed.length < 3) {
      setSelected(sq === selected ? null : sq);
    } else {
      setSelected(null);
    }
  };

  const toggleCapture = (index: number) => {
    setSealed(
      sealed.map((s, i) =>
        i === index && !s.forced ? { ...s, order: { ...s.order, capture: !s.order.capture } } : s,
      ),
    );
  };

  const undoOrder = () => {
    setSealed(sealed.slice(0, -1));
    setSelected(null);
  };

  const startResolve = (result: RoundResult) => {
    setRoundResult(result);
    setStepIndex(-1);
    setSelected(null);
    setOpponentSealed(false);
    setPhase("resolving");
  };

  const sealRound = async () => {
    if (sealed.length !== 3 || phase !== "planning") return;
    const mine = sealed.map((s) => s.order);
    if (mode === "solo") {
      // Under the race rule, sealing before the machine earns the lead.
      const humanFirst = raceRule && machineSealedAtRef.current === null;
      const matchId = matchIdRef.current;
      const pending = aiPlanRef.current;
      if (!pending) return; // no thinking started — should not happen
      setPhase("sealing"); // "the machine is still deep in thought…"
      const aiOrders = await pending;
      if (matchIdRef.current !== matchId) return; // game was abandoned meanwhile
      const first: Side = raceRule ? (humanFirst ? humanSide : aiSide) : "white";
      startResolve(
        humanSide === "white"
          ? resolveRound(board, mine, aiOrders, first)
          : resolveRound(board, aiOrders, mine, first),
      );
      return;
    }
    if (mode === "duel" && net) {
      setPhase("sealing");
      try {
        await submitOrders(net, round, mine);
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status !== 409) {
          // 409 = already sealed (a retry after a dropped response) — harmless.
          setNetError("The table is gone — the game could not continue.");
          setPhase("title");
        }
      }
    }
  };

  const skipPlayback = () => {
    if (roundResult) setStepIndex(roundResult.steps.length - 1);
  };

  const abandonGame = () => {
    if (phase !== "title" && phase !== "over") {
      trackEvent("game_over", { game: ENTITY, mode, level, outcome: "abandoned", rounds: round });
      if (mode === "duel" && net) resign(net);
    }
    matchIdRef.current++; // orphan any thinking still in flight
    aiPlanRef.current = null;
    setNet(null);
    setPhase("title");
  };

  /* ---- Solo mode: the machine thinks WHILE the human plans ------------------ */

  useEffect(() => {
    if (phase !== "planning" || mode !== "solo") return;
    const matchId = matchIdRef.current;
    machineSealedAtRef.current = null;
    setAiStatus("thinking");
    const startedAt = Date.now();
    // Its public "seal" moment: the full thinking budget, never instant.
    const sealDelay = Math.max(levelBudgetMs(level), RACE_MIN_THINK_MS);
    aiPlanRef.current = planOrdersDeep(board, aiSide, level, undefined, { raceLead: raceRule });
    const sealTimer = window.setTimeout(
      () => {
        if (matchIdRef.current !== matchId) return;
        machineSealedAtRef.current = startedAt + sealDelay;
        setAiStatus("sealed");
      },
      sealDelay + 20, // a whisker after, so "sealed" is never announced early
    );
    return () => window.clearTimeout(sealTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mode, board, level, aiSide, raceRule, round]);

  /* ---- Watch mode: the machines seal for themselves ------------------------ */

  useEffect(() => {
    if (phase !== "planning" || mode !== "watch") return;
    const matchId = matchIdRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        const white = await planOrdersDeep(board, "white", level, undefined, {
          raceLead: raceRule,
        });
        const black = await planOrdersDeep(board, "black", levelB, undefined, {
          raceLead: raceRule,
        });
        if (matchIdRef.current !== matchId) return; // spectator walked away
        // Under the race rule the shorter thinker seals first and leads.
        const whiteThink = Math.max(levelBudgetMs(level), RACE_MIN_THINK_MS);
        const blackThink = Math.max(levelBudgetMs(levelB), RACE_MIN_THINK_MS);
        const first: Side = raceRule && blackThink < whiteThink ? "black" : "white";
        startResolve(resolveRound(board, white, black, first));
      })();
    }, WATCH_THINK_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mode, board, level, levelB, raceRule]);

  /* ---- Duel mode: polling the relay ---------------------------------------- */

  const pollBusy = useRef(false);
  useEffect(() => {
    if (mode !== "duel" || !net) return;
    if (phase !== "waiting" && phase !== "planning" && phase !== "sealing") return;
    const tick = async () => {
      if (pollBusy.current) return;
      pollBusy.current = true;
      try {
        const state = await fetchState(net, round);
        if (state.resigned && state.resigned !== net.side) {
          setWinner(net.side);
          setWinBy("resign");
          setPhase("over");
          trackEvent("game_over", {
            game: ENTITY,
            mode,
            outcome: "won",
            by: "resign",
            rounds: round,
          });
          return;
        }
        if (phase === "waiting" && state.opponentJoined) setPhase("planning");
        setOpponentSealed(state.opponentSealed);
        if (phase === "sealing" && state.opponentOrders) {
          const mine = sealed.map((s) => s.order);
          const white = net.side === "white" ? mine : state.opponentOrders;
          const black = net.side === "white" ? state.opponentOrders : mine;
          // Under the race house rule the server's verdict on who sealed
          // first decides the lead; both clients read the same answer.
          const first: Side = state.race && state.firstSealer ? state.firstSealer : "white";
          startResolve(resolveRound(board, white, black, first));
        }
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 404 || status === 403) {
          setNetError("The table is gone — it may have expired.");
          setNet(null);
          setPhase("title");
        }
        // transient failures (offline blip, 429): just try again next tick
      } finally {
        pollBusy.current = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, net, phase, round, sealed, board]);

  /* ---- Playback ------------------------------------------------------------ */

  useEffect(() => {
    if (phase !== "resolving" || !roundResult) return;
    const finishRound = () => {
      const lines = roundResult.steps.map(describeOutcome);
      setLog((prev) => [{ round, lines }, ...prev]);
      setBoard(roundResult.board);
      if (roundResult.winner) {
        setWinner(roundResult.winner);
        setWinBy("capture");
        setPhase("over");
        const outcome =
          mode === "watch" ? "watched" : roundResult.winner === humanSide ? "won" : "lost";
        trackEvent("game_over", { game: ENTITY, mode, level, outcome, rounds: round });
      } else {
        setRound((r) => r + 1);
        setSealed([]);
        setRoundResult(null);
        setStepIndex(-1);
        setPhase("planning");
      }
    };
    const delay = stepIndex >= roundResult.steps.length - 1 ? ROUND_END_MS : STEP_MS;
    const timer = window.setTimeout(() => {
      if (stepIndex >= roundResult.steps.length - 1) finishRound();
      else setStepIndex((i) => i + 1);
    }, delay);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, roundResult, stepIndex, round, level, humanSide, mode]);

  /* ---- Derived bits --------------------------------------------------------- */

  const captured = useMemo(() => {
    const alive = new Set(board.filter(Boolean).map((p) => p!.id));
    const fallen: { id: number; type: PieceType; side: Side }[] = [];
    ORIGINALS.forEach((orig, id) => {
      if (!alive.has(id)) fallen.push({ id, ...orig });
    });
    return fallen;
  }, [board]);

  const revealedLines =
    phase === "resolving" && roundResult && stepIndex >= 0
      ? roundResult.steps.slice(0, stepIndex + 1).map(describeOutcome)
      : [];

  const orderText = (s: SealedOrder): string => {
    const piece = board.filter(Boolean).find((p) => p!.id === s.order.pieceId) ?? null;
    const letter = piece ? PIECE_LETTER[piece.type] : "";
    if (s.isCastle) return fileOf(s.order.to) === 6 ? "O–O (castle)" : "O–O–O (castle)";
    return `${letter}${squareName(s.order.from)} → ${squareName(s.order.to)}`;
  };

  const raceActive = mode === "duel" ? (net?.race ?? false) : raceRule;
  const plaqueSub =
    (mode === "solo"
      ? `${sideTitle(humanSide)} · Machine level ${level}`
      : mode === "watch"
        ? `Ivory machine ${level} · Onyx machine ${levelB}`
        : net
          ? `${sideTitle(humanSide)} · Table ${net.code}`
          : sideTitle(humanSide)) + (raceActive ? " · first seal leads" : "");

  const overLine = (() => {
    if (!winner) return "";
    if (mode === "watch") {
      return `The ${sideTitle(winner)} machine takes the king after ${round} round${round > 1 ? "s" : ""}.`;
    }
    if (winBy === "resign") return "Your opponent left the table. The game is yours.";
    return winner === humanSide
      ? `The ${sideTitle(aiSide)} king has fallen after ${round} round${round > 1 ? "s" : ""}.`
      : `Your king has fallen after ${round} round${round > 1 ? "s" : ""}.`;
  })();

  /* ---- Render ---------------------------------------------------------------- */

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topbar}>
          <Link to="/" className={styles.back}>
            ← Field Guide
          </Link>
          <div className={styles.badge}>
            <span>Pure AI Output</span>
            <span className={styles.badgeDot} />
          </div>
        </div>

        {phase === "title" && (
          <TitleScreen
            level={level}
            levelB={levelB}
            onLevel={setLevel}
            onLevelB={setLevelB}
            onSolo={startSolo}
            onWatch={startWatch}
            onCreate={(side) => void startDuelCreate(side)}
            onJoin={(code) => void startDuelJoin(code)}
            busy={netBusy}
            error={netError}
            race={raceRule}
            onRace={setRaceRule}
          />
        )}

        {phase !== "title" && (
          <div className={styles.gameLayout}>
            <div className={styles.boardColumn}>
              <div className={styles.marquee}>
                <span className={styles.marqueeRule} />
                <h1 className={styles.gameTitle}>Three Ahead Chess</h1>
                <span className={styles.marqueeRule} />
              </div>

              <div className={styles.boardFrame}>
                <div className={styles.board} data-testid="board">
                  {Array.from({ length: 64 }, (_, sq) => {
                    const { col, row } = toDisplay(sq);
                    const dark = (fileOf(sq) + rankOf(sq)) % 2 === 0;
                    const option = optionAt(sq);
                    const isLastFrom = lastStep?.from === sq && lastStep.landed !== sq;
                    const isLastLanded = lastStep?.landed === sq;
                    const orderIndex = sealed.findIndex((s) => s.order.to === sq);
                    const piece = displayedBoard[sq];
                    return (
                      <button
                        key={sq}
                        type="button"
                        className={[
                          styles.square,
                          dark ? styles.squareDark : styles.squareLight,
                          selected === sq ? styles.squareSelected : "",
                          option ? styles.squareOption : "",
                          isLastFrom ? styles.squareFrom : "",
                          isLastLanded ? styles.squareLanded : "",
                        ].join(" ")}
                        style={{ gridColumn: col + 1, gridRow: row + 1 }}
                        aria-label={
                          piece ? `${squareName(sq)}, ${piece.side} ${piece.type}` : squareName(sq)
                        }
                        onClick={() => clickSquare(sq)}
                      >
                        {option && (
                          <span
                            className={option.captureDefault ? styles.optionRing : styles.optionDot}
                          />
                        )}
                        {orderIndex >= 0 && phase === "planning" && (
                          <span className={styles.orderBadge}>
                            <span>{orderIndex + 1}</span>
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {/* Predicted victims, fading from the plan. */}
                  {[...ghostSquares.entries()].map(([sq, piece]) => {
                    const { col, row } = toDisplay(sq);
                    return (
                      <div
                        key={`ghost-${piece!.id}`}
                        className={`${styles.pieceLayer} ${styles.ghost}`}
                        style={{ transform: `translate(${col * 100}%, ${row * 100}%)` }}
                      >
                        <PieceGlyph type={piece!.type} side={piece!.side} />
                      </div>
                    );
                  })}

                  {/* The living pieces — keyed by id AND rendered in id order.
                      A stable DOM order matters: if the list were in board
                      order, a move would reorder children and React would
                      re-insert the node, which resets the CSS transition and
                      makes the piece teleport instead of glide. */}
                  {displayedBoard
                    .map((piece, sq) => ({ piece, sq }))
                    .filter((entry): entry is { piece: Piece; sq: Square } => entry.piece !== null)
                    .sort((a, b) => a.piece.id - b.piece.id)
                    .map(({ piece, sq }) => {
                      const { col, row } = toDisplay(sq);
                      return (
                        <div
                          key={piece.id}
                          className={styles.pieceLayer}
                          style={{ transform: `translate(${col * 100}%, ${row * 100}%)` }}
                        >
                          <PieceGlyph type={piece.type} side={piece.side} />
                        </div>
                      );
                    })}
                </div>
                <div className={styles.fileLabels} aria-hidden="true">
                  {(humanSide === "white" ? "abcdefgh" : "hgfedcba").split("").map((f) => (
                    <span key={f}>{f}</span>
                  ))}
                </div>
                <div className={styles.rankLabels} aria-hidden="true">
                  {(humanSide === "white"
                    ? ["8", "7", "6", "5", "4", "3", "2", "1"]
                    : ["1", "2", "3", "4", "5", "6", "7", "8"]
                  ).map((r) => (
                    <span key={r}>{r}</span>
                  ))}
                </div>
              </div>

              <div className={styles.trays}>
                <CapturedTray
                  side={otherSide(humanSide)}
                  label={`${sideTitle(otherSide(humanSide))} fallen`}
                  pieces={captured}
                />
                <CapturedTray
                  side={humanSide}
                  label={`${sideTitle(humanSide)} fallen`}
                  pieces={captured}
                />
              </div>
            </div>

            <aside className={styles.rail}>
              <div className={styles.roundPlaque}>
                <span className={styles.plaqueKicker}>Round</span>
                <span className={styles.plaqueNumber}>{round}</span>
                <span className={styles.plaqueSub}>{plaqueSub}</span>
              </div>

              {phase === "waiting" && net && (
                <div className={styles.ordersPanel}>
                  <h2 className={styles.panelTitle}>The Table Is Set</h2>
                  <p className={styles.panelHint}>
                    Give your opponent this code — the game begins the moment they sit down.
                  </p>
                  <div className={styles.codeDisplay}>{net.code}</div>
                  <p className={styles.panelHint}>Waiting for the other chair to fill…</p>
                </div>
              )}

              {phase === "planning" && interactive && (
                <div className={styles.ordersPanel}>
                  <h2 className={styles.panelTitle}>Seal Three Orders</h2>
                  <p className={styles.panelHint}>
                    {sealed.length < 3
                      ? selected !== null
                        ? "Choose a destination — rings mark predicted captures."
                        : "Pick a piece, then its destination. Your own orders are assumed to succeed."
                      : "Orders complete. Toggle ✕ where you predict a capture, then seal."}
                    {mode === "duel" && opponentSealed && " The opponent has already sealed."}
                  </p>
                  {mode === "solo" && aiStatus && (
                    <p className={styles.machineStatus}>
                      {aiStatus === "thinking"
                        ? raceRule
                          ? "◈ The machine ponders — seal first and you lead the round."
                          : "◈ The machine ponders…"
                        : raceRule
                          ? "◈ The machine has sealed. It will lead this round."
                          : "◈ The machine has sealed."}
                    </p>
                  )}
                  <ol className={styles.orderList}>
                    {[0, 1, 2].map((i) => {
                      const s = sealed[i];
                      return (
                        <li key={i} className={s ? styles.orderRow : styles.orderRowEmpty}>
                          <span className={styles.orderNumber}>
                            <span>{i + 1}</span>
                          </span>
                          {s ? (
                            <>
                              <span className={styles.orderMove}>{orderText(s)}</span>
                              <button
                                type="button"
                                className={`${styles.captureToggle} ${
                                  s.order.capture ? styles.captureOn : ""
                                }`}
                                disabled={s.forced}
                                aria-pressed={s.order.capture}
                                aria-label={`Order ${i + 1}: predict capture`}
                                onClick={() => toggleCapture(i)}
                              >
                                ✕
                              </button>
                            </>
                          ) : (
                            <span className={styles.orderUnwritten}>— unwritten —</span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  <div className={styles.orderActions}>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={undoOrder}
                      disabled={sealed.length === 0}
                    >
                      Undo
                    </button>
                    <button
                      type="button"
                      className={styles.sealButton}
                      onClick={() => void sealRound()}
                      disabled={sealed.length !== 3}
                    >
                      Seal Orders
                    </button>
                  </div>
                </div>
              )}

              {phase === "planning" && !interactive && (
                <div className={styles.ordersPanel}>
                  <h2 className={styles.panelTitle}>The Machines Confer</h2>
                  <p className={styles.panelHint}>Both plans are being sealed…</p>
                </div>
              )}

              {phase === "sealing" && (
                <div className={styles.ordersPanel}>
                  <h2 className={styles.panelTitle}>Orders Sealed</h2>
                  <ol className={styles.orderList}>
                    {sealed.map((s, i) => (
                      <li key={i} className={styles.orderRow}>
                        <span className={styles.orderNumber}>
                          <span>{i + 1}</span>
                        </span>
                        <span className={styles.orderMove}>{orderText(s)}</span>
                        {s.order.capture && <span className={styles.sealedCapture}>✕</span>}
                      </li>
                    ))}
                  </ol>
                  <p className={styles.panelHint}>
                    {mode === "solo"
                      ? "The machine is still deep in thought…"
                      : "Awaiting the opponent's sealed orders…"}
                  </p>
                </div>
              )}

              {phase === "resolving" && (
                <div className={styles.ordersPanel}>
                  <h2 className={styles.panelTitle}>The Round Plays Out</h2>
                  <ul className={styles.playbackList}>
                    {revealedLines.map((line, i) => (
                      <li key={i} className={styles.playbackLine}>
                        {line}
                      </li>
                    ))}
                    {revealedLines.length === 0 && (
                      <li className={styles.playbackLine}>Both plans are sealed…</li>
                    )}
                  </ul>
                  <div className={styles.orderActions}>
                    <button type="button" className={styles.ghostButton} onClick={skipPlayback}>
                      Skip
                    </button>
                  </div>
                </div>
              )}

              {phase === "over" && winner && (
                <div className={styles.ordersPanel}>
                  <h2 className={styles.panelTitle}>
                    {mode === "watch"
                      ? `${sideTitle(winner)} Prevails`
                      : winner === humanSide
                        ? "Victory"
                        : "Defeat"}
                  </h2>
                  <p className={styles.panelHint}>{overLine}</p>
                  <div className={styles.orderActions}>
                    {mode === "solo" && (
                      <button
                        type="button"
                        className={styles.sealButton}
                        onClick={() => startSolo(humanSide)}
                      >
                        Play Again
                      </button>
                    )}
                    {mode === "watch" && (
                      <button type="button" className={styles.sealButton} onClick={startWatch}>
                        Run It Back
                      </button>
                    )}
                  </div>
                </div>
              )}

              {log.length > 0 && (
                <div className={styles.logPanel}>
                  <h2 className={styles.panelTitle}>The Record</h2>
                  {log.map((entry) => (
                    <div key={entry.round} className={styles.logRound}>
                      <div className={styles.logRoundHead}>Round {entry.round}</div>
                      {entry.lines.map((line, i) => (
                        <div key={i} className={styles.logLine}>
                          {line}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              <button type="button" className={styles.abandon} onClick={abandonGame}>
                {phase === "over" ? "Title Screen" : "Abandon the Board"}
              </button>
            </aside>
          </div>
        )}

        {phase === "title" && (
          <div className={styles.feedbackWrap}>
            <div className={styles.feedbackHeading}>Help shape Three Ahead Chess</div>
            <FeedbackPanel entity={ENTITY} />
          </div>
        )}

        <SiteFooter />
      </div>
    </div>
  );
}

/* ---- Title screen ------------------------------------------------------------ */

function LevelDial({
  value,
  onChange,
  labelPrefix,
  compact,
}: {
  value: number;
  onChange: (level: number) => void;
  labelPrefix: string;
  compact?: boolean;
}) {
  return (
    <div
      className={compact ? styles.levelRowCompact : styles.levelRow}
      role="group"
      aria-label={labelPrefix}
    >
      {Array.from({ length: MAX_LEVEL - MIN_LEVEL + 1 }, (_, i) => i + MIN_LEVEL).map((n) => (
        <button
          key={n}
          type="button"
          className={`${styles.levelDiamond} ${compact ? styles.levelDiamondCompact : ""} ${
            n === value ? styles.levelActive : ""
          }`}
          aria-pressed={n === value}
          aria-label={`${labelPrefix} ${n}`}
          onClick={() => onChange(n)}
        >
          <span>{n}</span>
        </button>
      ))}
    </div>
  );
}

function TitleScreen({
  level,
  levelB,
  onLevel,
  onLevelB,
  onSolo,
  onWatch,
  onCreate,
  onJoin,
  busy,
  error,
  race,
  onRace,
}: {
  level: number;
  levelB: number;
  onLevel: (level: number) => void;
  onLevelB: (level: number) => void;
  onSolo: (side: Side) => void;
  onWatch: () => void;
  onCreate: (side: Side) => void;
  onJoin: (code: string) => void;
  busy: boolean;
  error: string | null;
  race: boolean;
  onRace: (on: boolean) => void;
}) {
  const [joinCode, setJoinCode] = useState("");
  return (
    <div className={styles.title}>
      <div className={styles.sunburst} aria-hidden="true" />
      <div className={styles.marquee}>
        <span className={styles.marqueeRule} />
        <span className={styles.marqueeDiamond} />
        <span className={styles.marqueeRule} />
      </div>
      <h1 className={styles.titleName}>
        Three <span className={styles.titleAhead}>Ahead</span> Chess
      </h1>
      <p className={styles.tagline}>
        Seal three moves in advance. Watch fate execute them. Nobody — not even you — may intervene.
      </p>

      {error && <p className={styles.netError}>{error}</p>}

      <div className={styles.houseRule}>
        <span className={styles.houseRuleLabel}>House Rule</span>
        <button
          type="button"
          className={`${styles.houseRuleToggle} ${race ? styles.houseRuleOn : ""}`}
          role="switch"
          aria-checked={race}
          aria-label="First to seal moves first"
          onClick={() => onRace(!race)}
        >
          <span className={styles.houseRuleKnob} />
        </button>
        <span className={styles.houseRuleText}>
          First to seal moves first <em>— evens the odds between Ivory and Onyx</em>
        </span>
      </div>

      <div className={styles.modeGrid}>
        <section className={styles.modeCard}>
          <h2 className={styles.modeTitle}>Versus the Machine</h2>
          <div className={styles.levelHead}>Strength of the Machine</div>
          <LevelDial value={level} onChange={onLevel} labelPrefix="Level" />
          <div className={styles.levelCaption}>
            {level <= 3
              ? "an amiable partner — moves at once"
              : level <= 7
                ? `a worthy adversary — thinks ~${Math.round(levelBudgetMs(level) / 1000)}s`
                : `a cold calculator — thinks ~${Math.round(levelBudgetMs(level) / 1000)}s`}
          </div>
          <div className={styles.startRow}>
            <button type="button" className={styles.startButton} onClick={() => onSolo("white")}>
              Play as Ivory
            </button>
            <button
              type="button"
              className={`${styles.startButton} ${styles.startOnyx}`}
              onClick={() => onSolo("black")}
            >
              Play as Onyx
            </button>
          </div>
        </section>

        <section className={styles.modeCard}>
          <h2 className={styles.modeTitle}>Two Players, One Wire</h2>
          <p className={styles.modeBlurb}>
            Open a table, hand the six-letter code to a friend, and seal your orders in secret — the
            wire reveals both plans only when both are in.
          </p>
          <div className={styles.startRow}>
            <button
              type="button"
              className={styles.startButton}
              disabled={busy}
              onClick={() => onCreate("white")}
            >
              Host as Ivory
            </button>
            <button
              type="button"
              className={`${styles.startButton} ${styles.startOnyx}`}
              disabled={busy}
              onClick={() => onCreate("black")}
            >
              Host as Onyx
            </button>
          </div>
          <div className={styles.orDivider}>
            <span className={styles.marqueeRule} />
            <span>or</span>
            <span className={styles.marqueeRule} />
          </div>
          <form
            className={styles.joinRow}
            onSubmit={(e) => {
              e.preventDefault();
              if (joinCode.trim()) onJoin(joinCode);
            }}
          >
            <input
              className={styles.joinInput}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="CODE"
              maxLength={6}
              aria-label="Table code"
            />
            <button
              type="submit"
              className={styles.startButton}
              disabled={busy || joinCode.trim().length !== 6}
            >
              Join a Table
            </button>
          </form>
        </section>

        <section className={styles.modeCard}>
          <h2 className={styles.modeTitle}>Machine vs Machine</h2>
          <p className={styles.modeBlurb}>Set two minds against each other and spectate.</p>
          <div className={styles.levelHead}>Ivory machine</div>
          <LevelDial value={level} onChange={onLevel} labelPrefix="Ivory level" compact />
          <div className={styles.levelHead}>Onyx machine</div>
          <LevelDial value={levelB} onChange={onLevelB} labelPrefix="Onyx level" compact />
          <div className={styles.startRow}>
            <button type="button" className={styles.startButton} onClick={onWatch}>
              Let Them Play
            </button>
          </div>
        </section>
      </div>

      <div className={styles.rulesPanel}>
        <h2 className={styles.rulesTitle}>The Rules of Three</h2>
        <ol className={styles.rulesList}>
          <li>
            Both players secretly write <strong>three orders</strong>; the round then plays out
            alternately — Ivory, Onyx, Ivory, Onyx, Ivory, Onyx.
          </li>
          <li>
            Each order must <strong>predict a capture</strong> (✕) or not. A victim on your ordered
            square is taken only if predicted — otherwise your piece halts one square short.
          </li>
          <li>
            Anything blocking the path stops a moving piece just short of it. Knights that cannot
            land do not move at all.
          </li>
          <li>
            There is no check. To win, <strong>capture the king</strong> — plans are sealed blind,
            so nothing warns him. A king that keeps moving is a hard king to kill.
          </li>
          <li>Castling is allowed, pawns crown themselves queens, and there is no en passant.</li>
          <li>
            <strong>House rule</strong> (optional): whoever seals their three orders first moves
            first each round — haste buys tempo, care buys quality.
          </li>
        </ol>
      </div>
    </div>
  );
}

/* ---- Captured tray ------------------------------------------------------------ */

function CapturedTray({
  side,
  label,
  pieces,
}: {
  side: Side;
  label: string;
  pieces: { id: number; type: PieceType; side: Side }[];
}) {
  const mine = pieces.filter((p) => p.side === side);
  return (
    <div className={styles.tray}>
      <span className={styles.trayLabel}>{label}</span>
      <div className={styles.trayPieces}>
        {mine.map((p) => (
          <span key={p.id} className={styles.trayPiece}>
            <PieceGlyph type={p.type} side={p.side} />
          </span>
        ))}
        {mine.length === 0 && <span className={styles.trayEmpty}>none</span>}
      </div>
    </div>
  );
}
