import { useCallback, useEffect, useRef, useState, FormEvent } from 'react';
import { attachGameInput, Vec } from '../input';
import {
  GameState,
  TICK_MS,
  CORPSE_LIFE,
  GHOST_LEN,
  GHOST_RUSH_FLASH,
  initialState,
  addFood,
  addGhostPowerup,
  step,
} from './snakeLogic';
import FeedbackPanel from '../../components/FeedbackPanel';
import { trackEvent } from '../../lib/analytics';
import styles from './SnakeGame.module.css';

// The Big Tiny aesthetic: tiny 8x8 sprites on a field that fills the screen.
// Movement / collision / spawning rules live in snakeLogic.ts (unit tested);
// CELL and the timers are presentation-only.
const CELL = 8;
const FOOD_EVERY_MS = 3000; // a new food drops in on this cadence
const GHOST_POWERUP_FIRST_MS = 4000; // first Ghost powerup appears ~4s into a game
const GHOST_POWERUP_EVERY_MS = 20000; // and then roughly every ~20s
// Driven off the game loop (in ticks) rather than a wall-clock timer, so it
// always fires while the loop is running.
const GHOST_FIRST_TICKS = Math.round(GHOST_POWERUP_FIRST_MS / TICK_MS);
const GHOST_EVERY_TICKS = Math.round(GHOST_POWERUP_EVERY_MS / TICK_MS);
const MIDNIGHT_BLUE = [25, 25, 112]; // ghost trails fade toward this

type Phase = 'idle' | 'playing' | 'gameover' | 'saved';

interface ScoreRow {
  id: number;
  initials: string;
  score: number;
  created_at: string;
}

