// A single master volume (0..1) shared by every game's sound effects and
// persisted in localStorage, so the setting follows the player across games and
// sessions. Sfx multiplies its gain by getVolume(); the VolumeControl component
// on each title screen reads and writes it.

const KEY = "btg-volume";

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

function load(): number {
  try {
    const raw = localStorage.getItem(KEY);
    return raw == null ? 1 : clamp01(Number(raw));
  } catch {
    return 1;
  }
}

let current = load();
const listeners = new Set<(v: number) => void>();

export function getVolume(): number {
  return current;
}

export function setVolume(v: number): void {
  current = clamp01(v);
  try {
    localStorage.setItem(KEY, String(current));
  } catch {
    // Private mode / no storage — the setting just won't persist.
  }
  for (const l of listeners) l(current);
}

/** Subscribe to volume changes; returns an unsubscribe function. */
export function subscribeVolume(fn: (v: number) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
