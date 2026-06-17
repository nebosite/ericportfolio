import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ExitGate from './ExitGate';

afterEach(cleanup);

function renderGate(answer: number, handlers: Partial<Record<'onSolved' | 'onWrong' | 'onCancel', () => void>> = {}) {
  const onSolved = handlers.onSolved ?? vi.fn();
  const onWrong = handlers.onWrong ?? vi.fn();
  const onCancel = handlers.onCancel ?? vi.fn();
  const utils = render(
    <ExitGate
      problem={{ a: Math.floor(answer / 2) || 2, b: 2, answer }}
      onSolved={onSolved}
      onWrong={onWrong}
      onCancel={onCancel}
    />,
  );
  return { ...utils, onSolved, onWrong, onCancel };
}

describe('ExitGate', () => {
  it('solves on the exact answer, evaluated per keypress (no Enter)', () => {
    const { onSolved } = renderGate(56);
    fireEvent.keyDown(window, { key: '5' });
    expect(onSolved).not.toHaveBeenCalled(); // 5 is just a prefix of 56
    fireEvent.keyDown(window, { key: '6' });
    expect(onSolved).toHaveBeenCalledTimes(1);
  });

  it('fails fast on a wrong digit', () => {
    const { onWrong, onSolved } = renderGate(6);
    fireEvent.keyDown(window, { key: '7' });
    expect(onWrong).toHaveBeenCalledTimes(1);
    expect(onSolved).not.toHaveBeenCalled();
  });

  it('ignores non-digit keys', () => {
    const { container, onSolved, onWrong } = renderGate(20);
    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSolved).not.toHaveBeenCalled();
    expect(onWrong).not.toHaveBeenCalled();
    expect(container.textContent).toContain('?'); // nothing typed yet
  });

  it('keeps painting (cancels) when the backdrop is tapped', () => {
    const onCancel = vi.fn();
    const { container } = renderGate(4, { onCancel });
    fireEvent.pointerDown(container.firstChild as Element);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
