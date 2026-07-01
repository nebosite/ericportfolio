import { describe, it, expect, vi, afterEach } from "vitest";
import { installNavContainment } from "./containNav";

afterEach(() => vi.restoreAllMocks());

describe("installNavContainment", () => {
  it("swallows the mouse back/forward buttons but leaves normal clicks alone", () => {
    const cleanup = installNavContainment();
    try {
      for (const button of [3, 4]) {
        const ev = new MouseEvent("mousedown", {
          button,
          cancelable: true,
          bubbles: true,
        });
        window.dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(true);
      }
      const left = new MouseEvent("mousedown", {
        button: 0,
        cancelable: true,
        bubbles: true,
      });
      window.dispatchEvent(left);
      expect(left.defaultPrevented).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("swallows the Esc key but leaves other keys (e.g. exit-gate digits) alone", () => {
    const cleanup = installNavContainment();
    try {
      const esc = new KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
        bubbles: true,
      });
      window.dispatchEvent(esc);
      expect(esc.defaultPrevented).toBe(true);

      const digit = new KeyboardEvent("keydown", {
        key: "4",
        cancelable: true,
        bubbles: true,
      });
      window.dispatchEvent(digit);
      expect(digit.defaultPrevented).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("re-parks a history entry when a back pops the sentinel", () => {
    const push = vi.spyOn(history, "pushState");
    const cleanup = installNavContainment();
    try {
      expect(push).toHaveBeenCalledTimes(1); // seeded on install
      window.dispatchEvent(new PopStateEvent("popstate"));
      expect(push).toHaveBeenCalledTimes(2); // re-trapped, so nothing navigates
    } finally {
      cleanup();
    }
  });

  it("stops trapping after cleanup", () => {
    const cleanup = installNavContainment();
    cleanup();
    const push = vi.spyOn(history, "pushState");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(push).not.toHaveBeenCalled();
  });
});
