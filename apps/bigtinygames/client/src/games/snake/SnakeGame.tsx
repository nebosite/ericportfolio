import { useCallback, useEffect, useRef, useState, FormEvent } from 'react';
import { attachGameInput, Vec } from '../input';
import { COLS, ROWS, POINTS_PER_APPLE, freshSnake, randomFood, step } from './snakeLogic';
import styles from './SnakeGame.module.css';

// The Big Tiny aesthetic: an 800x600 canvas crossed by a 100x75 grid of
// tiny 8x8px sprites. A very large world for a very small snake. The grid
// dimensions and movement rules live in snakeLogic.ts (unit tested); CELL and
// TICK_MS are presentation-only.
const CELL = 8;
const TICK_MS = 70;

type Phase = 'idle' | 'playing' | 'gameover' | 'saved';

interface ScoreRow {
  id: number;
  initials: string;
  score: number;
  created_at: string;
}

/*
 * SPRITES — all drawn in code as 8x8 one-bit pixel patterns so the owner can
 * redraw them later. Each string is one row; '#' pixels get the sprite's main
 * color, '.' pixels are skipped (background shows through).
 *
 * PLACEHOLDER ART: replace these patterns (or swap drawSprite for
 * ctx.drawImage with an 8x8 sprite sheet) with custom art in the owner's
 * quirky style — googly eyes on the head, a stubby tongue, a shinier apple…
 */
const SPRITE_HEAD = [
  '.######.',
  '########',
  '##.##.##',
  '########',
  '########',
  '#.####.#',
  '########',
  '.######.',
];
const SPRITE_BODY = [
  '.######.',
  '########',
  '##.##.##',
  '########',
  '##.##.##',
  '########',
  '########',
  '.######.',
];
const SPRITE_APPLE = [
  '...#....',
  '..##....',
  '.######.',
  '########',
  '########',
  '########',
  '.######.',
  '..####..',
];

function drawSprite(
  ctx: CanvasRenderingContext2D,
  pattern: string[],
  cellX: number,
  cellY: number,
  color: string,
) {
  ctx.fillStyle = color;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (pattern[row][col] === '#') {
        ctx.fillRect(cellX * CELL + col, cellY * CELL + row, 1, 1);
      }
    }
  }
}

