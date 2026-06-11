import { useEffect, useRef, useState } from 'react';
import styles from './PixelCanvas.module.css';

const GRID = 32;
const CELL = 16; // 32 cells * 16px = 512x512 canvas
const BLANK = '#ffffff';

// 16 bright, child-friendly crayon colors
const PALETTE = [
  '#ff3b3b', // cherry red
  '#ff8a3b', // orange pop
  '#ffd93d', // sunshine yellow
  '#b6e62e', // lime fizz
  '#4cc94c', // grass green
  '#2ec9a7', // mermaid teal
  '#3bc2ff', // sky blue
  '#2e6ee6', // crayon blue
  '#7b5ee6', // grape
  '#b03be6', // magic purple
  '#ff6fa5', // bubblegum pink
  '#a65a2e', // teddy-bear brown
  '#000000', // midnight black
  '#7a7a8c', // robot gray
  '#ffffff', // cloud white (eraser!)
  '#ffe0c2', // peach
];

function paintCanvas(canvas: HTMLCanvasElement, pixels: string[], cellSize: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  for (let i = 0; i < pixels.length; i++) {
    ctx.fillStyle = pixels[i];
    ctx.fillRect((i % GRID) * cellSize, Math.floor(i / GRID) * cellSize, cellSize, cellSize);
  }
}

export default function PixelCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintingRef = useRef(false);
  const [pixels, setPixels] = useState<string[]>(() => Array(GRID * GRID).fill(BLANK));
  const [color, setColor] = useState(PALETTE[0]);

  useEffect(() => {
    if (canvasRef.current) paintCanvas(canvasRef.current, pixels, CELL);
  }, [pixels]);

  // Stop painting even when the pointer is released outside the canvas
  useEffect(() => {
    const stop = () => {
      paintingRef.current = false;
    };
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, []);

  const paintAt = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * GRID);
    const y = Math.floor(((clientY - rect.top) / rect.height) * GRID);
    if (x < 0 || x >= GRID || y < 0 || y >= GRID) return;
    const index = y * GRID + x;
    setPixels((prev) => {
      if (prev[index] === color) return prev;
      const next = prev.slice();
      next[index] = color;
      return next;
    });
  };

  return (
    <div className={styles.studio}>
      <div className={styles.canvasColumn}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          width={GRID * CELL}
          height={GRID * CELL}
          onPointerDown={(e) => {
            paintingRef.current = true;
            paintAt(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (paintingRef.current) paintAt(e.clientX, e.clientY);
          }}
        />
        <div className={styles.palette}>
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
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.clearButton}
            onClick={() => setPixels(Array(GRID * GRID).fill(BLANK))}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
