import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import PaintApp from './PaintApp';

// Pin the exit problem so the gate is solvable/failable deterministically.
vi.mock('../lib/exitChallenge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/exitChallenge')>();
  return { ...actual, makeProblem: () => ({ a: 2, b: 2, answer: 4 }) };
});

afterEach(() => {
  cleanup();
  // Remove any fullscreen stub a test installed so others see "unsupported".
  delete (document.documentElement as Partial<HTMLElement>).requestFullscreen;
});

describe('PaintApp', () => {
  it('offers the four brush tools', () => {
    render(<PaintApp onExit={vi.fn()} />);
    for (const name of ['Tiny dot', 'Small brush', 'Big brush', 'Fill']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('has no clear button', () => {
    render(<PaintApp onExit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
  });

  it('exits only after the math gate is solved', () => {
    const onExit = vi.fn();
    render(<PaintApp onExit={onExit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect(onExit).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: '4' }); // 2 × 2 = 4
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('locks the exit with a countdown after a wrong answer', () => {
    render(<PaintApp onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    fireEvent.keyDown(window, { key: '9' }); // wrong → lock
    const locked = screen.getByRole('button', { name: /exit locked for \d+ seconds/i });
    expect(locked).toBeDisabled();
  });

  it('re-arms fullscreen on tap when resumed without it (e.g. after F5)', () => {
    const reqFs = vi.fn();
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: reqFs,
      configurable: true,
      writable: true,
    });
    render(<PaintApp onExit={vi.fn()} />);
    const prompt = screen.getByText(/tap to keep painting/i);
    fireEvent.pointerDown(prompt);
    expect(reqFs).toHaveBeenCalled();
    expect(screen.queryByText(/tap to keep painting/i)).not.toBeInTheDocument();
  });
});
