/** Makes /hands-high installable: manifest link + a service worker scoped to this page only. */

const SCOPE = "/hands-high";

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

/** Adds the manifest link for as long as the page is mounted; returns a cleanup. */
export function attachManifest(): () => void {
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = "/hands-high.webmanifest";
  document.head.appendChild(link);
  return () => link.remove();
}

/** Registers the offline service worker. Silent where service workers are unavailable. */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/hands-high-sw.js", { scope: SCOPE }).catch(() => {});
}

/** Asks the browser to keep the screen on; resolves to a release function (never throws). */
export async function keepScreenAwake(): Promise<() => void> {
  try {
    const wakeLock = (
      navigator as Navigator & {
        wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
      }
    ).wakeLock;
    const lock = await wakeLock?.request("screen");
    return () => {
      void lock?.release().catch(() => {});
    };
  } catch {
    return () => {};
  }
}

type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};

/** Hides the browser chrome (address bar). Must be called from a user gesture; never throws. */
export function enterFullscreen(): void {
  try {
    const el = document.documentElement as FullscreenElement;
    const request = el.requestFullscreen
      ? el.requestFullscreen({ navigationUI: "hide" })
      : el.webkitRequestFullscreen?.();
    void Promise.resolve(request).catch(() => {});
  } catch {
    /* fullscreen unsupported (e.g. iPhone Safari) — the marquee still works */
  }
}

/** Leaves fullscreen if we are in it; never throws. */
export function exitFullscreen(): void {
  try {
    const doc = document as FullscreenDocument;
    if (doc.fullscreenElement) void doc.exitFullscreen().catch(() => {});
    else if (doc.webkitFullscreenElement) doc.webkitExitFullscreen?.();
  } catch {
    /* nothing to exit */
  }
}
