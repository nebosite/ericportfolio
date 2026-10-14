import { NO_KEYS, type KeyState } from "./controls";

// Keyboard → KeyState (held keys) plus one-shot actions. WASD and the arrows
// drive, Space is the handbrake, R restarts, Esc leaves, F3 toggles the debug
// readout. Arrow/space defaults are suppressed so the page doesn't scroll.

export type InputAction = "reset" | "quit" | "debug";

const HELD: Record<string, keyof KeyState> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  Space: "handbrake",
  ShiftLeft: "slow",
  ShiftRight: "slow",
};

const ACTIONS: Record<string, InputAction> = {
  KeyR: "reset",
  Escape: "quit",
  F3: "debug",
};

export class KeyboardSource {
  state: KeyState = { ...NO_KEYS };
  private readonly target: Window;
  private readonly onAction: (action: InputAction) => void;

  constructor(target: Window, onAction: (action: InputAction) => void) {
    this.target = target;
    this.onAction = onAction;
  }

  attach(): void {
    this.target.addEventListener("keydown", this.onKeyDown);
    this.target.addEventListener("keyup", this.onKeyUp);
    this.target.addEventListener("blur", this.onBlur);
  }

  detach(): void {
    this.target.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("keyup", this.onKeyUp);
    this.target.removeEventListener("blur", this.onBlur);
    this.state = { ...NO_KEYS };
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const held = HELD[e.code];
    if (held) {
      this.state = { ...this.state, [held]: true };
      e.preventDefault();
      return;
    }
    const action = ACTIONS[e.code];
    if (action && !e.repeat) {
      e.preventDefault();
      this.onAction(action);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const held = HELD[e.code];
    if (held) this.state = { ...this.state, [held]: false };
  };

  // Losing focus mid-drive must not leave a key stuck down.
  private onBlur = () => {
    this.state = { ...NO_KEYS };
  };
}
