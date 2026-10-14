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
