import { useCallback, useEffect, useRef, useState, FormEvent } from "react";
import { attachGameInput } from "../input";
import {
  Grid,
  Tile,
  Side,
  Head,
  N,
  E,
  isLocked,
  rotateTile,
  generateGrid,
  startFlow,
  advanceHead,
  connectedToSource,
  tileAt,
  idx,
  countdownSec,
  flowRate,
} from "./pipeLogic";
import { loadSprites, spriteUrl, SpriteImages, SpriteName } from "./sprites";
import { Sfx } from "./sfx";
import FeedbackPanel from "../../components/FeedbackPanel";
import VolumeControl from "../../components/VolumeControl";
import { trackEvent } from "../../lib/analytics";
import { recordPlay } from "../../lib/plays";
import styles from "./BigPipeTinyDream.module.css";

// 40x40 pipe tiles filling the viewport (the "big pipe" of the title). Pure
// grid/connection/flow rules live in pipeLogic.ts; the pipe casings are the
// PNG sprites in sprites.ts; everything here is pixels, timing and input.
const TILE = 40;
const WATER_W = 8; // the stream drawn inside the pipe casing
const GAME_SLUG = "big-pipe-tiny-dream";
const FAST_SPEED = 200; // px/s when the speed toggle is on "fast"
const HALO_RADIUS = 70; // ~140px-wide glow that rides each advancing stream head
const SHADOW_RADIUS = 100; // ~200px-wide dark pool behind every drain
const MAX_HALOS = 24; // cap the per-head glows so a wide split stays cheap
const REFILL_BASE = 500; // "refill all parts" costs REFILL_BASE + REFILL_PER_LEVEL × level points
const REFILL_PER_LEVEL = 100;
const refillCostFor = (level: number): number => REFILL_BASE + REFILL_PER_LEVEL * level;

const WATER = "#37b6ff";
const WATER_GLOW = "#bff0ff";
const DRAIN_RING = "#8affc8";
const DRAIN_RING_DONE = "#48ffa0";
const BG = "#0d0d14";

type Phase = "idle" | "tutorial" | "playing" | "levelclear" | "gameover" | "saved";

// The bank of free pieces the player can drop onto the board. The end cap is a
// free-part-only plug (never seeded) for safely closing off a dead end.
type BankKind = "elbow" | "straight" | "cross" | "tee" | "endcap";
const BANK_ORDER: BankKind[] = ["elbow", "straight", "cross", "tee", "endcap"];
const BANK_SPRITE: Record<BankKind, SpriteName> = {
  elbow: "elbow",
  straight: "pipe",
  cross: "cross",
  tee: "tee",
  endcap: "endcap",
};
const fullBank = (): (BankKind | null)[] => [...BANK_ORDER];

interface ScoreRow {
  id: number;
  initials: string;
  score: number;
  created_at: string;
}

// Local pixel position of a side's edge-midpoint within a tile (N,E,S,W).
const EDGE: Array<[number, number]> = [
  [TILE / 2, 0],
  [TILE, TILE / 2],
  [TILE / 2, TILE],
  [0, TILE / 2],
];

// Which sprite draws this tile, and how many 90° clockwise turns to rotate the
// (natively-oriented) PNG so its openings match the tile's logical state.
//   pipe native = vertical N–S       → rot
//   elbow native = E+S (logic rot 1) → rot − 1
//   cross native = horizontal on top → rot (visual only)
//   tee native = E+S+W (logic rot 0) → rot
//   start/terminus native = open E   → dir − 1
function spriteFor(t: Tile): { name: SpriteName; steps: number } {
  switch (t.kind) {
    case "straight":
      return { name: "pipe", steps: t.rot % 4 };
    case "elbow":
      return { name: "elbow", steps: (t.rot + 3) % 4 };
    case "cross":
      return { name: "cross", steps: t.rot % 4 };
    case "tee":
      return { name: "tee", steps: t.rot % 4 };
    case "endcap":
      return { name: "endcap", steps: t.rot % 4 }; // native opens N, rotates with rot
    case "start":
      return { name: "start", steps: ((t.dir ?? N) + 3) % 4 };
    default:
      return { name: "terminus", steps: ((t.dir ?? E) + 3) % 4 };
  }
}

// Paint a tile's water into the given context: the entry arm fills over the
// first half of `progress`, then every exit arm fills over the second half (a
// tee has two exit arms, so its stream visibly splits). progress = 1 is a full,
// completed tile; a drain is painted as entry-only (no exits) at 0.5.
function paintWater(
  ctx: CanvasRenderingContext2D,
  entry: Side,
  exits: Side[],
  cx: number,
  cy: number,
  progress: number,
) {
  const ox = cx * TILE;
  const oy = cy * TILE;
  const midX = ox + TILE / 2;
  const midY = oy + TILE / 2;
  const ex0 = ox + EDGE[entry][0];
  const ey0 = oy + EDGE[entry][1];
  ctx.strokeStyle = WATER;
  ctx.lineWidth = WATER_W;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const inFrac = Math.min(progress, 0.5) / 0.5;
  if (inFrac > 0) {
    ctx.beginPath();
    ctx.moveTo(ex0, ey0);
    ctx.lineTo(ex0 + (midX - ex0) * inFrac, ey0 + (midY - ey0) * inFrac);
    ctx.stroke();
  }
  if (progress > 0.5) {
    const outFrac = (progress - 0.5) / 0.5;
    for (const ex of exits) {
      const xp = ox + EDGE[ex][0];
      const yp = oy + EDGE[ex][1];
      ctx.beginPath();
      ctx.moveTo(midX, midY);
      ctx.lineTo(midX + (xp - midX) * outFrac, midY + (yp - midY) * outFrac);
      ctx.stroke();
    }
  }
}

