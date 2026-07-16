import { useRef, useEffect, useCallback, useState, FormEvent } from "react";
import {
  initialState,
  step,
  respawnPlayer,
  mazeCellPassable,
  cellCenter,
  facingFromVec,
  GameState,
  InputState,
  Facing,
  POWERUP_TTL,
  BULLET_LENGTH,
} from "./roboTronLogic";
import { getLevelConfig } from "./levels";
import {
  loadSpriteSheet,
  playerRect,
  enemyRect,
  familyRect,
  electrodeRect,
  SPRITE,
  SrcRect,
} from "./sprites";
import { Sfx } from "./sfx";
import { trackEvent } from "../../lib/analytics";
import { attachGameInput } from "../input";
import FeedbackPanel from "../../components/FeedbackPanel";
import VolumeControl from "../../components/VolumeControl";
import styles from "./BigRoboTinyTron.module.css";

// ---------------------------------------------------------------------------
// Constants

const ENTITY = "big-robo-tiny-tron";

/**
 * Maze-cell size in logical px (2.5× the original). The number of cells is
 * chosen so the grid tiles the viewport, and the canvas backing store
 * (cols·cellSize × rows·cellSize) is stretched to fill the stage exactly (the
 * canvas CSS is width/height 100%), so the maze fills the screen on both axes.
 */
const CELL = 440;

/** Teleport-pad visual diameter (px). */
const PAD_DIAMETER = 30;

const POWERUP_COLORS: Record<string, string> = {
  TripleBullets: "#ff00ff",
  AllDirections: "#00aaff",
  SpeedBoost: "#ffee00",
  Decoy: "#ff8800",
};

const POWERUP_LABELS: Record<string, string> = {
  TripleBullets: "3x",
  AllDirections: "8D",
  SpeedBoost: "SPD",
  Decoy: "DEC",
};

/** Fallback colors for enemy kinds that don't have a sprite yet. */
const FALLBACK_ENEMY_COLOR: Record<string, string> = {
  enforcer: "#ff8800",
  phantom: "#00ffff",
  spheroid: "#66ccff",
  tank: "#cccccc",
};

// ---------------------------------------------------------------------------
// Types

type Phase = "idle" | "playing" | "dead" | "exiting" | "gameover" | "saved";

interface ScoreRow {
  id: number;
  initials: string;
  score: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Component

export default function BigRoboTinyTron() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState | null>(null);
  const rafRef = useRef<number>(0);

  // Sprite sheet + sound, loaded once.
  const sheetRef = useRef<HTMLImageElement | null>(null);
  const sfxRef = useRef<Sfx | null>(null);

  // Player animation tracking (facing from aim, moving from position delta).
  const playerFacingRef = useRef<Facing>("right");
  const prevPlayerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Twin-stick input — held booleans stored in refs to avoid re-renders
  const moveKeys = useRef({ w: false, a: false, s: false, d: false });
  const aimKeys = useRef({ up: false, down: false, left: false, right: false });
  const dropDecoyOnce = useRef(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [displayScore, setDisplayScore] = useState(0);
  const [displayLives, setDisplayLives] = useState(3);
  const [displayLevel, setDisplayLevel] = useState(1);
  const [initials, setInitials] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [leaderboard, setLeaderboard] = useState<ScoreRow[]>([]);

  // -------------------------------------------------------------------------
  // Leaderboard fetch on mount

  useEffect(() => {
    fetch(`/api/leaderboard?game=${ENTITY}`)
      .then((r) => r.json())
      .then((data: ScoreRow[]) => setLeaderboard(data))
      .catch(() => {});
  }, []);

  // -------------------------------------------------------------------------
  // Sprite sheet + sound load on mount

  useEffect(() => {
    let alive = true;
    loadSpriteSheet()
      .then((img) => {
        if (alive) sheetRef.current = img;
      })
      .catch(() => {});
    sfxRef.current = new Sfx();
    void sfxRef.current.load();
    return () => {
      alive = false;
      sfxRef.current?.destroy();
    };
  }, []);

  // -------------------------------------------------------------------------
  // Build a fresh GameState for a level, sizing the maze to the viewport.

  const buildLevel = useCallback((level: number): GameState | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const stage = stageRef.current;
    const w = stage?.clientWidth || canvas.clientWidth || 900;
    const h = stage?.clientHeight || canvas.clientHeight || 640;

    const cols = Math.max(3, Math.round(w / CELL));
    const rows = Math.max(3, Math.round(h / CELL));

    const config = getLevelConfig(level);
    const st = initialState(cols, rows, level, Math.random, CELL, config);
    // Backing store = the actual display size (1 backing px = 1 CSS px), so game
    // objects can be drawn at their native 1:1 pixel resolution. The draw layer
    // maps the maze's logical space onto this canvas to fill both axes.
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    return st;
  }, []);

