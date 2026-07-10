import { useCallback, useEffect, useRef, useState, FormEvent } from "react";
import { attachGameInput } from "../input";
import {
  BEAM_TTL,
  Castle,
  GameState,
  InputState,
  MAX_SHIELD,
  PowerupKind,
  RING_BAND,
  ROID_R,
  SHIP_R,
  SWEEP_DURATION,
  CORE_R,
  initialState,
  step,
} from "./roidsLogic";
import FeedbackPanel from "../../components/FeedbackPanel";
import { trackEvent } from "../../lib/analytics";
import styles from "./BigAstTinyERoids.module.css";

// The Big Tiny aesthetic, vector edition: glowing arcade line-art on a black
// field that fills the screen. Every rule lives in roidsLogic.ts (unit
// tested); this file is only pixels, timers and input plumbing.

const ENTITY = "big-ast-tiny-eroids";

type Phase = "idle" | "playing" | "gameover" | "saved";

interface ScoreRow {
  id: number;
  initials: string;
  score: number;
  created_at: string;
}

const WEAPON_LABEL: Record<GameState["weapon"], string> = {
  bullet: "PEA SHOOTER",
  machine: "MACHINE GUN",
  super: "SUPER BULLETS",
  laser: "LASER BOLT",
  superlaser: "SUPER LASER",
  ultralaser: "ULTRA LASER",
  puffball: "PUFFBALL",
};

const POWERUP_STYLE: Record<PowerupKind, { label: string; color: string }> = {
  shield: { label: "S", color: "#57d8ff" },
  bouncy: { label: "B", color: "#57ff7a" },
  life: { label: "♥", color: "#ffce3b" },
  machine: { label: "M", color: "#ffa03c" },
  super: { label: "X", color: "#ff5af5" },
  laser: { label: "L", color: "#ff5757" },
  superlaser: { label: "L2", color: "#ff2d95" },
  ultralaser: { label: "L3", color: "#b06bff" },
  puffball: { label: "P", color: "#ffffff" },
};

const RING_COLORS = ["#57ff7a", "#ffce3b", "#ff5757"]; // outer → inner

/** Stroke the same path twice — a fat translucent pass then a thin bright
 *  one — under additive compositing. That's the whole vector-glow trick. */