// The leading tip(s) of a crossing head — one on the entry arm before the
// centre, one per exit arm after it (a tee has two).
function headTips(head: Head): Array<[number, number]> {
  const ox = head.x * TILE;
  const oy = head.y * TILE;
  const midX = ox + TILE / 2;
  const midY = oy + TILE / 2;
  if (head.progress <= 0.5) {
    const f = head.progress / 0.5;
    const ex0 = ox + EDGE[head.entry][0];
    const ey0 = oy + EDGE[head.entry][1];
    return [[ex0 + (midX - ex0) * f, ey0 + (midY - ey0) * f]];
  }
  const outFrac = (head.progress - 0.5) / 0.5;
  return head.exits.map((ex) => {
    const xp = ox + EDGE[ex][0];
    const yp = oy + EDGE[ex][1];
    return [midX + (xp - midX) * outFrac, midY + (yp - midY) * outFrac] as [number, number];
  });
}

// Draw one tile's pipe sprite onto the (transparent) pipe layer at its grid
// cell. The layer is transparent so the textured green ground and the animated
// halo/shadow drawn beneath it show through around every casing.
function drawTile(
  ctx: CanvasRenderingContext2D,
  imgs: SpriteImages,
  t: Tile,
  cx: number,
  cy: number,
  darken = false,
) {
  const px = cx * TILE;
  const py = cy * TILE;
  ctx.clearRect(px, py, TILE, TILE);
  const { name, steps } = spriteFor(t);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(px + TILE / 2, py + TILE / 2);
  ctx.rotate((steps * Math.PI) / 2);
  ctx.drawImage(imgs[name], -TILE / 2, -TILE / 2, TILE, TILE);
  if (darken) {
    // Dim tiles that can't trace a path to the source — source-atop only tints
    // the sprite's own pixels, leaving the transparent gaps alone.
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(-TILE / 2, -TILE / 2, TILE, TILE);
  }
  ctx.restore();
}

// A small tileable canvas of mottled green — used as a repeating pattern for the
// grid's textured ground. Built once and memoised.
let greenTexture: HTMLCanvasElement | null = null;
function getGreenTexture(): HTMLCanvasElement | null {
  if (greenTexture) return greenTexture;
  const tex = document.createElement("canvas");
  tex.width = 64;
  tex.height = 64;
  const ctx = tex.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#1c3a22";
  ctx.fillRect(0, 0, 64, 64);
  // Scatter darker/lighter green flecks for a soft, organic mottle.
  for (let i = 0; i < 900; i++) {
    const x = Math.floor(Math.random() * 64);
    const y = Math.floor(Math.random() * 64);
    const lighten = Math.random() < 0.5;
    const a = 0.04 + Math.random() * 0.1;
    ctx.fillStyle = lighten ? `rgba(120,180,110,${a})` : `rgba(10,30,14,${a})`;
    ctx.fillRect(x, y, 1 + Math.floor(Math.random() * 2), 1 + Math.floor(Math.random() * 2));
  }
  greenTexture = tex;
  return tex;
}

// ---------------------------------------------------------------------------
// Level-1 tutorial: a 4-step dialog that points (with a dashed arrow line) at the
// source, the pre-laid path to a drain, the splitting tee, and finally the EXTRA
// PARTS bank. Rendered over the whole game (HUD + stage) so it can point at the
// bank too. Positions are computed in game-local coords via getBoundingClientRect.

const TUTORIAL_STEPS = 4;
const DIALOG_W = 288;
const DIALOG_H = 138;
const GOLD = "#ffce3b";

