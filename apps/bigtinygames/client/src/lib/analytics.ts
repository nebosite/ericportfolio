// Thin wrapper around window.gtag so callers don't need to cast or
// guard; safe to call even when the GA script isn't loaded (local dev).
export function trackEvent(name: string, params?: Record<string, unknown>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).gtag?.('event', name, params);
}
