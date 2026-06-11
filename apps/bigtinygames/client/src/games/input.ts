// Shared input for all Big Tiny games: keyboard (arrows/WASD, Enter/Space)
// and any connected gamepad (d-pad, left stick, A/Start) feed the same
// handlers, so every game supports both for free.

export type Vec = { x: number; y: number };

export interface GameInputHandlers {
  /** Fired once per direction press (keyboard) or direction change (gamepad). */
  onDirection?: (dir: Vec) => void;
  /** Enter / Space / gamepad A / Start. */
  onConfirm?: () => void;
}

const UP: Vec = { x: 0, y: -1 };
const DOWN: Vec = { x: 0, y: 1 };
const LEFT: Vec = { x: -1, y: 0 };
const RIGHT: Vec = { x: 1, y: 0 };

const KEY_DIRS: Record<string, Vec> = {
  ArrowUp: UP,
  ArrowDown: DOWN,
  ArrowLeft: LEFT,
  ArrowRight: RIGHT,
  w: UP,
  s: DOWN,
  a: LEFT,
  d: RIGHT,
};

const STICK_DEADZONE = 0.5;

/** Attach handlers; returns a cleanup function that detaches everything. */
export function attachGameInput({ onDirection, onConfirm }: GameInputHandlers): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      if (onConfirm) {
        e.preventDefault();
        onConfirm();
      }
      return;
    }
    const dir = KEY_DIRS[e.key] ?? KEY_DIRS[e.key.toLowerCase()];
    if (dir && onDirection) {
      e.preventDefault();
      onDirection(dir);
    }
  };
  window.addEventListener('keydown', onKey);

  // The Gamepad API has no events for sticks or the d-pad, so poll once per
  // frame and edge-detect: handlers fire only when the pad's state changes,
  // mirroring keydown's behavior.
  const lastDir = new Map<number, string>();
  const lastConfirm = new Map<number, boolean>();
  let raf = requestAnimationFrame(function poll() {
    for (const pad of navigator.getGamepads()) {
      if (!pad) continue;

      let dir: Vec | null = null;
      if (pad.buttons[12]?.pressed) dir = UP;
      else if (pad.buttons[13]?.pressed) dir = DOWN;
      else if (pad.buttons[14]?.pressed) dir = LEFT;
      else if (pad.buttons[15]?.pressed) dir = RIGHT;
      else {
        const ax = pad.axes[0] ?? 0;
        const ay = pad.axes[1] ?? 0;
        if (Math.abs(ax) > STICK_DEADZONE || Math.abs(ay) > STICK_DEADZONE) {
          dir = Math.abs(ax) >= Math.abs(ay) ? (ax < 0 ? LEFT : RIGHT) : (ay < 0 ? UP : DOWN);
        }
      }
      const key = dir ? `${dir.x},${dir.y}` : '';
      if (dir && key !== lastDir.get(pad.index) && onDirection) onDirection(dir);
      lastDir.set(pad.index, key);

      const confirm = Boolean(pad.buttons[0]?.pressed || pad.buttons[9]?.pressed);
      if (confirm && !lastConfirm.get(pad.index) && onConfirm) onConfirm();
      lastConfirm.set(pad.index, confirm);
    }
    raf = requestAnimationFrame(poll);
  });

  return () => {
    window.removeEventListener('keydown', onKey);
    cancelAnimationFrame(raf);
  };
}
