import { useEffect } from "react";
import { trackEvent } from "./analytics";

/**
 * Accumulates the *foreground* time a screen is engaged with. Feed it real
 * timestamps (ms) and visibility changes; it only counts time while visible, so
 * a tab left open in the background doesn't inflate the duration. Pure and
 * framework-free so the accounting is unit-tested away from the DOM.
 */
export class EngagementClock {
  private acc = 0; // completed visible ms
  private visible: boolean;
  private since: number; // start of the current visible stretch

  constructor(now: number, visible = true) {
    this.visible = visible;
    this.since = now;
  }

  /** Record a visibility change at time `now` (ms). Same-state calls are ignored. */
  setVisible(visible: boolean, now: number): void {
    if (visible === this.visible) return;
    if (this.visible) this.acc += Math.max(0, now - this.since);
    this.visible = visible;
    this.since = now;
  }

  /** Total visible milliseconds accumulated up to `now`. */
  elapsedMs(now: number): number {
    return this.acc + (this.visible ? Math.max(0, now - this.since) : 0);
  }
}

/**
 * Track how often and how long a screen is engaged with. Fires `engage_start`
 * on mount (its count answers "how often") and `engage_end` on leave — unmount
 * or the page going away — carrying the foreground `seconds` spent (how long).
 * Time while the tab is hidden isn't counted.
 */
export function useEngagement(entity: string): void {
  useEffect(() => {
    trackEvent("engage_start", { entity });
    const clock = new EngagementClock(Date.now(), document.visibilityState === "visible");
    let sent = false;
    const onVisibility = () => clock.setVisible(document.visibilityState === "visible", Date.now());
    const finish = () => {
      if (sent) return;
      sent = true;
      trackEvent("engage_end", {
        entity,
        seconds: Math.round(clock.elapsedMs(Date.now()) / 1000),
      });
    };
    document.addEventListener("visibilitychange", onVisibility);
    // pagehide catches mobile tab-close / navigation where unmount won't run.
    window.addEventListener("pagehide", finish);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", finish);
      finish();
    };
  }, [entity]);
}
