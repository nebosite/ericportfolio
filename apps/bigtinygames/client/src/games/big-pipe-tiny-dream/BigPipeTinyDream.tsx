import { useCallback, useEffect, useRef, useState, FormEvent } from "react";
import { attachGameInput } from "../input";
import {
  Grid,
  Flow,
  Tile,
  Side,
  N,
  E,
  isLocked,
  rotateTile,
  generateGrid,
  startFlow,
  advanceFlow,
  tileAt,
  idx,
  countdownSec,
  flowRate,
} from "./pipeLogic";
import { loadSprites, SpriteImages, SpriteName } from "./sprites";
import { Sfx } from "./sfx";
import FeedbackPanel from "../../components/FeedbackPanel";
import { trackEvent } from "../../lib/analytics";
import styles from "./BigPipeTinyDream.module.css";

// 40x40 pipe tiles filling the viewport (the "big pipe" of the title). Pure
// grid/connection/flow rules live in pipeLogic.ts; the pipe casings are the
// PNG sprites in sprites.ts; everything here is pixels, timing and input.
const TILE = 40;
const WATER_W = 8; // the stream drawn inside the pipe casing
const GAME_SLUG = "big-pipe-tiny-dream";
const FAST_SPEED = 100; // px/s when the speed toggle is on "fast"
const HALO_RADIUS = 75; // ~150px-wide source glow that rides the water head
const SHADOW_RADIUS = 100; // ~200px-wide dark pool behind the drain

const WATER = "#37b6ff";
const WATER_GLOW = "#bff0ff";
const DRAIN_RING = "#8affc8";
const BG = "#0d0d14";

type Phase = "idle" | "playing" | "levelclear" | "gameover" | "saved";

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

// A tile's water centreline: entry edge → centre → exit edge (always length
// TILE, whether the middle bends or runs straight). Single-opening tiles
// (start/terminus) pass exit === entry, giving an edge→centre stub.
function centreline(entry: Side, exit: Side): Array<[number, number]> {
  return [EDGE[entry], [TILE / 2, TILE / 2], EDGE[exit]];
}

// Which sprite draws this tile, and how many 90° clockwise turns to rotate the
// (natively-oriented) PNG so its openings match the tile's logical state.
//   pipe native = vertical N–S       → rot
//   elbow native = E+S (logic rot 1) → rot − 1
//   cross native = horizontal on top → rot (visual only)
//   start/terminus native = open E   → dir − 1
function spriteFor(t: Tile): { name: SpriteName; steps: number } {
  switch (t.kind) {
    case "straight":
      return { name: "pipe", steps: t.rot % 4 };
    case "elbow":
      return { name: "elbow", steps: (t.rot + 3) % 4 };
    case "cross":
      return { name: "cross", steps: t.rot % 4 };
    case "start":
      return { name: "start", steps: ((t.dir ?? N) + 3) % 4 };
    default:
      return { name: "terminus", steps: ((t.dir ?? E) + 3) % 4 };
  }
}

