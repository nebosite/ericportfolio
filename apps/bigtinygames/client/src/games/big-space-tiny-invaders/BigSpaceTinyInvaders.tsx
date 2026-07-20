import { useCallback, useEffect, useRef, useState, FormEvent } from "react";
import { Link } from "react-router-dom";
import { attachGameInput } from "../input";
import {
  GameState,
  InputState,
  PowerupKind,
  SPACING,
  UFO_LASER_DESCEND,
  UFO_Y,
  groundY,
  initialState,
  step,
} from "./invadersLogic";
import { Sfx } from "./sfx";
import FeedbackPanel from "../../components/FeedbackPanel";
import VolumeControl from "../../components/VolumeControl";
import { trackEvent } from "../../lib/analytics";
import { recordPlay } from "../../lib/plays";
import styles from "./BigSpaceTinyInvaders.module.css";

// The Big Tiny aesthetic at maximum scale: a horde of thousands of tiny
// pixel invaders. Rules live in invadersLogic.ts (unit tested); this file is
// pixels, timers, sound and input. The key performance trick: the rigid
// formation is pre-rendered onto two offscreen canvases (one per animation
// frame) and blitted with one drawImage per frame — deaths and arrivals just
// patch 8px cells, driven by state.deadSlots / state.bornSlots.

const ENTITY = "big-space-tiny-invaders";

type Phase = "idle" | "playing" | "gameover" | "saved";

interface ScoreRow {
  id: number;
  initials: string;
  score: number;
  created_at: string;
}

const WEAPON_LABEL: Record<GameState["weapon"], string> = {
  gun: "PEA CANNON",
  sprinkler: "SPRINKLER",
  chain: "LIGHTNING BURST",
};

const PICKUP_STYLE: Record<PowerupKind, { label: string; color: string }> = {
  missiles: { label: "M", color: "#ffce3b" },
  sprinkler: { label: "S", color: "#57d8ff" },
  chain: { label: "C", color: "#b06bff" },
  air: { label: "A", color: "#ff9a57" },
  nuke: { label: "N", color: "#ff5757" },
  wall: { label: "W", color: "#2f9e4c" },
  life: { label: "♥", color: "#57ff7a" },
};

// Rising pickup announcements, in full words.
const FLOATER_LABEL: Record<PowerupKind, string> = {
  missiles: "MISSILE BOOST",
  sprinkler: "SPRINKLER GUN",
  chain: "LIGHTNING BURST",
  air: "AIR SUPPORT +1",
  nuke: "GROUND NUKE",
  wall: "SHIELDS REBUILT",
  life: "EXTRA SHIP",
};

// Title-screen legend data.
const ENEMY_LEGEND: Array<{ label: string; score: string; color?: string; ufo?: boolean }> = [
  { label: "Grunt", score: "10", color: "#57ff7a" },
  { label: "Soldier", score: "20", color: "#57d8ff" },
  { label: "Elite", score: "30", color: "#ff5af5" },
  { label: "Swooper", score: "50", color: "#ffffff" },
  { label: "UFO", score: "1000", ufo: true },
];
const POWERUP_LEGEND: Array<{ kind: PowerupKind; desc: string }> = [
  { kind: "sprinkler", desc: "Sprinkler" },
  { kind: "chain", desc: "Lightning Burst" },
  { kind: "missiles", desc: "Missile boost" },
  { kind: "air", desc: "Air support" },
  { kind: "nuke", desc: "Ground nuke" },
  { kind: "wall", desc: "Rebuild shields" },
  { kind: "life", desc: "Extra ship" },
];

// 7×7 one-bit invader glyphs, two animation frames each, by type (bottom /
// middle / top tier). Drawn in code so they're easy to tweak.
const INVADER_SPRITES: string[][][] = [
  [
    ["..###..", ".#####.", "#.###.#", "#######", ".#.#.#.", "#.....#", ".#...#."],
    ["..###..", ".#####.", "#.###.#", "#######", ".#.#.#.", ".#...#.", "#.....#"],
  ],
  [
    [".#...#.", "..#.#..", ".#####.", "##.#.##", "#######", "#.###.#", "#.....#"],
    [".#...#.", "#.#.#.#", ".#####.", "##.#.##", "#######", ".#...#.", "..#.#.."],
  ],
  [
    ["...#...", "..###..", ".##.##.", "#######", "##.#.##", "..#.#..", ".#...#."],
    ["...#...", "..###..", ".##.##.", "#######", "##.#.##", ".#...#.", "#..#..#"],
  ],
];
const TYPE_COLORS = ["#57ff7a", "#57d8ff", "#ff5af5"];

