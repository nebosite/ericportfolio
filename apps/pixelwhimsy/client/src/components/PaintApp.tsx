import {
  useEffect,
  useRef,
  useState,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  PALETTE,
  CELL,
  TOOLBAR,
  Brush,
  gridSize,
  brushOffsets,
  floodFill,
} from "../lib/paint";
import {
  ANIM_BASE,
  BLANK_INDEX,
  GROUP_SIZE,
  GROUP_COUNT,
  GROUP_COLORS,
  animIndex,
  groupOf,
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

  // The color palette is a draggable dialog summoned by the palette button.
  // While it's open the cursor is an eyedropper that can sample a color from a
  // swatch OR straight from the drawing; picking either way closes it.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogPos, setDialogPos] = useState({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  // Dark mode: the blank background is black and animated colors fade to black.
  const [dark, setDark] = useState(false);
  const darkRef = useRef(dark);
  darkRef.current = dark;

  // The current paint as one solid color, for the brush icons (white stays
  // visible thanks to the icon outline). Animated paint shows its vivid base.
  const currentColor =
    paint.kind === "static"
      ? colorAt(paint.index, swatchPhase, dark)
      : GROUP_COLORS[paint.group];

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
      // No top color strip any more, so the canvas fills the full height right
      // of the tool column.
      const { cols, rows } = gridSize(host.clientWidth, host.clientHeight, TOOLBAR, 0);
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
      buildPalette32(phaseRef.current, paletteRef.current, darkRef.current);
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

  // Eyedropper result → set the active paint to a palette index, dismiss dialog.
  const pickIndex = (index: number) => {
    if (index >= ANIM_BASE) setPaint({ kind: "anim", group: groupOf(index) });
    else setPaint({ kind: "static", index });
    setDialogOpen(false);
  };

  const openDialog = () => {
    const w = 360;
    setDialogPos({ x: Math.max(8, (window.innerWidth - w) / 2), y: 64 });
    setDialogOpen(true);
  };

  // Wipe the canvas back to the (mode's) blank background. Clearing is blessed
  // as playful by the North Star, so it needs no gate.
  const clearScreen = () => {
    idxRef.current.fill(BLANK_INDEX);
    hasAnimatedRef.current = false;
    requestRender();
  };

  // Flip light/dark. Rebuild the palette immediately so the switch is instant
  // even when nothing animated is on screen to trigger the next tick.
  const toggleDark = () => {
    const next = !darkRef.current;
    darkRef.current = next;
    setDark(next);
    buildPalette32(phaseRef.current, paletteRef.current, next);
    requestRender();
  };

  // Drag the palette dialog by its handle (pointer-captured, clamped on-screen).
  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragRef.current = { dx: e.clientX - dialogPos.x, dy: e.clientY - dialogPos.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const panel = panelRef.current;
    const pw = panel?.offsetWidth ?? 360;
    const ph = panel?.offsetHeight ?? 240;
    const x = Math.min(Math.max(0, e.clientX - d.dx), Math.max(0, window.innerWidth - pw));
    const y = Math.min(Math.max(0, e.clientY - d.dy), Math.max(0, window.innerHeight - ph));
    setDialogPos({ x, y });
  };
  const onHandleUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const pt = toCell(e.clientX, e.clientY);
    if (!pt) return;

    // Palette open → the canvas acts as an eyedropper: sample the pixel under
    // the cursor and adopt its color, instead of painting.
    if (dialogOpen) {
      const { cols, rows } = dimsRef.current;
      const cx = Math.floor(pt.x);
      const cy = Math.floor(pt.y);
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
      pickIndex(idxRef.current[cy * cols + cx]);
      return;
    }

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
      className={dialogOpen ? `${styles.play} ${styles.eyedrop}` : styles.play}
      style={{ background: dark ? "#000" : "#fff" }}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      {/* Left strip — the color palette button, then the brush tools */}
      <div className={styles.toolbar}>
        <button
          type="button"
          aria-label="Color palette"
          aria-pressed={dialogOpen}
          className={dialogOpen ? styles.toolActive : styles.tool}
          onClick={openDialog}
        >
          <span className={styles.toolEmoji}>🎨</span>
        </button>

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
              // Brush dots paint-preview the current color; a faint outline keeps
              // a white (eraser) brush visible on the white button.
              <svg
                viewBox="0 0 40 40"
                width="100%"
                height="100%"
                aria-hidden="true"
              >
                <circle
                  cx="20"
                  cy="20"
                  r={t.r}
                  fill={currentColor}
                  stroke="rgba(58,46,79,0.45)"
                  strokeWidth="1.5"
                />
              </svg>
            )}
          </button>
        ))}

        <button
          type="button"
          aria-label="Clear screen"
          className={styles.tool}
          onClick={clearScreen}
        >
          <span className={styles.toolEmoji}>🧹</span>
        </button>

        <button
          type="button"
          aria-label={dark ? "Light mode" : "Dark mode"}
          aria-pressed={dark}
          className={styles.tool}
          onClick={toggleDark}
        >
          <span className={styles.toolEmoji}>{dark ? "☀️" : "🌙"}</span>
        </button>
      </div>

      {/* Drawing canvas — one toy pixel = 10x10 real pixels */}
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      />

      {/* Color palette dialog — draggable by its handle, eyedropper picks from
          a swatch or from the drawing; either choice closes it. */}
      {dialogOpen && (
        <div
          ref={panelRef}
          className={styles.dialog}
          style={{ left: dialogPos.x, top: dialogPos.y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            className={styles.dialogHandle}
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
          >
            <span className={styles.dialogGrip} aria-hidden="true">
              ⠿
            </span>
            <button
              type="button"
              className={styles.dialogClose}
              aria-label="Close colors"
              onClick={() => setDialogOpen(false)}
            >
              ✕
            </button>
          </div>

          <div className={styles.dialogColors}>
            {PALETTE.map((c, i) => {
              const index = i + 1; // static colors live at indices 1..16
              return (
                <button
                  key={c}
                  type="button"
                  aria-label={`Paint with ${c}`}
                  className={styles.dialogSwatch}
                  style={{ backgroundColor: c }}
                  onClick={() => pickIndex(index)}
                />
              );
            })}
            {Array.from({ length: GROUP_COUNT }, (_, g) => (
              <button
                key={`anim-${g}`}
                type="button"
                aria-label={`Animated color ${g + 1}`}
                className={styles.dialogAnim}
                onClick={() => pickIndex(ANIM_BASE + g * GROUP_SIZE)}
              >
                {Array.from({ length: GROUP_SIZE }, (_, s) => (
                  <span
                    key={s}
                    className={styles.animSlot}
                    style={{
                      backgroundColor: colorAt(
                        ANIM_BASE + g * GROUP_SIZE + s,
                        swatchPhase,
                        dark,
                      ),
                    }}
                  />
                ))}
              </button>
            ))}
          </div>
        </div>
      )}

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