// SPRITES — 8x8 one-bit patterns drawn in code so they're easy to tweak later.
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
const SPRITE_ROCK = [
  '..####..',
  '.######.',
  '########',
  '########',
  '########',
  '########',
  '.######.',
  '..####..',
];
const SPRITE_GHOST = [
  '..####..',
  '.######.',
  '##.##.##',
  '##.##.##',
  '########',
  '########',
  '########',
  '#.#..#.#',
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
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState | null>(null);
  const dirRef = useRef<Vec>({ x: 1, y: 0 });
  const dirQueueRef = useRef<Vec[]>([]);
  const tickRef = useRef(0);

  const [phase, setPhase] = useState<Phase>('idle');
  const [score, setScore] = useState(0);
  const [alive, setAlive] = useState(0);
  const [ghosts, setGhosts] = useState(0);
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
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.fillStyle = '#0d0d14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const state = stateRef.current;
    if (!state) return;

    // Permanent deadly rocks, then dying segments fading bright-white → black.
    for (const r of state.rocks) drawSprite(ctx, SPRITE_ROCK, r.x, r.y, '#6f6f82');
    for (const c of state.corpses) {
      const v = Math.round((255 * c.life) / CORPSE_LIFE); // life=full → white, 0 → black
      drawSprite(ctx, SPRITE_BODY, c.x, c.y, `rgb(${v},${v},${v})`);
    }

    for (const f of state.foods) drawSprite(ctx, SPRITE_APPLE, f.x, f.y, '#ff5757');

    // The Ghost powerup throbs between blue and white.
    if (state.ghostPowerup) {
      const pulse = 0.5 + 0.5 * Math.sin(((Date.now() % 700) / 700) * Math.PI * 2);
      const r = Math.round(120 + 135 * pulse);
      const g = Math.round(150 + 105 * pulse);
      drawSprite(ctx, SPRITE_GHOST, state.ghostPowerup.x, state.ghostPowerup.y, `rgb(${r},${g},255)`);
    }

    state.snakes.forEach((snake, si) => {
      // Ghost-rushing snakes go blue; in the last 2s they flash blue↔green.
      const buff = state.buffs[si] ?? 0;
      const flashing = buff > 0 && buff <= GHOST_RUSH_FLASH;
      const blue = buff > 0 && (!flashing || Date.now() % 320 < 160);
      const bodyA = blue ? '#2f6fd6' : '#2f9e4c';
      const bodyB = blue ? '#5a9bff' : '#3dbf5e';
      const headColor = blue ? '#a9d6ff' : '#57ff7a';
      for (let i = snake.length - 1; i >= 1; i--) {
        // Alternate two shades so the body reads as segments even at 8px.
        drawSprite(ctx, SPRITE_BODY, snake[i].x, snake[i].y, i % 2 === 0 ? bodyA : bodyB);
      }
      drawSprite(ctx, SPRITE_HEAD, snake[0].x, snake[0].y, headColor);
    });

    // Ghost snakes ride on top, their tails fading bright-white → midnight blue.
    for (const ghost of state.ghosts) {
      for (let i = ghost.trail.length - 1; i >= 1; i--) {
        const c = ghost.trail[i];
        if (c.x < 0 || c.y < 0 || c.x >= state.cols || c.y >= state.rows) continue;
        const t = i / GHOST_LEN;
        const r = Math.round(255 + (MIDNIGHT_BLUE[0] - 255) * t);
        const g = Math.round(255 + (MIDNIGHT_BLUE[1] - 255) * t);
        const b = Math.round(255 + (MIDNIGHT_BLUE[2] - 255) * t);
        drawSprite(ctx, SPRITE_BODY, c.x, c.y, `rgb(${r},${g},${b})`);
      }
      const head = ghost.trail[0];
      if (head.x >= 0 && head.y >= 0 && head.x < state.cols && head.y < state.rows) {
        drawSprite(ctx, SPRITE_GHOST, head.x, head.y, '#ffffff');
      }
    }
  }, []);

  // Size the canvas to the stage (fills the viewport, Big-Pac style) and start.
  const startGame = useCallback(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const cols = Math.max(10, Math.floor(stage.clientWidth / CELL));
    const rows = Math.max(10, Math.floor(stage.clientHeight / CELL));
    canvas.width = cols * CELL;
    canvas.height = rows * CELL;
    stateRef.current = initialState(cols, rows);
    dirRef.current = { x: 1, y: 0 };
    dirQueueRef.current = [];
    tickRef.current = 0;
    setScore(0);
    setAlive(stateRef.current.snakes.length);
    setGhosts(0);
    setInitials('');
    setPhase('playing');
  }, []);

  // Redraw whenever the phase changes (e.g. to show the cleared field).
  useEffect(draw, [draw, phase]);

  // Keyboard + gamepad via the shared input module. One heading steers every
  // snake. Queue turns so quick double-taps can't reverse within a single tick.
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

  // Main game loop.
  useEffect(() => {
    if (phase !== 'playing') return;
    const timer = window.setInterval(() => {
      const queued = dirQueueRef.current.shift();
      if (queued) dirRef.current = queued;

      let next = step(stateRef.current!, dirRef.current);

      // Drop a Ghost powerup on a cadence measured in ticks (first ~4s, then
      // ~20s). addGhostPowerup is a no-op while one is already on the field.
      tickRef.current += 1;
      if (
        !next.over &&
        tickRef.current >= GHOST_FIRST_TICKS &&
        (tickRef.current - GHOST_FIRST_TICKS) % GHOST_EVERY_TICKS === 0
      ) {
        next = addGhostPowerup(next);
      }

      stateRef.current = next;
      setScore(next.score);
      setAlive(next.snakes.length);
      setGhosts(next.ghosts.length);
      if (next.over) {
        trackEvent('game_over', { game: 'snake', score: next.score });
        setPhase('gameover');
        return;
      }
      draw();
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [phase, draw]);

  // Drop a fresh food in every few seconds.
  useEffect(() => {
    if (phase !== 'playing') return;
    const timer = window.setInterval(() => {
      if (stateRef.current) {
        stateRef.current = addFood(stateRef.current);
        draw();
      }
    }, FOOD_EVERY_MS);
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
      trackEvent('score_submitted', { game: 'snake', score, initials: clean });
      loadLeaderboard();
    } finally {
      setPhase('saved');
    }
  };

  const Leaderboard = () => (
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
  );

  return (
    <div className={styles.game}>
      <div className={styles.hud}>
        <span>SCORE: {score.toString().padStart(6, '0')}</span>
        <span>SNAKES ×{alive}</span>
        {ghosts > 0 && <span className={styles.ghostCount}>GHOSTS ×{ghosts}</span>}
        <span>ARROWS / WASD / PAD</span>
      </div>

      <div ref={stageRef} className={styles.stage}>
        <canvas ref={canvasRef} className={styles.canvas} />

        {phase === 'idle' && (
          <div className={styles.overlay}>
            <p className={styles.overlayTitle}>BIG TINY SNAKE</p>
            <p>One field, one heading, ever more snakes. Eat to multiply — keep them all alive.</p>
            <p>Grab the throbbing 👻 Ghost for a wild burst — but beware its sweeping trails.</p>
            <button type="button" className={styles.arcadeButton} onClick={startGame}>
              ▶ START
            </button>
            <FeedbackPanel entity="snake" />
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
                  setInitials(
                    e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, '')
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
            <button type="button" className={styles.skipButton} onClick={() => setPhase('saved')}>
              skip
            </button>
            <Leaderboard />
          </div>
        )}

        {phase === 'saved' && (
          <div className={styles.overlay}>
            <p className={styles.overlayTitle}>NICE RUN!</p>
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