  // Build an initial level-1 state on mount (drawn behind the title).
  useEffect(() => {
    stateRef.current = buildLevel(1);
  }, [buildLevel]);

  const startNewGame = useCallback(() => {
    const st = buildLevel(1);
    if (st) {
      stateRef.current = st;
      prevPlayerRef.current = { x: st.player.x, y: st.player.y };
    }
    setDisplayScore(0);
    setDisplayLives(3);
    setDisplayLevel(1);
    setInitials("");
    setSubmitError("");
    sfxRef.current?.resume();
    trackEvent("game_start", { game: ENTITY });
    setPhase("playing");
  }, [buildLevel]);

  // -------------------------------------------------------------------------
  // Draw

  const draw = useCallback((state: GameState, t: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { maze } = state;
    const { cols, rows, cellSize } = maze;
    const sheet = sheetRef.current;

    // Map the maze's logical space onto the display so it fills both axes; game
    // objects are then drawn at FIXED native pixel sizes (1:1) regardless of the
    // grid size — only their positions are scaled.
    const scaleX = canvas.width / (cols * cellSize);
    const scaleY = canvas.height / (rows * cellSize);
    const SX = (x: number) => x * scaleX;
    const SY = (y: number) => y * scaleY;
    // Screen size of one cell (for exit openings that span a cell).
    const cw = cellSize * scaleX;
    const chh = cellSize * scaleY;
    // 3-frame walk cycle, ~12fps, staggered per entity id.
    const animPhase = Math.floor(t * 12);

    ctx.imageSmoothingEnabled = false;

    // Blit a sprite-sheet sub-rect centered on world (wx, wy) at a fixed screen size.
    const blit = (rect: SrcRect, wx: number, wy: number, dw: number): boolean => {
      if (!sheet) return false;
      const px = SX(wx);
      const py = SY(wy);
      ctx.drawImage(sheet, rect.sx, rect.sy, rect.s, rect.s, px - dw / 2, py - dw / 2, dw, dw);
      return true;
    };

    // 1. Clear
    ctx.fillStyle = "#0a0a1a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Maze walls — neon green lines, 8px thick
    ctx.strokeStyle = "#39ff14";
    ctx.lineWidth = 8;
    ctx.lineCap = "square";
    ctx.beginPath();
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const w = maze.walls[row * cols + col];
        const x = col * cellSize;
        const y = row * cellSize;
        if (w & 1) {
          ctx.moveTo(SX(x), SY(y));
          ctx.lineTo(SX(x + cellSize), SY(y));
        }
        if (w & 2) {
          ctx.moveTo(SX(x + cellSize), SY(y));
          ctx.lineTo(SX(x + cellSize), SY(y + cellSize));
        }
        if (w & 4) {
          ctx.moveTo(SX(x), SY(y + cellSize));
          ctx.lineTo(SX(x + cellSize), SY(y + cellSize));
        }
        if (w & 8) {
          ctx.moveTo(SX(x), SY(y));
          ctx.lineTo(SX(x), SY(y + cellSize));
        }
      }
    }
    ctx.stroke();

    // 3. Exit openings
    if (state.exitsOpen) {
      ctx.fillStyle = "rgba(255, 238, 0, 0.85)";
      for (const ec of maze.exitCells) {
        const x = SX(ec.col * cellSize);
        const y = SY(ec.row * cellSize);
        if (ec.row === 0 && mazeCellPassable(maze, ec.col, ec.row, "N")) {
          ctx.fillRect(x + 5, y - 4, cw - 10, 8);
        } else if (ec.row === rows - 1 && mazeCellPassable(maze, ec.col, ec.row, "S")) {
          ctx.fillRect(x + 5, y + chh - 4, cw - 10, 8);
        } else if (ec.col === 0 && mazeCellPassable(maze, ec.col, ec.row, "W")) {
          ctx.fillRect(x - 4, y + 5, 8, chh - 10);
        } else if (ec.col === cols - 1 && mazeCellPassable(maze, ec.col, ec.row, "E")) {
          ctx.fillRect(x + cw - 4, y + 5, 8, chh - 10);
        }
      }
    }

