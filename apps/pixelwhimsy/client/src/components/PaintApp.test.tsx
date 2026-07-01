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

  it('has no always-on color strip; colors live behind the palette button', () => {
    render(<PaintApp onExit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Color palette' })).toBeInTheDocument();
    // no crayon swatch is shown until the palette is opened
    expect(
      screen.queryByRole('button', { name: 'Paint with #ff3b3b' }),
    ).not.toBeInTheDocument();
  });

  it('opens the color palette dialog and closes it with the ✕', () => {
    render(<PaintApp onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Color palette' }));
    // all the colors are offered — a crayon and an animated color
    expect(
      screen.getByRole('button', { name: 'Paint with #ff3b3b' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Animated color 1' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close colors' }));
    expect(
      screen.queryByRole('button', { name: 'Paint with #ff3b3b' }),
    ).not.toBeInTheDocument();
  });

  it('picking a color from the dialog dismisses it', () => {
    render(<PaintApp onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Color palette' }));
    fireEvent.click(screen.getByRole('button', { name: 'Paint with #7b5ee6' }));
    expect(
      screen.queryByRole('button', { name: 'Close colors' }),
    ).not.toBeInTheDocument();
  });

  it('offers clear and dark-mode buttons in the toolbar', () => {
    render(<PaintApp onExit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Clear screen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dark mode' })).toBeInTheDocument();
  });

  it('toggles between dark and light mode', () => {
    render(<PaintApp onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dark mode' }));
    expect(screen.getByRole('button', { name: 'Light mode' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Light mode' }));
    expect(screen.getByRole('button', { name: 'Dark mode' })).toBeInTheDocument();
  });

  it('clear screen button is clickable without error', () => {
    render(<PaintApp onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear screen' }));
    expect(screen.getByRole('button', { name: 'Clear screen' })).toBeInTheDocument();
  });

  it('exits only after the math gate is solved', () => {
    const onExit = vi.fn();
    render(<PaintApp onExit={onExit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect(onExit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Answer'), { target: { value: '4' } }); // 2 × 2 = 4
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('locks the exit with a countdown after a wrong answer', () => {
    render(<PaintApp onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    fireEvent.change(screen.getByLabelText('Answer'), { target: { value: '9' } }); // wrong → lock
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
