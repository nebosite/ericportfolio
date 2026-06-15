import { describe, it, expect } from 'vitest';
import {
  COLS,
  ROWS,
  START_LENGTH,
  freshSnake,
  randomFood,
  step,
  type StepResult,
} from './snakeLogic';
import type { Vec } from '../input';

describe('freshSnake', () => {
  it('starts at center, full length, trailing left', () => {
    const snake = freshSnake();
    expect(snake).toHaveLength(START_LENGTH);
    expect(snake[0]).toEqual({ x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) });
    // Body trails to the left of the head along one row.
    for (let i = 1; i < snake.length; i++) {
      expect(snake[i]).toEqual({ x: snake[0].x - i, y: snake[0].y });
    }
  });
});

describe('randomFood', () => {
  it('never lands on the snake', () => {
    const snake = freshSnake();
    // Force the rng to first hit the head cell, then move on.
    const head = snake[0];
    const seq = [head.x / COLS, head.y / ROWS, 0.0, 0.0];
    let i = 0;
    const rng = () => seq[Math.min(i++, seq.length - 1)];
    const food = randomFood(snake, rng);
    expect(snake.some((s) => s.x === food.x && s.y === food.y)).toBe(false);
  });

  it('stays within the grid', () => {
    for (let n = 0; n < 50; n++) {
      const food = randomFood(freshSnake());
      expect(food.x).toBeGreaterThanOrEqual(0);
      expect(food.x).toBeLessThan(COLS);
      expect(food.y).toBeGreaterThanOrEqual(0);
      expect(food.y).toBeLessThan(ROWS);
    }
  });
});

describe('step', () => {
  const RIGHT: Vec = { x: 1, y: 0 };
  const UP: Vec = { x: 0, y: -1 };

  it('moves forward without growing when there is no food', () => {
    const snake = freshSnake();
    const food: Vec = { x: 0, y: 0 }; // far away
    const r = step(snake, RIGHT, food);
    expect(r.dead).toBe(false);
    expect(r.ate).toBe(false);
    expect(r.snake).toHaveLength(snake.length); // unchanged length
    expect(r.snake[0]).toEqual({ x: snake[0].x + 1, y: snake[0].y });
  });

  it('does not mutate the input snake', () => {
    const snake = freshSnake();
    const copy = snake.map((s) => ({ ...s }));
    step(snake, RIGHT, { x: 0, y: 0 });
    expect(snake).toEqual(copy);
  });

  it('grows by one and respawns food when eating', () => {
    const snake = freshSnake();
    const food: Vec = { x: snake[0].x + 1, y: snake[0].y };
    const r: StepResult = step(snake, RIGHT, food, () => 0);
    expect(r.ate).toBe(true);
    expect(r.snake).toHaveLength(snake.length + 1);
    expect(r.food).not.toEqual(food); // a new apple appeared
  });

  it('dies on running into a wall', () => {
    // Place a one-cell snake at the right edge facing right.
    const snake: Vec[] = [{ x: COLS - 1, y: 5 }];
    const r = step(snake, RIGHT, { x: 0, y: 0 });
    expect(r.dead).toBe(true);
  });

  it('dies on running into its own body', () => {
    // U-shape so that turning up drives the head into an occupied cell.
    const snake: Vec[] = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 4, y: 4 },
      { x: 5, y: 4 },
    ];
    const r = step(snake, UP, { x: 0, y: 0 });
    expect(r.dead).toBe(true);
  });
});
