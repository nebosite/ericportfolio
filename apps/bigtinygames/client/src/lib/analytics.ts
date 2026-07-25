// Thin wrapper around window.gtag so callers don't need to cast or
// guard; safe to call even when the GA script isn't loaded (local dev).
export function trackEvent(name: string, params?: Record<string, unknown>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).gtag?.("event", name, params);
}

/**
 * Record use of a game feature. Everything funnels through a single GA4 event —
 * `feature_used` — carrying the `game` and `feature` names (plus any extras), so
 * once `game` and `feature` are registered as custom dimensions you can break the
 * one event down by game AND feature in Explorations. Fire on discrete player
 * actions only (a click, a pickup) — never per animation frame.
 */
export function trackFeature(
  game: string,
  feature: string,
  params?: Record<string, unknown>,
): void {
  trackEvent("feature_used", { game, feature, ...params });
}
