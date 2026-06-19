import {
  useEffect,
  useRef,
  useState,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  PALETTE,
  BLANK,
  CELL,
  Brush,
  gridSize,
  brushOffsets,
  floodFill,
} from "../lib/paint";
import { strokeCells, type Pt } from "../lib/stroke";
import ExitGate from "./ExitGate";
import styles from "./PaintApp.module.css";

const LOCKOUT_MS = 10_000; // wrong answer locks the exit for 10s

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

export default function PaintApp({ onExit }: { onExit: () => void }) {
  const playRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<string[]>([]);
  const dimsRef = useRef({ cols: 0, rows: 0 });
  const paintingRef = useRef(false);
  const ptsRef = useRef<Pt[]>([]); // recent cursor samples that feed the spline
  const dirtyRef = useRef(false); // true once the child has painted — lock the size

  const [color, setColor] = useState(PALETTE[0]);
  const [brush, setBrush] = useState<Brush>("single");
  const colorRef = useRef(color);
  const brushRef = useRef(brush);
  colorRef.current = color;
  brushRef.current = brush;

  const [gateOpen, setGateOpen] = useState(false);
  const [lockUntil, setLockUntil] = useState(0);
  const [, forceTick] = useState(0);

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
      if (cols === dimsRef.current.cols && rows === dimsRef.current.rows)
        return;
      dimsRef.current = { cols, rows };
      canvas.width = cols * CELL;
      canvas.height = rows * CELL;
      gridRef.current = new Array(cols * rows).fill(BLANK);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = BLANK;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
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

  const drawCells = (indices: number[], c: string) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { cols } = dimsRef.current;
    ctx.fillStyle = c;
    for (const idx of indices) {
      const x = idx % cols;
      const y = (idx - x) / cols;
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  };

  // Client coords → fractional toy-pixel-cell position (may be off-canvas).
  const toCell = (clientX: number, clientY: number): Pt | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left) / CELL, y: (clientY - rect.top) / CELL };
  };

  // Stamp the current brush centered on cell (cx,cy), collecting changed indices.
  const stampBrush = (cx: number, cy: number, c: string, out: number[]) => {
    const { cols, rows } = dimsRef.current;
    const grid = gridRef.current;
    for (const [dx, dy] of brushOffsets(brushRef.current)) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const i = y * cols + x;
      if (grid[i] !== c) {
        grid[i] = c;
        out.push(i);
      }
    }
  };

  // Paint one cursor sample, interpolating a smooth, gap-free stroke from the
  // recent samples so fast motion never skips toy pixels (see lib/stroke).
  const paintSample = (clientX: number, clientY: number) => {
    const pt = toCell(clientX, clientY);
    if (!pt) return;
    const pts = ptsRef.current;
    const prev = pts[pts.length - 1];
    const c = colorRef.current;
    const out: number[] = [];
    dirtyRef.current = true; // the child is painting — stop auto-resizing the buffer
    if (!prev) {
      stampBrush(Math.floor(pt.x), Math.floor(pt.y), c, out);
    } else {
      const before = pts[pts.length - 2] ?? prev; // p0 (tangent in)
      const future = { x: 2 * pt.x - prev.x, y: 2 * pt.y - prev.y }; // p3 from velocity
      for (const [cx, cy] of strokeCells(before, prev, pt, future)) {
        stampBrush(cx, cy, c, out);
      }
    }
    drawCells(out, c);
    pts.push(pt);
    if (pts.length > 3) pts.shift(); // only the last few samples shape the spline
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
      const c = colorRef.current;
      const grid = gridRef.current;
      const idxs = floodFill(grid, cols, rows, cx, cy, c);
      for (const i of idxs) grid[i] = c;
      drawCells(idxs, c);
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
      {/* Top strip — color picking */}
      <div className={styles.colorbar}>
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Paint with ${c}`}
            className={c === color ? styles.swatchActive : styles.swatch}
            style={{ backgroundColor: c }}
            onClick={() => setColor(c)}
          />
        ))}
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
