import { useCallback, useEffect, useRef, useState, FormEvent } from "react";
import { attachGameInput } from "../input";
import {
  BEAM_TTL,
  Castle,
  GameState,
  InputState,
  MAX_SHIELD,
  NOVA_CHARGE,
  PowerupKind,
  RING_BAND,
  ROID_R,
  SHIP_R,
  CORE_R,
  SUPER_BULLET_R,
  WEAPON_AMMO,
  initialState,
  novaHitR,
  step,
  traceHitscan,
} from "./roidsLogic";
import { Sfx } from "./sfx";
import FeedbackPanel from "../../components/FeedbackPanel";
import VolumeControl from "../../components/VolumeControl";
import { trackEvent } from "../../lib/analytics";
import { recordPlay } from "../../lib/plays";
import styles from "./BigAsterTinyOids.module.css";

// The Big Tiny aesthetic, vector edition: glowing arcade line-art on a black
// field that fills the screen. Every rule lives in roidsLogic.ts (unit
// tested); this file is only pixels, timers, sound and input plumbing.

const ENTITY = "big-aster-tiny-oids";

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

// Rising pickup announcements, in full words.
const FLOATER_LABEL: Record<PowerupKind, string> = {
  shield: "SHIELD +2",
  bouncy: "BOUNCY ARMOR",
  life: "EXTRA SHIP",
  machine: "MACHINE GUN",
  super: "SUPER BULLETS",
  laser: "LASER BOLT",
  superlaser: "SUPER LASER",
  ultralaser: "ULTRA LASER",
  puffball: "PUFFBALL",
};

const RING_COLORS = ["#57ff7a", "#ffce3b", "#ff5757", "#57d8ff", "#ff5af5", "#b06bff"]; // outer → inner

/** Oscilloscope-phosphor stroke: a clearly visible glow underlay ~5× the
 *  line width, a hot inner bloom, then the thin bright core — all additive.
 *  Caller widths are halved here (the "50% thinner" house rule). */