// Stroke a polyline only up to `len` pixels along it — the growing water head.
function strokePartial(
  ctx: CanvasRenderingContext2D,
  pts: Array<[number, number]>,
  len: number,
  width: number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  let remaining = len;
  for (let i = 1; i < pts.length && remaining > 0; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (remaining >= seg) {
      ctx.lineTo(x1, y1);
      remaining -= seg;
    } else {
      const t = remaining / seg;
      ctx.lineTo(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      remaining = 0;
    }
  }
  ctx.stroke();
}

// The point `len` pixels along a polyline (for the bright head bead).
function pointAlong(pts: Array<[number, number]>, len: number): [number, number] {
  let remaining = len;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (remaining <= seg) {
      const t = seg === 0 ? 0 : remaining / seg;
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    }
    remaining -= seg;
  }
  return pts[pts.length - 1];
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

export default function BigPipeTinyDream() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<HTMLCanvasElement | null>(null); // textured green ground
  const pipesRef = useRef<HTMLCanvasElement | null>(null); // transparent pipe layer
  const spritesRef = useRef<SpriteImages | null>(null);
  const sfxRef = useRef<Sfx | null>(null);
  const gridRef = useRef<Grid | null>(null);
  const flowRef = useRef<Flow | null>(null);
  const trailRef = useRef<Array<{ x: number; y: number; entry: Side; exit: Side }>>([]);
  const levelRef = useRef(1);
  const scoreRef = useRef(0);
  const traveledRef = useRef(0); // pixels the water has travelled — the score
  const fastRef = useRef(false); // speed toggle: fast (100px/s) vs level speed
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);
  const flowAtRef = useRef(0); // performance.now() when the flood begins
  const phaseRef = useRef<Phase>("idle");

  const [phase, setPhaseState] = useState<Phase>("idle");
  const [level, setLevel] = useState(1);
  const [score, setScore] = useState(0);
  const [fast, setFast] = useState(false);
  const [initials, setInitials] = useState("");
  const [leaderboard, setLeaderboard] = useState<ScoreRow[]>([]);

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const toggleFast = useCallback(() => {
    fastRef.current = !fastRef.current;
    setFast(fastRef.current);
  }, []);

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

  // Repaint the whole transparent pipe layer (once per new board / on rotation).
  const renderPipes = useCallback(() => {
    const grid = gridRef.current;
    const pipes = pipesRef.current;
    const imgs = spritesRef.current;
    const ctx = pipes?.getContext("2d");
    if (!grid || !pipes || !ctx || !imgs) return;
    ctx.clearRect(0, 0, pipes.width, pipes.height);
    for (let y = 0; y < grid.rows; y++) {
      for (let x = 0; x < grid.cols; x++) {
        drawTile(ctx, imgs, tileAt(grid, x, y), x, y);
      }
    }
  }, []);

  // Composite one frame, bottom to top: textured green ground, the drain's dark
  // pool and the source halo (which rides the water head), the pipes, the water,
  // then the countdown badge.
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const pipes = pipesRef.current;
    const ctx = canvas?.getContext("2d");
    const grid = gridRef.current;
    if (!canvas || !pipes || !ctx || !grid) return;
    const now = performance.now();

    const bg = bgRef.current;
    if (bg) {
      ctx.drawImage(bg, 0, 0);
    } else {
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const trail = trailRef.current;
    const flow = flowRef.current;
    const sx = grid.start.x * TILE;
    const sy = grid.start.y * TILE;
    const tx = grid.terminus.x * TILE;
    const ty = grid.terminus.y * TILE;

    // The drain's pulsating dark pool (~200px), always on.
    const shadowR = SHADOW_RADIUS * (0.85 + 0.15 * Math.sin(now / 700 + 1));
    const shadow = ctx.createRadialGradient(
      tx + TILE / 2,
      ty + TILE / 2,
      0,
      tx + TILE / 2,
      ty + TILE / 2,
      shadowR,
    );
    shadow.addColorStop(0, "rgba(0,0,0,0.55)");
    shadow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(tx + TILE / 2, ty + TILE / 2, shadowR, 0, Math.PI * 2);
    ctx.fill();

    // The source halo (~150px), pulsating and tracking the leading water edge.
    let haloX = sx + TILE / 2;
    let haloY = sy + TILE / 2;
    if (flow && !flow.dead && trail.length > 0) {
      const head = trail[trail.length - 1];
      const frac = Math.min(flow.progress, flow.won ? 0.5 : 1);
      const pts = centreline(head.entry, head.exit).map(
        ([lx, ly]) => [head.x * TILE + lx, head.y * TILE + ly] as [number, number],
      );
      [haloX, haloY] = pointAlong(pts, frac * TILE);
    }
    const haloR = HALO_RADIUS * (0.8 + 0.2 * Math.sin(now / 500));
    const halo = ctx.createRadialGradient(haloX, haloY, 0, haloX, haloY, haloR);
    halo.addColorStop(0, "rgba(255,238,170,0.5)");
    halo.addColorStop(1, "rgba(255,238,170,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(haloX, haloY, haloR, 0, Math.PI * 2);
    ctx.fill();

    // The pipes sit above the ground and the glows.
    ctx.drawImage(pipes, 0, 0);

    // A soft ring around the drain so it's findable on a monitor-sized board.
    ctx.strokeStyle = DRAIN_RING;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(now / 400);
    ctx.beginPath();
    ctx.arc(tx + TILE / 2, ty + TILE / 2, TILE * 0.46, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Source is always wet: a small water pip at the spring.
    ctx.fillStyle = WATER;
    ctx.beginPath();
    ctx.arc(sx + TILE / 2, sy + TILE / 2, TILE * 0.1, 0, Math.PI * 2);
    ctx.fill();

    // Water: every trail tile is full except the head, which fills to progress.
    for (let i = 0; i < trail.length; i++) {
      const seg = trail[i];
      const isHead = i === trail.length - 1 && flow != null && !flow.dead;
      // The head fills to its progress; a won (drain) tile only to its centre.
      const frac = isHead ? Math.min(flow!.progress, flow!.won ? 0.5 : 1) : 1;
      const pts = centreline(seg.entry, seg.exit).map(
        ([lx, ly]) => [seg.x * TILE + lx, seg.y * TILE + ly] as [number, number],
      );
      strokePartial(ctx, pts, frac * TILE, WATER_W, WATER);
      if (isHead) {
        const headPt = pointAlong(pts, frac * TILE);
        ctx.fillStyle = WATER_GLOW;
        ctx.beginPath();
        ctx.arc(headPt[0], headPt[1], WATER_W / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Countdown badge over the spring until the flood begins.
    if (phaseRef.current === "playing" && flow == null) {
      const secs = Math.max(0, Math.ceil((flowAtRef.current - performance.now()) / 1000));
      ctx.fillStyle = "rgba(13,13,20,0.72)";
      ctx.beginPath();
      ctx.arc(sx + TILE / 2, sy + TILE / 2, TILE * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.round(TILE * 0.5)}px system-ui, sans-serif`;
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

      // Transparent pipe layer, redrawn per tile on rotation.
      const pipes = document.createElement("canvas");
      pipes.width = canvas.width;
      pipes.height = canvas.height;
      pipesRef.current = pipes;

      gridRef.current = generateGrid(cols, rows, Math.random);
      flowRef.current = null;
      trailRef.current = [];
      traveledRef.current = 0;
      flowAtRef.current = performance.now() + countdownSec(lvl) * 1000;
      levelRef.current = lvl;
      setLevel(lvl);
      setPhase("playing");
      renderPipes();
      draw();
    },
    [draw, renderPipes, setPhase],
  );

  const startGame = useCallback(() => {
    scoreRef.current = 0;
    setScore(0);
    setInitials("");
    sfxRef.current?.resume();
    trackEvent("game_start", { game: GAME_SLUG });
    startLevel(1);
  }, [startLevel]);

  // The rAF loop: advance the flood while phase is "playing".
  useEffect(() => {
    if (phase !== "playing") return;
    lastTsRef.current = performance.now();
    const tick = (ts: number) => {
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      const grid = gridRef.current;
      if (!grid) return;
      const lvl = levelRef.current;

      // Kick off the flood once the countdown elapses.
      if (flowRef.current == null && ts >= flowAtRef.current) {
        const f = startFlow(grid);
        flowRef.current = f;
        sfxRef.current?.play("flow", 0.5);
        if (!f.dead) {
          trailRef.current.push({ x: f.x, y: f.y, entry: f.entry, exit: f.exit });
        }
      }

      let flow = flowRef.current;
      if (flow && !flow.dead) {
        const speed = fastRef.current ? FAST_SPEED : flowRate(lvl);
        const delta = speed * dt;
        traveledRef.current += delta;
        flow.progress += delta / TILE;
        // Cross into as many tiles as this frame's travel spans (a drain tile
        // is `won` and never advances onward).
        while (flow && !flow.dead && !flow.won && flow.progress >= 1) {
          const carry = flow.progress - 1;
          const next = advanceFlow(grid, flow);
          flowRef.current = next;
          flow = next;
          if (next.dead) break;
          next.progress = carry;
          trailRef.current.push({ x: next.x, y: next.y, entry: next.entry, exit: next.exit });
        }
        scoreRef.current = Math.floor(traveledRef.current);
        setScore(scoreRef.current);
      }

      draw();

      const cur = flowRef.current;
      if (cur && cur.dead) {
        stopLoop();
        sfxRef.current?.play("gameover", 0.6);
        trackEvent("game_over", { game: GAME_SLUG, score: scoreRef.current });
        setPhase("gameover");
        return;
      }
      if (cur && cur.won && cur.progress >= 0.5) {
        stopLoop();
        sfxRef.current?.play("levelup", 0.6);
        setPhase("levelclear");
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

  // Click / tap a tile to rotate it 90° clockwise (unless it's watered/locked).
  useEffect(() => {
    if (phase !== "playing") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rotateAt = (clientX: number, clientY: number) => {
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
      if (isLocked(t)) return;
      grid.tiles[idx(grid, gx, gy)] = rotateTile(t);
      const pctx = pipes.getContext("2d");
      if (pctx) drawTile(pctx, imgs, grid.tiles[idx(grid, gx, gy)], gx, gy);
      sfxRef.current?.resume();
      sfxRef.current?.play("rotate", 0.4);
      draw();
    };

    const onClick = (e: MouseEvent) => rotateAt(e.clientX, e.clientY);
    const onTouch = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      rotateAt(t.clientX, t.clientY);
    };
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("touchend", onTouch, { passive: false });
    return () => {
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("touchend", onTouch);
    };
  }, [phase, draw]);

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
    <div className={styles.game}>
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
        <span className={styles.drainHint}>◎ GUIDE WATER TO THE DRAIN</span>
        <span>CLICK / TAP TO ROTATE</span>
      </div>

      <div ref={stageRef} className={styles.stage}>
        <canvas ref={canvasRef} className={styles.canvas} />

        {phase === "idle" && (
          <div className={styles.overlay}>
            <p className={styles.overlayTitle}>BIG PIPE TINY DREAM</p>
            <p>
              The board is already full of pipe. Before the water wakes, twist the tiles — one click
              turns a piece a quarter turn — and dream up a path from the golden spring to the
              glowing drain.
            </p>
            <p>
              Water creeps from the spring, scoring a point for every pixel it travels. Keep an
              open, matching pipe waiting at every edge; a wet pipe sets and can&apos;t be turned.
              Reach the drain to clear the level.
            </p>
            <button type="button" className={styles.arcadeButton} onClick={startGame}>
              ▶ START
            </button>
            <FeedbackPanel entity={GAME_SLUG} />
          </div>
        )}

        {phase === "levelclear" && (
          <div className={styles.overlay}>
            <p className={styles.overlayTitle}>LEVEL {level} COMPLETE</p>
            <p>SCORE: {score}</p>
            <p>The spring runs faster the deeper you dream.</p>
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
    </div>
  );
}