function glowStroke(
  ctx: CanvasRenderingContext2D,
  color: string,
  width: number,
  alpha: number,
  path: (ctx: CanvasRenderingContext2D) => void,
) {
  ctx.beginPath();
  path(ctx);
  ctx.strokeStyle = color;
  ctx.lineWidth = width * 3.2;
  ctx.globalAlpha = 0.28 * alpha;
  ctx.stroke();
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export default function BigAstTinyERoids() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState | null>(null);
  const keysRef = useRef<InputState>({ left: false, right: false, thrust: false, fire: false });
  const starsRef = useRef<Array<{ x: number; y: number; r: number }>>([]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [score, setScore] = useState(0);
  const [wave, setWave] = useState(1);
  const [lives, setLives] = useState(0);
  const [shield, setShield] = useState(0);
  const [bouncy, setBouncy] = useState(false);
  const [weapon, setWeapon] = useState<GameState["weapon"]>("bullet");
  const [ammo, setAmmo] = useState<number>(Infinity);
  const [initials, setInitials] = useState("");
  const [leaderboard, setLeaderboard] = useState<ScoreRow[]>([]);

  const loadLeaderboard = useCallback(() => {
    fetch(`/api/leaderboard?game=${ENTITY}`)
      .then((res) => res.json())
      .then((data: ScoreRow[]) => setLeaderboard(data))
      .catch(() => {});
  }, []);

  useEffect(loadLeaderboard, [loadLeaderboard]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const state = stateRef.current;
    const now = performance.now() / 1000;

    // Phosphor persistence: fade the last frame instead of clearing it, so
    // everything in motion leaves a dying vector trail.
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(6, 8, 14, 0.4)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!state) return;

    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";

    // A dim static starfield behind everything.
    ctx.fillStyle = "#8899bb";
    ctx.globalAlpha = 0.35;
    for (const star of starsRef.current) ctx.fillRect(star.x, star.y, star.r, star.r);
    ctx.globalAlpha = 1;

    const drawWrapped = (pos: { x: number; y: number }, r: number, fn: () => void) => {
      for (const dx of [-state.w, 0, state.w]) {
        for (const dy of [-state.h, 0, state.h]) {
          const x = pos.x + dx;
          const y = pos.y + dy;
          if (x < -r || x > state.w + r || y < -r || y > state.h + r) continue;
          ctx.save();
          ctx.translate(dx, dy);
          fn();
          ctx.restore();
        }
      }
    };

    // Rocks: jagged glowing polygons.
    for (const roid of state.roids) {
      const r = ROID_R[roid.size];
      drawWrapped(roid.pos, r * 1.3, () => {
        glowStroke(ctx, "#9fd8ff", 1.5, 1, (c) => {
          for (let i = 0; i <= roid.shape.length; i++) {
            const k = i % roid.shape.length;
            const a = roid.angle + (k / roid.shape.length) * Math.PI * 2;
            const rr = r * roid.shape[k];
            const x = roid.pos.x + Math.cos(a) * rr;
            const y = roid.pos.y + Math.sin(a) * rr;
            if (i === 0) c.moveTo(x, y);
            else c.lineTo(x, y);
          }
        });
      });
    }

    // The StarCastle.
    if (state.castle) drawCastle(ctx, state.castle, now, drawWrapped);

    // Beams (lasers + already-applied damage; these just afterglow).
    for (const beam of state.beams) {
      const fade = Math.max(0, beam.ttl / BEAM_TTL);
      beam.segs.forEach((seg, i) => {
        const color =
          beam.kind === "laser"
            ? "#ff4a4a"
            : beam.kind === "superlaser"
              ? "#ff2d95"
              : beam.kind === "sweep"
                ? "#ff3030"
                : `hsl(${(i * 47 + now * 300) % 360} 100% 65%)`;
        glowStroke(ctx, color, beam.kind === "laser" ? 1.5 : 2.2, fade, (c) => {
          c.moveTo(seg.a.x, seg.a.y);
          c.lineTo(seg.b.x, seg.b.y);
        });
      });
    }

    // Bullets.
    for (const bullet of state.bullets) {
      const spec =
        bullet.kind === "enemy"
          ? { color: "#ff5757", r: 2.5 }
          : bullet.kind === "super"
            ? { color: "#ff5af5", r: 4 }
            : bullet.kind === "frag"
              ? { color: "#ff9df8", r: 1.8 }
              : bullet.kind === "machine"
                ? { color: "#ffa03c", r: 2 }
                : { color: "#ffce3b", r: 2.4 };
      drawWrapped(bullet.pos, 6, () => {
        glowStroke(ctx, spec.color, spec.r, 1, (c) =>
          c.arc(bullet.pos.x, bullet.pos.y, spec.r, 0, Math.PI * 2),
        );
      });
    }

    // Blasts (puffball rings + wreck flashes).
    for (const blast of state.blasts) {
      const t = blast.age / blast.ttl;
      const color = blast.kind === "puff" ? "#7df9ff" : "#ffce3b";
      glowStroke(ctx, color, 2.5, 1 - t, (c) =>
        c.arc(blast.pos.x, blast.pos.y, blast.maxR * t, 0, Math.PI * 2),
      );
    }

    // Powerups: glowing hexagons with a letter inside.
    for (const pu of state.powerups) {
      const { label, color } = POWERUP_STYLE[pu.kind];
      const blink = pu.ttl < 3 && now % 0.4 < 0.2 ? 0.25 : 1;
      drawWrapped(pu.pos, 14, () => {
        glowStroke(ctx, color, 1.4, blink, (c) => {
          for (let i = 0; i <= 6; i++) {
            const a = now * 0.8 + (i / 6) * Math.PI * 2;
            const x = pu.pos.x + Math.cos(a) * 11;
            const y = pu.pos.y + Math.sin(a) * 11;
            if (i === 0) c.moveTo(x, y);
            else c.lineTo(x, y);
          }
        });
        ctx.fillStyle = color;
        ctx.globalAlpha = blink;
        ctx.font = "bold 9px 'Courier New', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, pu.pos.x, pu.pos.y + 0.5);
        ctx.globalAlpha = 1;
      });
    }

    // The ship.
    if (state.respawn <= 0 && !state.over) {
      const ship = state.ship;
      const blink = ship.invuln > 0 && now % 0.25 < 0.12;
      if (!blink) {
        drawWrapped(ship.pos, 30, () => {
          const cos = Math.cos(ship.angle);
          const sin = Math.sin(ship.angle);
          const pt = (fx: number, fy: number) => ({
            x: ship.pos.x + fx * cos - fy * sin,
            y: ship.pos.y + fx * sin + fy * cos,
          });
          const nose = pt(SHIP_R + 2, 0);
          const rearL = pt(-9, -9);
          const rearR = pt(-9, 9);
          const notch = pt(-5, 0);
          glowStroke(ctx, "#eaffff", 1.6, 1, (c) => {
            c.moveTo(nose.x, nose.y);
            c.lineTo(rearL.x, rearL.y);
            c.lineTo(notch.x, notch.y);
            c.lineTo(rearR.x, rearR.y);
            c.closePath();
          });
          if (ship.thrusting && now % 0.1 < 0.07) {
            const flame = pt(-14 - 5 * ((now * 60) % 1), 0);
            const baseL = pt(-7, -4);
            const baseR = pt(-7, 4);
            glowStroke(ctx, "#ffb347", 1.4, 1, (c) => {
              c.moveTo(baseL.x, baseL.y);
              c.lineTo(flame.x, flame.y);
              c.lineTo(baseR.x, baseR.y);
            });
          }
          if (ship.shield > 0) {
            glowStroke(ctx, "#57d8ff", 1, 0.25 + 0.5 * (ship.shield / MAX_SHIELD), (c) =>
              c.arc(ship.pos.x, ship.pos.y, SHIP_R + 7, 0, Math.PI * 2),
            );
          }
          if (ship.bouncy > 0) {
            const pulse = 0.6 + 0.4 * Math.sin(now * 10);
            glowStroke(ctx, "#57ff7a", 1.4, ship.bouncy < 2 ? pulse * 0.5 : pulse, (c) =>
              c.arc(ship.pos.x, ship.pos.y, SHIP_R + 12, 0, Math.PI * 2),
            );
          }
        });
      }
    }

    ctx.globalCompositeOperation = "source-over";
  }, []);

  // Sync the HUD from the model (cheap: setState bails on identical values).
  const syncHud = useCallback((state: GameState) => {
    setScore(state.score);
    setWave(state.wave);
    setLives(state.lives);
    setShield(state.ship.shield);
    setBouncy(state.ship.bouncy > 0);
    setWeapon(state.weapon);
    setAmmo(state.ammo);
  }, []);

  const startGame = useCallback(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const w = Math.max(320, stage.clientWidth);
    const h = Math.max(240, stage.clientHeight);
    canvas.width = w;
    canvas.height = h;
    const state = initialState(w, h);
    stateRef.current = state;
    starsRef.current = Array.from({ length: 90 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() < 0.25 ? 2 : 1,
    }));
    keysRef.current = { left: false, right: false, thrust: false, fire: false };
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#06080e";
      ctx.fillRect(0, 0, w, h);
    }
    syncHud(state);
    setInitials("");
    trackEvent("game_start", { game: ENTITY });
    setPhase("playing");
  }, [syncHud]);

  // Enter/Space (or gamepad A) starts a game from the idle/saved overlays.
  useEffect(() => {
    if (phase === "idle" || phase === "saved") {
      return attachGameInput({ onConfirm: startGame });
    }
  }, [phase, startGame]);

  // Held-key input while playing. The shared input module is press-based, so
  // rotate/thrust/fire track keydown/keyup here instead.
  useEffect(() => {
    if (phase !== "playing") return;
    const setKey = (e: KeyboardEvent, down: boolean) => {
      const keys = keysRef.current;
      switch (e.key) {
        case "ArrowLeft":
        case "a":
        case "A":
          keys.left = down;
          break;
        case "ArrowRight":
        case "d":
        case "D":
          keys.right = down;
          break;
        case "ArrowUp":
        case "w":
        case "W":
          keys.thrust = down;
          break;
        case " ":
        case "Enter":
          keys.fire = down;
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    const onDown = (e: KeyboardEvent) => setKey(e, true);
    const onUp = (e: KeyboardEvent) => setKey(e, false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [phase]);

  // Main loop: fixed-timestep-ish rAF, gamepad polled per frame.
  useEffect(() => {
    if (phase !== "playing") return;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const keys = keysRef.current;
      const input: InputState = { ...keys };
      for (const pad of navigator.getGamepads()) {
        if (!pad) continue;
        const ax = pad.axes[0] ?? 0;
        input.left ||= ax < -0.5 || Boolean(pad.buttons[14]?.pressed);
        input.right ||= ax > 0.5 || Boolean(pad.buttons[15]?.pressed);
        input.thrust ||= Boolean(
          pad.buttons[12]?.pressed || pad.buttons[7]?.pressed || pad.buttons[1]?.pressed,
        );
        input.fire ||= Boolean(pad.buttons[0]?.pressed);
      }

      const state = stateRef.current;
      if (!state) return;
      step(state, input, dt);
      syncHud(state);
      if (state.over) {
        trackEvent("game_over", { game: ENTITY, score: state.score });
        setPhase("gameover");
        return;
      }
      draw();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [phase, draw, syncHud]);

  // Follow window resizes mid-game: the field really is the whole stage.
  useEffect(() => {
    if (phase !== "playing") return;
    const onResize = () => {
      const stage = stageRef.current;
      const canvas = canvasRef.current;
      const state = stateRef.current;
      if (!stage || !canvas || !state) return;
      canvas.width = Math.max(320, stage.clientWidth);
      canvas.height = Math.max(240, stage.clientHeight);
      state.w = canvas.width;
      state.h = canvas.height;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [phase]);

  // Touch: virtual buttons (shown via CSS only on coarse-pointer devices).
  const bindTouch = (key: keyof InputState) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      keysRef.current[key] = true;
    },
    onPointerUp: () => {
      keysRef.current[key] = false;
    },
    onPointerCancel: () => {
      keysRef.current[key] = false;
    },
  });

  const submitScore = async (e: FormEvent) => {
    e.preventDefault();
    const clean = initials.trim().toUpperCase();
    if (!clean) return;
    try {
      await fetch("/api/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initials: clean, score, game: ENTITY }),
      });
      trackEvent("score_submitted", { game: ENTITY, score, initials: clean });
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
        <span>WAVE {wave}</span>
        <span>
          SHIPS {"▲".repeat(Math.max(0, Math.min(lives, 6)))}
          {lives > 6 ? `×${lives}` : ""}
        </span>
        <span className={styles.shieldPips}>SHIELD {"◆".repeat(shield) || "—"}</span>
        {bouncy && <span className={styles.bouncyTag}>BOUNCY!</span>}
        <span className={styles.weaponTag}>
          {WEAPON_LABEL[weapon]}
          {Number.isFinite(ammo) ? ` ×${ammo}` : ""}
        </span>
      </div>

      <div ref={stageRef} className={styles.stage}>
        <canvas ref={canvasRef} className={styles.canvas} />

        {phase === "playing" && (
          <div className={styles.touchControls}>
            <div className={styles.touchCluster}>
              <button type="button" className={styles.touchButton} {...bindTouch("left")}>
                ⟲
              </button>
              <button type="button" className={styles.touchButton} {...bindTouch("right")}>
                ⟳
              </button>
            </div>
            <div className={styles.touchCluster}>
              <button type="button" className={styles.touchButton} {...bindTouch("thrust")}>
                ▲
              </button>
              <button type="button" className={styles.touchButtonFire} {...bindTouch("fire")}>
                FIRE
              </button>
            </div>
          </div>
        )}

        {phase === "idle" && (
          <div className={styles.overlay}>
            <p className={styles.overlayTitle}>BIG AST TINY EROIDS</p>
            <p>
              Blast the rocks, surf the wrap. Watch for the STARCASTLE — when its spinning shields
              open a hole, a sweeping beam is coming.
            </p>
            <p>
              Grab power-ups: three tiers of laser, machine gun, super bullets, the puffball blast —
              plus shields, bouncy armor and a rare extra ship.
            </p>
            <p>ROTATE ◀ ▶ · THRUST ▲ · FIRE SPACE · gamepad and touch work too.</p>
            <button type="button" className={styles.arcadeButton} onClick={startGame}>
              ▶ START
            </button>
            <FeedbackPanel entity={ENTITY} />
          </div>
        )}

        {phase === "gameover" && (
          <div className={styles.overlay}>
            <p className={styles.overlayTitle}>GAME OVER</p>
            <p>FINAL SCORE: {score}</p>
            <form className={styles.initialsForm} onSubmit={submitScore}>
              <label htmlFor="eroids-initials">ENTER INITIALS:</label>
              <input
                id="eroids-initials"
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
            <p className={styles.overlayTitle}>NICE FLYING!</p>
            <Leaderboard />
            <button type="button" className={styles.arcadeButton} onClick={startGame}>
              ▶ PLAY AGAIN
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The StarCastle: three counter-rotating segmented shield rings, a spinning
 *  core, and the charge/sweep beam telegraphs. */
function drawCastle(
  ctx: CanvasRenderingContext2D,
  castle: Castle,
  now: number,
  drawWrapped: (pos: { x: number; y: number }, r: number, fn: () => void) => void,
) {
  const outer = castle.rings[0]?.r ?? 66;
  drawWrapped(castle.pos, outer + RING_BAND + 10, () => {
    castle.rings.forEach((ring, ri) => {
      const color = RING_COLORS[ri % RING_COLORS.length];
      const arc = (Math.PI * 2) / ring.segs.length;
      const gap = arc * 0.12;
      for (let i = 0; i < ring.segs.length; i++) {
        if (!ring.segs[i]) continue;
        const a0 = ring.angle + i * arc + gap;
        const a1 = ring.angle + (i + 1) * arc - gap;
        glowStroke(ctx, color, 2.2, 1, (c) => c.arc(castle.pos.x, castle.pos.y, ring.r, a0, a1));
      }
    });

    // The core: a slowly spinning triangle that flares while charging.
    const charging = castle.sweep?.phase === "charge";
    const flare = charging ? 0.6 + 0.4 * Math.sin(now * 30) : 0.9;
    glowStroke(ctx, charging ? "#ff3030" : "#ffffff", 1.6, flare, (c) => {
      for (let i = 0; i <= 3; i++) {
        const a = now * 1.5 + (i / 3) * Math.PI * 2;
        const x = castle.pos.x + Math.cos(a) * CORE_R;
        const y = castle.pos.y + Math.sin(a) * CORE_R;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
    });

    const sweep = castle.sweep;
    if (sweep?.phase === "charge") {
      // Telegraph: a thin aiming line flickering toward the ship.
      const len = 2000;
      glowStroke(ctx, "#ff3030", 0.8, 0.35 + 0.3 * Math.sin(now * 25), (c) => {
        c.moveTo(castle.pos.x, castle.pos.y);
        c.lineTo(
          castle.pos.x + Math.cos(sweep.angle) * len,
          castle.pos.y + Math.sin(sweep.angle) * len,
        );
      });
    } else if (sweep?.phase === "fire") {
      const frac = Math.min(1, sweep.t / SWEEP_DURATION);
      const angle = sweep.from + (sweep.to - sweep.from) * frac;
      const len = 3000;
      glowStroke(ctx, "#ff3030", 6, 0.9, (c) => {
        c.moveTo(castle.pos.x, castle.pos.y);
        c.lineTo(castle.pos.x + Math.cos(angle) * len, castle.pos.y + Math.sin(angle) * len);
      });
      glowStroke(ctx, "#ffffff", 1.6, 1, (c) => {
        c.moveTo(castle.pos.x, castle.pos.y);
        c.lineTo(castle.pos.x + Math.cos(angle) * len, castle.pos.y + Math.sin(angle) * len);
      });
    }
  });
}