function Tutorial({
  gameEl,
  canvas,
  bankEl,
  grid,
  step,
  onNext,
  onSkip,
}: {
  gameEl: HTMLElement | null;
  canvas: HTMLCanvasElement | null;
  bankEl: HTMLElement | null;
  grid: Grid;
  step: number;
  onNext: () => void;
  onSkip: () => void;
}) {
  const hint = grid.hint;

  // Re-render on a timer during the path step (dot animation) and once shortly
  // after mount so late layout (fonts/measurements) is picked up.
  const [t, setT] = useState(0);
  useEffect(() => {
    if (step !== 1 || !hint) return;
    let raf = 0;
    const loop = (ts: number) => {
      setT((ts / 1800) % 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [step, hint]);

  const gameRect = gameEl?.getBoundingClientRect();
  const gw = gameRect?.width ?? 0;
  const gh = gameRect?.height ?? 0;

  // A grid cell's centre, in game-local coordinates (accounts for canvas scale).
  const cellPt = (c: { x: number; y: number }): { left: number; top: number } | null => {
    if (!canvas || !gameRect) return null;
    const cr = canvas.getBoundingClientRect();
    if (!cr.width || !canvas.width) return null;
    const sx = cr.width / canvas.width;
    const sy = cr.height / canvas.height;
    return {
      left: cr.left - gameRect.left + (c.x * TILE + TILE / 2) * sx,
      top: cr.top - gameRect.top + (c.y * TILE + TILE / 2) * sy,
    };
  };
  const elCenter = (el: HTMLElement | null): { left: number; top: number } | null => {
    if (!el || !gameRect) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left - gameRect.left + r.width / 2, top: r.top - gameRect.top + r.height / 2 };
  };

  const isBankStep = step === 3;
  const focusPt = isBankStep
    ? elCenter(bankEl)
    : step === 1
      ? cellPt(hint?.target ?? grid.start)
      : step === 2
        ? cellPt(hint?.tee ?? grid.start)
        : cellPt(grid.start);
  const text = isBankStep
    ? "These are extra parts — free to place. Click one, then replace an unfilled pipe anywhere on the board. When you run low, hit REFILL to restock the whole box (500 + 100 × level points). Use the end cap to safely plug a spare opening."
    : step === 0
      ? "Water will flow from this source when the timer runs out."
      : step === 1
        ? "This is a drain connected to the source through pipes."
        : "Use tees to split the flow and connect to all of the drains to win!";

  // Anchor the dialog to whichever game corner is FARTHEST from the focus, so it
  // stays well clear (≥300px on a real board) and never covers the highlighted part.
  const fx = focusPt?.left ?? gw / 2;
  const fy = focusPt?.top ?? gh / 2;
  const M = 14;
  // Nudge the dialog ~a few hundred px off the focus (toward the interior so it
  // stays on-screen), clamped to the game — not slammed into a corner.
  const OFFSET = 300;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const dcx = fx + (fx < gw / 2 ? OFFSET : -OFFSET);
  const dcy = fy + (fy < gh / 2 ? OFFSET : -OFFSET);
  const dialog = {
    left: clamp(dcx - DIALOG_W / 2, M, Math.max(M, gw - DIALOG_W - M)),
    top: clamp(dcy - DIALOG_H / 2, M, Math.max(M, gh - DIALOG_H - M)),
  };
  // The arrow leaves the dialog edge nearest the focus and points at the focus.
  const ax = Math.max(dialog.left, Math.min(fx, dialog.left + DIALOG_W));
  const ay = Math.max(dialog.top, Math.min(fy, dialog.top + DIALOG_H));

  // Step-2 travelling water dot along the pre-laid path.
  let dot: { left: number; top: number } | null = null;
  if (step === 1 && hint && hint.path.length > 1) {
    const seg = t * (hint.path.length - 1);
    const i = Math.min(hint.path.length - 2, Math.floor(seg));
    const frac = seg - i;
    const a = cellPt(hint.path[i]);
    const b = cellPt(hint.path[i + 1]);
    if (a && b) {
      dot = { left: a.left + (b.left - a.left) * frac, top: a.top + (b.top - a.top) * frac };
    }
  }

  return (
    <div className={styles.tutorialLayer}>
      <svg className={styles.tutorialSvg} width={gw} height={gh}>
        <defs>
          <marker id="ptdArrow" markerWidth="9" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill={GOLD} />
          </marker>
        </defs>
        {focusPt && (
          <line
            x1={ax}
            y1={ay}
            x2={fx}
            y2={fy}
            stroke={GOLD}
            strokeWidth={3}
            strokeDasharray="7 5"
            markerEnd="url(#ptdArrow)"
          />
        )}
      </svg>
      {focusPt && !isBankStep && (
        <div className={styles.tutorialRing} style={{ left: fx, top: fy }} />
      )}
      {dot && <div className={styles.tutorialDot} style={{ left: dot.left, top: dot.top }} />}
      {step === 2 &&
        grid.drains.map((d, i) => {
          const p = cellPt(d);
          return p ? (
            <div key={i} className={styles.tutorialArrow} style={{ left: p.left, top: p.top }}>
              ▼
            </div>
          ) : null;
        })}
      <div className={styles.tutorialDialog} style={{ left: dialog.left, top: dialog.top }}>
        <p className={styles.tutorialText}>{text}</p>
        <div className={styles.tutorialButtons}>
          <button type="button" className={styles.tutorialSkip} onClick={onSkip}>
            Skip Tutorial
          </button>
          <button type="button" className={styles.tutorialNext} onClick={onNext}>
            {step < TUTORIAL_STEPS - 1 ? "Next ▶" : "Start ▶"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BigPipeTinyDream() {
  const gameRef = useRef<HTMLDivElement>(null); // outer container (HUD + stage) for tutorial coords
  const bankElRef = useRef<HTMLDivElement>(null); // the EXTRA PARTS bank DOM node, for the tutorial arrow
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<HTMLCanvasElement | null>(null); // textured green ground
  const pipesRef = useRef<HTMLCanvasElement | null>(null); // transparent pipe layer
  const waterRef = useRef<HTMLCanvasElement | null>(null); // baked, completed water
  const spritesRef = useRef<SpriteImages | null>(null);
  const sfxRef = useRef<Sfx | null>(null);
  const gridRef = useRef<Grid | null>(null);
  const headsRef = useRef<Head[]>([]); // active stream heads
  const reachedRef = useRef<Array<Side | null>>([]); // per drain: entry side, or null
  const burstsRef = useRef<Array<{ x: number; y: number; start: number }>>([]); // drain splashes
  const floodStartedRef = useRef(false);
  const levelRef = useRef(1);
  const scoreRef = useRef(0);
  const traveledRef = useRef(0); // pixels the water has travelled — the score
  const spentRef = useRef(0); // points spent on extra parts this level (subtracted from score)
  const fastRef = useRef(false); // speed toggle: fast (100px/s) vs level speed
  const bankRef = useRef<(BankKind | null)[]>(fullBank());
  const cursorRef = useRef<{ kind: BankKind; fromSlot: number } | null>(null);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);
  const flowAtRef = useRef(0); // performance.now() when the flood begins
  const phaseRef = useRef<Phase>("idle");

  const [phase, setPhaseState] = useState<Phase>("idle");
  const [level, setLevel] = useState(1);
  const [score, setScore] = useState(0);
  const [fast, setFast] = useState(false);
  const [drainsDone, setDrainsDone] = useState(0);
  const [drainsTotal, setDrainsTotal] = useState(1);
  const [bank, setBankState] = useState<(BankKind | null)[]>(fullBank());
  const [cursor, setCursorState] = useState<{ kind: BankKind; fromSlot: number } | null>(null);
  const [initials, setInitials] = useState("");
  const [leaderboard, setLeaderboard] = useState<ScoreRow[]>([]);
  const [tutorialStep, setTutorialStep] = useState(0);

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const setBank = useCallback((b: (BankKind | null)[]) => {
    bankRef.current = b;
    setBankState(b);
  }, []);

  const setCursor = useCallback((c: { kind: BankKind; fromSlot: number } | null) => {
    cursorRef.current = c;
    setCursorState(c);
  }, []);

  const toggleFast = useCallback(() => {
    fastRef.current = !fastRef.current;
    setFast(fastRef.current);
    sfxRef.current?.resume();
    // Hitting the speed control also releases the water immediately (skips any
    // remaining countdown).
    if (phaseRef.current === "playing" && !floodStartedRef.current) {
      flowAtRef.current = performance.now();
    }
  }, []);

  // Click a bank slot: pick up a part (cursor becomes it) — parts are free to use
  // — or click the slot it came from to put it back and return to normal play.
  const onSlot = useCallback(
    (i: number) => {
      if (phaseRef.current !== "playing") return;
      sfxRef.current?.resume();
      const cur = cursorRef.current;
      const b = [...bankRef.current];
      if (cur) {
        b[cur.fromSlot] = cur.kind; // the held piece goes back to its slot
        if (i === cur.fromSlot) {
          setBank(b);
          setCursor(null); // put back where it came from → normal play
        } else if (b[i] != null) {
          const kind = b[i] as BankKind; // switch to a different slot's piece
          b[i] = null;
          setBank(b);
          setCursor({ kind, fromSlot: i });
        } else {
          setBank(b);
          setCursor(null);
        }
      } else if (b[i] != null) {
        const kind = b[i] as BankKind;
        b[i] = null;
        setBank(b);
        setCursor({ kind, fromSlot: i });
      }
    },
    [setBank, setCursor],
  );

  // Refill all bank slots at once, spending REFILL_BASE + REFILL_PER_LEVEL × level
  // points. The button is disabled unless the player can afford it.
  const onRefill = useCallback(() => {
    if (phaseRef.current !== "playing") return;
    const cost = refillCostFor(levelRef.current);
    if (scoreRef.current < cost) return;
    sfxRef.current?.resume();
    spentRef.current += cost;
    scoreRef.current = Math.max(0, Math.floor(traveledRef.current) - spentRef.current);
    setScore(scoreRef.current);
    setBank(fullBank());
    setCursor(null);
    sfxRef.current?.play("rotate", 0.5);
  }, [setBank, setCursor]);

  // Load sprite PNGs and prime the sound effects once, on mount.
  useEffect(() => {
    let alive = true;
    loadSprites()
      .then((imgs) => {
        if (!alive) return;
        spritesRef.current = imgs;
        if (gridRef.current) {
          renderPipes();
          draw();
        }
      })
      .catch(() => {});
    let sfx: Sfx | null = null;
    try {
      sfx = new Sfx(); // no-op in environments without Web Audio (e.g. tests)
      void sfx.load();
      sfxRef.current = sfx;
    } catch {
      sfxRef.current = null;
    }
    return () => {
      alive = false;
      sfx?.destroy();
      sfxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadLeaderboard = useCallback(() => {
    fetch(`/api/leaderboard?game=${GAME_SLUG}`)
      .then((res) => res.json())
      .then((data: ScoreRow[]) => setLeaderboard(data))
      .catch(() => {});
  }, []);

  useEffect(loadLeaderboard, [loadLeaderboard]);

  // Repaint the whole transparent pipe layer (once per new board / whenever a
  // rotation or placement changes the board), darkening every tile that can't
  // reach the source so the live path stands out.
  const renderPipes = useCallback(() => {
    const grid = gridRef.current;
    const pipes = pipesRef.current;
    const imgs = spritesRef.current;
    const ctx = pipes?.getContext("2d");
    if (!grid || !pipes || !ctx || !imgs) return;
    ctx.clearRect(0, 0, pipes.width, pipes.height);
    const connected = connectedToSource(grid);
    for (let y = 0; y < grid.rows; y++) {
      for (let x = 0; x < grid.cols; x++) {
        drawTile(ctx, imgs, tileAt(grid, x, y), x, y, !connected[idx(grid, x, y)]);
      }
    }
  }, []);

  // Composite one frame, bottom to top: textured green ground, each drain's dark
  // pool and a halo riding every advancing head, the pipes, the drain rings, the
  // baked + live water, then the countdown badge.
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const pipes = pipesRef.current;
    const ctx = canvas?.getContext("2d");
    const grid = gridRef.current;
    if (!canvas || !pipes || !ctx || !grid) return;
    const now = performance.now();
    const heads = headsRef.current;

    const bg = bgRef.current;
    if (bg) {
      ctx.drawImage(bg, 0, 0);
    } else {
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const sx = grid.start.x * TILE;
    const sy = grid.start.y * TILE;

    // Every drain's pulsating dark pool (~200px), always on.
    for (const d of grid.drains) {
      const dx = d.x * TILE + TILE / 2;
      const dy = d.y * TILE + TILE / 2;
      const r = SHADOW_RADIUS * (0.85 + 0.15 * Math.sin(now / 700 + d.x + d.y));
      const g = ctx.createRadialGradient(dx, dy, 0, dx, dy, r);
      g.addColorStop(0, "rgba(0,0,0,0.55)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(dx, dy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // A pulsating halo riding each advancing head (or the spring before flow). A
    // capped head has no exit tip in its second half, so filter those out (else
    // headTips(h)[0] is undefined) — the stream just quietly ends at the cap.
    const haloTips = heads
      .slice(0, MAX_HALOS)
      .map((h) => headTips(h)[0])
      .filter((p): p is [number, number] => p !== undefined);
    const haloPts: Array<[number, number]> =
      haloTips.length > 0 ? haloTips : [[sx + TILE / 2, sy + TILE / 2]];
    const haloR = HALO_RADIUS * (0.8 + 0.2 * Math.sin(now / 500));
    for (const [hx, hy] of haloPts) {
      const halo = ctx.createRadialGradient(hx, hy, 0, hx, hy, haloR);
      halo.addColorStop(0, "rgba(255,238,170,0.5)");
      halo.addColorStop(1, "rgba(255,238,170,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(hx, hy, haloR, 0, Math.PI * 2);
      ctx.fill();
    }

    // The pipes sit above the ground and the glows.
    ctx.drawImage(pipes, 0, 0);

    // A soft ring around each drain so they're findable on a huge board; a fed
    // drain glows brighter and steadier.
    grid.drains.forEach((d, i) => {
      const done = reachedRef.current[i] != null;
      ctx.strokeStyle = done ? DRAIN_RING_DONE : DRAIN_RING;
      ctx.lineWidth = done ? 3 : 2;
      ctx.globalAlpha = done ? 0.9 : 0.5 + 0.3 * Math.sin(now / 400 + d.x);
      ctx.beginPath();
      // Pulled in from the tile edge so the ring no longer crosses the drain's
      // mouth — the opening side stays readable.
      ctx.arc(d.x * TILE + TILE / 2, d.y * TILE + TILE / 2, TILE * 0.38, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // Source is always wet: a small water pip at the spring.
    ctx.fillStyle = WATER;
    ctx.beginPath();
    ctx.arc(sx + TILE / 2, sy + TILE / 2, TILE * 0.1, 0, Math.PI * 2);
    ctx.fill();

    // Baked water (completed tiles + fed drains), then each live head on top.
    const water = waterRef.current;
    if (water) ctx.drawImage(water, 0, 0);
    for (const h of heads) {
      paintWater(ctx, h.entry, h.exits, h.x, h.y, h.progress);
      ctx.fillStyle = WATER_GLOW;
      for (const [tx, ty] of headTips(h)) {
        ctx.beginPath();
        ctx.arc(tx, ty, WATER_W / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Drain splashes: a quick radial burst of water droplets when a drain fills.
    if (burstsRef.current.length > 0) {
      const BURST_MS = 650;
      burstsRef.current = burstsRef.current.filter((b) => now - b.start < BURST_MS);
      ctx.fillStyle = WATER_GLOW;
      for (const b of burstsRef.current) {
        const age = (now - b.start) / BURST_MS; // 0 → 1
        const bx = b.x * TILE + TILE / 2;
        const by = b.y * TILE + TILE / 2;
        const reach = TILE * (0.15 + 0.75 * age);
        ctx.globalAlpha = 1 - age;
        const drops = 9;
        for (let k = 0; k < drops; k++) {
          const ang = (k / drops) * Math.PI * 2 + b.start * 0.01; // vary the fan per burst
          const dx = bx + Math.cos(ang) * reach;
          const dy = by + Math.sin(ang) * reach - age * 7; // a little upward lift
          ctx.beginPath();
          ctx.arc(dx, dy, (1 - age) * 3.5 + 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    // Countdown badge over the spring until the flood begins.
    if (phaseRef.current === "playing" && !floodStartedRef.current) {
      const secs = Math.max(0, Math.ceil((flowAtRef.current - now) / 1000));
      ctx.fillStyle = "rgba(13,13,20,0.72)";
      ctx.beginPath();
      // Smaller badge so the spring's opening peeks out beside the countdown.
      ctx.arc(sx + TILE / 2, sy + TILE / 2, TILE * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.round(TILE * 0.42)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(secs), sx + TILE / 2, sy + TILE / 2 + 1);
    }
  }, []);

  const stopLoop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  // Build a fresh board sized to the stage and (re)start the loop for a level.
  const startLevel = useCallback(
    (lvl: number) => {
      const stage = stageRef.current;
      const canvas = canvasRef.current;
      if (!stage || !canvas) return;
      const cols = Math.max(6, Math.floor(stage.clientWidth / TILE));
      const rows = Math.max(6, Math.floor(stage.clientHeight / TILE));
      canvas.width = cols * TILE;
      canvas.height = rows * TILE;

      // Textured green ground layer, painted once from a repeating noise tile.
      const bg = document.createElement("canvas");
      bg.width = canvas.width;
      bg.height = canvas.height;
      const bgCtx = bg.getContext("2d");
      const tex = getGreenTexture();
      if (bgCtx && tex) {
        const pat = bgCtx.createPattern(tex, "repeat");
        if (pat) {
          bgCtx.fillStyle = pat;
          bgCtx.fillRect(0, 0, bg.width, bg.height);
        }
      }
      bgRef.current = bg;

      // Transparent pipe layer (redrawn per tile on rotation) and a water layer
      // that accumulates completed streams.
      const pipes = document.createElement("canvas");
      pipes.width = canvas.width;
      pipes.height = canvas.height;
      pipesRef.current = pipes;
      const water = document.createElement("canvas");
      water.width = canvas.width;
      water.height = canvas.height;
      waterRef.current = water;

      const grid = generateGrid(cols, rows, Math.random, lvl);
      gridRef.current = grid;
      headsRef.current = [];
      reachedRef.current = grid.drains.map(() => null);
      floodStartedRef.current = false;
      traveledRef.current = 0;
      spentRef.current = 0;
      flowAtRef.current = performance.now() + countdownSec(lvl) * 1000;
      levelRef.current = lvl;
      setLevel(lvl);
      setDrainsDone(0);
      setDrainsTotal(grid.drains.length);
      setBank(fullBank()); // fresh free pieces per level
      setCursor(null);
      fastRef.current = false; // every level starts at NORMAL speed
      setFast(false);
      renderPipes();
      draw();
      // Level 1 opens with the on-board tutorial; the flood countdown only starts
      // once the player finishes or skips it (see beginPlay).
      if (lvl === 1 && grid.hint) {
        setTutorialStep(0);
        setPhase("tutorial");
      } else {
        setPhase("playing");
      }
    },
    [draw, renderPipes, setPhase, setBank, setCursor],
  );

  // Dismiss the tutorial and release the flood countdown fresh.
  const beginPlay = useCallback(() => {
    flowAtRef.current = performance.now() + countdownSec(levelRef.current) * 1000;
    setPhase("playing");
  }, [setPhase]);

  const startGame = useCallback(() => {
    scoreRef.current = 0;
    setScore(0);
    setInitials("");
    sfxRef.current?.resume();
    trackEvent("game_start", { game: GAME_SLUG });
    recordPlay(GAME_SLUG);
    startLevel(1);
  }, [startLevel]);

  // The rAF loop: advance every stream while phase is "playing".
  useEffect(() => {
    if (phase !== "playing") return;
    lastTsRef.current = performance.now();

    // Mark a drain fed; returns true when that completes the set.
    const markDrain = (grid: Grid, dx: number, dy: number, entry: Side): boolean => {
      const i = grid.drains.findIndex((d) => d.x === dx && d.y === dy);
      if (i < 0 || reachedRef.current[i] != null) return false;
      reachedRef.current[i] = entry;
      // Celebrate: a happy chime + a little burst of water at the drain.
      sfxRef.current?.play("drain", 0.6);
      burstsRef.current.push({ x: dx, y: dy, start: performance.now() });
      const wctx = waterRef.current?.getContext("2d");
      if (wctx) paintWater(wctx, entry, [], dx, dy, 0.5); // a stub into the drain
      const done = reachedRef.current.filter((r) => r != null).length;
      setDrainsDone(done);
      return done === grid.drains.length;
    };

    const tick = (ts: number) => {
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      const grid = gridRef.current;
      if (!grid) return;
      const lvl = levelRef.current;
      let won = false;
      let crashed = false; // a stream ran off an edge / into a mis-oriented tile

      // Kick off the flood once the countdown elapses.
      if (!floodStartedRef.current && ts >= flowAtRef.current) {
        floodStartedRef.current = true;
        sfxRef.current?.play("flow", 0.5);
        const step = startFlow(grid);
        if (step.type === "continue") headsRef.current.push(step.head);
        else if (step.type === "drain") won = markDrain(grid, step.x, step.y, step.entry);
        else if (step.reason === "crash") crashed = true;
      }

      if (floodStartedRef.current && !won && !crashed) {
        const speed = fastRef.current ? FAST_SPEED : flowRate(lvl);
        const delta = speed * dt;
        const dInc = delta / TILE;
        const heads = headsRef.current;
        traveledRef.current += delta * heads.length; // every stream travels
        const next: Head[] = [];
        for (const h of heads) {
          h.progress += dInc;
          if (h.progress < 1) {
            next.push(h);
            continue;
          }
          // Completed this tile: bake its full water, then branch onward.
          const wctx = waterRef.current?.getContext("2d");
          if (wctx) paintWater(wctx, h.entry, h.exits, h.x, h.y, 1);
          for (const st of advanceHead(grid, h)) {
            if (st.type === "continue") {
              st.head.progress = h.progress - 1;
              next.push(st.head);
            } else if (st.type === "drain") {
              if (markDrain(grid, st.x, st.y, st.entry)) won = true;
            } else if (st.reason === "crash") {
              crashed = true; // off an edge / mis-oriented tile → whole run ends
            }
            // collision → this branch simply ends, the run continues
          }
        }
        headsRef.current = next;
        scoreRef.current = Math.max(0, Math.floor(traveledRef.current) - spentRef.current);
        setScore(scoreRef.current);
      }

      draw();

      if (won) {
        stopLoop();
        sfxRef.current?.play("levelup", 0.6);
        setPhase("levelclear");
        return;
      }
      // A crash (edge / mis-oriented tile) ends the run at once; so does every
      // stream dying — by collision or otherwise — before the drains are fed.
      if (crashed || (floodStartedRef.current && headsRef.current.length === 0)) {
        stopLoop();
        sfxRef.current?.play("gameover", 0.6);
        trackEvent("game_over", { game: GAME_SLUG, score: scoreRef.current });
        setPhase("gameover");
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return stopLoop;
  }, [phase, draw, stopLoop, setPhase]);

  // Keyboard / gamepad: confirm starts a run or advances between levels.
  useEffect(() => {
    if (phase === "idle" || phase === "saved") {
      return attachGameInput({ onConfirm: startGame });
    }
    if (phase === "levelclear") {
      return attachGameInput({ onConfirm: () => startLevel(levelRef.current + 1) });
    }
  }, [phase, startGame, startLevel]);

  // Click / tap a tile: drop the armed bank piece there, or rotate it 90°
  // clockwise. Watered/start tiles (and drains, for placement) are left alone.
  useEffect(() => {
    if (phase !== "playing") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const actAt = (clientX: number, clientY: number) => {
      const grid = gridRef.current;
      const pipes = pipesRef.current;
      const imgs = spritesRef.current;
      if (!grid || !pipes || !imgs) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const gx = Math.floor(((clientX - rect.left) * (canvas.width / rect.width)) / TILE);
      const gy = Math.floor(((clientY - rect.top) * (canvas.height / rect.height)) / TILE);
      if (gx < 0 || gy < 0 || gx >= grid.cols || gy >= grid.rows) return;
      const t = tileAt(grid, gx, gy);
      const cur = cursorRef.current;

      if (cur) {
        // Drop the extra piece here (can't replace the source, a drain, or a wet
        // pipe). The piece is free but one-shot — its slot stays empty until the
        // player pays to REFILL the whole box.
        if (isLocked(t) || t.kind === "terminus") return;
        grid.tiles[idx(grid, gx, gy)] = {
          kind: cur.kind,
          rot: 0,
          water: [false, false, false, false],
        };
        setCursor(null);
      } else {
        if (isLocked(t)) return;
        grid.tiles[idx(grid, gx, gy)] = rotateTile(t);
      }
      sfxRef.current?.resume();
      sfxRef.current?.play("rotate", 0.4);
      renderPipes(); // full repaint: connectivity/darkening may have shifted
      draw();
    };

    const onClick = (e: MouseEvent) => actAt(e.clientX, e.clientY);
    const onTouch = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      actAt(t.clientX, t.clientY);
    };
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("touchend", onTouch, { passive: false });
    return () => {
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("touchend", onTouch);
    };
  }, [phase, draw, renderPipes, setCursor]);

  // Turn the mouse pointer into the held piece while one is armed.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const imgs = spritesRef.current;
    if (cursor && imgs) {
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 32;
      const cx = c.getContext("2d");
      if (cx) {
        cx.imageSmoothingEnabled = false;
        cx.drawImage(imgs[BANK_SPRITE[cursor.kind]], 0, 0, 32, 32);
        canvas.style.cursor = `url(${c.toDataURL()}) 16 16, crosshair`;
        return;
      }
    }
    canvas.style.cursor = cursor ? "crosshair" : "";
  }, [cursor]);

  const submitScore = async (e: FormEvent) => {
    e.preventDefault();
    const clean = initials.trim().toUpperCase();
    if (!clean) return;
    try {
      await fetch("/api/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game: GAME_SLUG, initials: clean, score: scoreRef.current }),
      });
      trackEvent("score_submitted", { game: GAME_SLUG, score: scoreRef.current, initials: clean });
      loadLeaderboard();
    } finally {
      setPhase("saved");
    }
  };

  const Leaderboard = () => (
    <ol className={styles.scoreList}>
      {leaderboard.map((row, i) => (
        <li key={row.id} className={styles.scoreRow}>
          <span className={styles.rank}>{(i + 1).toString().padStart(2, "0")}</span>
          <span className={styles.scoreInitials}>{row.initials}</span>
          <span className={styles.scoreValue}>{row.score}</span>
        </li>
      ))}
      {leaderboard.length === 0 && <li className={styles.scoreEmpty}>NO SCORES YET</li>}
    </ol>
  );

  return (
    <div className={styles.game} ref={gameRef}>
      <div className={styles.hud}>
        <span>SCORE: {score.toString().padStart(6, "0")}</span>
        <span>LEVEL {level}</span>
        <button
          type="button"
          className={styles.speedToggle}
          onClick={toggleFast}
          aria-pressed={fast}
        >
          SPEED: {fast ? "FAST ⏩" : "NORMAL"}
        </button>
        <div className={styles.bank} role="group" aria-label="Extra Parts" ref={bankElRef}>
          <span className={styles.bankLabel}>EXTRA PARTS</span>
          {bank.map((kind, i) => (
            <button
              key={i}
              type="button"
              className={`${styles.bankSlot} ${cursor?.fromSlot === i ? styles.bankSlotArmed : ""}`}
              onClick={() => onSlot(i)}
              disabled={phase !== "playing"}
              aria-label={
                kind ? `Take ${kind} piece` : cursor?.fromSlot === i ? "Return piece" : "Empty slot"
              }
              title={kind ? `Place a ${kind}` : "Empty"}
            >
              {kind ? (
                <img src={spriteUrl(BANK_SPRITE[kind])} alt={kind} className={styles.bankIcon} />
              ) : null}
            </button>
          ))}
          <button
            type="button"
            className={styles.refillBtn}
            onClick={onRefill}
            disabled={phase !== "playing" || score < refillCostFor(level)}
            title={`Refill all parts — costs ${refillCostFor(level)} points`}
          >
            REFILL {refillCostFor(level)}
          </button>
        </div>
        <span className={styles.drainHint}>
          ◎ DRAINS {drainsDone}/{drainsTotal}
        </span>
        <span>{cursor ? "CLICK A TILE TO PLACE" : "CLICK / TAP TO ROTATE"}</span>
      </div>

      <div ref={stageRef} className={styles.stage}>
        <canvas ref={canvasRef} className={styles.canvas} />

        {phase === "idle" && (
          <div className={styles.overlay}>
            <p className={styles.overlayTitle}>BIG PIPE TINY DREAM</p>
            <FeedbackPanel entity={GAME_SLUG} />
            <p>
              The board is already full of pipe. Before the water wakes, twist the tiles — one click
              turns a piece a quarter turn — and dream up a path from the golden spring to every
              glowing drain.
            </p>
            <p>
              A tee splits the stream in two, so one spring can feed many drains — but a stream that
              runs into a wall, an edge, or water already flowing dies. If every stream dies before
              the drains are fed, the dream ends. Score a point for each pixel the water travels.
            </p>
            <button type="button" className={styles.arcadeButton} onClick={startGame}>
              ▶ START
            </button>
            <VolumeControl />
          </div>
        )}

        {phase === "levelclear" && (
          <div className={styles.overlay}>
            <p className={styles.overlayTitle}>LEVEL {level} COMPLETE</p>
            <p>SCORE: {score}</p>
            <p>Every drain fed. The spring runs faster the deeper you dream.</p>
            <button
              type="button"
              className={styles.arcadeButton}
              onClick={() => startLevel(levelRef.current + 1)}
            >
              ▶ NEXT LEVEL
            </button>
          </div>
        )}

        {phase === "gameover" && (
          <div className={styles.overlay}>
            <p className={styles.overlayTitle}>THE DREAM ENDS</p>
            <p>FINAL SCORE: {score}</p>
            <form className={styles.initialsForm} onSubmit={submitScore}>
              <label htmlFor="initials">ENTER INITIALS:</label>
              <input
                id="initials"
                className={styles.initialsInput}
                value={initials}
                onChange={(e) =>
                  setInitials(
                    e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, "")
                      .slice(0, 3),
                  )
                }
                maxLength={3}
                autoFocus
                required
              />
              <button type="submit" className={styles.arcadeButton}>
                SAVE
              </button>
            </form>
            <button type="button" className={styles.skipButton} onClick={() => setPhase("saved")}>
              skip
            </button>
            <Leaderboard />
          </div>
        )}

        {phase === "saved" && (
          <div className={styles.overlay}>
            <p className={styles.overlayTitle}>SWEET DREAMS</p>
            <Leaderboard />
            <button type="button" className={styles.arcadeButton} onClick={startGame}>
              ▶ DREAM AGAIN
            </button>
          </div>
        )}
      </div>

      {/* Tutorial spans the whole game (HUD + stage) so it can point at the bank. */}
      {phase === "tutorial" && gridRef.current?.hint && (
        <Tutorial
          gameEl={gameRef.current}
          canvas={canvasRef.current}
          bankEl={bankElRef.current}
          grid={gridRef.current}
          step={tutorialStep}
          onSkip={beginPlay}
          onNext={() =>
            tutorialStep < TUTORIAL_STEPS - 1 ? setTutorialStep(tutorialStep + 1) : beginPlay()
          }
        />
      )}
    </div>
  );
}