// Scrap sparkle: the smooth blue→white fade is quantized into these shades.
const SCRAP_COLORS = ["#4f8dff", "#74a9ff", "#9cc4ff", "#cfe3ff", "#ffffff"];

function makeSprite(pattern: string[], color: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 7;
  c.height = 7;
  const ctx = c.getContext("2d"); // null only in canvas-less test environments
  if (ctx) {
    ctx.fillStyle = color;
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        if (pattern[y][x] === "#") ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return c;
}

// The current shooting weapon's icon, drawn in the status band under the ship.
function drawWeaponIcon(
  ctx: CanvasRenderingContext2D,
  weapon: "gun" | "sprinkler" | "chain",
  cx: number,
  cy: number,
  now: number,
): void {
  ctx.save();
  ctx.lineWidth = 1.5;
  if (weapon === "gun") {
    // A single upward dart.
    ctx.fillStyle = "#ffce3b";
    ctx.beginPath();
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx - 3, cy + 4);
    ctx.lineTo(cx + 3, cy + 4);
    ctx.closePath();
    ctx.fill();
  } else if (weapon === "sprinkler") {
    // A fan of three spraying darts.
    ctx.strokeStyle = "#57d8ff";
    ctx.beginPath();
    for (const a of [-0.5, 0, 0.5]) {
      ctx.moveTo(cx, cy + 4);
      ctx.lineTo(cx + Math.sin(a) * 8, cy + 4 - Math.cos(a) * 9);
    }
    ctx.stroke();
  } else {
    // A crackling zigzag bolt.
    ctx.strokeStyle = now % 0.16 < 0.08 ? "#dff4ff" : "#4fb8ff";
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy - 5);
    ctx.lineTo(cx + 1, cy - 1);
    ctx.lineTo(cx - 2, cy + 1);
    ctx.lineTo(cx + 4, cy + 5);
    ctx.stroke();
  }
  ctx.restore();
}

