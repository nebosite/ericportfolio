// Keep the browser's escape hatches — back/forward (incl. the mouse's side
// buttons) and the Esc key — from ever leaving or disrupting PixelWhimsy
// (containment: a random tap or keypress must never exit the toy).
//
// Layers:
//  1. Swallow the side-button events (mouse buttons 3/4) so they trigger nothing.
//  2. Trap history navigation. Preventing default on the button events does NOT
//     stop the browser's back/forward, so we park a sentinel history entry and
//     re-push it whenever a "back" pops it off — the navigation is undone before
//     anything unloads, so the page never actually leaves.
//  3. Swallow the Esc key. (Note: browsers force Esc to exit fullscreen and that
//     is not cancelable from script — the fullscreen re-prompt in PaintApp
//     covers that — but this stops every other Esc-driven default.)
//
// Returns a cleanup function that removes everything.
export function installNavContainment(): () => void {
  const blockButtons = (e: MouseEvent) => {
    if (e.button === 3 || e.button === 4) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const blockEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const reTrap = () => {
    try {
      history.pushState(null, "", window.location.href);
    } catch {
      /* history unavailable — nothing to trap */
    }
  };

  const opts = { capture: true } as const;
  window.addEventListener("mousedown", blockButtons, opts);
  window.addEventListener("mouseup", blockButtons, opts);
  window.addEventListener("auxclick", blockButtons, opts);
  window.addEventListener("keydown", blockEscape, opts);
  window.addEventListener("keyup", blockEscape, opts);
  window.addEventListener("popstate", reTrap);
  reTrap(); // seed a sentinel entry so the first back has something to pop

  return () => {
    window.removeEventListener("mousedown", blockButtons, opts);
    window.removeEventListener("mouseup", blockButtons, opts);
    window.removeEventListener("auxclick", blockButtons, opts);
    window.removeEventListener("keydown", blockEscape, opts);
    window.removeEventListener("keyup", blockEscape, opts);
    window.removeEventListener("popstate", reTrap);
  };
}