export default function SnakeGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snakeRef = useRef<Vec[]>(freshSnake());
  const dirRef = useRef<Vec>({ x: 1, y: 0 });
  const dirQueueRef = useRef<Vec[]>([]);
  const foodRef = useRef<Vec>(randomFood(snakeRef.current));

  const [phase, setPhase] = useState<Phase>('idle');
  const [score, setScore] = useState(0);
  const [initials, setInitials] = useState('');
  const [leaderboard, setLeaderboard] = useState<ScoreRow[]>([]);

  const loadLeaderboard = useCallback(() => {
    fetch('/api/leaderboard')
      .then((res) => res.json())
      .then((data: ScoreRow[]) => setLeaderboard(data))
      .catch(() => {});
  }, []);

  useEffect(loadLeaderboard, [loadLeaderboard]);

  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0d0d14';
    ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);

    drawSprite(ctx, SPRITE_APPLE, foodRef.current.x, foodRef.current.y, '#ff5757');

    const snake = snakeRef.current;
    for (let i = snake.length - 1; i >= 1; i--) {
      // Alternate two greens so the body reads as segments even at 8px
      drawSprite(ctx, SPRITE_BODY, snake[i].x, snake[i].y, i % 2 === 0 ? '#2f9e4c' : '#3dbf5e');
    }
    drawSprite(ctx, SPRITE_HEAD, snake[0].x, snake[0].y, '#57ff7a');
  }, []);

  useEffect(draw, [draw, phase]);

  const startGame = useCallback(() => {
    snakeRef.current = freshSnake();
    dirRef.current = { x: 1, y: 0 };
    dirQueueRef.current = [];
    foodRef.current = randomFood(snakeRef.current);
    setScore(0);
    setInitials('');
    setPhase('playing');
  }, []);

  // Keyboard + gamepad via the shared input module. Queue turns so quick
  // double-taps don't let the snake reverse into itself within a single tick.
  useEffect(() => {
    if (phase === 'playing') {
      return attachGameInput({
        onDirection: (dir) => {
          const queue = dirQueueRef.current;
          const last = queue.length > 0 ? queue[queue.length - 1] : dirRef.current;
          if (dir.x === -last.x && dir.y === -last.y) return; // no 180° turns
          if (dir.x === last.x && dir.y === last.y) return;
          if (queue.length < 3) queue.push(dir);
        },
      });
    }
    if (phase === 'idle' || phase === 'saved') {
      return attachGameInput({ onConfirm: startGame });
    }
  }, [phase, startGame]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const timer = window.setInterval(() => {
      const queued = dirQueueRef.current.shift();
      if (queued) dirRef.current = queued;

      const result = step(snakeRef.current, dirRef.current, foodRef.current);
      if (result.dead) {
        setPhase('gameover');
        return;
      }
      snakeRef.current = result.snake;
      foodRef.current = result.food;
      if (result.ate) setScore((s) => s + POINTS_PER_APPLE);
      draw();
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [phase, draw]);

  const submitScore = async (e: FormEvent) => {
    e.preventDefault();
    const clean = initials.trim().toUpperCase();
    if (!clean) return;
    try {
      await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initials: clean, score }),
      });
      loadLeaderboard();
    } finally {
      setPhase('saved');
    }
  };

  return (
    <div className={styles.arcade}>
      <div className={styles.screenWrap}>
        <div className={styles.hud}>
          <span>SCORE: {score.toString().padStart(5, '0')}</span>
          <span>ARROWS / WASD / PAD</span>
        </div>
        <div className={styles.screen}>
          <canvas ref={canvasRef} className={styles.canvas} width={COLS * CELL} height={ROWS * CELL} />

          {phase === 'idle' && (
            <div className={styles.overlay}>
              <p className={styles.overlayTitle}>BIG TINY SNAKE</p>
              <p>One large field. One tiny snake. How long can you get?</p>
              <button type="button" className={styles.arcadeButton} onClick={startGame}>
                ▶ START
              </button>
            </div>
          )}

          {phase === 'gameover' && (
            <div className={styles.overlay}>
              <p className={styles.overlayTitle}>GAME OVER</p>
              <p>FINAL SCORE: {score}</p>
              <form className={styles.initialsForm} onSubmit={submitScore}>
                <label htmlFor="initials">ENTER INITIALS:</label>
                <input
                  id="initials"
                  className={styles.initialsInput}
                  value={initials}
                  onChange={(e) =>
                    setInitials(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3))
                  }
                  maxLength={3}
                  autoFocus
                  required
                />
                <button type="submit" className={styles.arcadeButton}>
                  SAVE
                </button>
              </form>
              <button type="button" className={styles.skipButton} onClick={() => setPhase('saved')}>
                skip
              </button>
            </div>
          )}

          {phase === 'saved' && (
            <div className={styles.overlay}>
              <p className={styles.overlayTitle}>NICE RUN!</p>
              <button type="button" className={styles.arcadeButton} onClick={startGame}>
                ▶ PLAY AGAIN
              </button>
            </div>
          )}
        </div>
      </div>

      <aside className={styles.leaderboard}>
        <h3 className={styles.leaderboardTitle}>HIGH SCORES</h3>
        <ol className={styles.scoreList}>
          {leaderboard.map((row, i) => (
            <li key={row.id} className={styles.scoreRow}>
              <span className={styles.rank}>{(i + 1).toString().padStart(2, '0')}</span>
              <span className={styles.scoreInitials}>{row.initials}</span>
              <span className={styles.scoreValue}>{row.score}</span>
            </li>
          ))}
          {leaderboard.length === 0 && <li className={styles.scoreEmpty}>NO SCORES YET</li>}
        </ol>
      </aside>
    </div>
  );
}
