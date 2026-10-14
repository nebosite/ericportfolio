// Pure hi/lo tracking for the hardware-probe panel. Each named metric keeps
// its current value and the lowest and highest seen since the last reset, so a
// visitor can read "frame time now / best / worst" without watching for minutes.

export interface StatSample {
  current: number;
  low: number;
  high: number;
  /** Number of samples folded in since reset. */
  samples: number;
}

export class StatTracker {
  private readonly metrics = new Map<string, StatSample>();

  /** Fold a new value in. Non-finite values are ignored (a stalled readout shouldn't poison hi/lo). */
  record(name: string, value: number): void {
    if (!Number.isFinite(value)) return;
    const m = this.metrics.get(name);
    if (!m) {
      this.metrics.set(name, { current: value, low: value, high: value, samples: 1 });
      return;
    }
    m.current = value;
    if (value < m.low) m.low = value;
    if (value > m.high) m.high = value;
    m.samples++;
  }

  get(name: string): StatSample | undefined {
    return this.metrics.get(name);
  }

  names(): string[] {
    return [...this.metrics.keys()];
  }

  /** Forget history for one metric (or all), keeping nothing. */
  reset(name?: string): void {
    if (name === undefined) this.metrics.clear();
    else this.metrics.delete(name);
  }

  /** Snapshot every metric as plain data (for React state). */
  toRows(): { name: string; sample: StatSample }[] {
    return this.names().map((name) => ({ name, sample: { ...this.metrics.get(name)! } }));
  }
}

/** Format a number for the panel: integers as-is, otherwise a fixed number of decimals. */
export function formatStat(value: number, decimals = 1): string {
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toFixed(decimals);
}