function glowStroke(
  ctx: CanvasRenderingContext2D,
  color: string,
  width: number,
  alpha: number,
  path: (ctx: CanvasRenderingContext2D) => void,
) {
  ctx.beginPath();
  path(ctx);
  const w = width * 0.5;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineWidth = w * 5;
  ctx.globalAlpha = 0.32 * alpha; // the glow underlay
  ctx.stroke();
  ctx.lineWidth = w * 2;
  ctx.globalAlpha = 0.5 * alpha; // hot inner bloom
  ctx.stroke();
  ctx.lineWidth = w;
  ctx.globalAlpha = alpha; // the trace itself
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// Seven-segment vector digits for the in-game score (unit box 0.6 × 1).
const SEG_PTS: Record<string, [number, number, number, number]> = {
  A: [0, 0, 0.6, 0],
  B: [0.6, 0, 0.6, 0.5],
  C: [0.6, 0.5, 0.6, 1],
  D: [0, 1, 0.6, 1],
  E: [0, 0.5, 0, 1],
  F: [0, 0, 0, 0.5],
  G: [0, 0.5, 0.6, 0.5],
};
const DIGIT_SEGS: Record<string, string> = {
  "0": "ABCDEF",
  "1": "BC",
  "2": "ABGED",
  "3": "ABGCD",
  "4": "FGBC",
  "5": "AFGCD",
  "6": "AFGECD",
  "7": "ABC",
  "8": "ABCDEFG",
  "9": "ABCDFG",
};

function drawVectorDigits(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  h: number,
  color: string,
) {
  const advance = h * 0.6 + h * 0.35;
  glowStroke(ctx, color, 1.6, 1, (c) => {
    for (let i = 0; i < text.length; i++) {
      const segs = DIGIT_SEGS[text[i]];
      if (!segs) continue;
      const ox = x + i * advance;
      for (const s of segs) {
        const [x1, y1, x2, y2] = SEG_PTS[s];
        c.moveTo(ox + x1 * h, y + y1 * h);
        c.lineTo(ox + x2 * h, y + y2 * h);
      }
    }
  });
}

export default function BigAsterTinyOids() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState | null>(null);
  const keysRef = useRef<InputState>({ left: false, right: false, thrust: false, fire: false });
  const starsRef = useRef<Array<{ x: number; y: number; r: number }>>([]);
  const sfxRef = useRef<Sfx | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [score, setScore] = useState(0); // mirrored for the overlays; in-game it's vector-drawn
  const [wave, setWave] = useState(1);
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

  // Web Audio lives for the lifetime of the mount.
  useEffect(() => {
    let sfx: Sfx | null = null;
    try {
      sfx = new Sfx(); // no-op in environments without Web Audio (e.g. tests)
      void sfx.load();
      sfxRef.current = sfx;
    } catch {
      sfxRef.current = null;
    }
    return () => {
      sfx?.destroy();
      sfxRef.current = null;
    };
  }, []);

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
        glowStroke(ctx, "#9fd8ff", 1.3, 1, (c) => {
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

    // The StarCastles.
    for (const castle of state.castles) drawCastle(ctx, castle, now, drawWrapped);

    // Novas: the castle's swelling radiant bullets (they never wrap). The
    // radiation lines trace from the center out to the kill radius — if a
    // line can touch you, so can the nova.
    for (const nova of state.novas) {
      glowStroke(ctx, "#ffffff", 1.6, 1, (c) =>
        c.arc(nova.pos.x, nova.pos.y, Math.max(1.5, nova.r * 0.35), 0, Math.PI * 2),
      );
      glowStroke(ctx, "#ff5757", 1.8, 0.9, (c) =>
        c.arc(nova.pos.x, nova.pos.y, nova.r, 0, Math.PI * 2),
      );
      const rays = 12;
      const reach = novaHitR(nova.r);
      glowStroke(ctx, "#ff9a57", 1, 0.9, (c) => {
        for (let i = 0; i < rays; i++) {
          const a = nova.age * 2.2 + (i / rays) * Math.PI * 2;
          const flick = 0.6 + 0.4 * Math.sin(now * 30 + i * 2.1);
          const r1 = reach * flick;
          c.moveTo(nova.pos.x, nova.pos.y);
          c.lineTo(nova.pos.x + Math.cos(a) * r1, nova.pos.y + Math.sin(a) * r1);
        }
      });
    }

    // Laser sight: while a laser tier is armed, a faint line previews exactly
    // where the shot will go (including pierces and the ultra's wrap).
    const armed = state.weapon;
    if (
      (armed === "laser" || armed === "superlaser" || armed === "ultralaser") &&
      state.respawn <= 0 &&
      !state.over
    ) {
      const sightColor =
        armed === "laser" ? "#ff4a4a" : armed === "superlaser" ? "#ff2d95" : "#b06bff";
      for (const seg of traceHitscan(state, armed).segs) {
        glowStroke(ctx, sightColor, 0.8, 0.14, (c) => {
          c.moveTo(seg.a.x, seg.a.y);
          c.lineTo(seg.b.x, seg.b.y);
        });
      }
    }

    // Beams (lasers + already-applied damage; these just afterglow).
    for (const beam of state.beams) {
      const fade = Math.max(0, beam.ttl / BEAM_TTL);
      beam.segs.forEach((seg, i) => {
        const color =
          beam.kind === "laser"
            ? "#ff4a4a"
            : beam.kind === "superlaser"
              ? "#ff2d95"
              : `hsl(${(i * 47 + now * 300) % 360} 100% 65%)`;
        glowStroke(ctx, color, beam.kind === "laser" ? 1.3 : 1.8, fade, (c) => {
          c.moveTo(seg.a.x, seg.a.y);
          c.lineTo(seg.b.x, seg.b.y);
        });
      });
    }

    // Bullets.
    for (const bullet of state.bullets) {
      const spec =
        bullet.kind === "enemy"
          ? { color: "#ff5757", r: 1.6 }
          : bullet.kind === "super"
            ? { color: "#ff5af5", r: SUPER_BULLET_R }
            : bullet.kind === "machine"
              ? { color: "#ffa03c", r: 1.3 }
              : { color: "#ffce3b", r: 1.5 };
      drawWrapped(bullet.pos, spec.r + 4, () => {
        glowStroke(ctx, spec.color, Math.min(spec.r, 3), 1, (c) =>
          c.arc(bullet.pos.x, bullet.pos.y, spec.r, 0, Math.PI * 2),
        );
      });
    }

    // Blasts (puffball rings + wreck flashes).
    for (const blast of state.blasts) {
      const t = blast.age / blast.ttl;
      const color = blast.kind === "puff" ? "#7df9ff" : "#ffce3b";
      glowStroke(ctx, color, 2, 1 - t, (c) =>
        c.arc(blast.pos.x, blast.pos.y, blast.maxR * t, 0, Math.PI * 2),
      );
    }

    // Explosion debris: tumbling line shards that burn out.
    for (const shard of state.debris) {
      const t = shard.age / shard.ttl;
      const dx = (Math.cos(shard.angle) * shard.len) / 2;
      const dy = (Math.sin(shard.angle) * shard.len) / 2;
      glowStroke(ctx, "#9fd8ff", 0.9, 1 - t, (c) => {
        c.moveTo(shard.pos.x - dx, shard.pos.y - dy);
        c.lineTo(shard.pos.x + dx, shard.pos.y + dy);
      });
    }

    // Powerups: glowing hexagons with a letter inside.
    for (const pu of state.powerups) {
      const { label, color } = POWERUP_STYLE[pu.kind];
      const blink = pu.ttl < 3 && now % 0.4 < 0.2 ? 0.25 : 1;
      drawWrapped(pu.pos, 10, () => {
        glowStroke(ctx, color, 1.2, blink, (c) => {
          for (let i = 0; i <= 6; i++) {
            const a = now * 0.8 + (i / 6) * Math.PI * 2;
            const x = pu.pos.x + Math.cos(a) * 7;
            const y = pu.pos.y + Math.sin(a) * 7;
            if (i === 0) c.moveTo(x, y);
            else c.lineTo(x, y);
          }
        });
        ctx.fillStyle = color;
        ctx.globalAlpha = blink;
        ctx.font = "bold 7px 'Courier New', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, pu.pos.x, pu.pos.y + 0.5);
        ctx.globalAlpha = 1;
      });
    }

    // Rising pickup announcements.
    for (const floater of state.floaters) {
      const t = floater.age / floater.ttl;
      const { color } = POWERUP_STYLE[floater.kind];
      ctx.fillStyle = color;
      ctx.globalAlpha = 1 - t;
      ctx.font = "bold 11px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(FLOATER_LABEL[floater.kind], floater.pos.x, floater.pos.y - 12 - t * 30);
      ctx.globalAlpha = 1;
    }

    // The ship.
    if (state.respawn <= 0 && !state.over) {
      const ship = state.ship;
      const blink = ship.invuln > 0 && now % 0.25 < 0.12;
      if (!blink) {
        drawWrapped(ship.pos, 20, () => {
          const cos = Math.cos(ship.angle);
          const sin = Math.sin(ship.angle);
          const pt = (fx: number, fy: number) => ({
            x: ship.pos.x + fx * cos - fy * sin,
            y: ship.pos.y + fx * sin + fy * cos,
          });
          const nose = pt(SHIP_R + 1, 0);
          const rearL = pt(-4.5, -4.5);
          const rearR = pt(-4.5, 4.5);
          const notch = pt(-2.5, 0);
          glowStroke(ctx, "#eaffff", 1.3, 1, (c) => {
            c.moveTo(nose.x, nose.y);
            c.lineTo(rearL.x, rearL.y);
            c.lineTo(notch.x, notch.y);
            c.lineTo(rearR.x, rearR.y);
            c.closePath();
          });
          if (ship.thrusting && now % 0.1 < 0.07) {
            const flame = pt(-7 - 2.5 * ((now * 60) % 1), 0);
            const baseL = pt(-3.5, -2);
            const baseR = pt(-3.5, 2);
            glowStroke(ctx, "#ffb347", 1.2, 1, (c) => {
              c.moveTo(baseL.x, baseL.y);
              c.lineTo(flame.x, flame.y);
              c.lineTo(baseR.x, baseR.y);
            });
          }
          if (ship.shield > 0) {
            glowStroke(ctx, "#57d8ff", 0.9, 0.25 + 0.5 * (ship.shield / MAX_SHIELD), (c) =>
              c.arc(ship.pos.x, ship.pos.y, SHIP_R + 4, 0, Math.PI * 2),
            );
          }
          if (ship.bouncy > 0) {
            const pulse = 0.6 + 0.4 * Math.sin(now * 10);
            glowStroke(ctx, "#57ff7a", 1.2, ship.bouncy < 2 ? pulse * 0.5 : pulse, (c) =>
              c.arc(ship.pos.x, ship.pos.y, SHIP_R + 7, 0, Math.PI * 2),
            );
          }
          // A weapon powerup is armed: red dot on the nose, blinking faster
          // as the magazine runs low.
          const armed = state.weapon;
          if (armed !== "bullet") {
            const low = state.ammo / WEAPON_AMMO[armed] <= 1 / 3;
            const period = low ? 0.14 : 0.5;
            if (now % period < period / 2) {
              glowStroke(ctx, "#ff3030", 1.6, 1, (c) => c.arc(nose.x, nose.y, 1.6, 0, Math.PI * 2));
            }
          }
        });
      }
    }

    // In-game vector HUD: the score in seven-segment digits, remaining ships
    // as little hulls beneath it. Drawn last so it rides above the action.
    drawVectorDigits(ctx, String(state.score).padStart(6, "0"), 12, 12, 16, "#ffce3b");
    for (let i = 0; i < Math.min(state.lives, 8); i++) {
      const x = 12 + i * 14;
      const y = 38;
      glowStroke(ctx, "#eaffff", 1.1, 1, (c) => {
        c.moveTo(x + 4, y);
        c.lineTo(x, y + 11);
        c.lineTo(x + 4, y + 8);
        c.lineTo(x + 8, y + 11);
        c.closePath();
      });
    }

    ctx.globalCompositeOperation = "source-over";
  }, []);

  // Sync the HUD from the model (cheap: setState bails on identical values).
  const syncHud = useCallback((state: GameState) => {
    setScore(state.score);
    setWave(state.wave);
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
    sfxRef.current?.resume();
    syncHud(state);
    setInitials("");
    trackEvent("game_start", { game: ENTITY });
    recordPlay(ENTITY);
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
      // One shot per distinct sound per frame, so a puffball clearing a dozen
      // rocks doesn't fire a dozen overlapping booms.
      for (const event of new Set(state.events)) sfxRef.current?.play(event);
      // The engine rumble loops for exactly as long as the ship is thrusting,
      // and the deep synth buzz for as long as any nova is in flight.
      sfxRef.current?.setLoop("thrust", state.respawn <= 0 && !state.over && state.ship.thrusting);
      sfxRef.current?.setLoop("nova", state.novas.length > 0);
      syncHud(state);
      if (state.over) {
        sfxRef.current?.setLoop("thrust", false);
        sfxRef.current?.setLoop("nova", false);
        trackEvent("game_over", { game: ENTITY, score: state.score });
        setPhase("gameover");
        return;
      }
      draw();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      sfxRef.current?.setLoop("thrust", false);
      sfxRef.current?.setLoop("nova", false);
    };
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
        <span>WAVE {wave}</span>
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
            <p className={styles.overlayTitle}>BIG ASTER TINY OIDS</p>
            <FeedbackPanel entity={ENTITY} />
            <p>
              Blast the rocks, surf the wrap. Watch for the STARCASTLES — when their spinning
              shields open a hole, a sweeping beam is coming. Higher waves mean more castles with
              thicker shields, all at once.
            </p>
            <p>
              Grab power-ups: three tiers of laser, machine gun, super bullets, the puffball blast —
              plus shields, bouncy armor and a rare extra ship.
            </p>
            <p>ROTATE ◀ ▶ · THRUST ▲ · FIRE SPACE · gamepad and touch work too.</p>
            <button type="button" className={styles.arcadeButton} onClick={startGame}>
              ▶ START
            </button>
            <VolumeControl />
          </div>
        )}

        {phase === "gameover" && (
          <div className={styles.overlay}>
            <p className={styles.overlayTitle}>GAME OVER</p>
            <p>FINAL SCORE: {score}</p>
            <form className={styles.initialsForm} onSubmit={submitScore}>
              <label htmlFor="oids-initials">ENTER INITIALS:</label>
              <input
                id="oids-initials"
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

/** A StarCastle: counter-rotating rings of flat, gapless shield segments
 *  around a little winged core ship, plus the charge/sweep beam telegraphs. */
function drawCastle(
  ctx: CanvasRenderingContext2D,
  castle: Castle,
  now: number,
  drawWrapped: (pos: { x: number; y: number }, r: number, fn: () => void) => void,
) {
  const outer = castle.rings[0]?.r ?? 26;
  drawWrapped(castle.pos, outer + RING_BAND + 8, () => {
    // Shield rings: each segment is a flat chord between adjacent ring
    // vertices, drawn edge-to-edge so intact stretches read as one solid wall.
    castle.rings.forEach((ring, ri) => {
      const color = RING_COLORS[ri % RING_COLORS.length];
      const arc = (Math.PI * 2) / ring.segs.length;
      for (let i = 0; i < ring.segs.length; i++) {
        if (!ring.segs[i]) continue;
        const a0 = ring.angle + i * arc;
        const a1 = a0 + arc;
        glowStroke(ctx, color, 1.8, 1, (c) => {
          c.moveTo(castle.pos.x + Math.cos(a0) * ring.r, castle.pos.y + Math.sin(a0) * ring.r);
          c.lineTo(castle.pos.x + Math.cos(a1) * ring.r, castle.pos.y + Math.sin(a1) * ring.r);
        });
      }
    });

    // The core: a tiny winged gunship that fires the way it points.
    const charging = castle.charge != null;
    const flare = charging ? 0.6 + 0.4 * Math.sin(now * 30) : 0.9;
    const color = charging ? "#ff3030" : "#ffffff";
    const cos = Math.cos(castle.coreAngle);
    const sin = Math.sin(castle.coreAngle);
    const pt = (fx: number, fy: number) => ({
      x: castle.pos.x + fx * cos - fy * sin,
      y: castle.pos.y + fx * sin + fy * cos,
    });
    // Body.
    const nose = pt(CORE_R + 1, 0);
    const rearL = pt(-CORE_R * 0.7, -CORE_R * 0.7);
    const rearR = pt(-CORE_R * 0.7, CORE_R * 0.7);
    glowStroke(ctx, color, 1.3, flare, (c) => {
      c.moveTo(nose.x, nose.y);
      c.lineTo(rearL.x, rearL.y);
      c.lineTo(rearR.x, rearR.y);
      c.closePath();
    });
    // Wings.
    glowStroke(ctx, color, 1.1, flare, (c) => {
      const wl0 = pt(-1, -CORE_R * 0.6);
      const wl1 = pt(-3, -CORE_R * 1.4);
      const wr0 = pt(-1, CORE_R * 0.6);
      const wr1 = pt(-3, CORE_R * 1.4);
      c.moveTo(wl0.x, wl0.y);
      c.lineTo(wl1.x, wl1.y);
      c.moveTo(wr0.x, wr0.y);
      c.lineTo(wr1.x, wr1.y);
    });
    // Gun barrel.
    glowStroke(ctx, color, 1.1, flare, (c) => {
      const tip = pt(CORE_R + 5, 0);
      c.moveTo(nose.x, nose.y);
      c.lineTo(tip.x, tip.y);
    });

    const charge = castle.charge;
    if (charge) {
      // Telegraph: a proto-nova swelling on the core (no beams, ever) —
      // a pulsing red orb with sprouting radiance stubs.
      const t = Math.min(1, charge.t / NOVA_CHARGE);
      const r = 2 + 7 * t + 1.2 * Math.sin(now * 30);
      glowStroke(ctx, "#ff3030", 1.6, 0.5 + 0.5 * t, (c) =>
        c.arc(castle.pos.x, castle.pos.y, Math.max(1, r), 0, Math.PI * 2),
      );
      glowStroke(ctx, "#ff9a57", 0.9, 0.4 + 0.5 * t, (c) => {
        for (let i = 0; i < 8; i++) {
          const a = now * 4 + (i / 8) * Math.PI * 2;
          const r1 = r + 2 + 4 * t * (0.6 + 0.4 * Math.sin(now * 25 + i * 1.7));
          c.moveTo(castle.pos.x + Math.cos(a) * (r + 1), castle.pos.y + Math.sin(a) * (r + 1));
          c.lineTo(castle.pos.x + Math.cos(a) * r1, castle.pos.y + Math.sin(a) * r1);
        }
      });
    }
  });
}