    // 4. Teleport pads — small 30px pulsing disks at the corner-cell centers
    const padAlpha = 0.45 + 0.3 * Math.sin(t * 3.5);
    for (const pad of maze.teleportPads) {
      const c = cellCenter(maze, pad.col, pad.row);
      ctx.beginPath();
      ctx.arc(SX(c.x), SY(c.y), PAD_DIAMETER / 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(40, 80, 255, ${padAlpha})`;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(120, 170, 255, ${0.6 + 0.4 * Math.sin(t * 3.5)})`;
      ctx.stroke();
    }

    // 5. Electrodes — native 16px
    for (const el of state.electrodes) {
      if (!blit(electrodeRect(el.type, el.shrink), el.x, el.y, SPRITE)) {
        ctx.fillStyle = "#39ff14";
        ctx.fillRect(SX(el.x) - 5, SY(el.y) - 5, 10, 10);
      }
    }

    // 6. Family members — native 16px, 3-frame walk cycle
    for (const h of state.humans) {
      const ph = animPhase + h.id;
      if (!blit(familyRect(h.type, h.facing, h.moving, ph), h.x, h.y, SPRITE)) {
        ctx.fillStyle = "#ffee00";
        ctx.fillRect(SX(h.x) - 4, SY(h.y) - 4, 8, 8);
      }
    }

    // 7. Powerup pickups
    for (const p of state.powerupPickups) {
      const pc = cellCenter(maze, p.col, p.row);
      const px = SX(pc.x);
      const py = SY(pc.y);
      ctx.fillStyle = POWERUP_COLORS[p.kind] ?? "#ffffff";
      ctx.fillRect(px - 6, py - 6, 12, 12);
      ctx.fillStyle = "#000000";
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(POWERUP_LABELS[p.kind] ?? "?", px, py);
    }

    // 8. Enemies — native 16px sprite (or fallback shape)
    for (const e of state.enemies) {
      const ph = animPhase + e.id;
      const rect = enemyRect(e.kind, e.facing, e.moving, ph);
      if (rect && blit(rect, e.x, e.y, SPRITE)) continue;
      ctx.fillStyle = FALLBACK_ENEMY_COLOR[e.kind] ?? "#ff3333";
      const s = e.kind === "enforcer" || e.kind === "tank" ? 14 : 10;
      ctx.fillRect(SX(e.x) - s / 2, SY(e.y) - s / 2, s, s);
    }

    // 9. Active decoy
    if (state.decoy) {
      const fade = Math.min(1, state.decoy.ttl / (POWERUP_TTL * 0.5));
      const pulse = 0.4 + 0.3 * Math.sin(t * 6);
      ctx.fillStyle = `rgba(255, 80, 200, ${fade * pulse})`;
      ctx.fillRect(SX(state.decoy.x) - 5, SY(state.decoy.y) - 5, 10, 10);
    }

    // 10. Player — native 16px
    if (state.player.respawnTimer <= 0) {
      const flickerOff = state.player.invuln > 0 && Math.floor(t * 10) % 2 === 0;
      if (!flickerOff) {
        const facing =
          facingFromVec(state.player.aimDir.x, state.player.aimDir.y) ?? playerFacingRef.current;
        playerFacingRef.current = facing;
        const prev = prevPlayerRef.current;
        const moving = Math.abs(state.player.x - prev.x) + Math.abs(state.player.y - prev.y) > 0.3;
        prevPlayerRef.current = { x: state.player.x, y: state.player.y };
        if (!blit(playerRect(facing, moving, animPhase), state.player.x, state.player.y, SPRITE)) {
          ctx.fillStyle = "#00ff88";
          ctx.fillRect(SX(state.player.x) - 5, SY(state.player.y) - 5, 10, 10);
        }
      }
    }

    // 11. Bullets — fixed 6px line oriented along (screen-space) travel direction
    ctx.lineCap = "round";
    ctx.lineWidth = 2.5;
    for (const b of state.bullets) {
      const vx = b.vx * scaleX;
      const vy = b.vy * scaleY;
      const spd = Math.hypot(vx, vy) || 1;
      const ux = vx / spd;
      const uy = vy / spd;
      const half = BULLET_LENGTH / 2;
      const bx = SX(b.x);
      const by = SY(b.y);
      ctx.strokeStyle = b.fromPlayer ? "#ffffff" : "#ff5555";
      ctx.beginPath();
      ctx.moveTo(bx - ux * half, by - uy * half);
      ctx.lineTo(bx + ux * half, by + uy * half);
      ctx.stroke();
    }

    // 12. Particles — reconstitute streaks (converging) or debris lines
    ctx.lineWidth = 2;
    for (const p of state.particles) {
      const a = Math.max(0, Math.min(1, p.ttl / p.life));
      if (p.tx !== undefined && p.ty !== undefined) {
        // Bright green streak trailing behind its inward motion.
        const dx = p.tx - p.x;
        const dy = p.ty - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const ux = dx / d;
        const uy = dy / d;
        const bx = SX(p.x);
        const by = SY(p.y);
        ctx.globalAlpha = 1 - a * 0.4; // brighter as it nears the player
        ctx.strokeStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - ux * 10, by - uy * 10);
        ctx.stroke();
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.fillRect(SX(p.x) - p.len, SY(p.y) - 1, p.len * 2, 2);
      }
    }
    ctx.globalAlpha = 1;
  }, []);

  // -------------------------------------------------------------------------
  // Twin-stick keyboard listeners (only when playing)

  useEffect(() => {
    if (phase !== "playing") return;

    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "w":
        case "W":
          moveKeys.current.w = true;
          e.preventDefault();
          break;
        case "a":
        case "A":
          moveKeys.current.a = true;
          e.preventDefault();
          break;
        case "s":
        case "S":
          moveKeys.current.s = true;
          e.preventDefault();
          break;
        case "d":
        case "D":
          moveKeys.current.d = true;
          e.preventDefault();
          break;
        case "ArrowUp":
          aimKeys.current.up = true;
          e.preventDefault();
          break;
        case "ArrowDown":
          aimKeys.current.down = true;
          e.preventDefault();
          break;
        case "ArrowLeft":
          aimKeys.current.left = true;
          e.preventDefault();
          break;
        case "ArrowRight":
          aimKeys.current.right = true;
          e.preventDefault();
          break;
        case "q":
        case "Q":
          dropDecoyOnce.current = true;
          e.preventDefault();
          break;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      switch (e.key) {
        case "w":
        case "W":
          moveKeys.current.w = false;
          break;
        case "a":
        case "A":
          moveKeys.current.a = false;
          break;
        case "s":
        case "S":
          moveKeys.current.s = false;
          break;
        case "d":
        case "D":
          moveKeys.current.d = false;
          break;
        case "ArrowUp":
          aimKeys.current.up = false;
          break;
        case "ArrowDown":
          aimKeys.current.down = false;
          break;
        case "ArrowLeft":
          aimKeys.current.left = false;
          break;
        case "ArrowRight":
          aimKeys.current.right = false;
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      moveKeys.current = { w: false, a: false, s: false, d: false };
      aimKeys.current = { up: false, down: false, left: false, right: false };
    };
  }, [phase]);

  // -------------------------------------------------------------------------
  // Game loop

  useEffect(() => {
    if (phase !== "playing" || !stateRef.current) return;

    let last = performance.now();
    let cancelled = false;

    const loop = () => {
      if (cancelled) return;

      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      const mk = moveKeys.current;
      const ak = aimKeys.current;
      const input: InputState = {
        moveX: (mk.d ? 1 : 0) - (mk.a ? 1 : 0),
        moveY: (mk.s ? 1 : 0) - (mk.w ? 1 : 0),
        aimX: (ak.right ? 1 : 0) - (ak.left ? 1 : 0),
        aimY: (ak.down ? 1 : 0) - (ak.up ? 1 : 0),
        fire: ak.up || ak.down || ak.left || ak.right,
        dropDecoy: dropDecoyOnce.current,
      };
      dropDecoyOnce.current = false;

      const next = step(stateRef.current!, input, dt);

      // Play sound for every event this step.
      const sfx = sfxRef.current;
      if (sfx) for (const ev of next.events) sfx.play(ev);

      draw(next, now / 1000);
      setDisplayScore(next.score);
      setDisplayLives(next.lives);
      setDisplayLevel(next.level);

      const evts = next.events;

      if (evts.includes("gameover")) {
        trackEvent("game_over", { game: ENTITY, score: next.score });
        setPhase("gameover");
        return;
      }

      if (evts.includes("playerHit")) {
        setPhase("dead");
        setTimeout(() => {
          // Reconstitute: particles fly in and congeal into the player, who
          // flashes while a cue plays so you can find yourself again.
          if (stateRef.current) respawnPlayer(stateRef.current);
          sfxRef.current?.play("reconstitute");
          setPhase("playing");
        }, 1500);
        return;
      }

      // Level advance — the component owns building the next level (dynamic
      // cell size + the CSV config for the new level).
      if (evts.includes("levelAdvance")) {
        const cur = stateRef.current!;
        const st = buildLevel(cur.level + 1);
        if (st) {
          st.score = cur.score;
          st.lives = cur.lives;
          stateRef.current = st;
          prevPlayerRef.current = { x: st.player.x, y: st.player.y };
        }
        setPhase("exiting");
        setTimeout(() => setPhase("playing"), 2000);
        return;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [phase, draw, buildLevel]);

  // -------------------------------------------------------------------------
  // Idle screen: Enter/Space to start

  useEffect(() => {
    if (phase !== "idle") return;
    return attachGameInput({ onConfirm: startNewGame });
  }, [phase, startNewGame]);

  // -------------------------------------------------------------------------
  // Score submission

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!/^[A-Z0-9]{1,3}$/.test(initials)) {
        setSubmitError("Enter 1–3 uppercase letters or digits");
        return;
      }
      try {
        const res = await fetch("/api/leaderboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ game: ENTITY, initials, score: displayScore }),
        });
        if (!res.ok) throw new Error("submit failed");
        trackEvent("score_submitted", { game: ENTITY, score: displayScore });
        const updated: ScoreRow[] = await fetch(`/api/leaderboard?game=${ENTITY}`).then((r) =>
          r.json(),
        );
        setLeaderboard(updated);
        setPhase("saved");
      } catch {
        setSubmitError("Could not save score. Try again.");
      }
    },
    [initials, displayScore],
  );

  // -------------------------------------------------------------------------
  // Render

  return (
    <div ref={stageRef} className={styles.stage}>
      <canvas ref={canvasRef} className={styles.canvas} />

      {/* ---- HUD ---- */}
      {(phase === "playing" || phase === "dead" || phase === "exiting") && (
        <div className={styles.hud}>
          <span>SCORE: {displayScore.toLocaleString()}</span>
          <span>
            LV{displayLevel} &nbsp; {"♥".repeat(Math.max(0, displayLives))}
          </span>
        </div>
      )}

      {/* ---- Idle / title overlay ---- */}
      {phase === "idle" && (
        <div className={styles.overlay}>
          <h1 style={{ color: "#39ff14", letterSpacing: "0.2em", margin: 0 }}>
            BIG ROBO TINY TRON
          </h1>
          <p style={{ color: "#00ccff", margin: "0.25rem 0 0.75rem" }}>
            Twin-stick shooter · big neon maze · rescue the family
          </p>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.35rem",
              fontSize: "0.82rem",
              color: "#aaa",
              marginBottom: "0.5rem",
            }}
          >
            <div>
              <kbd>WASD</kbd> Move &nbsp;·&nbsp; <kbd>↑↓←→</kbd> Aim &amp; Shoot
            </div>
            <div>
              <kbd>Q</kbd> Drop Decoy &nbsp;·&nbsp; <kbd>Enter</kbd> / <kbd>Space</kbd> Start
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "0.3rem 1.2rem",
              fontSize: "0.78rem",
              color: "#888",
              marginBottom: "1rem",
            }}
          >
            <span style={{ color: "#ff3333" }}>■ Grunt</span>
            <span>swarms toward you by contact</span>
            <span style={{ color: "#39ff14" }}>■ Electrode</span>
            <span>shoot it — deadly to touch</span>
            <span style={{ color: "#ff5cc8" }}>■ Family</span>
            <span>rescue for +1000 · dies on any hazard</span>
          </div>

          <button className={styles.arcadeButton} onClick={startNewGame}>
            START GAME
          </button>
          <VolumeControl />
          <FeedbackPanel entity={ENTITY} />
        </div>
      )}

      {/* ---- Player-down flash overlay ---- */}
      {phase === "dead" && (
        <div className={styles.overlay}>
          <h2 style={{ color: "#ff3333", letterSpacing: "0.2em", margin: 0 }}>PLAYER DOWN</h2>
          <p style={{ color: "#888", marginTop: "0.5rem" }}>
            {displayLives} {displayLives === 1 ? "life" : "lives"} remaining
          </p>
        </div>
      )}

      {/* ---- Level-clear flash overlay ---- */}
      {phase === "exiting" && (
        <div className={styles.overlay}>
          <h2 style={{ color: "#39ff14", letterSpacing: "0.2em", margin: 0 }}>LEVEL CLEAR!</h2>
          <p style={{ color: "#aaa", marginTop: "0.5rem" }}>
            Score: <strong style={{ color: "#ffffff" }}>{displayScore.toLocaleString()}</strong>
          </p>
          <p style={{ color: "#888" }}>Entering level {displayLevel}…</p>
        </div>
      )}

      {/* ---- Game-over overlay ---- */}
      {phase === "gameover" && (
        <div className={styles.overlay}>
          <h2 style={{ color: "#ff3333", letterSpacing: "0.2em", margin: 0 }}>GAME OVER</h2>
          <p style={{ color: "#aaa", marginTop: "0.5rem" }}>
            Final score:{" "}
            <strong style={{ color: "#ffffff", fontSize: "1.3rem" }}>
              {displayScore.toLocaleString()}
            </strong>
          </p>

          <form
            onSubmit={handleSubmit}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
              alignItems: "center",
            }}
          >
            <label style={{ color: "#aaa", fontSize: "0.85rem" }}>Enter your initials</label>
            <input
              type="text"
              maxLength={3}
              value={initials}
              onChange={(e) => setInitials(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="AAA"
              className={styles.initials}
            />
            {submitError && (
              <p style={{ color: "#ff5555", margin: 0, fontSize: "0.8rem" }}>{submitError}</p>
            )}
            <button className={styles.arcadeButton} type="submit">
              SUBMIT SCORE
            </button>
          </form>

          <button
            className={styles.arcadeButton}
            onClick={startNewGame}
            style={{ marginTop: "0.25rem" }}
          >
            PLAY AGAIN
          </button>
        </div>
      )}

      {/* ---- Saved / leaderboard overlay ---- */}
      {phase === "saved" && (
        <div className={styles.overlay}>
          <h2 style={{ color: "#39ff14", letterSpacing: "0.15em", margin: 0 }}>SCORE SAVED!</h2>
          <p style={{ color: "#aaa", margin: "0.25rem 0 0.75rem" }}>
            Final score:{" "}
            <strong style={{ color: "#ffffff" }}>{displayScore.toLocaleString()}</strong>
          </p>

          <div
            style={{
              width: "min(320px, 90%)",
              background: "rgba(0,0,0,0.5)",
              border: "1px solid #39ff14",
              borderRadius: "6px",
              padding: "0.75rem",
              marginBottom: "0.75rem",
            }}
          >
            <div
              style={{
                color: "#39ff14",
                fontSize: "0.8rem",
                letterSpacing: "0.2em",
                marginBottom: "0.5rem",
              }}
            >
              TOP SCORES
            </div>
            {leaderboard.slice(0, 10).map((row, i) => (
              <div
                key={row.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontFamily: "monospace",
                  fontSize: "0.85rem",
                  padding: "0.15rem 0",
                  color: row.initials === initials ? "#39ff14" : "#ccc",
                  borderBottom:
                    i < Math.min(leaderboard.length, 10) - 1 ? "1px solid #222" : "none",
                }}
              >
                <span style={{ color: "#555", width: "1.5rem" }}>{i + 1}.</span>
                <span style={{ flex: 1 }}>{row.initials}</span>
                <span>{row.score.toLocaleString()}</span>
              </div>
            ))}
          </div>

          <button className={styles.arcadeButton} onClick={startNewGame}>
            PLAY AGAIN
          </button>
        </div>
      )}
    </div>
  );
}