export default function BigSpaceTinyInvaders() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState | null>(null);
  const keysRef = useRef({ left: false, right: false, fire: false });
  const oneShotRef = useRef<{
    missile: { x: number; y: number } | null;
    air: boolean;
    nuke: boolean;
    selectWeapon: boolean;
  }>({ missile: null, air: false, nuke: false, selectWeapon: false });
  const spritesRef = useRef<HTMLCanvasElement[][]>([]);
  const formCanvasRef = useRef<HTMLCanvasElement[]>([]); // one per animation frame
  const shieldCanvasesRef = useRef<HTMLCanvasElement[]>([]);
  const bucketsRef = useRef<Uint8Array | null>(null);
  const lastLevelRef = useRef(0);
  const sirenFadingRef = useRef(false);
  const sfxRef = useRef<Sfx | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [score, setScore] = useState(0); // mirrored for the overlays; in-game the HUD is on-canvas
  const [initials, setInitials] = useState("");
  const [leaderboard, setLeaderboard] = useState<ScoreRow[]>([]);

  const loadLeaderboard = useCallback(() => {
    fetch(`/api/leaderboard?game=${ENTITY}`)
      .then((res) => res.json())
      .then((data: ScoreRow[]) => setLeaderboard(data))
      .catch(() => {});
  }, []);

  useEffect(loadLeaderboard, [loadLeaderboard]);

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

  /** (Re)paint the whole formation onto the two offscreen frames. */
  const rebuildFormation = useCallback((state: GameState) => {
    const form = state.form;
    const sprites = spritesRef.current;
    const frames: HTMLCanvasElement[] = [];
    for (let frame = 0; frame < 2; frame++) {
      const c = document.createElement("canvas");
      c.width = form.cols * SPACING;
      c.height = form.rows * SPACING;
      const ctx = c.getContext("2d");
      if (ctx) {
        for (let row = 0; row < form.rows; row++) {
          const type = row < form.rows * 0.2 ? 2 : row < form.rows * 0.55 ? 1 : 0;
          const sprite = sprites[type]?.[frame];
          if (!sprite) continue;
          for (let col = 0; col < form.cols; col++) {
            if (form.alive[row * form.cols + col]) {
              ctx.drawImage(sprite, col * SPACING, row * SPACING);
            }
          }
        }
      }
      frames.push(c);
    }
    formCanvasRef.current = frames;
  }, []);

  /** Apply this step's deaths/births to the offscreen frames (cheap). */
  const patchFormation = useCallback((state: GameState) => {
    const frames = formCanvasRef.current;
    if (frames.length < 2) return;
    const form = state.form;
    for (const idx of state.deadSlots) {
      const col = idx % form.cols;
      const row = (idx / form.cols) | 0;
      for (const frame of frames) {
        frame.getContext("2d")?.clearRect(col * SPACING, row * SPACING, SPACING, SPACING);
      }
    }
    for (const idx of state.bornSlots) {
      const col = idx % form.cols;
      const row = (idx / form.cols) | 0;
      const type = row < form.rows * 0.2 ? 2 : row < form.rows * 0.55 ? 1 : 0;
      for (let f = 0; f < 2; f++) {
        const sprite = spritesRef.current[type]?.[f];
        if (sprite) frames[f].getContext("2d")?.drawImage(sprite, col * SPACING, row * SPACING);
      }
    }
  }, []);

  const repaintShield = useCallback((state: GameState, i: number) => {
    const shield = state.shields[i];
    let c = shieldCanvasesRef.current[i];
    if (!c) {
      c = document.createElement("canvas");
      c.width = shield.cellsW * 2;
      c.height = shield.cellsH * 2;
      shieldCanvasesRef.current[i] = c;
    }
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = "#2f9e4c";
      for (let cy = 0; cy < shield.cellsH; cy++) {
        for (let cx = 0; cx < shield.cellsW; cx++) {
          if (shield.cells[cy * shield.cellsW + cx]) ctx.fillRect(cx * 2, cy * 2, 2, 2);
        }
      }
    }
    shield.dirty = false;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const state = stateRef.current;
    const now = performance.now() / 1000;
    ctx.fillStyle = "#06080e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!state) return;
    const ground = groundY(state.h);

    // Starfield (cheap deterministic scatter).
    ctx.fillStyle = "#39415e";
    for (let i = 0; i < 70; i++) {
      const x = ((i * 733) % state.w) + ((i * 149) % 7);
      const y = (i * 397) % (state.h - 60);
      ctx.fillRect(x, y, 1, 1);
    }

    // Ground.
    ctx.fillStyle = "#2f9e4c";
    ctx.fillRect(0, ground, state.w, 2);

    // The horde: one blit.
    const frames = formCanvasRef.current;
    if (frames.length === 2 && state.form.aliveCount > 0) {
      const frame = frames[Math.floor(now * 2) % 2];
      ctx.drawImage(frame, Math.round(state.form.x), Math.round(state.form.y));
    }

    // Shields.
    state.shields.forEach((shield, i) => {
      if (shield.dirty || !shieldCanvasesRef.current[i]) repaintShield(state, i);
      ctx.drawImage(shieldCanvasesRef.current[i], Math.round(shield.x), Math.round(shield.y));
    });

    // Scrap grains: sparkly blue/white, each fading smoothly between colors
    // on its own 200-400ms cycle. Grains are bucketed by their current shade
    // so the whole pool still draws in a handful of batched passes.
    const s = state.scrap;
    let buckets = bucketsRef.current;
    if (!buckets || buckets.length < s.count) {
      buckets = new Uint8Array(s.x.length);
      bucketsRef.current = buckets;
    }
    for (let k = 0; k < s.count; k++) {
      const period = 0.2 + s.seed[k] * 0.2; // 200-400ms per fade cycle
      const tri = 0.5 + 0.5 * Math.sin((now / period + s.seed[k] * 17) * Math.PI * 2);
      buckets[k] = Math.min(SCRAP_COLORS.length - 1, (tri * SCRAP_COLORS.length) | 0);
    }
    for (let b = 0; b < SCRAP_COLORS.length; b++) {
      ctx.fillStyle = SCRAP_COLORS[b];
      for (let k = 0; k < s.count; k++) {
        if (buckets[k] === b) ctx.fillRect(s.x[k], s.y[k], 1.5, 1.5);
      }
    }

    // Flyers.
    for (const f of state.flyers) {
      const sprite = spritesRef.current[f.type]?.[Math.floor(now * 6) % 2];
      if (sprite) ctx.drawImage(sprite, Math.round(f.x - 3.5), Math.round(f.y - 3.5));
    }

    // UFOs + their lasers.
    for (const u of state.ufos) {
      // The descending beam, drawn first so the saucer rides on top.
      if (u.laser > 0) {
        const frontY = UFO_Y + (ground - UFO_Y) * Math.min(1, u.laser / UFO_LASER_DESCEND);
        const top = u.y + 3;
        const len = Math.max(0, frontY - top);
        const wob = 3 + Math.sin(now * 40) * 1.6;
        // Wide flickering glow.
        ctx.fillStyle = "#ff7a7a";
        ctx.globalAlpha = 0.35 + 0.2 * Math.sin(now * 33);
        ctx.fillRect(Math.round(u.x - wob), top, Math.round(wob * 2), len);
        // Saturated red body.
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = "#ff2020";
        ctx.fillRect(Math.round(u.x - 2), top, 4, len);
        // Hot white core.
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(Math.round(u.x - 1), top, 2, len);
        // Blazing leading front crawling down the screen.
        ctx.globalAlpha = 0.7 + 0.3 * Math.sin(now * 55);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(Math.round(u.x - wob - 1), Math.round(frontY - 2), Math.round(wob * 2 + 2), 5);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = u.charge > 0 && now % 0.16 < 0.08 ? "#ffffff" : "#ff5757";
      ctx.fillRect(Math.round(u.x - 8), Math.round(u.y - 3), 16, 5);
      ctx.fillRect(Math.round(u.x - 4), Math.round(u.y - 6), 8, 3);
    }

    // Player bullets — chain rounds buzz with crackly blue energy spikes.
    for (const b of state.bullets) {
      if (b.chain) {
        ctx.fillStyle = "#dff4ff";
        ctx.fillRect(b.x - 1.5, b.y - 3, 3, 6);
        ctx.strokeStyle = now % 0.06 < 0.03 ? "#9fe0ff" : "#4fb8ff";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
          const a = (((k * 997 + now * 1300) % 100) / 100) * Math.PI * 2;
          const r = 4 + (((k * 331 + now * 900) % 5) | 0);
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r);
        }
        ctx.stroke();
      } else {
        ctx.fillStyle = "#ffce3b";
        ctx.fillRect(b.x - 1, b.y - 3, 2, 5);
      }
    }
    // Enemy bullets: bright hot-red darts with a white-hot core, so they can
    // never be mistaken for the dim blue scrap grains.
    for (const e of state.ebullets) {
      ctx.fillStyle = "#ff2828";
      ctx.fillRect(e.x - 1.5, e.y - 4, 3, 8);
      ctx.fillStyle = "#ffdada";
      ctx.fillRect(e.x - 0.5, e.y - 3, 1.5, 6);
    }

    // Missiles gliding their bezier, with a short exhaust streak along it,
    // plus a flashing cross marking each one's target.
    for (const m of state.missiles) {
      const tail = Math.max(0, m.u - 0.06);
      const v = 1 - tail;
      const tx = v * v * m.sx + 2 * v * tail * m.cx + tail * tail * m.tx;
      const ty = v * v * m.sy + 2 * v * tail * m.cy + tail * tail * m.ty;
      ctx.strokeStyle = "#9a8250";
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(m.x - 1.5, m.y - 1.5, 3, 3);
      // Target reticle: a flashing cross where this missile is headed.
      if (now % 0.24 < 0.14) {
        ctx.strokeStyle = "#ff5757";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(m.tx - 7, m.ty);
        ctx.lineTo(m.tx + 7, m.ty);
        ctx.moveTo(m.tx, m.ty - 7);
        ctx.lineTo(m.tx, m.ty + 7);
        ctx.stroke();
      }
    }

    // Nuke fuses: a blinking charge on the ground with countdown, then rising
    // after detonation.
    for (const fuse of state.fuses) {
      const fast = !fuse.blasted && fuse.fuse < 1;
      ctx.fillStyle = "#ffb04733";
      ctx.fillRect(fuse.x - 1, fuse.y, 2, 10); // exhaust trail below it
      ctx.fillStyle = now % (fast ? 0.12 : 0.3) < (fast ? 0.06 : 0.15) ? "#ffffff" : "#ff5757";
      ctx.fillRect(fuse.x - 3, fuse.y - 4, 6, 6);
      if (!fuse.blasted) {
        // Countdown seconds above the charge.
        const secs = Math.ceil(fuse.fuse);
        ctx.font = "bold 14px 'Courier New', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = "rgba(0,0,0,0.8)";
        ctx.fillText(String(secs), fuse.x + 1, fuse.y - 5 + 1);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(String(secs), fuse.x, fuse.y - 5);
      }
    }

    // Air-support missiles raining down.
    ctx.fillStyle = "#ffd0a0";
    for (const m of state.airMissiles) {
      if (m.y < -2) continue;
      ctx.fillRect(m.x - 1, m.y - 4, 2, 6);
    }

    // Chain lightning: each fork leaves a crackly blue bolt, re-jittered every
    // frame so it flickers as it fades.
    if (state.bolts.length > 0) {
      ctx.strokeStyle = "#b8e6ff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const bolt of state.bolts) {
        const mx = (bolt.ax + bolt.bx) / 2 + (((now * 991) % 9) - 4);
        const my = (bolt.ay + bolt.by) / 2 + (((now * 743) % 9) - 4);
        ctx.moveTo(bolt.ax, bolt.ay);
        ctx.lineTo(mx, my);
        ctx.lineTo(bolt.bx, bolt.by);
      }
      ctx.globalAlpha = 0.55 + 0.35 * Math.sin(now * 40);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Player-death fireworks.
    for (const fw of state.fireworks) {
      ctx.fillStyle = `hsl(${fw.hue} 100% 65%)`;
      ctx.globalAlpha = Math.max(0, 1 - fw.age / fw.ttl);
      ctx.fillRect(fw.x - 1, fw.y - 1, 2, 2);
    }
    ctx.globalAlpha = 1;

    // Molten ground left by nukes — glowing lava that burns the ship.
    for (const lava of state.lavas) {
      const t = lava.age / lava.ttl;
      const heat = 1 - t; // cools as it ages
      const y0 = ground - 3;
      const h = 6;
      for (let px = -lava.halfW; px < lava.halfW; px += 4) {
        const flick = 0.5 + 0.5 * Math.sin(now * 18 + px * 0.5);
        const g = Math.round(60 + 140 * flick * heat);
        ctx.fillStyle = `rgb(255,${g},20)`;
        ctx.globalAlpha = 0.5 + 0.5 * heat;
        ctx.fillRect(lava.x + px, y0 - Math.round(flick * 3 * heat), 4, h + Math.round(flick * 3));
      }
      ctx.globalAlpha = 0.25 * heat;
      ctx.fillStyle = "#ffd060";
      ctx.fillRect(lava.x - lava.halfW, y0 - 8, lava.halfW * 2, 4);
      ctx.globalAlpha = 1;
    }

    // Blasts: missile rings, and the nuke's plasma-filled hemisphere.
    for (const blast of state.blasts) {
      const r = blast.maxR * Math.min(1, blast.age / blast.ttl);
      const fade = 1 - blast.age / blast.ttl;
      if (blast.kind === "nuke") {
        // Fill the dome with churning fiery plasma: nested flickering rings
        // from white-hot core out to a deep-red rim.
        const rings = 7;
        for (let k = rings; k >= 1; k--) {
          const rr = (r * k) / rings;
          const f = k / rings; // 1 = outer
          const flick = 0.75 + 0.25 * Math.sin(now * 30 + k * 1.7);
          const cr = 255;
          const cg = Math.round((230 - 170 * f) * flick);
          const cb = Math.round((120 - 110 * f) * flick);
          ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
          ctx.globalAlpha = (0.16 + 0.5 * (1 - f)) * (0.5 + 0.5 * fade);
          ctx.beginPath();
          ctx.arc(blast.x, blast.y, rr, Math.PI, 2 * Math.PI);
          ctx.fill();
        }
        // Shock rim.
        ctx.strokeStyle = "#fff2c0";
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.5 + 0.5 * fade;
        ctx.beginPath();
        ctx.arc(blast.x, blast.y, r, Math.PI, 2 * Math.PI);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = "#7df9ff";
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.4 + 0.6 * fade;
        ctx.beginPath();
        ctx.arc(blast.x, blast.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.15 * fade;
        ctx.fillStyle = "#7df9ff";
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Falling / landed pickups (blinking when about to fade away).
    for (const pk of state.pickups) {
      if (pk.groundTtl < 1.5 && now % 0.24 < 0.1) continue;
      const { label, color } = PICKUP_STYLE[pk.kind];
      ctx.fillStyle = "#0d0d14";
      ctx.fillRect(pk.x - 5, pk.y - 5, 10, 10);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(pk.x - 5, pk.y - 5, 10, 10);
      ctx.fillStyle = color;
      ctx.font = "bold 7px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, pk.x, pk.y + 0.5);
    }

    // Rising pickup announcements.
    for (const fl of state.floaters) {
      const t = fl.age / fl.ttl;
      const { color } = PICKUP_STYLE[fl.kind];
      ctx.globalAlpha = 1 - t;
      ctx.font = "bold 13px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillText(FLOATER_LABEL[fl.kind], fl.x + 1, fl.y - t * 28 + 1);
      ctx.fillStyle = color;
      ctx.fillText(FLOATER_LABEL[fl.kind], fl.x, fl.y - t * 28);
      ctx.globalAlpha = 1;
    }

    // The player's tiny cannon, with its weapon-status band ~20px below it.
    if (state.respawn <= 0 && !state.over) {
      const blink = state.player.invuln > 0 && now % 0.25 < 0.12;
      const px = Math.round(state.player.x);
      if (!blink) {
        ctx.fillStyle = "#eaffff";
        ctx.fillRect(px - 6, ground - 8, 13, 4);
        ctx.fillRect(px - 2, ground - 12, 5, 4);
        ctx.fillRect(px - 1, ground - 14, 3, 2);
      }
      drawWeaponIcon(ctx, state.weapon, px, ground + 12, now);
    }

    // In-game HUD: chunky arcade text drawn right over the battlefield.
    const hudText = (
      text: string,
      x: number,
      y: number,
      color: string,
      size: number,
      align: CanvasTextAlign,
    ) => {
      ctx.font = `bold ${size}px 'Courier New', monospace`;
      ctx.textAlign = align;
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
      ctx.fillText(text, x + 2, y + 2);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    };
    // Score (top-left) — measure width so CHARGE can follow immediately after.
    ctx.font = "bold 20px 'Courier New', monospace";
    const scoreTxt = `SCORE ${String(state.score).padStart(6, "0")}`;
    const scoreW = ctx.measureText(scoreTxt).width;
    hudText(scoreTxt, 10, 8, "#ffce3b", 20, "left");
    hudText(`CHARGE ${Math.floor(state.charge)}`, 10 + scoreW + 18, 8, "#ff9a57", 20, "left");
    hudText(
      `LEVEL ${state.level}   SHIPS ${"▲".repeat(Math.max(0, Math.min(state.lives, 6)))}`,
      state.w - 10,
      8,
      "#57ff7a",
      20,
      "right",
    );
    const lvl = (n: number) => (n > 0 ? `+${n}` : "");
    // The equipped weapon, with the other unlocked ones shown dim so you know
    // what S cycles to.
    const stackFor = (w: GameState["weapon"]) =>
      w === "chain" ? state.chainStack : w === "sprinkler" ? state.sprinklerStack : 0;
    const wlabel = (w: GameState["weapon"]) => `${WEAPON_LABEL[w]}${lvl(stackFor(w))}`;
    hudText(`▸ ${wlabel(state.weapon)}`, 10, 34, "#b8e6ff", 15, "left");
    const others = state.weapons.filter((w) => w !== state.weapon);
    if (others.length > 0) {
      hudText(`S: ${others.map(wlabel).join(" / ")}`, 10, 52, "#5b6a8a", 12, "left");
    }

    // Rising bonus banners (squadron wipe-out).
    for (const b of state.banners) {
      const t = b.age / b.ttl;
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.font = "bold 22px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillText(b.text, b.x + 2, b.y - t * 40 + 2);
      ctx.fillStyle = "#ffce3b";
      ctx.fillText(b.text, b.x, b.y - t * 40);
      ctx.globalAlpha = 1;
    }

    // Control reminder along the very bottom (the active weapon now shows as an
    // icon under the ship, not as text here).
    ctx.textBaseline = "bottom";
    // The special-weapon meters live bottom-left, to the left of the controls.
    ctx.textAlign = "left";
    ctx.font = "bold 14px 'Courier New', monospace";
    const meters = `MSL${lvl(state.missileStack)}   AIR${lvl(state.airStack)} ${state.airAmmo}   NUKE${lvl(state.nukeStack)} ${state.nukeAmmo}`;
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillText(meters, 11, state.h - 3);
    ctx.fillStyle = "#ff9a57";
    ctx.fillText(meters, 10, state.h - 4);
    // Control reminder centered along the very bottom.
    ctx.textAlign = "center";
    ctx.font = "bold 12px 'Courier New', monospace";
    const controls = "◀ A D ▶ MOVE   SPACE FIRE   S SWAP   CLICK MISSILE   E AIR   Q NUKE";
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillText(controls, state.w / 2 + 1, state.h - 4 + 1);
    ctx.fillStyle = "#7385a8";
    ctx.fillText(controls, state.w / 2, state.h - 4);
  }, [repaintShield]);

  const syncHud = useCallback((state: GameState) => {
    setScore(state.score);
  }, []);

  const startGame = useCallback(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const w = Math.max(360, stage.clientWidth);
    const h = Math.max(300, stage.clientHeight);
    canvas.width = w;
    canvas.height = h;
    if (spritesRef.current.length === 0) {
      spritesRef.current = INVADER_SPRITES.map((frames, type) =>
        frames.map((p) => makeSprite(p, TYPE_COLORS[type])),
      );
    }
    const state = initialState(w, h);
    stateRef.current = state;
    rebuildFormation(state);
    shieldCanvasesRef.current = [];
    lastLevelRef.current = state.level;
    keysRef.current = { left: false, right: false, fire: false };
    oneShotRef.current = { missile: null, air: false, nuke: false, selectWeapon: false };
    sfxRef.current?.resume();
    syncHud(state);
    setInitials("");
    trackEvent("game_start", { game: ENTITY });
    recordPlay(ENTITY);
    setPhase("playing");
  }, [rebuildFormation, syncHud]);

  useEffect(() => {
    if (phase === "idle" || phase === "saved") {
      return attachGameInput({ onConfirm: startGame });
    }
  }, [phase, startGame]);

  // Held keys + one-shot special keys.
  useEffect(() => {
    if (phase !== "playing") return;
    const setKey = (e: KeyboardEvent, down: boolean) => {
      const key = e.key;
      const code = e.code;
      const keys = keysRef.current;
      const shots = oneShotRef.current;
      // Move left: A, J, Left arrow, Numpad4.
      if (
        key === "ArrowLeft" ||
        key === "a" ||
        key === "A" ||
        key === "j" ||
        key === "J" ||
        code === "Numpad4"
      )
        keys.left = down;
      // Move right: D, L, Right arrow, Numpad6.
      else if (
        key === "ArrowRight" ||
        key === "d" ||
        key === "D" ||
        key === "l" ||
        key === "L" ||
        code === "Numpad6"
      )
        keys.right = down;
      // Fire: W, I, Spacebar, Up arrow, Numpad7.
      else if (
        key === " " ||
        key === "ArrowUp" ||
        key === "w" ||
        key === "W" ||
        key === "i" ||
        key === "I" ||
        code === "Numpad7"
      )
        keys.fire = down;
      // Air support: E, Left Alt, C, period, O, Enter, Numpad9, Numpad3.
      else if (
        down &&
        (key === "e" ||
          key === "E" ||
          key === "c" ||
          key === "C" ||
          key === "o" ||
          key === "O" ||
          key === "." ||
          key === "Enter" ||
          code === "AltLeft" ||
          code === "Numpad9" ||
          code === "Numpad3")
      )
        shots.air = true;
      // Ground nuke: Q, Left shift, U, N, Right ctrl, Right shift, Numpad0.
      else if (
        down &&
        (key === "q" ||
          key === "Q" ||
          key === "u" ||
          key === "U" ||
          key === "n" ||
          key === "N" ||
          code === "ShiftLeft" ||
          code === "ShiftRight" ||
          code === "ControlRight" ||
          code === "Numpad0")
      )
        shots.nuke = true;
      // Swap weapon: S, K, Down arrow, Numpad5.
      else if (
        down &&
        (key === "s" ||
          key === "S" ||
          key === "k" ||
          key === "K" ||
          key === "ArrowDown" ||
          code === "Numpad5")
      )
        shots.selectWeapon = true;
      else return;
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

  // Left-click / tap = missile toward that point; right-click = swap weapon.
  useEffect(() => {
    if (phase !== "playing") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onPointer = (e: PointerEvent) => {
      if (e.button === 2) {
        oneShotRef.current.selectWeapon = true;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      oneShotRef.current.missile = {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height),
      };
    };
    const onContext = (e: Event) => e.preventDefault(); // no context menu on right-click
    canvas.addEventListener("pointerdown", onPointer);
    canvas.addEventListener("contextmenu", onContext);
    return () => {
      canvas.removeEventListener("pointerdown", onPointer);
      canvas.removeEventListener("contextmenu", onContext);
    };
  }, [phase]);

  // Main loop.
  useEffect(() => {
    if (phase !== "playing") return;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const keys = keysRef.current;
      const shots = oneShotRef.current;
      const input: InputState = {
        left: keys.left,
        right: keys.right,
        fire: keys.fire,
        missile: shots.missile,
        air: shots.air,
        nuke: shots.nuke,
        selectWeapon: shots.selectWeapon,
      };
      for (const pad of navigator.getGamepads()) {
        if (!pad) continue;
        const ax = pad.axes[0] ?? 0;
        input.left ||= ax < -0.5 || Boolean(pad.buttons[14]?.pressed);
        input.right ||= ax > 0.5 || Boolean(pad.buttons[15]?.pressed);
        input.fire ||= Boolean(pad.buttons[0]?.pressed);
        if (pad.buttons[2]?.pressed) input.selectWeapon = true;
      }
      shots.missile = null;
      shots.air = false;
      shots.nuke = false;
      shots.selectWeapon = false;

      const state = stateRef.current;
      if (!state) return;
      step(state, input, dt);
      // The UFO laser is a continuous buzz for as long as any beam is firing,
      // so it plays as a loop rather than a one-shot on that event.
      for (const event of new Set(state.events)) {
        if (event !== "laser") sfxRef.current?.play(event);
      }
      sfxRef.current?.setLoop(
        "laser",
        state.ufos.some((u) => u.laser > 0),
      );
      // The echoey air-raid siren wails from the start of the fly-in (through
      // the warmup and settle), then fades out over 2s once everyone's landed.
      const flyingIn =
        state.introLaunched < state.introQueue.length ||
        state.flyers.some((f) => f.mode === "arrive");
      if (flyingIn) {
        sirenFadingRef.current = false;
        sfxRef.current?.setLoop("siren", true);
      } else if (!sirenFadingRef.current) {
        sirenFadingRef.current = true;
        sfxRef.current?.fade("siren", 2);
      }
      if (state.level !== lastLevelRef.current) {
        lastLevelRef.current = state.level;
        rebuildFormation(state); // a fresh horde marched in
      } else {
        patchFormation(state);
      }
      syncHud(state);
      if (state.over) {
        sfxRef.current?.setLoop("laser", false);
        sfxRef.current?.setLoop("siren", false);
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
      sfxRef.current?.setLoop("laser", false);
      sfxRef.current?.setLoop("siren", false);
    };
  }, [phase, draw, syncHud, rebuildFormation, patchFormation]);

  const bindTouch = (key: "left" | "right" | "fire") => ({
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
      <div ref={stageRef} className={styles.stage}>
        <canvas ref={canvasRef} className={styles.canvas} />

        {phase === "playing" && (
          <div className={styles.touchControls}>
            <div className={styles.touchCluster}>
              <button type="button" className={styles.touchButton} {...bindTouch("left")}>
                ◀
              </button>
              <button type="button" className={styles.touchButton} {...bindTouch("right")}>
                ▶
              </button>
            </div>
            <div className={styles.touchCluster}>
              <button type="button" className={styles.touchButtonFire} {...bindTouch("fire")}>
                FIRE
              </button>
            </div>
          </div>
        )}

        {phase === "idle" && (
          <div className={styles.overlay}>
            <p className={styles.overlayTitle}>BIG SPACE TINY INVADERS</p>
            <FeedbackPanel entity={ENTITY} />
            <p>
              Thousands of them. One tiny you. Hold the line against the marching horde, the
              swooping squadrons that dive and rejoin it, and the UFOs with their down-beam lasers.
            </p>
            <p>
              Bullets and missiles drain one shared CHARGE pool that scrap refills. Catch falling
              powerups: Sprinkler and Lightning Burst unlock new shooting weapons; a random bonus
              also drifts in from an edge every so often.
            </p>
            <p>
              <strong>MOVE</strong> ◀ ▶ arrows · A D · J L · Numpad 4 6 &nbsp;|&nbsp;
              <strong>FIRE</strong> Space · W · I · ↑ · Numpad 7 &nbsp;|&nbsp;
              <strong>SWAP WEAPON</strong> S · K · ↓ · Numpad 5 · right-click
            </p>
            <p>
              <strong>MISSILE</strong> click/tap target &nbsp;|&nbsp;
              <strong>AIR SUPPORT</strong> E · C · O · . · Enter · Numpad 9 3 · LAlt &nbsp;|&nbsp;
              <strong>NUKE</strong> Q · U · N · LShift · RCtrl · Numpad 0
            </p>

            <div className={styles.legend}>
              <div className={styles.legendGroup}>
                <span className={styles.legendHead}>ENEMIES</span>
                {ENEMY_LEGEND.map((e) => (
                  <span key={e.label} className={styles.legendItem}>
                    <span
                      className={e.ufo ? styles.legendChipUfo : styles.legendChip}
                      style={e.ufo ? undefined : { background: e.color }}
                    />
                    {e.label} {e.score}
                  </span>
                ))}
              </div>
              <div className={styles.legendGroup}>
                <span className={styles.legendHead}>POWER-UPS</span>
                {POWERUP_LEGEND.map((p) => (
                  <span key={p.kind} className={styles.legendItem}>
                    <span
                      className={styles.legendChipBox}
                      style={{ color: PICKUP_STYLE[p.kind].color }}
                    >
                      {PICKUP_STYLE[p.kind].label}
                    </span>
                    {p.desc}
                  </span>
                ))}
              </div>
            </div>

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
              <label htmlFor="invaders-initials">ENTER INITIALS:</label>
              <input
                id="invaders-initials"
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
            <Link to="/" className={styles.lobbyLink}>
              ◀ BACK TO LOBBY
            </Link>
          </div>
        )}

        {phase === "saved" && (
          <div className={styles.overlay}>
            <p className={styles.overlayTitle}>THE HORDE THANKS YOU</p>
            <Leaderboard />
            <button type="button" className={styles.arcadeButton} onClick={startGame}>
              ▶ PLAY AGAIN
            </button>
            <Link to="/" className={styles.lobbyLink}>
              ◀ BACK TO LOBBY
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
