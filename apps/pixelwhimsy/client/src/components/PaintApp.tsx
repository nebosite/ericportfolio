import {
  useEffect,
  useRef,
  useState,
  PointerEvent as ReactPointerEvent,
} from "react";
import { PALETTE, CELL, Brush, gridSize, brushOffsets, floodFill } from "../lib/paint";
import {
  ANIM_BASE,
  GROUP_SIZE,
  GROUP_COUNT,
  animIndex,
  colorAt,
  buildPalette32,
} from "../lib/palette";
import { strokeCells, type Pt } from "../lib/stroke";
import ExitGate from "./ExitGate";
import styles from "./PaintApp.module.css";

const LOCKOUT_MS = 10_000; // wrong answer locks the exit for 10s
const ANIM_MS = 110; // palette cycles one step this often

interface Tool {
  id: Brush;
  label: string;
  r?: number; // SVG dot radius for brush icons
  emoji?: string;
}
const TOOLS: Tool[] = [
  { id: "single", label: "Tiny dot", r: 2.5 },
  { id: "round5", label: "Small brush", r: 6 },
  { id: "round20", label: "Big brush", r: 12 },
  { id: "fill", label: "Fill", emoji: "🪣" },
];

// What the child is painting with: a fixed static color index, or an animated
// high-bit group whose index marches forward with every brush stamp.
type Paint = { kind: "static"; index: number } | { kind: "anim"; group: number };

