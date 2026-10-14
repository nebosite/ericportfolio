import { NO_PAD, PAD_BUTTON, readPad, type PadState } from "./controls";
import type { InputAction } from "./KeyboardSource";

// Gamepad API → PadState, polled once per frame (the API is poll-only). The
// first connected pad drives. Start restarts, B leaves, Back toggles the debug
// readout — fired on the press edge so holding a button doesn't repeat.

export class GamepadSource {
  connected = false;
  private readonly onAction: (action: InputAction) => void;
  private prev = { start: false, b: false, back: false };

  constructor(onAction: (action: InputAction) => void) {
    this.onAction = onAction;
  }

  poll(): PadState {
    const pad = firstPad();
    this.connected = pad !== null;
    if (!pad) return NO_PAD;
    const pressed = (i: number) => pad.buttons[i]?.pressed ?? false;
    const now = {
      start: pressed(PAD_BUTTON.start),
      b: pressed(PAD_BUTTON.b),
      back: pressed(PAD_BUTTON.back),
    };
    if (now.start && !this.prev.start) this.onAction("reset");
    if (now.b && !this.prev.b) this.onAction("quit");
    if (now.back && !this.prev.back) this.onAction("debug");
    this.prev = now;
    return readPad(pad);
  }
}

function firstPad(): Gamepad | null {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return null;
  for (const pad of navigator.getGamepads()) {
    if (pad && pad.connected) return pad;
  }
  return null;
}
