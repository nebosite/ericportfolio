import { useRef, useEffect, useCallback, useState, FormEvent } from "react";
import {
  initialState,
  step,
  mazeCellPassable,
  cellCenter,
  GameState,
  InputState,
  CELL_SIZE,
  POWERUP_TTL,
} from "./roboTronLogic";
import { trackEvent } from "../../lib/analytics";
import { attachGameInput } from "../input";
import FeedbackPanel from "../../components/FeedbackPanel";
import VolumeControl from "../../components/VolumeControl";
import styles from "./BigRoboTinyTron.module.css";

// ---------------------------------------------------------------------------
// Constants

const ENTITY = "big-robo-tiny-tron";

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
  // Canvas / state initialisation on mount

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    const cols = Math.max(5, Math.floor(w / CELL_SIZE));
    const rows = Math.max(5, Math.floor(h / CELL_SIZE));
    canvas.width = cols * CELL_SIZE;
    canvas.height = rows * CELL_SIZE;
    stateRef.current = initialState(cols, rows, 1);
  }, []);

  // -------------------------------------------------------------------------
  // Helpers

  /** Build a fresh GameState for level 1 at the current canvas size. */
  const buildFreshState = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    const cols = Math.max(5, Math.floor(w / CELL_SIZE));
    const rows = Math.max(5, Math.floor(h / CELL_SIZE));
    canvas.width = cols * CELL_SIZE;
    canvas.height = rows * CELL_SIZE;
    stateRef.current = initialState(cols, rows, 1);
  }, []);

  const startNewGame = useCallback(() => {
    buildFreshState();
    setDisplayScore(0);
    setDisplayLives(3);
    setDisplayLevel(1);
    setInitials("");
    setSubmitError("");
    trackEvent("game_start", { game: ENTITY });
    setPhase("playing");
  }, [buildFreshState]);

  // -------------------------------------------------------------------------
  // Draw

  const draw = useCallback((state: GameState) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { maze } = state;
    const { cols, rows, cellSize } = maze;
    const t = performance.now() / 1000;

    // 1. Clear
    ctx.fillStyle = "#0a0a1a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Maze walls — neon green lines, one pass per cell
    ctx.strokeStyle = "#39ff14";
    ctx.lineWidth = 2;
    ctx.lineCap = "square";
    ctx.beginPath();
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const w = maze.walls[row * cols + col];
        const x = col * cellSize;
        const y = row * cellSize;
        if (w & 1) {
          // N wall
          ctx.moveTo(x, y);
          ctx.lineTo(x + cellSize, y);
        }
        if (w & 2) {
          // E wall
          ctx.moveTo(x + cellSize, y);
          ctx.lineTo(x + cellSize, y + cellSize);
        }
        if (w & 4) {
          // S wall
          ctx.moveTo(x, y + cellSize);
          ctx.lineTo(x + cellSize, y + cellSize);
        }
        if (w & 8) {
          // W wall
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + cellSize);
        }
      }
    }
    ctx.stroke();

    // 3. Exit rects — bright yellow openings on border when exits are open
    if (state.exitsOpen) {
      ctx.fillStyle = "rgba(255, 238, 0, 0.85)";
      for (const ec of maze.exitCells) {
        const x = ec.col * cellSize;
        const y = ec.row * cellSize;
        if (ec.row === 0 && mazeCellPassable(maze, ec.col, ec.row, "N")) {
          ctx.fillRect(x + 5, y - 4, cellSize - 10, 8);
        } else if (ec.row === rows - 1 && mazeCellPassable(maze, ec.col, ec.row, "S")) {
          ctx.fillRect(x + 5, y + cellSize - 4, cellSize - 10, 8);
        } else if (ec.col === 0 && mazeCellPassable(maze, ec.col, ec.row, "W")) {
          ctx.fillRect(x - 4, y + 5, 8, cellSize - 10);
        } else if (ec.col === cols - 1 && mazeCellPassable(maze, ec.col, ec.row, "E")) {
          ctx.fillRect(x + cellSize - 4, y + 5, 8, cellSize - 10);
        }
      }
    }

    // 4. Teleport pads — pulsing blue squares at corners
    const padAlpha = 0.4 + 0.25 * Math.sin(t * 3.5);
    ctx.fillStyle = `rgba(40, 80, 255, ${padAlpha})`;
    for (const pad of maze.teleportPads) {
      const px = pad.col * cellSize + 4;
      const py = pad.row * cellSize + 4;
      ctx.fillRect(px, py, cellSize - 8, cellSize - 8);
    }
    // Teleport pad border glow
    ctx.strokeStyle = `rgba(80, 140, 255, ${0.6 + 0.4 * Math.sin(t * 3.5)})`;
    ctx.lineWidth = 1;
    for (const pad of maze.teleportPads) {
      const px = pad.col * cellSize + 4;
      const py = pad.row * cellSize + 4;
      ctx.strokeRect(px, py, cellSize - 8, cellSize - 8);
    }

    // 5. Humans — yellow 6×6 squares
    ctx.fillStyle = "#ffee00";
    for (const h of state.humans) {
      const hc = cellCenter(maze, h.col, h.row);
      ctx.fillRect(hc.x - 3, hc.y - 3, 6, 6);
    }

    // 6. Powerup pickups — 8×8 colored squares with label
    for (const p of state.powerupPickups) {
      const pc = cellCenter(maze, p.col, p.row);
      const color = POWERUP_COLORS[p.kind] ?? "#ffffff";
      ctx.fillStyle = color;
      ctx.fillRect(pc.x - 4, pc.y - 4, 8, 8);
      ctx.fillStyle = "#000000";
      ctx.font = "5px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(POWERUP_LABELS[p.kind] ?? "?", pc.x, pc.y);
    }

    // 7. Active decoy — semi-transparent pulsing orange-magenta sprite
    if (state.decoy) {
      const fade = Math.min(1, state.decoy.ttl / (POWERUP_TTL * 0.5));
      const pulse = 0.4 + 0.3 * Math.sin(t * 6);
      ctx.fillStyle = `rgba(255, 80, 200, ${fade * pulse})`;
      ctx.fillRect(state.decoy.x - 4, state.decoy.y - 4, 8, 8);
      ctx.strokeStyle = `rgba(255, 150, 50, ${fade * 0.9})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(state.decoy.x - 5, state.decoy.y - 5, 10, 10);
    }

    // 8. Player — 8×8 bright green square, flicker during invuln
    if (state.player.respawnTimer <= 0) {
      const flickerOff = state.player.invuln > 0 && Math.floor(t * 10) % 2 === 0;
      if (!flickerOff) {
        ctx.fillStyle = "#00ff88";
        ctx.fillRect(state.player.x - 4, state.player.y - 4, 8, 8);
        // Aim direction indicator — tiny bright triangle
        const { aimDir } = state.player;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(
          state.player.x + aimDir.x * 5 - 1,
          state.player.y + aimDir.y * 5 - 1,
          2,
          2,
        );
      }
    }

    // 9. Grunts — 8×8 red
    ctx.fillStyle = "#ff3333";
    for (const e of state.enemies) {
      if (e.kind !== "grunt") continue;
      const ec = cellCenter(maze, e.col, e.row);
      ctx.fillRect(ec.x - 4, ec.y - 4, 8, 8);
      // HP dot (always 1 for grunt)
    }

    // 10. Enforcers — 12×8 orange, with HP pips
    ctx.fillStyle = "#ff8800";
    for (const e of state.enemies) {
      if (e.kind !== "enforcer") continue;
      const ec = cellCenter(maze, e.col, e.row);
      ctx.fillRect(ec.x - 6, ec.y - 4, 12, 8);
      // HP pips above enforcer
      for (let h = 0; h < e.hp; h++) {
        ctx.fillStyle = "#ffcc00";
        ctx.fillRect(ec.x - 4 + h * 4, ec.y - 7, 3, 2);
      }
      ctx.fillStyle = "#ff8800";
    }

    // 11. Phantoms — 10×10 pulsing cyan
    for (const e of state.enemies) {
      if (e.kind !== "phantom") continue;
      const ec = cellCenter(maze, e.col, e.row);
      const pulse = 0.6 + 0.4 * Math.sin(t * 5);
      ctx.fillStyle = `rgba(0, 255, 255, ${pulse})`;
      ctx.fillRect(ec.x - 5, ec.y - 5, 10, 10);
      // Outer glow ring
      ctx.strokeStyle = `rgba(0, 220, 255, ${pulse * 0.5})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(ec.x - 7, ec.y - 7, 14, 14);
    }

    // 12. Bullets
    for (const b of state.bullets) {
      if (b.fromPlayer) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(b.x - 2, b.y - 2, 4, 4);
      } else {
        ctx.fillStyle = "#ff6666";
        ctx.fillRect(b.x - 1.5, b.y - 1.5, 3, 3);
      }
    }

    // 13. HUD
    ctx.font = "bold 13px monospace";
    ctx.textBaseline = "top";

    // Score — top left
    ctx.textAlign = "left";
    ctx.fillStyle = "#39ff14";
    ctx.fillText(`SCORE: ${state.score.toLocaleString()}`, 8, 6);

    // Level + lives — top right
    ctx.textAlign = "right";
    const heartsStr = "♥".repeat(Math.max(0, state.lives));
    ctx.fillText(`LV${state.level}  ${heartsStr}`, canvas.width - 8, 6);

    // Powerup timer bar — top centre
    if (state.player.activePowerup && state.player.activePowerup !== "Decoy") {
      const barW = 100;
      const barX = canvas.width / 2 - barW / 2;
      const barY = 4;
      const frac = Math.max(0, state.player.powerupTimer / POWERUP_TTL);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(barX - 1, barY - 1, barW + 2, 10);
      ctx.fillStyle = POWERUP_COLORS[state.player.activePowerup] ?? "#ffffff";
      ctx.fillRect(barX, barY, barW * frac, 8);
      ctx.fillStyle = "#ffffff";
      ctx.font = "7px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(state.player.activePowerup.toUpperCase(), canvas.width / 2, barY);
    }

    // Decoy charge counter — bottom left
    if (state.decoyCharges > 0) {
      ctx.fillStyle = "#ff8800";
      ctx.font = "11px monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(`DECOY ×${state.decoyCharges}`, 8, canvas.height - 6);
    }
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
      // Reset held keys so nothing bleeds into the next phase
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

      // Build input snapshot
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

      draw(next);
      setDisplayScore(next.score);
      setDisplayLives(next.lives);
      setDisplayLevel(next.level);

      const evts = next.events;

      // Game over takes priority
      if (evts.includes("gameover")) {
        trackEvent("game_over", { game: ENTITY, score: next.score });
        setPhase("gameover");
        return;
      }

      // Player hit (life lost but still alive)
      if (evts.includes("playerHit")) {
        setPhase("dead");
        setTimeout(() => {
          // Clear respawn timer so the player is in control immediately
          if (stateRef.current) stateRef.current.player.respawnTimer = 0;
          setPhase("playing");
        }, 1500);
        return;
      }

      // Level advance — state is already reset by step() via Object.assign
      if (evts.includes("levelAdvance")) {
        setPhase("exiting");
        setTimeout(() => {
          setPhase("playing");
        }, 2000);
        return;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [phase, draw]);

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

      {/* ---- Idle / title overlay ---- */}
      {phase === "idle" && (
        <div className={styles.overlay}>
          <h1 style={{ color: "#39ff14", letterSpacing: "0.2em", margin: 0 }}>
            BIG ROBO TINY TRON
          </h1>
          <p style={{ color: "#00ccff", margin: "0.25rem 0 0.75rem" }}>
            Twin-stick shooter · maze arena · rescue the humans
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
            <span>1 HP · BFS chaser · fires</span>
            <span style={{ color: "#ff8800" }}>▬ Enforcer</span>
            <span>3 HP · spread shot</span>
            <span style={{ color: "#00ffff" }}>■ Phantom</span>
            <span>passes through walls</span>
            <span style={{ color: "#ffee00" }}>■ Human</span>
            <span>rescue for +1000</span>
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

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", alignItems: "center" }}>
            <label style={{ color: "#aaa", fontSize: "0.85rem" }}>Enter your initials</label>
            <input
              type="text"
              maxLength={3}
              value={initials}
              onChange={(e) =>
                setInitials(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
              }
              placeholder="AAA"
              style={{
                textAlign: "center",
                fontFamily: "monospace",
                fontSize: "1.8rem",
                width: "4.5ch",
                background: "#0a0a1a",
                color: "#39ff14",
                border: "2px solid #39ff14",
                borderRadius: "4px",
                padding: "0.2rem 0.4rem",
                letterSpacing: "0.3em",
              }}
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
                  borderBottom: i < Math.min(leaderboard.length, 10) - 1 ? "1px solid #222" : "none",
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
