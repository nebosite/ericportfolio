// Pure game logic for Big Tiny Snake, separated from the React/canvas component
// so the movement, growth, and death rules can be unit tested directly.

import { Vec } from '../input';

export const COLS = 100;
export const ROWS = 75;
export const START_LENGTH = 6;
export const POINTS_PER_APPLE = 10;

/** A fresh snake: head at center, body trailing to the left. */
export function freshSnake(): Vec[] {
  const startX = Math.floor(COLS / 2);
  const startY = Math.floor(ROWS / 2);
  return Array.from({ length: START_LENGTH }, (_, i) => ({ x: startX - i, y: startY }));
}

/** A random food cell that is not currently under the snake. */
export function randomFood(snake: Vec[], rng: () => number = Math.random): Vec {
  let food: Vec;
  do {
    food = { x: Math.floor(rng() * COLS), y: Math.floor(rng() * ROWS) };
  } while (snake.some((s) => s.x === food.x && s.y === food.y));
  return food;
}

export interface StepResult {
  snake: Vec[];
  food: Vec;
  ate: boolean;
  dead: boolean;
}

/**
 * Advance the snake one tick in `dir`. Returns the next snake/food plus whether
 * it ate or died; the inputs are never mutated. Running into a wall or into the
 * snake's own body is death (matching the classic feel where the tail cell is
 * still occupied at the moment of the step).
 */
export function step(
  snake: Vec[],
  dir: Vec,
  food: Vec,
  rng: () => number = Math.random,
): StepResult {
  const head = snake[0];
  const next: Vec = { x: head.x + dir.x, y: head.y + dir.y };

  const hitWall = next.x < 0 || next.x >= COLS || next.y < 0 || next.y >= ROWS;
  const hitSelf = snake.some((s) => s.x === next.x && s.y === next.y);
  if (hitWall || hitSelf) {
    return { snake, food, ate: false, dead: true };
  }

  const grown = [next, ...snake];
  if (next.x === food.x && next.y === food.y) {
    return { snake: grown, food: randomFood(grown, rng), ate: true, dead: false };
  }
  grown.pop(); // no food: tail follows the head
  return { snake: grown, food, ate: false, dead: false };
}