export default function PaintApp({ onExit }: { onExit: () => void }) {
  const playRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dimsRef = useRef({ cols: 0, rows: 0 });
  const paintingRef = useRef(false);
  const ptsRef = useRef<Pt[]>([]); // recent cursor samples that feed the spline
  const dirtyRef = useRef(false); // true once the child has painted — lock the size

  // The classic 8-bit setup: an off-screen index buffer (one palette index per
  // toy pixel), a 1px-per-cell scratch canvas the palette renders into, and the
  // current index→RGBA palette. The render loop blits the scratch canvas up.
  const idxRef = useRef<Uint8Array>(new Uint8Array(0));
  const smallRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<ImageData | null>(null);
  const img32Ref = useRef<Uint32Array | null>(null);
  const paletteRef = useRef<Uint32Array>(buildPalette32(0));
  const phaseRef = useRef(0);
  const stampCounterRef = useRef(0); // advances the animated index per brush stamp
  const hasAnimatedRef = useRef(false); // any animated pixels on screen → cycle them
  const renderScheduledRef = useRef(false);

  const [paint, setPaint] = useState<Paint>({ kind: "static", index: 1 });
  const [brush, setBrush] = useState<Brush>("round20");
  const [swatchPhase, setSwatchPhase] = useState(0); // drives the animated picker
  const paintRef = useRef(paint);
  const brushRef = useRef(brush);
  paintRef.current = paint;
  brushRef.current = brush;

  const [gateOpen, setGateOpen] = useState(false);
  const [lockUntil, setLockUntil] = useState(0);
  const [, forceTick] = useState(0);

  // Map the index buffer through the current palette and scale it up onto the
  // visible canvas (nearest-neighbour, so toy pixels stay crisp 10x10 blocks).
  const render = () => {
    const big = canvasRef.current;
    const small = smallRef.current;
    const img = imgRef.current;
    const img32 = img32Ref.current;
    if (!big || !small || !img || !img32) return;
    const sctx = small.getContext("2d");
    const bctx = big.getContext("2d");
    if (!sctx || !bctx) return;
    const idx = idxRef.current;
    const pal = paletteRef.current;
    for (let i = 0; i < idx.length; i++) img32[i] = pal[idx[i]];
    sctx.putImageData(img, 0, 0);
    bctx.imageSmoothingEnabled = false;
    bctx.drawImage(small, 0, 0, small.width, small.height, 0, 0, big.width, big.height);
  };

  const requestRender = () => {
    if (renderScheduledRef.current) return;
    renderScheduledRef.current = true;
    requestAnimationFrame(() => {
      renderScheduledRef.current = false;
      render();
    });
  };

  // Fullscreen can't be (re)entered without a user gesture — so whenever we're in
  // the sandbox but not fullscreen (after an F5 reload, or an Esc), show a prompt
  // whose tap re-enters it. Tapping the prompt (not the canvas) means the buffer
  // can still resize to the new fullscreen size.
  const fsSupported =
    typeof document.documentElement.requestFullscreen === "function";
  const [needFullscreen, setNeedFullscreen] = useState(
    () => fsSupported && !document.fullscreenElement,
  );
  const goFullscreen = () => {
    try {
      void document.documentElement.requestFullscreen?.();
    } catch {
      /* refused — just keep painting windowed */
    }
    setNeedFullscreen(false);
  };

  useEffect(() => {
    if (!fsSupported) return;
    const onFsChange = () => {
      if (!document.fullscreenElement) setNeedFullscreen(true);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [fsSupported]);

  // Size the drawing buffer from the *actual* container once layout has settled.
  // Because fullscreen resizes the viewport asynchronously, we measure after a
  // frame and again on resize/fullscreenchange — but only until the child starts
  // painting, so a later resize never wipes their art.
  useEffect(() => {
    const sizeCanvas = () => {
      const host = playRef.current;
      const canvas = canvasRef.current;
      if (!host || !canvas || dirtyRef.current) return;
      const { cols, rows } = gridSize(host.clientWidth, host.clientHeight);
      if (cols === dimsRef.current.cols && rows === dimsRef.current.rows) return;
      dimsRef.current = { cols, rows };
      canvas.width = cols * CELL;
      canvas.height = rows * CELL;
      idxRef.current = new Uint8Array(cols * rows); // 0 = blank (white)
      const small = document.createElement("canvas");
      small.width = cols;
      small.height = rows;
      smallRef.current = small;
      const sctx = small.getContext("2d");
      if (sctx) {
        const img = sctx.createImageData(cols, rows);
        imgRef.current = img;
        img32Ref.current = new Uint32Array(img.data.buffer);
      }
      hasAnimatedRef.current = false;
      render();
    };

    const raf = requestAnimationFrame(sizeCanvas);
    window.addEventListener("resize", sizeCanvas);
    document.addEventListener("fullscreenchange", sizeCanvas);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", sizeCanvas);
      document.removeEventListener("fullscreenchange", sizeCanvas);
    };
  }, []);

  // The palette animation clock: advance the phase, rebuild the palette, and (if
  // anything animated is on screen) repaint. Also drives the picker preview.
  useEffect(() => {
    const id = window.setInterval(() => {
      phaseRef.current += 1;
      buildPalette32(phaseRef.current, paletteRef.current);
      setSwatchPhase(phaseRef.current);
      if (hasAnimatedRef.current) requestRender();
    }, ANIM_MS);
    return () => window.clearInterval(id);
  }, []);

  // Client coords → fractional toy-pixel-cell position (may be off-canvas).
  const toCell = (clientX: number, clientY: number): Pt | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left) / CELL, y: (clientY - rect.top) / CELL };
  };

  // The palette index for the next brush stamp: fixed for a static color, or the
  // next slot in the group for an animated one (so the lit dot chases the trail).
  const nextStampIndex = (): number => {
    const p = paintRef.current;
    if (p.kind === "static") return p.index;
    const i = animIndex(p.group, stampCounterRef.current);
    stampCounterRef.current += 1;
    return i;
  };

  // Stamp the current brush footprint at cell (cx,cy) into the index buffer.
  const stampBrush = (cx: number, cy: number) => {
    const index = nextStampIndex();
    const { cols, rows } = dimsRef.current;
    const buf = idxRef.current;
    let changed = false;
    for (const [dx, dy] of brushOffsets(brushRef.current)) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const i = y * cols + x;
      if (buf[i] !== index) {
        buf[i] = index;
        changed = true;
      }
    }
    if (changed && index >= ANIM_BASE) hasAnimatedRef.current = true;
  };

  // Paint one cursor sample, interpolating a smooth, gap-free stroke from the
  // recent samples so fast motion never skips toy pixels (see lib/stroke).
  const paintSample = (clientX: number, clientY: number) => {
    const pt = toCell(clientX, clientY);
    if (!pt) return;
    const pts = ptsRef.current;
    const prev = pts[pts.length - 1];
    dirtyRef.current = true; // the child is painting — stop auto-resizing the buffer
    if (!prev) {
      stampBrush(Math.floor(pt.x), Math.floor(pt.y));
    } else {
      const before = pts[pts.length - 2] ?? prev; // p0 (tangent in)
      const future = { x: 2 * pt.x - prev.x, y: 2 * pt.y - prev.y }; // p3 from velocity
      for (const [cx, cy] of strokeCells(before, prev, pt, future)) {
        stampBrush(cx, cy);
      }
    }
    pts.push(pt);
    if (pts.length > 3) pts.shift(); // only the last few samples shape the spline
    requestRender();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const pt = toCell(e.clientX, e.clientY);
    if (!pt) return;

    if (brushRef.current === "fill") {
      const { cols, rows } = dimsRef.current;
      const cx = Math.floor(pt.x);
      const cy = Math.floor(pt.y);
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
      dirtyRef.current = true;
      const buf = idxRef.current;
      const p = paintRef.current;
      if (p.kind === "static") {
        for (const i of floodFill(buf, cols, rows, cx, cy, p.index)) buf[i] = p.index;
      } else {
        // -1 forces a fill regardless; a diagonal index ramp makes it shimmer.
        for (const i of floodFill(buf, cols, rows, cx, cy, -1)) {
          const x = i % cols;
          buf[i] = animIndex(p.group, x + (i - x) / cols);
        }
        hasAnimatedRef.current = true;
      }
      requestRender();
      return;
    }

    paintingRef.current = true;
    ptsRef.current = []; // start a fresh stroke
    paintSample(e.clientX, e.clientY);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!paintingRef.current || brushRef.current === "fill") return;
    // Walk every coalesced sample the browser merged into this event, so a fast
    // flick still feeds the spline its in-between positions.
    const native = e.nativeEvent;
    const samples =
      typeof native.getCoalescedEvents === "function" &&
      native.getCoalescedEvents().length > 0
        ? native.getCoalescedEvents()
        : [native];
    for (const s of samples) paintSample(s.clientX, s.clientY);
  };

  useEffect(() => {
    const stop = () => {
      paintingRef.current = false;
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, []);

  // Tick once a second while the exit is locked so the countdown updates.
  useEffect(() => {
    if (lockUntil <= Date.now()) return;
    const t = setInterval(() => forceTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [lockUntil]);

  const remaining = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
  const locked = remaining > 0;

  return (
    <div
      ref={playRef}
      className={styles.play}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      {/* Top strip — color picking: fixed crayons, then animated colors */}
      <div className={styles.colorbar}>
        {PALETTE.map((c, i) => {
          const index = i + 1; // static colors live at indices 1..16
          const active = paint.kind === "static" && paint.index === index;
          return (
            <button
              key={c}
              type="button"
              aria-label={`Paint with ${c}`}
              className={active ? styles.swatchActive : styles.swatch}
              style={{ backgroundColor: c }}
              onClick={() => setPaint({ kind: "static", index })}
            />
          );
        })}

        <span className={styles.swatchSep} aria-hidden="true" />

        {Array.from({ length: GROUP_COUNT }, (_, g) => {
          const active = paint.kind === "anim" && paint.group === g;
          return (
            <button
              key={`anim-${g}`}
              type="button"
              aria-label={`Animated color ${g + 1}`}
              className={active ? styles.animSwatchActive : styles.animSwatch}
              onClick={() => setPaint({ kind: "anim", group: g })}
            >
              {Array.from({ length: GROUP_SIZE }, (_, s) => (
                <span
                  key={s}
                  className={styles.animSlot}
                  style={{ backgroundColor: colorAt(ANIM_BASE + g * GROUP_SIZE + s, swatchPhase) }}
                />
              ))}
            </button>
          );
        })}
      </div>

      {/* Left strip — tools */}
      <div className={styles.toolbar}>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-label={t.label}
            aria-pressed={brush === t.id}
            className={brush === t.id ? styles.toolActive : styles.tool}
            onClick={() => setBrush(t.id)}
          >
            {t.emoji ? (
              <span className={styles.toolEmoji}>{t.emoji}</span>
            ) : (
              <svg
                viewBox="0 0 40 40"
                width="100%"
                height="100%"
                aria-hidden="true"
              >
                <circle cx="20" cy="20" r={t.r} fill="currentColor" />
              </svg>
            )}
          </button>
        ))}
      </div>

      {/* Drawing canvas — one toy pixel = 10x10 real pixels */}
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      />

      {/* Exit corner — small, buffered, math-gated */}
      <div className={styles.exitCorner}>
        <button
          type="button"
          className={styles.exitBtn}
          aria-label={locked ? `Exit locked for ${remaining} seconds` : "Exit"}
          disabled={locked}
          onClick={() => setGateOpen(true)}
        >
          {locked ? remaining : "✕"}
        </button>
      </div>

      {gateOpen && (
        <ExitGate
          onSolved={onExit}
          onWrong={() => {
            setLockUntil(Date.now() + LOCKOUT_MS);
            setGateOpen(false);
          }}
          onCancel={() => setGateOpen(false)}
        />
      )}

      {needFullscreen && (
        <div className={styles.fsPrompt} onPointerDown={goFullscreen}>
          <div className={styles.fsEmoji}>🎨</div>
          <p className={styles.fsText}>Tap to keep painting</p>
        </div>
      )}
    </div>
  );
}
