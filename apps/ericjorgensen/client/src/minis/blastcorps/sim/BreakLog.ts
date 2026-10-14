import { EVENT_FLOATS, MAX_BREAK_EVENTS, type MaterialKind } from "./protocol";

// Where and what broke this step: a bounded log of joint-failure positions the
// snapshot carries to the main thread for particles, sound and the driver's-eye
// view. When a collapse breaks more joints than fit, the overflow is counted but
// not stored — the first MAX_BREAK_EVENTS positions are plenty to spawn from.

export class BreakLog {
  readonly data = new Float32Array(MAX_BREAK_EVENTS * EVENT_FLOATS);
  /** Events stored (≤ capacity). */
  count = 0;
  /** Events offered, including any that did not fit. */
  total = 0;

  push(x: number, y: number, z: number, kind: MaterialKind): void {
    this.total++;
    if (this.count >= MAX_BREAK_EVENTS) return;
    const o = this.count * EVENT_FLOATS;
    this.data[o] = x;
    this.data[o + 1] = y;
    this.data[o + 2] = z;
    this.data[o + 3] = kind;
    this.count++;
  }

  /** Copy the stored events into a snapshot at `offset`. */
  writeTo(out: Float32Array, offset: number): void {
    out.set(this.data.subarray(0, this.count * EVENT_FLOATS), offset);
  }

  clear(): void {
    this.count = 0;
    this.total = 0;
  }
}
